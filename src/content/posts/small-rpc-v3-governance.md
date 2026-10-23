---
title: "small-rpc 3.0：手写熔断、限流、降级，给 RPC 消费端补上治理闭环"
description: "兑现 2.0 埋下的伏笔：以 Filter 链形式手写熔断器（滑动窗口+双条件三态状态机）、令牌桶限流、降级 Fallback 与在途背压，全部 opt-in 默认关闭。逐一拆解实现源码，并给出熔断快速失败与半开自愈的完整验证命令。"
publishDate: 2026-10-20
tags: ["RPC", "Java"]
readTime: "约 13 分钟"
series:
  name: "SMALL-RPC 从零到治理闭环"
  order: 2
refLink:
  text: "参考工程：small-rpc"
  url: "https://github.com/upowerman/small-rpc"
---

在上一篇《[small-rpc 2.0：基于 Netty + Hessian 的轻量级 RPC 框架](../small-rpc-intro/)》里，我把这个从零手写的 RPC 框架重构成了「微内核 + SPI 扩展」的架构。但当时有一块能力被刻意留白了：**容错治理**。2.0 的 Failover 能在调用失败时换实例重试，可如果下游是持续性故障，重试只会放大流量、拖垮还在挣扎的实例——那正是熔断器要解决的问题。

2.0 收尾时，我在 `FailoverClusterInvoker` 的状态码模型上留了一句注释：「熔断留给 3.0——状态码模型已为其预留决策依据」。**3.0 的全部工作，就是兑现这句承诺**：以 Filter 形式手写熔断器、客户端限流、降级 Fallback，加上传输层的在途背压和按原因归因的调用指标，构成完整的消费端治理闭环。本文逐一拆解每个机制的实现思路与核心源码，文末给出可复现的验证命令。

## 一、为什么是 3.0：2.x 基座的最后一块拼图

先看 2.x 基座在故障场景下的真实表现。假设下游某实例开始持续抛异常：

1. 调用失败，Failover **换一个实例重试**——这是它被设计的用途，本身没错；
2. 但如果故障是全局性的（服务雪崩、依赖的数据库挂了），重试必然再失败，重试次数 × 请求量 = **流量被成倍放大**；
3. 如果故障是「慢」而不是「错」（下游 GC 卡顿、线程池打满），每个调用都要等满超时预算才失败，客户端的在途请求和线程被大量占用，**故障顺着调用方向传染**回消费端。

工业级框架对这个问题的标准答案就是消费端治理四件套：**熔断**（发现下游不健康就停止调用）、**限流**（约束自己发出的流量）、**降级**（被拒之后给业务一个体面的兜底）、**背压**（在途请求超过水位就快速失败）。small-rpc 3.0 把这套机制按自己的理解重新手写了一遍，思想出处如下：

| 能力 | 机制 | 思想出处 |
| --- | --- | --- |
| **熔断器** | 滑动窗口统计错误率/慢调用率，超阈值 OPEN 快速失败，半开探测自愈 | Hystrix/Sentinel 三态状态机 + Resilience4j 双条件 |
| **客户端限流** | 每资源令牌桶限速 + 并发信号量，两道闸门独立可配 | Sentinel 单机流控 |
| **降级 Fallback** | `@RpcReference(fallback = X.class)`，下游失败或治理拒绝时兜底 | Dubbo Mock（fail 语义） |
| **在途背压** | 消费端全局 in-flight 上限，超限 CLIENT_BUSY 快速失败 | TCP 拥塞控制思想 |

## 二、整体设计：治理三件都是 Filter，全部 opt-in

3.0 没有为治理引入任何新概念——熔断、限流、降级全部实现为消费端 Filter，挂在 2.x 已有的过滤器链上。装配逻辑在 `ReferenceBeanPostProcessor.buildProxy` 里，链序与理由直接写在装配处注释中：

```text
// 链序：Trace（traceId 先落 attachments）→ Metrics（计时含 Cluster 重试全程）
// → Fallback（包住全部下游失败，治理拒绝也由它兜底）
// → RateLimit（先守自身水位）→ CircuitBreaker（再看下游健康，紧贴 Cluster）
List<Filter> filters = new ArrayList<Filter>();
filters.add(new TraceFilter());
filters.add(new MetricsFilter());
Object fallbackInstance = resolveFallback(iface, reference.fallback(), beanFactory);
if (fallbackInstance != null) {
    filters.add(new FallbackFilter(fallbackInstance));
}
if (rateLimitRule != null || maxConcurrent > 0) {
    filters.add(new RateLimitFilter(limiter, rateLimitRule, maxConcurrent));
}
if (circuitBreakerRule != null) {
    filters.add(new CircuitBreakerFilter(breaker, circuitBreakerRule, timeoutMillis));
}
```

这个链序值得细品：**Fallback 放在治理 Filters 外层**，所以熔断拒绝（CIRCUIT_OPEN）、限流拒绝（RATE_LIMITED）、在途超限（CLIENT_BUSY）统统会被 Fallback 兜住——业务代码拿到的永远是「正常返回的降级值」，而不是一堆要特殊处理的治理异常；**CircuitBreaker 紧贴 FailoverCluster**，保证统计口径是「一次 Filter 调用的最终结果」，Cluster 内部重试多少次都不会放大熔断统计。

两个贯穿全局的设计原则：

- **opt-in，默认关闭**：三个治理 Filter 只有显式配置了才装配。从 2.x 升级到 3.0，不写一行治理配置，行为零变化；
- **本地状态码，绝不上网络线**：所有拒绝（`CIRCUIT_OPEN` / `RATE_LIMITED` / `CLIENT_BUSY`）都在消费端本地结算成 `Result` 直接返回，请求根本不发出去。这延续了 2.x「本地状态码」的原则——快速失败的本意就是**不把流量打到已经生病的下游**，发出去再失败等于白打。

## 三、熔断器：滑动窗口 + 双条件 + 三态状态机

熔断器是 3.0 的重头戏，由两部分组成：统计用的滑动窗口，和做决策的三态状态机。

### 1. SlidingWindow：Sentinel LeapArray 的最小可读版

直接用一个累计总数的大窗口统计错误率是有问题的：故障发生在 30 秒前，窗口却覆盖最近 5 分钟，熔断器会因为「历史脏数据」迟迟跳不了闸，恢复时也回不来。工业级做法是把窗口切成秒级小桶，时间推进时旧桶自然滑出统计范围。small-rpc 的 `SlidingWindow` 就是 Sentinel LeapArray 的最小可读版：

```java
public void record(boolean success, boolean slow, long rtMillis) {
    long now = clockMillis.getAsLong();
    long bucketStart = now - now % bucketMillis;   // 秒级对齐到桶起始
    lock.lock();
    try {
        Bucket b = buckets[index(bucketStart)];    // 环形数组取桶
        // 只有「更新的桶起始」才重置：时钟回拨不清零，同桶只做累加
        if (bucketStart > b.startMillis) {
            b.reset(bucketStart);
        }
        b.total++;
        if (!success) { b.error++; }
        if (slow)     { b.slow++;  }
        b.totalRtMillis += rtMillis;
    } finally {
        lock.unlock();
    }
}

public Stats stats() {
    long minStart = clockMillis.getAsLong() - windowMillis;
    // 聚合时只计入 startMillis > minStart 的桶——窗口外的旧桶自然滑出
    ...
}
```

每个桶记录 total / error / slow / totalRt 四个计数，读写都以「桶起始时间戳」判新：时间推进到新桶就整桶重置，不需要后台线程定时清理；时钟回拨时按当前桶继续累加，不会错误清零。线程模型上选择了实例级 `ReentrantLock`——record 的频率就是调用频率，教学实现优先保证正确与易读，这是刻意的取舍。

### 2. 双条件跳闸：错误率看不到「慢死」

只统计错误率有一个盲区：如果下游没有抛异常，只是每笔调用都磨到超时才失败——错误率看起来是 100%，可如果你的超时预算配得很宽（比如 30 秒），熔断前的 30 秒里每一笔调用都在占用线程和在途名额。所以 3.0 借鉴 Resilience4j，用**错误率与慢调用率双条件**，任一超阈值即跳闸：

```text
private void maybeTrip() {
    SlidingWindow.Stats s = window.stats();
    if (s.total < rule.minCalls()) {
        return;                                   // 样本不足不跳闸，防冷启动误伤
    }
    if (rule.errorRateThreshold() > 0
            && (double) s.error / s.total >= rule.errorRateThreshold()) {
        open();
        return;
    }
    if (rule.slowCallRateThreshold() > 0
            && (double) s.slow / s.total >= rule.slowCallRateThreshold()) {
        open();
    }
}

/** 慢阈值：显式 slow-rt-ms > 0 优先；否则按调用超时预算 × 0.8 推导 */
private boolean isSlow(long rtMillis, long timeoutBudgetMillis) {
    long threshold = rule.slowRtMillis();
    if (threshold <= 0 && timeoutBudgetMillis > 0) {
        threshold = timeoutBudgetMillis * 8 / 10;
    }
    return threshold > 0 && rtMillis > threshold;
}
```

慢阈值有个贴心细节：不显式配置 `slow-rt-ms` 时，自动按该次调用的超时预算 × 80% 推导——「快到超时还没回来的调用」就是慢调用，和 2.x 的超时预算机制天然咬合。

### 3. 三态状态机与半开自愈

状态机是经典的 CLOSED → OPEN → HALF_OPEN 三态，每个资源（`service#method`）一份独立状态：

```text
boolean tryPass() {
    if (state == CLOSED) {
        return true;                     // 快路径：只读 volatile，不加锁
    }
    lock.lock();
    try {
        if (state == OPEN && clockMillis.getAsLong() - openedAtMillis >= rule.openMillis()) {
            state = HALF_OPEN;           // 冷静期结束，进入半开
            halfOpenRemaining = rule.halfOpenProbes();
            halfOpenSuccesses = 0;
            halfOpenFailed = false;
        }
        if (state == HALF_OPEN) {
            if (halfOpenRemaining > 0) {
                halfOpenRemaining--;     // 放行一个探测名额
                return true;
            }
            return false;                // 名额被占：其余请求仍按 OPEN 拒绝
        }
        return false;
    } finally {
        lock.unlock();
    }
}

/** 半开探测记账：任一失败立即回 OPEN 重新计时；全部成功回 CLOSED 并换新窗口 */
private void completeProbe(boolean success) {
    if (halfOpenFailed) { return; }
    if (!success) {
        halfOpenFailed = true;
        open();
        return;
    }
    halfOpenSuccesses++;
    if (halfOpenSuccesses + halfOpenRemaining >= rule.halfOpenProbes()) {
        state = CLOSED;
        window = new SlidingWindow(rule.windowMillis(), 1000L, clockMillis);
    }
}
```

两个容易写错的细节，源码里都有明确处理：

- **半开探测要限名额**：恢复瞬间不能把积压流量全放进去（下游可能还没真正缓过来），每轮只放行 `half-open-probes` 个探测，其余请求继续被拒；
- **低流量下也能恢复**：恢复条件是「已放行探测全部成功」，而不是「等到 N 个新请求都成功」——否则低流量服务可能永远凑不齐探测样本，这与 Sentinel 的行为一致。

另外 `CircuitBreakerFilter` 保证一次 Filter 调用**恰好一次** `onComplete`：Failover 在 Cluster 内部重试不会重复记账，统计口径稳定为「这次调用最终是成功还是失败」。

## 四、客户端限流：令牌桶 + 并发信号量，两道闸门

限流 Filter 挂在消费端，防护的是「出压侧」：别让自己的突发流量把下游打爆。它有两道独立可配的闸门，第一道是令牌桶（RateLimiter SPI 的默认实现）：

```text
public boolean tryAcquire(String resource, RateLimitRule rule) {
    Bucket b = buckets.computeIfAbsent(resource, k -> new Bucket(rule.qps()));
    synchronized (b) {
        long now = clockMillis.getAsLong();
        double elapsed = (now - b.lastRefillMillis) / 1000.0;
        if (elapsed > 0) {
            b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.capacity);
            b.lastRefillMillis = now;
        }
        if (b.tokens >= 1.0) {
            b.tokens -= 1.0;
            return true;
        }
        return false;
    }
}
```

教科书式实现：桶容量等于 qps，按 qps/秒 匀速补充，**满桶起步**——允许 1 秒的突发流量，之后被削平到稳定速率。每个资源（`service#method`）一个桶，互不干扰。

但 QPS 限流有个盲区：它限得住「速率」，限不住「堆积」。下游 RT 是 1 秒时，哪怕 qps 只有 50，客户端也可能同时挂起大量在途调用。所以第二道闸门是**并发信号量**：

```java
Semaphore semaphore = semaphores.computeIfAbsent(resource, k -> new Semaphore(maxConcurrent));
if (!semaphore.tryAcquire()) {
    RpcMetrics.getInstance().recordRejection(resource, "concurrent-limit");
    return CompletableFuture.completedFuture(DefaultResult.failure(Status.RATE_LIMITED,
            new RpcException("concurrent limit reached for " + resource)));
}
try {
    return next.invoke(invocation).whenComplete((result, error) -> semaphore.release());
} catch (Throwable t) {
    // 下游同步抛出时 future 不存在，whenComplete 挂不上——此处不释放即永久泄漏
    semaphore.release();
    throw t;
}
```

这里有个很值得注意的防御细节：许可释放挂在 `whenComplete` 上，覆盖成功、失败、异常所有完成路径；但如果下游 `invoke` 是**同步抛出**（连 future 都没创建出来），`whenComplete` 根本挂不上去——必须在 catch 里补一次 release，否则许可永久泄漏，信号量会被慢慢耗干。

## 五、降级 Fallback：失败之后的最后一张网

熔断和限流负责「拒」，Fallback 负责「拒了之后怎么办」。用法上沿袭 Dubbo Mock 的思想，一个注解声明兜底实现：

```text
public static class HelloFallback implements HelloService {
    @Override
    public HelloDTO hello(String name) {
        return new HelloDTO(name, "degraded: provider unavailable");
    }
}

@RpcReference(fallback = HelloFallback.class)
private HelloService protectedHelloService;
```

`FallbackFilter` 包住整条下游链路，只有两种情况会触发兜底：下游返回非 SUCCESS，或链路抛出异常。触发后通过反射调用 fallback 实现的**同名方法**：

```java
next.invoke(invocation).whenComplete((result, error) -> {
    if (error == null && result != null && result.status() == Status.SUCCESS) {
        downstream.complete(result);          // 成功：直接透传
        return;
    }
    final Status originalStatus = ...;        // 记住原始失败状态
    try {
        Object value = fallbackInstance.getClass()
                .getMethod(invocation.methodName(), invocation.parameterTypes())
                .invoke(fallbackInstance, invocation.arguments());
        RpcMetrics.getInstance().recordDegraded(resource);
        if (value instanceof CompletableFuture) {          // 异步方法自动解包
            ((CompletableFuture<?>) value).whenComplete((v, ft) -> ...);
        } else {
            downstream.complete(DefaultResult.success(value));
        }
    } catch (Throwable t) {
        downstream.complete(fallbackFailure(...));         // fallback 也失败
    }
});
```

三个设计决策：

- **容器 bean 优先**：fallback 类如果在 Spring 容器里已存在同名 bean，直接复用——这样兜底实现自己也能注入数据源、缓存等依赖；容器里没有才反射实例化。类型不匹配或无法实例化时大声失败，绝不静默吞掉；
- **异步天然适配**：fallback 实现的是同一个接口，方法返回 `CompletableFuture` 时自动解包，与 2.x 的异步调用无缝衔接；
- **降级不吞真相**：fallback 自己也失败时，返回结果的**状态沿用原始失败**（比如保持 NETWORK_ERROR 而不是伪装成业务失败），原始异常以 `addSuppressed` 挂在新异常上——排障时两条线索都在。

## 六、在途上限：CLIENT_BUSY 与全链路背压

治理的最后一环落在传输层，而不是 Filter 链——因为「在途请求」的账本本来就记在客户端的 `PendingRequests` 表里（requestId → CompletableFuture）。注册新请求时检查水位：

```java
public CompletableFuture<Result> register(long requestId, long timeoutMillis) {
    final CompletableFuture<Result> future = new CompletableFuture<Result>();
    if (maxInFlight > 0 && pending.size() >= maxInFlight) {
        // 客户端在途背压（3.0 治理）：快速失败，不写表、不调度超时任务
        future.complete(DefaultResult.failure(Status.CLIENT_BUSY,
                new RpcException("client busy: in-flight requests reached " + maxInFlight)));
        return future;
    }
    pending.put(requestId, future);
    ...
}
```

超限的请求**连表都不进、超时任务都不调度**，以近乎零成本立即返回 CLIENT_BUSY。这与 2.x 服务端已有的 CallerRuns 背压（业务队列打满后由提交线程自己执行，减速而不是拒绝）拼在一起，构成了**全链路背压**：服务端扛不住时自行减速，客户端在途水位超限时停止投递——正是 TCP 拥塞控制的思想。

## 七、指标归因：治理不是加了开关就完事

「治理闭环」的「闭环」二字，最后落在可观测性上：拒绝了多少、为什么拒绝、降级救回多少——看不见这些，治理就只是几个 silently 生效的开关。2.x 的 `MetricsFilter` 已按 `service#method` 统计调用数与 RT，3.0 在快照中新增了两块：

```java
RpcMetrics.Snapshot snap = RpcMetrics.getInstance().snapshot();
snap.total();        // 总调用数
snap.degraded();     // Fallback 救回次数
snap.rejections();   // 按原因归因的拒绝计数：
                     //   circuit-open      熔断打开拒绝
                     //   rate-limit        令牌桶限速拒绝
                     //   concurrent-limit  并发信号量拒绝
                     //   client-busy       在途上限拒绝
```

拒绝计数**按原因分列**而不是合并成一个「被拒总数」，是因为不同原因指向完全不同的处置：circuit-open 高说明下游在持续故障；rate-limit 高说明容量规划偏紧；client-busy 高可能要上调 `max-in-flight` 或排查下游 RT。快照是进程级单调累计值，取两次做差即可得时间窗内的速率，对接 Micrometer 等监控体系由使用方自行桥接。

## 八、动手验证：从熔断打开到半开自愈

示例工程内置了治理演示配置（`circuit-breaker.enabled=true, min-calls=5, open-ms=5000`、`rate-limit.qps=50`、`max-in-flight=100`）和一个带 fallback 的受保护引用。按 [README](https://github.com/upowerman/small-rpc) 的场景 A 启动一台 Provider 和一台 Consumer 后：

**第一步，注入连续失败，把熔断打OPEN**（服务端对 `name=boom` 抛异常）：

```bash
for i in {1..10}; do curl -s "http://127.0.0.1:8091/rpc2/protected-hello?name=boom"; done
```

**第二步，验证快速失败**。立即换成正常参数调用——熔断已打开，请求不再到达服务端（服务端日志无新 `hello called`），调用以 CIRCUIT_OPEN 本地结算并由 Fallback 兜底，RT 接近 0：

```bash
curl -s "http://127.0.0.1:8091/rpc2/protected-hello?name=alice"
# 返回 {"name":"alice","message":"degraded: provider unavailable"}
```

**第三步，验证半开自愈**。等过 5 秒冷静期，熔断放行半开探测，下游已恢复 → 探测成功回到 CLOSED，一切如常：

```bash
sleep 6 && curl -s "http://127.0.0.1:8091/rpc2/protected-hello?name=alice"
# 返回 {"name":"alice","message":"hello world"}
```

限流与在途上限可以并发压测验证：100 个并发请求会混合出 `hello world` 与降级文案（后者就是被令牌桶拒绝、被 fallback 接住的调用）；用 `name=slow-*` 让服务端阻塞 4 秒占满在途名额，超过 100 的并发会立即得到 CLIENT_BUSY，而不会堆积在客户端内存里。此时读一次 `RpcMetrics.snapshot()`，`rejections()` 里四种原因的计数一目了然。

## 九、写在最后

3.0 的所有治理能力都是 opt-in 的：不写一行配置，升级后行为零变化；写了配置，每个机制也都**可单独阅读、单独 Debug、单独关掉**——熔断器和限流器同时是两个新的 SPI 扩展点（`CircuitBreaker` / `RateLimiter`），默认实现不满意可以直接替换。这延续了我写这个框架一贯的立场：每一层机制都小到能装进脑子里，出问题知道去哪看。

至此，small-rpc 走完了「1.0 极简原型 → 2.0 微内核架构 → 3.0 治理闭环」的完整演进。如果你对 RPC 内核、服务治理的实现细节感兴趣，欢迎阅读系列前篇《[small-rpc 2.0：基于 Netty + Hessian 的轻量级 RPC 框架](../small-rpc-intro/)》与《[基于 small-rpc 实战发布到 Maven 中央仓库](../maven-central-publish-guide/)》，以及方法论总结《[从 Vibe Coding 到双轨 SDD：现代 Agent 编程工程化实践](../agent-programming-sdd-tdd/)》，也欢迎来 [GitHub 仓库](https://github.com/upowerman/small-rpc) 提 issue 交流——全部源码带注释，支持单步 Debug。
