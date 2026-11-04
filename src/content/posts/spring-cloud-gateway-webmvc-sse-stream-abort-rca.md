---
title: "AI 智能体接入 DeepSeek 的流式网关报警排查：Spring Cloud Gateway WebMVC 异常处理机制"
description: "在微服务网关代理后端智能体与 DeepSeek 大模型的 SSE 流式输出时，上游超时断开会导致网关抛出未捕获异常并派发至 /error，引发报警风暴。本文深入源码剖析全链路故障与核心架构约束。"
publishDate: 2026-11-04
tags: ["Spring Cloud Gateway", "DeepSeek", "SSE", "AI 智能体", "源码剖析", "故障排查"]
readTime: "约 12 分钟"
refLink:
  text: "github.com/spring-cloud/spring-cloud-gateway/issues/4357"
  url: "https://github.com/spring-cloud/spring-cloud-gateway/issues/4357#issuecomment-6628205979"
---

## 一、业务背景

我们最近在给产品接入 AI 智能体（Agent），底层大模型对接了 **DeepSeek**（如 DeepSeek-R1 / V3）。大模型在思考（CoT 推理过程）和逐字吐出 Token 时的耗时较长，整条调用链路采用基于 HTTP Chunked 分块传输的 **SSE（Server-Sent Events）** 协议：

```text
[客户端 (Browser / App)]
       │
       │ (HTTP / SSE 流)
       ▼
[Spring Cloud Gateway Server WebMVC] (鉴权、路由、限流)
       │
       │ (HTTP / SSE 流)
       ▼
[后端微服务 (Agent 业务编排)]
       │
       │ (HTTPS / SSE 流)
       ▼
[大模型服务 (DeepSeek API)]
```

网关选型使用的是 Spring Boot 3+ / 4.x 体系下的 `spring-cloud-gateway-server-webmvc`。服务在完成常规功能测试后部署上线。

---

## 二、上线后的异常现象

上线首日下午，随着大模型调用并发量上升，DeepSeek 接口偶有思考耗时过长或网络抖动的情况。很快，监控群收到了告警通知：

```text
告警：网关集群 5xx 错误率上升，Tomcat 抛出未捕获异常。
```

排查网关日志，发现了大量未捕获异常与堆栈：

```log
ERROR o.a.c.c.C.[.[.[/].[dispatcherServlet] : Servlet.service() for servlet [dispatcherServlet] in context with path [] threw exception
java.io.IOException: closed
	at o.s.c.g.server.mvc.common.AbstractProxyExchange.copyResponseBodyWithFlushing(AbstractProxyExchange.java:97)
	at o.s.c.g.server.mvc.common.AbstractProxyExchange.copyResponseBody(AbstractProxyExchange.java:50)
	at o.s.c.g.server.mvc.handler.RestClientProxyExchange.lambda$doExchange$3(RestClientProxyExchange.java:82)
	at o.s.c.g.server.mvc.handler.GatewayServerResponseBuilder$WriteFunctionResponse.writeToInternal(GatewayServerResponseBuilder.java:232)
	at o.s.c.g.server.mvc.handler.AbstractGatewayServerResponse.writeTo(AbstractGatewayServerResponse.java:97)
	at o.s.web.servlet.function.support.HandlerFunctionAdapter.handle(HandlerFunctionAdapter.java:110)
	at o.s.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:963)
	...
Caused by: java.io.IOException: chunked transfer encoding, state: READING_LENGTH
Caused by: java.net.SocketException: Connection reset

DEBUG o.s.web.servlet.DispatcherServlet : "INCLUDE" dispatch for POST "/error", parameters={}
WARN  .w.s.m.s.DefaultHandlerExceptionResolver : Resolved [org.springframework.http.converter.HttpMessageNotWritableException: No converter for [class java.util.LinkedHashMap] with preset Content-Type 'text/event-stream']
```

伴随该异常的，还有一条相关的警告日志：
`HttpMessageNotWritableException: No converter for [class java.util.LinkedHashMap] with preset Content-Type 'text/event-stream'`。

此时对比两端表现：
- **客户端**：收到了被截断的流。由于上游连接中断，前端可以捕获到网络异常并提示用户重试。
- **网关服务端**：将这一常见的上游网络断开视作未处理异常，打印完整 ERROR 堆栈，并尝试将请求转发到 `/error` 页面。

---

## 三、涉及的核心类与组件

该异常穿透了从后端模型服务到 Servlet 容器的调用链路，涉及的核心组件如下：

| 层次 | 核心类 / 组件 | 说明 |
| :--- | :--- | :--- |
| **大模型 / 上游服务** | `DeepSeek API / 后端智能体微服务` | 返回 `200 OK` 并向网关推送部分 SSE Token 后，因推理耗时超过超时阈值（或触发上游限流断连），关闭了 Socket 连接（发送 TCP RST）。 |
| **Servlet 容器** | `Tomcat (StandardHostValve)` | 接收来自 `DispatcherServlet` 外抛的异常，打印 `ERROR` 日志，并尝试转发至 `/error`。 |
| **Spring MVC** | `DispatcherServlet` | 核心分发器；在响应流输出阶段捕获外抛异常，协助派发错误。 |
| | `HandlerFunctionAdapter` | 适配函数式路由，执行 `ServerResponse.writeTo()`。 |
| | `DefaultHandlerExceptionResolver` | 在 `/error` 尝试输出默认 JSON 时，因原响应头已被置为 `text/event-stream` 无法转换，抛出 `HttpMessageNotWritableException`。 |
| **SCG WebMVC** | `AbstractGatewayServerResponse` | 网关响应基类，发送响应头并将响应标记为 `isCommitted() = true`。 |
| | `RestClientProxyExchange` | 基于 Spring `RestClient` 实现代理转发，持有后端返回的响应体输入流。 |
| | `AbstractProxyExchange` | **异常抛出点**。执行 `copyResponseBodyWithFlushing()` 边读边写，因上游 Socket 关闭抛出 `IOException: closed`。 |

---

## 四、错误调用链路与流程图解

### 1. 异常流转与架构分层

该流程展示了异常在各层之间的传递路径，以及网关 Filter 无法拦截该异常的原因：

```text
[客户端 (Browser / App)]
       │
       │ (1. 发起智能体对话 SSE 请求)
       ▼
[Tomcat (StandardHostValve)]
       │
       ▼
[DispatcherServlet]
       │
       ▼
[Gateway Filters]  ───(过滤器链执行完毕，正常返回退栈)
       │
       ▼
[AbstractGatewayServerResponse]
       │  (发送响应头 200 text/event-stream，isCommitted = true)
       ▼
[AbstractProxyExchange (copyResponseBodyWithFlushing)]
       │
       ├─► (边读边刷盘转发) ──► 客户端
       │
       ▲
       │ (2. 后端服务 / DeepSeek 推理超时断开，发送 TCP RST)
[后端业务微服务 / DeepSeek API]
       │
       ▼
【第一现场】AbstractProxyExchange.read() 抛出 IOException
       │
       ▼ (绕过 Filters，向外冒泡)
[DispatcherServlet]
       │
       ▼ (逃逸出 DispatcherServlet)
[Tomcat Engine] ──► 打印 ERROR 日志与完整堆栈（触发告警）
       │
       ▼ (3. 尝试内部派发)
/error 重定向 ──► Content-Type 冲突 ──► 抛出 HttpMessageNotWritableException
```

### 2. 端到端调用时序

```text
客户端                   Tomcat             DispatcherServlet        GatewayFilters       SCG Response & Proxy        后端微服务 / DeepSeek
  │                         │                       │                      │                       │                                │
  │──── 1. 发起对话请求 ────►│                       │                      │                       │                                │
  │                         │──── service() ───────►│                      │                       │                                │
  │                         │                       │─── 执行前置过滤器 ───►│                       │                                │
  │                         │                       │◄── 过滤器链返回 ─────│                       │                                │
  │                         │                       │─── writeTo() ────────────────────────────────►│                                │
  │◄─── 响应头 200 (isCommitted = true) ────────────────────────────────────────────────────────────│                                │
  │                         │                       │                      │                       │                                │
  │                         │                       │                      │        [边读边向客户端推送 Chunk]                        │
  │                         │                       │                      │                       │─── read() ────────────────────►│
  │◄─── SSE Token 推送 ────────────────────────────────────────────────────────────────────────────│◄── 返回 Token (思维链/内容) ──│
  │                         │                       │                      │                       │                                │
  │                         │                       │                      │                       │    (DeepSeek 超时 / 连接中断)   │
  │                         │                       │                      │                       │◄── TCP RST / Reset ────────────│
  │                         │                       │                      │                       │                                │
  │                         │                       │                      │                       │【第一现场】                     │
  │                         │                       │                      │                       │ read() 抛出异常                 │
  │                         │                       │◄── 抛出 IOException (Filter 已退出) ──────────│                                │
  │                         │◄── 逃逸出 Servlet ────│                                                                               │
  │                         │                                                                                                       │
  │                         │─── 打印 ERROR 日志与堆栈 (触发告警)                                                                    │
  │                         │                                                                                                       │
  │                         │─── 内部重定向派发至 /error ──► DispatcherServlet                                                      │
  │                         │                                  │                                                                    │
  │                         │                                  └──► Content-Type 为 text/event-stream                                │
  │                         │                                       输出 JSON 失败，抛出 HttpMessageNotWritableException             │
```

---

## 五、原因分析

在尝试进行应用层兜底拦截时，有几处机制限制了常规处理方式：

1. **Filter 无法捕获该异常**：
   在 Spring Cloud Gateway WebMVC 中，读取上游响应体并复制到客户端发生在 `ServerResponse.writeTo()` 阶段。此时所有 `HandlerFilterFunction` 已执行完毕并退栈，Filter 中的 `try-catch` 无法捕获后续流传输过程中的异常。
2. **`DisconnectedClientHelper` 的判定方向冲突**：
   Spring 框架提供了 `DisconnectedClientHelper`，用来处理客户端提前断开连接的场景（通过匹配 "Connection reset"、"Broken pipe" 等关键字进行静默处理）。在当前场景下，断开连接的是上游服务端，网络表现与客户端断开类似，直接套用会导致方向误判。
3. **已提交响应（Committed Response）无法重定向**：
   当状态码与响应头发送给客户端后，`response.isCommitted()` 变为 `true`。此时 Servlet 容器派发 `/error` 无法重新发送状态码，而且 Spring Boot 的错误处理器默认尝试输出 JSON 格式的错误体，与原本协商好的 `text/event-stream` 冲突，进而引发二次异常。

---

## 六、网关处理流式中断的两个核心约束

在针对该问题设计解决方案时（参考 [Spring Cloud Gateway Issue #4357](https://github.com/spring-cloud/spring-cloud-gateway/issues/4357#issuecomment-6628205979)），需要注意两个技术边界：

### 约束 1：不能直接忽略异常（避免静默截断）
如果在 `copyResponseBodyWithFlushing` 中捕获 `IOException` 并让方法正常返回，Servlet 容器（Tomcat）会认为请求已正常处理完毕，在流末尾追加写入 Chunked 终止块（**`0\r\n\r\n`**）。
客户端接收到终止块后，会判定整个传输正常结束，导致前端**无法感知回答已被中途截断**。
因此，当上游异常中断时，网关必须直接中断或重置下游连接，使客户端能够明确检测到传输未完成。

### 约束 2：避免对已提交响应记录 ERROR 日志和触发二次派发
对于反向代理网关来说，上游超时或网络抖动属于常态网络事件。在响应已经提交后，不应将其作为网关未处理的系统故障输出 ERROR 堆栈，也不应触发容器级别的 `/error` 派发。

---

## 七、工程处理方式与落地实现

由于 `copyResponseBodyWithFlushing` 是 `AbstractProxyExchange` 内部的底层方法，普通网关 Filter 无法直接 `try-catch` 到该过程。在官方提供原生配置或优化之前，可以通过以下方式优雅落地：

### 1. 规避方案落地：Filter + 装饰响应包装器
利用最外层的 Servlet Filter 结合 `HttpServletResponseWrapper` 拦截输出流：
- 通过包装器监控是否是写往客户端（下游）报错；
- 如果写客户端未报错，但整体流程外抛异常且响应已提交（`isCommitted() == true`），说明是**上游后端服务 / DeepSeek 读流中断**；
- 此时记录指标并抛出 Tomcat 底层的 `CloseNowException`。Tomcat 会在 DEBUG 级别处理该异常，直接断开连接且不写入 `0\r\n\r\n`，同时不会触发 `/error` 转发。

```java
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.apache.coyote.CloseNowException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SseStreamAbortHandlingFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(SseStreamAbortHandlingFilter.class);

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        ClientAbortTrackingResponseWrapper wrappedResponse = 
                new ClientAbortTrackingResponseWrapper(httpResponse);

        try {
            chain.doFilter(request, wrappedResponse);
        } catch (Exception ex) {
            // 响应已提交 (SSE 已开始推送) 且写客户端没有失败，说明是上游断开
            if (httpResponse.isCommitted() && !wrappedResponse.isClientWriteFailed()) {
                log.info("Upstream DeepSeek/Agent stream aborted prematurely: {}", ex.getMessage());
                // 抛出 Tomcat 识别的底层断开异常，避免写入终止块且避免 ERROR 日志
                throw new CloseNowException(ex);
            }
            throw ex;
        }
    }

    private static class ClientAbortTrackingResponseWrapper extends HttpServletResponseWrapper {
        private boolean clientWriteFailed = false;

        public ClientAbortTrackingResponseWrapper(HttpServletResponse response) {
            super(response);
        }

        @Override
        public ServletOutputStream getOutputStream() throws IOException {
            ServletOutputStream delegate = super.getOutputStream();
            return new ServletOutputStream() {
                @Override
                public boolean isReady() {
                    return delegate.isReady();
                }

                @Override
                public void setWriteListener(WriteListener writeListener) {
                    delegate.setWriteListener(writeListener);
                }

                @Override
                public void write(int b) throws IOException {
                    try {
                        delegate.write(b);
                    } catch (IOException e) {
                        clientWriteFailed = true;
                        throw e;
                    }
                }

                @Override
                public void write(byte[] b, int off, int len) throws IOException {
                    try {
                        delegate.write(b, off, len);
                    } catch (IOException e) {
                        clientWriteFailed = true;
                        throw e;
                    }
                }

                @Override
                public void flush() throws IOException {
                    try {
                        delegate.flush();
                    } catch (IOException e) {
                        clientWriteFailed = true;
                        throw e;
                    }
                }
            };
        }

        public boolean isClientWriteFailed() {
            return clientWriteFailed;
        }
    }
}
```

此外，可在网关中禁用默认的错误页面自动装配：
```java
@SpringBootApplication(exclude = { ErrorMvcAutoConfiguration.class })
public class GatewayApplication {
    // ...
}
```

### 2. 监控与超时配置
- **指标拆分**：将流式传输过程中的上游断开与网关自身的 5xx 告警分离，通过专用指标（如 `gateway.upstream.stream.aborted`）监控后端智能体服务与 DeepSeek 的稳定性。
- **调整超时配置**：DeepSeek 思考与生成文本时间较长，需要在网关路由中针对流式端点单独调大 `RestClient` 的读取超时时间（`readTimeout`），同时确保后端微服务到 DeepSeek 的 HTTP Client 连接保活参数合理，减少非必要的超时断开。

---

## 八、总结

使用 Spring Cloud Gateway WebMVC 代理长连接与流式响应时，需要注意底层 Servlet 容器在流输出阶段的行为特点：
1. 流传输过程中的上游断开需要与网关本身的代码缺陷区分对待；
2. 异常处理时既要防止容器派发错误引发日志风暴，也要确保连接被及时掐断以防止客户端遭遇静默数据截断。
