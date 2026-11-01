---
title: "Spring Cloud Gateway 丢失客户端真实 Host：RFC 7239 与 framework 策略的冲突排查"
description: "在网关级联与多级反向代理场景下，配置 server.forward-headers-strategy=framework 会导致下游服务获取客户端原始 Host 异常。本文深入 Spring Boot 与 Spring Cloud Gateway 源码，剖析 ForwardedHeaderTransformer 与 ForwardedHeadersFilter 的数据源冲突根因，并给出修复方案与避坑实践。"
publishDate: 2026-11-01
tags: ["Spring Cloud Gateway", "Spring Boot", "源码剖析", "网络协议", "故障排查"]
readTime: "约 10 分钟"
refLink:
  text: "github.com/spring-cloud/spring-cloud-gateway/issues/4326"
  url: "https://github.com/spring-cloud/spring-cloud-gateway/issues/4326"
---

在微服务架构中，客户端请求到达最终的业务服务通常会经过多层反向代理：

```text
客户端 (Browser/App)
       │
       ▼
[Edge Ingress / Nginx / ALB] (公网入口)
       │
       ▼
[Spring Cloud Gateway - 网关 A] (业务路由/鉴权边缘)
       │
       ▼
[Spring Cloud Gateway - 网关 B] (内网子域/服务集群网关)
       │
       ▼
[下游微服务] (业务系统、OAuth2 回调、Swagger)
```

为了让下游微服务获知客户端的真实 IP、访问域名（`Host`）和协议（`https`），系统依赖反向代理传递转发头。除了传统的 `X-Forwarded-*` 系列，IETF 也制定了标准化的 **RFC 7239（`Forwarded` 请求头）**。

在网关上开启 RFC 7239 支持后，遇到了一个问题：**下游服务拿到的协议和客户端 IP 都正确，但原始 Host 却变成了上一级网关自身的内网地址**。

本文梳理该问题的排查过程，并从 Spring Boot 和 Spring Cloud Gateway 的源码层面分析其根因（对应 GitHub Issue [spring-cloud/spring-cloud-gateway#4326](https://github.com/spring-cloud/spring-cloud-gateway/issues/4326)）。

---

## 一、 现场现象与业务影响

### 1. 业务场景

下游微服务有几类功能依赖客户端的原始 Host：
- **OAuth2 / SSO 单点登录回调**：认证失败或换取 Token 时，后端拼接 `redirect_uri` 需要使用公网 Host；
- **SaaS 多租户分流**：根据二级域名（如 `tenant-a.example.com`）识别租户身份与数据源；
- **OpenAPI / Swagger 文档**：生成文档页面的 Servers Base URL。

网关配置了以下参数，启用框架级转发头处理和 RFC 7239 支持：

```yaml
server:
  forward-headers-strategy: framework

spring:
  cloud:
    gateway:
      server:
        webflux:
          forwarded:
            enabled: true
```

### 2. Header 异常表现

配置生效后，下游微服务的重定向跳转异常，OAuth2 认证跳转到了 `http://internal-gateway:8080/login`，而非公网客户端访问的 `https://api.fengstack.com/login`。

查看下游收到的 HTTP 请求头 `Forwarded` 字段：

```http
Forwarded: proto=https;for=114.242.25.10;host=internal-gateway:8080
```

拆解各字段：
1. `proto=https`：正确，保留了公网客户端的 TLS 协议；
2. `for=114.242.25.10`：正确，透传了客户端公网 IP；
3. `host=internal-gateway:8080`：错误，公网域名 `api.fengstack.com` 丢失，变成了网关自己的内网地址。

此外，RFC 7239 支持在多级代理下以逗号追加多个代理节点的信息，但下游最终只收到了这一条，上游代理的历史记录全部丢失。

---

## 二、 触发条件排查

在常规单层网关场景下，该问题往往不会暴露。对比不同网络拓扑后，可以确定触发问题的三个条件：

```text
┌────────────────────────────────────────────────────────┐
│ 触发条件 1：server.forward-headers-strategy=framework  │
│ 触发条件 2：gateway.forwarded.enabled=true (RFC 7239)   │
│ 触发条件 3：网关收到的物理 Host 与客户端原始 Host 不一致  │
└────────────────────────────────────────────────────────┘
```

条件 3 是问题是否显现的分水岭：
- **常规 Kubernetes Ingress 场景**：以 `ingress-nginx` 为例，默认配置了 `proxy_set_header Host $host;`。网关物理接收到的 `Host` 请求头恰好等于原始公网域名，因此即使字段取值来源有误，结果也是一致的；
- **多级代理与网关级联场景**：
  - Nginx 默认的 `proxy_pass http://upstream;` 会将 `Host` 重写为 upstream 名称；
  - Spring Cloud Gateway 在转发请求时，**默认会将 `Host` 改为 route URI 对应的 host**（除非显式配置 `PreserveHostHeader` 过滤器）；
  - 当存在两层网关（如 Edge Gateway -> Internal Gateway）时，第二层网关收到的物理 `Host` 是第一层网关传递过来的内部地址，问题随即发生。

---

## 三、 源码排查：数据源不一致

通过断点追踪 WebFlux 处理请求和网关转发的过程，定位到 Spring Boot 与 Spring Cloud Gateway 在转发头处理逻辑上的衔接缺陷。

### 1. Spring Boot 端：`ForwardedHeaderTransformer` 的改写逻辑

配置 `server.forward-headers-strategy=framework` 后，Spring Boot 注入 WebFlux 的 `ForwardedHeaderTransformer`：

```java
// org.springframework.web.server.adapter.ForwardedHeaderTransformer
@Override
public ServerHttpRequest apply(ServerHttpRequest request) {
    // 1. 解析入站的 Forwarded 头 (或 X-Forwarded-*)
    ForwardedHeaderExtractingRequest mutatedRequest = 
        new ForwardedHeaderExtractingRequest(request);

    // 2. 提取出原始协议、Host、RemoteAddress
    // 3. 将提取出的原始 Host 写入 mutatedRequest 的 getURI()
    
    // 4. 清除已有头部，防止下游重复处理
    HttpHeaders headers = mutatedRequest.getHeaders();
    headers.remove("Forwarded");
    headers.remove("X-Forwarded-Host");
    // ...
    return mutatedRequest;
}
```

这里有两个关键行为：
1. **改写 URI**：提取原始公网 Host 并写入 `request.getURI()`；
2. **清除 Header**：从请求头映射中删除了入站的 `Forwarded` 字段；
3. **保留物理 Host**：并未修改原始 HTTP 请求头中的 `HttpHeaders.HOST`。

进入网关过滤器链时，请求对象的状态如下：
- `request.getURI().getHost()`：公网真实 Host（`api.fengstack.com`）；
- `request.getRemoteAddress()`：公网真实 IP；
- `request.getHeaders().getFirst("Forwarded")`：为 `null`（已删除）；
- `request.getHeaders().getFirst(HttpHeaders.HOST)`：网关收到的物理 Host（`internal-gateway:8080`）。

### 2. Spring Cloud Gateway 端：`ForwardedHeadersFilter` 的字段来源

网关通过 `ForwardedHeadersFilter` 生成发送给下游的 RFC 7239 请求头：

```java
// org.springframework.cloud.gateway.filter.headers.ForwardedHeadersFilter (server-webflux)
@Override
public HttpHeaders filter(ServerWebExchange exchange) {
    ServerHttpRequest request = exchange.getRequest();
    HttpHeaders original = request.getHeaders();
    
    // 取 proto: 来自 request.getURI() (已被 Transformer 改写为原始协议)
    String proto = request.getURI().getScheme();
    
    // 取 for: 来自 request.getRemoteAddress() (已被 Transformer 改写为原始客户端IP)
    InetSocketAddress remoteAddress = request.getRemoteAddress();
    
    // 取 host: 直接从 Headers 中读取物理 Host！
    String host = original.getFirst(HttpHeaders.HOST);
    
    // 组装新的 Forwarded 条目发往下游
    // ...
}
```

三个字段的数据来源存在明显分歧：

| 字段 | 取值来源 | 是否包含原始客户端信息 |
| :--- | :--- | :--- |
| `proto` | `request.getURI().getScheme()` | ✅ 是（来自 Transformer 改写后的 URI） |
| `for` | `request.getRemoteAddress()` | ✅ 是（来自 Transformer 改写后的 RemoteAddress） |
| `host` | `original.getFirst(HttpHeaders.HOST)` | ❌ **否（直接读取未经改写的物理 Header）** |

因为入站的 `Forwarded` 头此前已被 `ForwardedHeaderTransformer` 移除，网关无法保留前序代理的记录；而新生成的条目中，`proto` 和 `for` 来自改写后的上下文，`host` 却来自物理请求头，下游由此收到了包含混合来源信息的 `Forwarded` 头。

---

## 四、 对照组与 Native 模式的表现

### 1. `XForwardedHeadersFilter` 的处理方式

在 Spring Cloud Gateway 源码中，处理 `X-Forwarded-*` 的实现方式与 RFC 7239 有所不同：

```java
// XForwardedHeadersFilter.java (server-webflux)
private String toHostHeader(ServerWebExchange exchange) {
    ServerHttpRequest request = exchange.getRequest();
    URI uri = request.getURI();
    int port = uri.getPort();
    String host = uri.getHost(); // 从 request.getURI() 获取 Host
    if (port > 0 && !isDefaultPort(uri.getScheme(), port)) {
        return host + ":" + port;
    }
    return host;
}
```

WebFlux 的 `XForwardedHeadersFilter` 和 MVC 的 `XForwardedRequestHeadersFilter` 在生成 `X-Forwarded-Host` 时，均从 `request.getURI()` 派生 Host。

只有负责 RFC 7239 的 `ForwardedHeadersFilter` (server-webflux) 和 `ForwardedRequestHeadersFilter` (server-mvc) 读取了原始的 `HttpHeaders.HOST`。

### 2. 为什么 `server.forward-headers-strategy=native` 表现看似正常？

切换至 `server.forward-headers-strategy=native` 时，下游服务通常能获取到正确的 Host。

原因在于：
- 在 `native` 模式下，底层 Reactor Netty 解析转发头后，不会从请求头中删除入站的 `Forwarded` 头；
- 网关生成的错误条目会被追加到已有条目之后：
  ```http
  Forwarded: for=114.242.25.10;proto=https;host="api.fengstack.com", for=10.0.0.1;proto=http;host="internal-gateway:8080"
  ```
- 下游 Spring Boot 应用使用 `ForwardedHeaderUtils` 解析时，默认只读取列表中第一个条目（即上游原始记录）；
- 此时网关追加的错误条目依然存在，只是被下游“只取首项”的默认解析规则掩盖。

---

## 五、 解决方案与规避措施

### 1. 修复方案（Upstream 建议）

在 GitHub Issue [#4326](https://github.com/spring-cloud/spring-cloud-gateway/issues/4326#issuecomment-6406985616) 中提出的修复思路是：调整 `ForwardedHeadersFilter`，使其与 `XForwardedHeadersFilter` 保持一致，优先从 `request.getURI()` 派生 Host，仅在 URI 为空时回退到 `HttpHeaders.HOST`。

```java
private String extractForwardedHost(ServerHttpRequest request, HttpHeaders headers) {
    URI uri = request.getURI();
    String host = uri.getHost();
    if (StringUtils.hasText(host)) {
        int port = uri.getPort();
        if (port > 0 && !isDefaultPort(uri.getScheme(), port)) {
            return host + ":" + port;
        }
        return host;
    }
    return headers.getFirst(HttpHeaders.HOST);
}
```

兼容性影响：
1. **默认模式（无 Transformer）**：`request.getURI()` 本身基于物理请求构造，其 host 与 `HttpHeaders.HOST` 一致，不改变原有行为；
2. **`framework` 模式**：`request.getURI()` 已包含 `ForwardedHeaderTransformer` 写入的原始 Host，能保留客户端 Host；
3. **一致性**：统一 `server-webflux` 和 `server-mvc` 的实现，与 `X-Forwarded-*` 的行为对齐。

### 2. 生产环境规避方案

在官方发布包含修复的版本前，可根据实际网络架构采用以下规避方式：

#### 方案 A：使用 `X-Forwarded-*` 转发头（推荐）
关闭 RFC 7239 支持，使用 `X-Forwarded-*`：
```yaml
spring:
  cloud:
    gateway:
      server:
        webflux:
          forwarded:
            enabled: false
```
网关内置的 `XForwardedHeadersFilter` 默认生效，能正常传递客户端 Host。

#### 方案 B：在中间网关配置 `PreserveHostHeader`
在多级网关级联场景下，可以在前置网关的路由配置中加入 `PreserveHostHeader` 过滤器，保留原始物理 Host：
```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: internal-service
          uri: http://internal-gateway:8080
          filters:
            - PreserveHostHeader
```

#### 方案 C：切回 `native` 策略
若无特殊的自定义框架头处理逻辑，可配置底层容器原生处理：
```yaml
server:
  forward-headers-strategy: native
```

---

## 六、 总结与思考

排查该问题带来的几点体会：

1. **多模块协作的边界条件**：`server.forward-headers-strategy=framework` 与 `gateway.forwarded.enabled=true` 均为官方支持的配置项，分别由 Spring Boot 和 Spring Cloud Gateway 维护。两者的清除机制与读取机制在特定拓扑下组合，暴露出隐蔽的契约空隙。
2. **数据源抽象一致性**：在过滤器中组装转发上下文时，各字段依赖的数据源应保持在同一抽象层级。避免部分字段读取改写后的逻辑模型（`request.getURI()`），部分字段直接穿透到底层物理报文（`raw headers`）。
3. **标准规范与现实生态**：RFC 7239 提供了比 `X-Forwarded-*` 更严谨的转发头格式，但在各类框架和反向代理中的支持成熟度与测试覆盖率存在差异，在生产环境启用新标准时需对全链路节点进行针对性验证。
