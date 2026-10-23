---
title: "small-rpc 2.0：基于 Netty + Hessian 的轻量级 RPC 框架"
description: "介绍我写的轻量级 Java RPC 框架 small-rpc：微内核架构、自研 SPI、注册中心订阅推送与缓存降级，以及快速上手示例。"
publishDate: 2026-10-06
tags: ["RPC", "Java"]
readTime: "约 4 分钟"
series:
  name: "SMALL-RPC 从零到治理闭环"
  order: 1
refLink:
  text: "github.com/upowerman/small-rpc"
  url: "https://github.com/upowerman/small-rpc"
---

**[small-rpc](https://github.com/upowerman/small-rpc)** 是我写的一款高性能、轻量级、高度可扩展的 Java RPC 框架,定位是**深入理解分布式 RPC 内核原理**。2.0 版本完成了一次全面的模块化重构与现代微服务治理升级,目前已经发布到 Maven Central(`io.github.upowerman:small-rpc-spring-boot-starter`),Java 8+ 即可使用。

## 为什么要造这个轮子

市面上的 RPC 框架(Dubbo、gRPC 等)功能完善,但正因为太完善,想弄清楚「一次远程调用到底发生了什么」反而要穿透层层封装。small-rpc 的目标就是把这个过程拆开摆在桌面上:微内核、清晰的模块边界、每个机制都能单独读懂。它适合用来学习分布式网络编程、RPC 通信协议与服务治理机制,也适合在此基础上做二次定制。

## 整体架构:1 个微内核 + 7 个扩展模块

工程按职责拆成 8 个子模块,由父 POM 统一管理依赖。核心层 `rpc-core` 只依赖 `slf4j-api`,对网络协议与序列化**零依赖**:

- `rpc-core` — 微内核抽象:SPI 机制、Invocation / Invoker、Filter 链、LoadBalancer、Registry 抽象与缓存降级;
- `rpc-transport-netty` — 自研二进制协议帧(Magic `0x5352`)编解码、Netty 4 通信引擎、Hessian 序列化;
- `rpc-registry-local` / `rpc-registry-zookeeper` / `rpc-registry-redis` — 三种开箱即用的注册中心;
- `small-rpc-spring` 与 `small-rpc-spring-boot-starter` — Spring 集成与自动装配;
- `rpc-examples` — 端到端示例工程(接口 / 提供方 / 消费端)。

## 设计亮点

### 1. 自研工业级 SPI

扩展点文件统一放在 `META-INF/small-rpc/`,支持:

- `@Spi("defaultName")` 声明默认实现,比如 `LoadBalancer` 默认 `random`;
- `@SpiInject` 字段依赖注入,内置同线程环依赖检测,成环立即大声失败;
- `@Adaptive("key")` 动态自适应代理,按 `Invocation` 的 attachments 动态路由,未传时平滑回退默认扩展;
- 多 ClassLoader 环境下按 (name, FQCN) 幂等去重,扩展名相同但类名不同则严格报错。

内置扩展点包括 `Registry`(local / zookeeper / redis)、`LoadBalancer`(random / roundrobin)、`Serializer`(hessian)、`Filter`(trace)。

### 2. 订阅-推送的注册中心 + 本地缓存无损降级

1.x 每次调用都同步去注册中心拉取实例列表,2.0 彻底改成**事件驱动的订阅-推送模型**:注册中心状态变化时异步回调,推送全量不可变实例快照。消费端调用只读本地 `ConcurrentHashMap` 缓存,不与注册中心产生任何同步网络等待。

由此换来一个关键承诺:**注册中心故障无损降级**——网络分区、抖动甚至注册中心全量停机时,本地缓存冻结保留,已有服务调用完全不受影响;注册中心恢复后推送管道自动重连,缓存即时刷新。ZooKeeper 实现用 Curator 5.6 临时节点 + 真实推送,Redis 实现用 Set 注册表 + 轮询差量比对推送,还带「存活租约键」判定,连 `kill -9` 这类被动退出也能自动摘除。

### 3. 优雅停机与容错

Failover 集群重试、全链路 Trace 上下文、Spring Boot 优雅下线与自动注销:Provider 在 Spring 上下文销毁或收到 SIGTERM 时自动 `unregister`,干净摘除节点。

## 快速上手

引入 starter(默认内置 Local 直连注册中心,零外部依赖开箱即用):

```xml
<dependency>
    <groupId>io.github.upowerman</groupId>
    <artifactId>small-rpc-spring-boot-starter</artifactId>
    <version>2.1.1</version>
</dependency>
```

提供方只需在实现类上标 `@RpcService`:

```java
@Service
@RpcService
public class HelloServiceImpl implements HelloService {
    @Override
    public HelloDTO hello(String name) {
        return new HelloDTO(name, "hello world");
    }
}
```

消费方用 `@RpcReference` 注入远程代理:

```java
@RestController
public class HelloController {
    @RpcReference
    private HelloService helloService;

    @GetMapping("/rpc2/hello")
    public HelloDTO hello(@RequestParam("name") String name) {
        return helloService.hello(name);
    }
}
```

集群部署时把注册中心换成 ZooKeeper 或 Redis 即可,负载均衡默认 `random`,可切 `roundrobin`;还支持 `@RpcReference(address = "...")` 注解级点对点直连,适合调试与金丝雀灰度验证。

## 高可用是怎么验证的

示例工程提供了三个可以亲手复现的场景:

1. **多实例负载均衡与宕机摘除**:起两台 Provider,连续调用观察流量均摊;`kill -9` 其中一台,等 ZooKeeper 会话超时后所有调用 100% 平滑转移到存活实例;
2. **注册中心停机无损降级**:集群运行中直接 `docker stop zookeeper`,调用依然正常返回——消费端靠本地冻结快照继续服务;恢复后自动重连刷新;
3. **Redis 注册中心**:优雅下线自动注销(Set SREM),被动退出靠租约过期在下一个轮询周期自动摘除。

## 写在最后

small-rpc 是一个**学习与研究定位**的项目,专注于把核心机制呈现得足够清晰、工程规范足够完整。如果你也想搞懂 RPC 的内核——协议帧怎么编解码、注册中心怎么推送、降级怎么做到无损——欢迎 star、提 issue,或者直接读源码:

[github.com/upowerman/small-rpc](https://github.com/upowerman/small-rpc)
