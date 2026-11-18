---
title: "不用本地 Drools 也能玩转多模型风控：MVEL 预编译、JsonLogic 与 JPMML 混合内核架构实战"
description: "深度拆解金融级实时风控决策引擎的多内核架构设计：剖析为何将 Drools 剥离为外部 REST 节点，如何在本地 JVM 通过 MVEL2 预编译与占位符微语法、JsonLogic 有界缓存与依赖反解、JPMML 进程内推理统一支撑规则集、决策树、评分卡与决策表，并复盘上下文穿透、Redis 模拟沙箱隔离与源码中的工程陷阱。"
publishDate: 2026-11-18
tags: ["架构设计", "风控系统", "规则引擎", "MVEL", "JsonLogic", "JPMML", "Java"]
readTime: "约 16 分钟"
series:
  name: "金融级智能风控与信贷中台架构实战"
  order: 2
---

在上一篇《[对接 20+ 外部征信数据源：高可用三方网关的插件化适配、防重计费缓存与 Hazelcast 分布式限流实战](/post/credit-thirdparty-gateway-architecture/)》中，我们介绍了信贷中台如何通过三方征信网关收敛多源外部数据，并解决防重计费问题。

拿到外部数据后，下游负责业务判定的核心模块是实时风控决策引擎。

提起 Java 生态的规则引擎，很多团队的第一反应是把 Drools 嵌进业务服务：写 `.drl` 脚本、维护 `KieContainer`，再处理 `KieSession` 的状态与内存问题。但在信贷风控场景中，策略资产并不只有 `if-then` 规则集，还包括策略师配置的评分卡和决策树、运营维护的二维决策表，以及算法团队训练导出的 XGBoost / 逻辑回归（PMML）模型。

把这些异构模型全放进本地 Drools，实践中会遇到三个问题：

1. **Rete 网络并不适合所有风控形态**：评分卡的加权分箱求和、决策表的行列唯一命中、PMML 的树模型推理，硬转成 DRL 规则不仅模板复杂，也会破坏原本直观的语义结构。
2. **动态编译与内存膨胀风险**：策略频繁上下线时，本地频繁重建 `KieBase` 编译耗时长，且容易因类加载器残留引发 Metaspace 或堆内存膨胀。
3. **故障隔离困难**：一旦某条复杂规则写出死循环触发无限 `fire`，整个核心决策服务实例的 CPU 都会被打满。

因此，我们的风控引擎采用了“本地轻量多内核 + 外部可选 Drools”的混合架构：完全移除本地 `org.drools` 依赖，在 JVM 内通过 MVEL2 预编译、JsonLogic 和 JPMML 统一支撑规则集、决策树、评分卡、决策表与机器学习模型；仅在确需兼容存量 DRL 资产时，才通过轻量 HTTP 客户端调用外部独立部署的 KIE Server。

---

## 一、 总体架构：树形决策流如何串联五种异构内核

为了让上层网关和业务线不用关心底层究竟运行了哪种规则或模型，引擎通过复合决策流（Decision Flow）作为统一调度层，将不同场景的单引擎按条件串联起来：

```text
                       [ 风控请求入口: riskInput (Map<String, Object>) ]
                                              |
                                              v
+---------------------------------------------------------------------------------------------------+
|                           复合决策流编排层 (DecisionFlowServiceImpl)                              |
|                                                                                                   |
|   while (satisfiedChild != null):                                                                 |
|     1. 补全场景号 & 路由具体引擎节点 (executeSingleScene)                                          |
|     2. 提取节点出参映射 & 回写共享上下文 (mappingResult -> riskInput.putAll)                       |
|     3. 遍历子节点边条件 (findSatisfiedChild): 按 MVEL 表达式匹配首个满足条件的下游节点               |
+---------------------------------------------|-----------------------------------------------------+
                                              | 按 RiskBusinessType 分发
          +-----------------+-----------------+-----------------+-----------------+
          v                 v                 v                 v                 v
  +---------------+ +---------------+ +---------------+ +---------------+ +---------------+
  |   规则集内核   | |  决策树内核    | |  评分卡内核    | |  决策表内核    | |  PMML 模型内核 |
  |   risk-core   | | decision-core | |  scard-core   | | decision-table| |   jpmml-eval  |
  +---------------+ +---------------+ +---------------+ +---------------+ +---------------+
  | MVEL2 预编译   | | MVEL2 /       | | MVEL2 占位符   | | 精确匹配 / * / | | 进程内评估器   |
  | 权重/最坏模式  | | JsonLogic AST | | 互斥/累加分箱  | | MVEL 唯一命中 | | LRU 缓存实例  |
  +---------------+ +---------------+ +---------------+ +---------------+ +---------------+
          \                 |                 |                 |                 /
           +----------------+-----------------+-----------------+----------------+
                                              |
                                              v
  +-------------------------------------------------------------------------------------------------+
  |                        公共支撑与隔离底座 (MvelCache / ThreadContexts / Roster)                  |
  |  - MVEL 编译缓存 (Guava 10000) & JsonLogic AST 缓存 (Guava LRU 100)                              |
  |  - 黑白灰名单前置短路 & Redis 模拟沙箱快照隔离 (isSimulation = true)                             |
  |  - 旁路异步留痕: GZIP 压缩投递 Kafka + 异步批量写入 MongoDB 评估日志                              |
  +-------------------------------------------------------------------------------------------------+

  * 独立旁路: [ drools 模块 (KieExecutor) ] --(HTTP POST JSON Commands)--> [ 外部独立 KIE Server ]
```

### 为什么决策流坚持“单线程串行路由”与“共享上下文”？

虽然决策流在结构上是一棵树，但节点之间并没有做并发编排。

在 `DecisionFlowServiceImpl` 的主循环中，引擎采用单线程 `while (satisfiedChild != null)` 串行推进，原因有两点：
1. **边条件强依赖上游输出**：父节点执行完规则集或评分卡后，产出的 `decisionCode`、模型分或 `resultMapping` 会立刻写入 `riskInput`，随后 `findSatisfiedChild` 才能拿这些新字段去计算子节点边上的 MVEL 路由条件；
2. **特征数据跨节点复用**：在主干流程里，决策流上游节点（例如反欺诈规则集）从三方网关或特征平台拉回来的征信指标会直接回写进 `riskInput`；当流转到下游评分卡或 PMML 模型时，采集器会直接跳过 `riskInput` 中已存在的 `quotaNo`，避免重复发起远程调用。

不过，为了防止单引擎执行过程中的临时中间变量污染原始入参，像决策树入口 `DTreeEngineApiImpl` 在执行前会先调用 `MapCloneUtils.shadowClone(riskInput)` 构造一层浅拷贝 `executionMap`，待树遍历结束后，再有选择地把提取到的特征 `quotaMap` 与命中规则 `hitRules` 回写回原 `riskInput`。

> **注意**：由于 `shadowClone` 是浅拷贝，如果 `riskInput` 中包含嵌套的 `Map` 或 `List`（例如某个三方征信返回的嵌套报文体），子引擎内部直接修改嵌套对象仍会影响全局引用，因此工程约定各引擎只对顶层 Key 做增量 `put`，禁止原地修改嵌套结构。

---

## 二、 内核一：MVEL2 的工业级打开方式——预编译与微语法改写

在五个本地内核中，MVEL2 是使用最广的底座：规则集、旧版决策树、评分卡分箱、决策表条件以及决策流路由条件都由它驱动。

如果直接调用 `MVEL.eval(expr, map)`，每次请求都会经历词法解析与 AST 构造，在高频压测下 CPU 消耗很明显。我们的做法是将编译与执行分离。

### 1. 预编译 + 有界缓存防爆

`MvelCacheServiceImpl` 封装了 `ExpressionCompiler` 与 Guava Cache，对所有动态表达式按原文缓存编译后的字节码对象 `CompiledExpression`（上限 `10000` 条，30 分钟无访问淘汰）：

```java
@Service
@Slf4j
public class MvelCacheServiceImpl implements MvelCacheService {

    private static final Cache<String, CompiledExpression> expressionCache = CacheBuilder.newBuilder()
            .expireAfterAccess(30, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    @Override
    public CompiledExpression getExpression(String expression) {
        try {
            return expressionCache.get(expression, () -> {
                ExpressionCompiler compiler = new ExpressionCompiler(expression);
                return compiler.compile();
            });
        } catch (Exception e) {
            log.error("mvel compile cache exception for expr: {}", expression, e);
            return new ExpressionCompiler(expression).compile();
        }
    }
}
```

对于静态配置加载的规则集与评分卡，会在模型装载或刷新阶段把每条规则预编译为 `@Transient CompiledExpression` 挂在领域对象上；多版本模型则在首次命中路由后执行懒编译。运行时只需执行 `MVEL.executeExpression(compiledExp, vars, Boolean.class)`，百条规则求值耗时稳定在 1~5 ms。

### 2. 面向策略师的“占位符微语法”改写

风控策略师在后台配规则时，通常不会像程序员一样每次都写规范的 Java 逻辑表达式。为了让后台配置更简洁，评分卡和决策表在编译前各自做了一层轻量字符串改写。

#### 案例 A：评分卡的 `$` 区间简写改写

在评分卡模块 `SCardServiceImpl` 中，策略师常针对某个特征（比如 `overdueDays`）配置类似 `$ > 30` 或 Python 风格的区间简写 `10 < $ <= 30`。MVEL 并不原生支持 `10 < x <= 30` 这种连写比较，于是加载器在预编译时用正则 `^\$|\$$` 分两种情况处理：

```java
private static final Pattern pattern = Pattern.compile("^\\$|\\$$");

private CompiledExpression getCompiledExpression(String expression, String paramName) {
    String routeStr = expression.trim();
    String routeExpression;
    if (pattern.matcher(routeStr).find()) {
        // 首尾出现 $（如 "$ > 30" 或 "0 <= $"），直接替换为特征名
        routeExpression = routeStr.replaceAll("\\$", paramName);
    } else {
        // $ 位于中间（如区间简写 "10 < $ <= 30"），展开为 "10 < paramName && paramName <= 30"
        routeExpression = routeStr.replaceAll("\\$", paramName + " && " + paramName);
    }
    return mvelCacheService.getExpression(routeExpression);
}
```

> **边界条件**：这种简写简化了配置，但依赖后台校验对语法的约束——如果策略师在中间型表达式里显式写了 `10 < $ && $ <= 30`（且 `$` 不在首尾），`else` 分支会把两个 `$` 都展开，导致语法错误。因此，配置端和引擎端对这种简写格式必须约定一致。

#### 案例 B：二维决策表的 `{x}` 改写与唯一命中（Unique Hit）

决策表模块 `DecisionTableServiceImpl` 将表格抽象为二维 `List<List<DecisionDataBO>>`，表头分为输入条件列（`IN`）与输出动作列（`OUT`）：
1. 每次遍历行时，先通过 `mvelService.evaluateValue(riskInput, col.getHeader())` 提取当前输入列的实际值；
2. 单元格支持三种类型定义（`DecisionDataTypeEnum`）：
   - `VALUE`：支持通配符 `"*"`、精确相等以及空值兼容（`StringUtils.isBlank(target) && "\"\"".equals(content)`）；
   - `MVEL`：把配置中的 `{x}` 替换为固定变量 `"param"` 并注入局部 `dataMap`，编译缓存后执行求值，异常时降级返回 `false`；
   - `INTERVAL`：预留区间类型枚举（当前代码库尚未落地区间解析，统一由 `MVEL` 类型承载区间判断）。
3. **Unique Hit（唯一命中）语义**：全表扫描所有满足全部 `IN` 列条件的行列表 `hit`，只有当 `hit.size() == 1` 时，引擎才判定 `PASS` 并输出该行的 `OUT` 列结果；0 行命中或多行同时命中（策略冲突）均判定 `DECLINE`，从语义上避免规则冲突带来的歧义结果。

### 3. 上下文增强：系统变量 `_root` 与 ThreadLocal 数学上下文

所有 MVEL 求值统一收口在 `MvelServiceImpl` 中，其中包含两个扩展点：

```java
@Override
public boolean evalToBoolean(Map<String, Object> mvelMap, String expression) {
    this.checkOrSetMathContext(expression, mvelMap);
    CompiledExpression compilerExp = mvelCacheService.getExpression(expression);
    return MVEL.executeExpression(compilerExp, setupVars(mvelMap), Boolean.class);
}

private void checkOrSetMathContext(String exp, Map<String, Object> mvelMap) {
    boolean flag = exp != null && (exp.contains("mathToDouble(") || exp.contains("mathToBoolean("));
    if (flag) {
        ThreadContexts.setVariables(mvelMap);
    }
}

private Map<String, Object> setupVars(Map<String, Object> mvelMap) {
    if (mvelVars == null || mvelMap == null) {
        return mvelMap;
    }
    Map<String, Object> systemVars = mvelVars.systemVars(mvelMap);
    if (systemVars != null && systemVars.size() > 0) {
        mvelMap.putAll(systemVars);
    }
    return mvelMap;
}
```

- **`_root` 系统变量空间**：`system-var` 模块在启动时用 `Reflections` 扫描带 `@VarMeta` 注解的 `Var` 实现，支持三种生命周期：不可变（仅算一次常驻内存）、定时缓存（Guava `LoadingCache` 按配置 `expire/refresh` 自动刷新）和实时 Ad-hoc（每次实时计算，异常降级为 `@VarMeta.defaultValue`）。这些变量注入到 `_root` 键下，规则中可直接写 `_root.apply_count_today > 5`。
- **按需注入 `ThreadContexts`**：只有检测到表达式调用了 `mathToDouble(` 等自定义静态数学函数时，才将 `mvelMap` 放入基于 `RequestContext` 的 `ThreadLocal` 中供函数内部读取；使用完毕后必须在调用链路的 `finally` 中清理 `RequestContext`，防止 Tomcat/Biz 线程池复用导致上下文串读或内存滞留。

---

## 三、 内核二：JsonLogic——打通可视化配置与修复内存泄漏

MVEL 表达能力很强，但新版后台上线可视化拖拽决策树编辑器（例如基于 `react-awesome-query-builder`）后，前后端直接互传 MVEL 文本有两个问题：一是前端拼接字符串容易出现括号不匹配、引号转义错误；二是后端很难对自由字符串做白名单安全审计和精确的依赖解析。

因此，新版决策树引入了标准化的 JsonLogic（`io.github.jamsesso:json-logic-java`）：

```json
{
  "logic": {
    "and": [
      { ">": [ { "var": "thirdparty_credit.score" }, 600 ] },
      { "in": [ { "var": "user_level" }, ["A", "B"] ] }
    ]
  },
  "data": {
    "thirdparty_credit": { "score": 0 }
  }
}
```

### 1. 分支级“按需懒加载”的依赖反解

决策树在执行时不预拉全树变量：一棵几十个节点的树，单笔请求从根到叶往往只走 3~4 层。如果把未命中分支的三方征信提前全拉一遍，调用成本和接口 RT 都会大幅上升。

新版决策树执行器 `DTreeModelExecutor` 在试探子节点分支 `tryFireDbNode` 时，会结合 `JsonLogicHelper` 做静态依赖反解：
- 对 `JSONLOGIC` 类型节点，拆出 `logic` 表达式串与 `data` 字典，扫描表达式中是否出现 `serviceName + "."`；
- 对 `MVEL` 类型节点，拿整棵树声明的 `dataSourceServiceNames`（三方服务列表）和 `variableGroupList`（特征平台变量组列表），同样反解出仅当前这条分支依赖的最小特征集；
- 结合 `TreeExecutionContext.pulledServices` 去重过滤后，只向数据采集层发起未拉取过的变量请求，拉回并写入上下文后才真正执行节点求值。

### 2. 实战踩坑：绕开原生 `JsonLogic` 门面的无界缓存泄漏

在压测与源码审查中，我们发现 `json-logic-java` 库原生门面类 `io.github.jamsesso.jsonlogic.JsonLogic` 存在一个隐患：它在内部使用无界 `Map` 缓存所有解析过的 `JsonLogicNode` AST。线上策略持续迭代、版本不断更新时，旧表达式的 AST 不会被淘汰，久而久之会引起持续的堆内存泄漏。

为此，`JsonLogicExecutor` 放弃了官方门面类，改为手动注册 `JsonLogicExpression` 算子集合构建底层 `JsonLogicEvaluator`，并用定长的 `GuavaLRUCache(100)` 接管 AST 缓存：

```java
@Slf4j
public final class JsonLogicExecutor {

    private static final int CACHE_SIZE = 100;
    private static final GuavaLRUCache<String, JsonLogicNode> JSON_LOGIC_LRU_CACHE = new GuavaLRUCache<>(CACHE_SIZE);

    private static final List<JsonLogicExpression> expressions;
    private static final JsonLogicEvaluator evaluator;

    static {
        expressions = Lists.newArrayList();
        expressions.add(MathExpression.ADD);
        expressions.add(MathExpression.SUBTRACT);
        // ... 注册算术、逻辑、比较、数组(filter/map/reduce/in)与缺失值判断等标准算子
        expressions.add(MissingExpression.ALL);
        expressions.add(MissingExpression.SOME);
        evaluator = new JsonLogicEvaluator(expressions);
    }

    public static <T> T executeAgent(String json, Map<String, Object> data) throws JsonLogicEvaluationException {
        JsonLogicNode jsonLogicNode = JSON_LOGIC_LRU_CACHE.getOrCache(json, () -> compile(json));
        return (T) evaluator.evaluate(jsonLogicNode, data);
    }
}
```

引入任何三方规则或表达式引擎时，都需要检查它的缓存策略是否是有界的。

---

## 四、 内核三：JPMML 进程内推理——打通算法与工程的最后一公里

在机器学习风控模型（评分卡模型、GBDT、XGBoost、逻辑回归）落地时，常见有两种方案：
- **跨语言 RPC**：算法用 Python 起 Flask/FastAPI 服务，Java 引擎发 HTTP 请求预测；
- **PMML 进程内推理**：算法导出标准 PMML XML 文件，Java 端直接嵌入 `jpmml-evaluator` 在本机完成特征绑定与打分。

对于以结构化特征为主的信贷风控模型，我们选择了 JPMML 进程内推理：既省去了跨机房/跨容器的序列化与网络 RTT，也避免了线上同时维护 Java 与 Python 两套高可用服务栈的运维负担。

### 1. 模型加载与推理闭环

在 `PMMLModelBO`（`credit-risk-engine-model` 模块，注意该模块并不是普通 DTO 包，而是专门的 PMML 执行内核）中，推理流程分为四步：

1. **压缩存储与编译缓存**：算法上传的 PMML 文件经 GZIP 压缩以字节数组 `compressedPMML` 存入 MongoDB；首次加载时解析为 `org.jpmml.evaluator.Evaluator` 并缓存在 `GuavaLRUCache`（默认容量 `200`）中。
2. **并发特征采集**：根据模型 `InputField` 元数据中的 `(serviceName, quotaName)` 自动识别三方服务与变量组依赖，调用并发采集器拉取指标并回写上下文。
3. **特征提取与合法化（`prepare`）**：循环每个模型输入字段，从 `executionMap` 提取特征值，交由 JPMML 原生 `pmmlInputField.prepare(value)` 完成类型转换、缺失值填充与离群值截断，组装为 `Map<FieldName, FieldValue>`。
4. **打分与解码回写**：调用 `modelEvaluator.evaluate(arguments)` 计算，再通过 `EvaluatorUtil.decodeAll(rawResult)` 解码 `outputFields` 和 `targetFields`（如违约概率 `probability(1)` 或模型评分），按 `mappingName` 写入决策流上下文供下游规则判定。

```java
// PMML 推理核心链路简化示意
if (StringUtils.isBlank(field.getServiceName())) {
    value = executionMap.get(field.getPmmlFieldName());
} else {
    value = MVEL.eval(field.getServiceName() + "." + field.getQuotaName(), executionMap);
}
FieldValue fieldValue = field.getPmmlInputField().prepare(value);
arguments.put(field.getPmmlInputField().getName(), fieldValue);

Map<FieldName, ?> rawResult = modelEvaluator.evaluate(arguments);
Map<String, ?> resultRecord = EvaluatorUtil.decodeAll(rawResult);
```

### 2. 源码审查中发现的一个隐蔽类型陷阱

在梳理 `PMMLModelBO#evaluate` 源码时，我们注意到一个很容易被忽略的强转问题：代码在校验直取输入字段和输出/目标字段是否为空时，直接写了 `StringUtils.isBlank((String) executionMap.get(...))` 与 `StringUtils.isBlank((String) value)`。

一旦模型的某个输入特征是 `Integer`/`Double` 数值类型，或者模型输出的概率值/目标值在 `EvaluatorUtil.decodeAll` 解码后是 `Double`/`Number` 对象，运行时就会直接抛出 `ClassCastException`。因此，这类校验应当统一改为 `Objects.isNull(value) || StringUtils.isBlank(String.valueOf(value))`，才能安全兼容数值与字符串特征。

---

## 五、 为什么把 Drools“踢出”本地 JVM？（及客户端避坑实录）

既然本地已经覆盖了规则集、决策树、评分卡、决策表和 PMML，为什么工程里还保留着 `credit-risk-engine-drools` 模块？

打开它的 `pom.xml` 会发现，这个模块里并没有任何 `org.drools` 或 `org.kie` 依赖。里面的核心类 `KieExecutor` 实际上只是一个纯 HTTP/REST 客户端，负责把请求转换成 KIE Server 的 JSON 命令协议发往外部独立容器：

```text
  [ 引擎业务进程 ] --(POST /services/rest/server/containers/instances/{container})--> [ 独立 KIE Server ]
                         Payload:
                           - lookup: ruleSession (默认 "defaultSession")
                           - commands: [ insert(fact1), ..., fire-all-rules(max = ruleFireMax) ]
```

把轻内核留在主进程、重型 Drools 放到外部 KIE Server 的做法，隔离收益很直接：主决策进程保持轻量和可预测的 GC 表现；即使某条复杂的 DRL 规则在 Rete 推理中陷入高频递归（哪怕配置了 `ruleFireMax` 兜底上限），也只会影响独立的 KIE Server 集群，不会拖垮核心决策流量。

> **源码排查记录**：在审查 `KieExecutor` 时，我们也发现了两个典型的 HTTP 客户端实现缺陷：
> 1. **未复用连接池与超时**：`execute()` 每次请求都会 `new ObjectMapper()` 和 `new RestTemplate()`，既没有配置连接池，也没有设置连接/读取超时，高并发下极易耗尽句柄或阻塞调用线程；
> 2. **判空失效导致请求头丢失**：方法开头初始化了 `LinkedMultiValueMap<String, String> serverHeader = new LinkedMultiValueMap<>()` 和 `String basicStr = ""`，但随后的 `buildKieServerHeader` 与 `createHeaders` 却用 `if (serverHeader == null)` 和 `if (basicStr == null)` 来决定是否写入 `Content-Type` 与 Basic Auth 请求头——这两个条件永远为 `false`，导致关键 Header 实际上没有写入。
>
> 接手或改造老系统时，这类平时很少触发的旁路代码往往最需要重点排查。

---

## 六、 配套沙箱：模拟回测如何做到“零污染”生产名单库？

多模型引擎跑通之后，风控团队在上线新策略前都会做策略模拟/影子回测（Simulation Run）。

在第一篇[三方网关实战](/post/credit-thirdparty-gateway-architecture/)中，我们利用 MongoDB 历史报文沉淀解决了仿真流量“零成本复用外部征信”的问题；而在决策引擎内部，黑白灰名单校验（`RosterEngineServiceImpl`）同样面临一个问题：

> 如果主流程刚刚把用户的最新风险命中写进了生产 MySQL 名单库，紧接着同一笔流水的模拟策略（`isSimulation = true`）也去查写生产名单库，就会导致模拟结果受时序干扰，甚至把测试命中记录写进生产表。

系统的解法是在名单引擎中构建了一层 Redis 业务快照沙箱：

```text
  生产主流程 (!isSimulation)
     |-- 1. 查 MySQL 名单表执行撞库
     |-- 2. 将本次关联的名单记录序列化缓存至 Redis (Key = businessId, TTL = 600s)
     v
  同一流水模拟策略 (isSimulation = true)
     |-- 1. 撞库直接读取 Redis {businessId} 快照，不查生产 MySQL
     |-- 2. 命中后自动加名单逻辑也仅追加写入该 Redis 快照，完全隔离生产库
```

通过三方征信 MongoDB 历史回放和名单库 Redis 业务快照这两道隔离，风控策略的线上仿真与 AB 实验可以在不触发外部计费的前提下，避免污染生产数据。

---

## 七、 总结：混合内核架构的边界与落地建议

回顾这套不使用本地 Drools 的多内核风控引擎：在多数实时信贷风控场景中，用专用轻量内核各自承担擅长的策略形态，再通过标准 Map 上下文串联，往往比强推单一重型规则引擎更容易演进和调优。

在设计与重构风控决策系统时，各策略形态的选型边界和注意事项如下：

| 策略形态 | 本系统选型 | 适用场景与边界建议 |
| :--- | :--- | :--- |
| **反欺诈/准入规则** | MVEL2 预编译 | 适合无状态并发或短路求值（`SCORE` / `WORSE`），但**不适合**强有状态、跨 Fact 复杂正向推理的 CEP 场景 |
| **可视化分支决策树** | JsonLogic + MVEL | 可直接对接前端 Query Builder，支持分支级特征依赖反解；需用**有界 LRU** 替换原生无界 AST 缓存 |
| **评分卡 / 二维决策表** | MVEL2 + 微语法改写 | 支持 `$` / `{x}` 简写与唯一命中校验；注意对输入类型做统一归一化，避免 `String.valueOf` 引发类型错配 |
| **机器学习评分模型** | JPMML 进程内推理 | 无需跨进程网络开销，推理延迟较低；注意模型字段类型校验勿盲目强转 `(String)` |
| **存量复杂 DRL 资产** | 外置 KIE Server (REST) | 物理隔离内存膨胀与死循环风险，但需做好客户端连接池复用与超时熔断 |

工程落地中，混合内核的瓶颈通常不在表达式求值那 1~5 ms，而在特征采集的并发与去重、所有动态编译器的内存上界，以及异常路径下 `ThreadLocal` 和沙箱状态的清理。把这几项基础约束守住，多引擎架构才能在高并发生产流量下稳定运行。
