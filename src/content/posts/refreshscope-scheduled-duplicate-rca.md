---
title: "一次线上故障复盘：@RefreshScope + @Scheduled + @Async 为什么会导致定时任务重复执行？"
description: "复盘 Spring Boot 2.7.x 与 Spring Cloud Consul 环境下，配置刷新导致定时任务每周期执行两次的排查过程。从现象梳理、假设推演、Spring 底层对象身份错位分析，到测试验证与架构解耦方案。"
publishDate: 2026-10-25
tags: ["Spring Boot", "Spring Cloud", "故障排查", "源码剖析", "Java"]
readTime: "约 12 分钟"
---

在 Spring Cloud 技术栈中，`@RefreshScope` 常用于配合配置中心实现参数热刷新，而 `@Scheduled` 与 `@Async` 则是处理定时任务和异步执行最常用的轻量注解。

前段时间处理过一个很有意思的线上问题：当这三个注解同时出现在一个 Spring Bean 上时，配置中心一刷新，定时任务在每个调度周期内就会执行两次；更奇怪的是，后续再次修改配置并多次刷新，执行次数依然稳定在两次，没有继续增加。

本文把当时的排查过程、源码链路以及验证思路完整记录下来，梳理清楚这背后的原因和规避方案。

---

## 一、 现场现象

当时生产环境的核心依赖版本如下：
- **Spring Boot**: `2.7.18`
- **Spring Framework**: `5.3.31`
- **Spring Cloud Context**: `3.1.8`
- **配置中心**: Spring Cloud Consul

涉及的业务是一个定时统计和数据处理组件。为了能在配置中心动态调整执行间隔，同时避免同步执行耗时阻塞调度线程，代码写在同一个 Bean 里：

```java
@Component
@RefreshScope
public class AsyncTaskService {

    @Scheduled(fixedRateString = "${task.rate:10000}")
    @Async("taskExecutor")
    public void executeTask() {
        // 核心处理逻辑
    }
}
```

排查时收集到的现象主要有 5 条：

1. **服务启动后**：定时任务按既定周期运行，每周期执行 1 次；
2. **偶发调用**：Controller 曾通过 HTTP 接口手动调用过该 Bean 的 `executeTask()` 方法；
3. **触发刷新**：修改 Consul 中的配置项，系统收到 RefreshEvent 开始刷新；
4. **频率翻倍**：配置刷新完成后，定时任务开始每周期执行 2 次，日志里的对象引用表明来自两个不同的内部实例；
5. **次数不再增加**：继续多次修改配置并刷新，执行次数依然是 2 次，没有变成 3 次或 4 次。

而在应急排查时，如果直接把类上的 `@RefreshScope` 去掉，无论怎么刷新配置，任务都维持在每周期执行 1 次。

---

## 二、 假设验证与排查过程

面对“刷新后变成两次，但继续刷新不再增加”的现象，排查时主要梳理了三条线索：

```text
               ┌── 假设 A：对象不一致导致旧任务未注销（最终证实：销毁回调根本没注册）
               │
排查推导 ──────┼── 假设 B：旧任务残留 + 外部访问触发重建（证实：访问是生成新任务的触发点）
               │
               └── 假设 C：单调度任务 + 接口或事件重复触发（排除）
```

### 1. 假设 C：单调度任务 + 额外链路调用？

**推测**：是不是调度任务本身只有一个，但 Controller 调用或者刷新事件监听器里残留了额外的定时逻辑？

**验证**：
在测试工程中通过记录器追踪调用源与执行线程。结果表明：
- Controller 的实际调用次数为 1；
- 翻倍后的两次执行，线程与任务提交者均为 `scheduling-1`；
- 通过反射查看 `ScheduledAnnotationBeanPostProcessor` 内部的 `scheduledTasks` 任务注册表，发现确实存在两个独立的 `ACTIVE` 状态的 `ScheduledTask`。

这说明两个任务都是由调度器真正发起的，假设 C 被排除。

### 2. 假设 B：旧任务未取消，新实例又注册了新任务？

既然有两个 `ScheduledTask`，那说明旧实例的任务没被停掉，并且新实例又注册了一次。

这里最初有一个误判：以为旧实例是之前 Controller 访问时才被初始化的。
但实际上，Spring Cloud 的 `RefreshScope` 默认设置了 `eager = true`。服务启动时，`RefreshScope.eagerlyInitialize()` 就会主动调用 `getBean()` 完成预实例化。因此，**旧实例与第一个定时任务在容器启动阶段就已经创建好了，并不依赖此前的 Controller 调用。**

### 3. 假设 A：为什么刷新时旧任务没有被注销？

在 Spring Cloud 中，当 `@RefreshScope` 刷新时，会调用 `GenericScope.destroy()` 遍历缓存中的 `BeanLifecycleWrapper` 执行销毁回调。按预期，`ScheduledAnnotationBeanPostProcessor` 应该收到销毁通知，将旧任务从内部注册表中移除并调用 `cancel()`。

通过反射读取 RefreshScope 的内部状态后，发现了根本问题：

> **`BeanLifecycleWrapper.callback` 的值为 `null`。**
> 
> 这意味着：在 Bean 初始化阶段，RefreshScope 的销毁回调根本就没有注册上。

---

## 三、 根因分析：Spring 底层的“对象身份错位”

为什么销毁回调没有注册？结合 Spring Framework 5.3.31 与 Spring Cloud Context 3.1.8 的源码，问题出现在 Bean 的创建与初始化时序上。

### 1. 销毁回调的入参差异

在 `AbstractAutowireCapableBeanFactory.doCreateBean` 中，Bean 的创建流程如下：

```java
// 1. 创建原始对象 (raw bean)
Object bean = instanceWrapper.getWrappedInstance();

// 2. 初始化与后置处理
Object exposedObject = bean;
exposedObject = initializeBean(beanName, exposedObject, mbd);

// 3. 注册销毁回调
registerDisposableBeanIfNecessary(beanName, bean, mbd); // 注意：此处传入的是 bean，而非 exposedObject
```

关键点在第 3 步：**Spring 传给 `registerDisposableBeanIfNecessary` 的是原始对象 `bean`（raw 实例），而不是经过后置处理及动态代理包装后的 `exposedObject`。**

### 2. @Async 与 @Scheduled 的后置处理器执行顺序

在 `initializeBean` 阶段，各个 `BeanPostProcessor` 按注册顺序依次执行：

```text
原始对象 (raw)
   │
   ▼
AsyncAnnotationBeanPostProcessor
   │  生成 @Async 的 CGLIB 代理对象 P1
   ▼
exposedObject = CGLIB代理 (P1)
   │
   ▼
ScheduledAnnotationBeanPostProcessor
   │  解析 @Scheduled，注册任务：
   │  scheduledTasks.put(P1, task)  <── 注册 Key 是代理对象 P1
   ▼
返回 exposedObject
```

在默认配置下，`AsyncAnnotationBeanPostProcessor` 先于 `ScheduledAnnotationBeanPostProcessor` 执行。

当 Scheduled 后处理器执行时，它拿到的已经是被 `@Async` 增强后的 **CGLIB 代理对象（P1）**。
于是，Scheduled 后处理器将任务放进自己的注册表：
```java
private final Map<Object, Set<ScheduledTask>> scheduledTasks = new IdentityHashMap<>(16);
```
**注意：这个 Map 是 `IdentityHashMap`，比较 key 时只看内存地址引用是否相同（`==`）。**
此时注册表里记录的是：`{ 代理对象P1 : 任务A }`。

### 3. 判断是否需要销毁：判断扑空

回到 `doCreateBean` 的最后一步：
```java
registerDisposableBeanIfNecessary(beanName, bean, mbd); // 传入的是 raw 原始对象 T1
```
Spring 会调用 `requiresDestruction(bean, mbd)` 检查该 Bean 是否需要注册销毁逻辑：

```java
// ScheduledAnnotationBeanPostProcessor.java (L589)
public boolean requiresDestruction(Object bean) {
    synchronized (this.scheduledTasks) {
        return this.scheduledTasks.containsKey(bean); // 这里传入的是 raw 原始对象 T1
    }
}
```

* `scheduledTasks` 里的 key 是 **CGLIB 代理对象 P1**；
* 这里检查的入参却是 **原始对象 T1**；
* `IdentityHashMap.containsKey(T1)` 返回 **`false`**。

由于业务类没有实现 `DisposableBean`，也没有指定 `destroyMethod`，Spring 便判定该 Bean 不需要执行销毁逻辑，因此跳过了 `scope.registerDestructionCallback(...)`。

最终结果是：**RefreshScope 里的 `BeanLifecycleWrapper.callback` 保持为 `null`。**

### 4. 配置刷新时旧任务泄漏

当 Consul 配置变更触发 `RefreshScope.refreshAll()` 时：

```java
// BeanLifecycleWrapper.java (L383)
public void destroy() {
    if (this.callback == null) {
        return; // callback 为 null，直接返回
    }
    this.callback.destroy();
}
```

因为 `callback` 为空，代码直接返回。
旧的代理对象 P1 依然被 Scheduled 后处理器的 `scheduledTasks` 强引用，其内部的 `ScheduledTask` 处于运行状态，继续按周期调度。

---

## 四、 为什么执行次数稳定为 2 次，不再递增？

这是排查中最容易让人疑惑的一点：如果任务泄漏了，为什么第二次、第三次刷新时，任务数没有变成 3 次或 4 次？

### 1. 任务数量与访问触发机制

梳理生命周期可以得出任务总数的对应关系：

$$\text{当前活动任务数} = 1\text{（启动期预实例化）} + 1 \times (\text{刷新后经由外层代理访问的次数})$$

RefreshScope 的机制是：**刷新只会清理 Scope 内部的缓存，不会自动重新创建 Bean。** 只有当外部请求通过注入的 Scoped 代理再次调用该 Bean 时，代理发现缓存为空，才会重新执行 `doCreateBean`。

```text
【时间线梳理】

1. 应用启动（RefreshScope eager 预实例化）：
   创建原始实例 T1 与代理 P1，注册任务 A。
   -> 任务数：1

2. Controller 首次访问：
   直接命中缓存中的 P1。
   -> 任务数：1

3. 首次修改配置并刷新：
   清理 Scope 缓存。因 callback 为 null，旧任务 A 存活。
   -> 任务数：1（旧任务继续运行）

4. Controller 再次访问（触发重建）：
   Scope 缓存为空，触发 doCreateBean 创建 T2 与代理 P2，注册任务 B。
   -> 任务数：2（任务 A 与 任务 B 同时运行）

5. 第二次修改配置并刷新：
   清理 Scope 缓存。
   后续若没有外界请求通过代理访问该 Bean，不会触发创建。
   -> 任务数：稳定为 2
```

### 2. 实验对照验证

为了验证这一推断，我们在测试中设计了两个对照场景：
- **场景 T7a（连续刷新，不访问）**：连续触发多次配置刷新，中间不发起任何方法调用。结果：**全程保持 1 个任务**。
- **场景 T7b（刷新后访问交替进行）**：每轮配置刷新后，手动发起一次代理方法调用。结果：任务数呈 **1 → 2 → 3 → 4** 线性增加，多个不同实例交替执行。

线上之所以看起来“稳定在 2 次”，原因在于**第一次刷新后发生过一次外部访问，而随后的几次刷新期间，没有其他请求再通过代理调用这个 Bean**。

---

## 五、 两个延伸疑问

### 1. 给业务类加上 `@PreDestroy` 能解决吗？
如果给业务类加上 `@PreDestroy`，`hasDestroyMethod` 会变成 true，从而使销毁回调得以注册。
但在真正执行销毁时，`DisposableBeanAdapter.destroy()` 传给 `ScheduledAnnotationBeanPostProcessor.postProcessBeforeDestruction(bean)` 的依然是 raw 原始对象。
Scheduled 后处理器去执行 `scheduledTasks.remove(raw)` 时，面对 key 为代理对象的 `IdentityHashMap` 依旧匹配不上，因此**任务依然无法被正常取消**。

### 2. 为什么去掉 `@RefreshScope` 后恢复正常？
去掉 `@RefreshScope` 后，Bean 变成标准单例（Singleton），其生命周期与 Spring 容器一致，不再受 RefreshScope 刷新销毁机制影响，任务自然也就只会在启动时注册一次。

---

## 六、 修复方案与建议

分析清楚原因后，方案选择主要考虑结构清晰与长期可维护性。

### 方案 1：动静分离，配置与任务解耦（推荐）

最稳妥的做法是将“动态配置参数”与“定时任务执行”拆开：定时任务类保持普通单例，动态配置交给独立的 `@ConfigurationProperties` Bean 管理。

```java
// 1. 动态配置类：负责接收热刷新
@Component
@RefreshScope
@ConfigurationProperties(prefix = "task")
public class TaskDynamicProperties {
    private long rate = 10000;
    private boolean enabled = true;
    // getter / setter
}

// 2. 任务执行类：普通单例，避免生命周期动态销毁
@Component
public class AsyncTaskService {

    private final TaskDynamicProperties props;

    public AsyncTaskService(TaskDynamicProperties props) {
        this.props = props;
    }

    @Scheduled(fixedRate = 1000)
    @Async("taskExecutor")
    public void executeTask() {
        if (!props.isEnabled()) {
            return;
        }
        // 业务逻辑读取 props.getRate() 等配置
    }
}
```

- **优点**：避免将调度机制置于动态刷新作用域内，结构简单，没有框架底层时序依赖。

### 方案 2：去掉方法上的 `@Async`，改为线程池显式提交

如果一定要保留 `@RefreshScope`，可以去掉方法上的 `@Async` 注解，避免 `AsyncAnnotationBeanPostProcessor` 先行生成代理。
当没有 `@Async` 代理时，Scheduled 后处理器收到的就是 raw 对象，注册的 key 与销毁检查的对象一致，任务就能被正常注销。
异步逻辑改由内部注入 `ThreadPoolTaskExecutor` 执行：

```java
@Component
@RefreshScope
public class AsyncTaskService {

    @Autowired
    @Qualifier("taskExecutor")
    private ThreadPoolTaskExecutor executor;

    @Scheduled(fixedRateString = "${task.rate:10000}")
    public void executeTask() {
        executor.submit(() -> {
            // 异步业务逻辑
        });
    }
}
```

---

## 七、 复盘总结

1. **避免在同一个 Bean 上叠加过多的特殊生命周期与代理切面**：`@RefreshScope` 会产生 Scoped 代理，`@Async` 会产生方法拦截代理，`@Scheduled` 则涉及全局调度器注册。多个不同层级的切面混合在一起时，不同后处理器的执行顺序很容易引发边界问题。
2. **警惕“稳定现象”背后的偶发因素**：排查问题时，不能轻易被“固定执行两次”这一表象带偏，背后很可能是特定的调用路径与缓存机制碰巧构成的临时状态。
3. **保持常驻组件与动态配置的边界**：定时任务、长连接、线程池属于常驻型基础能力，而配置中心热刷新更适合作用于单纯的数据载体。将变动的数据抽离成属性对象，比对整个执行组件做销毁重建更加清晰可靠。
