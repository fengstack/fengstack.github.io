---
title: "给 openobserve 提的三个 PR：都是边界条件惹的祸"
description: "使用 openobserve 时先后遇到 Grafana 直方图不渲染、_around 接口 size=1 返回 2000 行、quantile 遇 +Inf 返回 NaN 三个问题，读 Rust 源码定位后各提交一个 PR，记录完整过程与心得。"
publishDate: 2026-10-06
tags: ["开源实战", "可观测性"]
readTime: "约 5 分钟"
refLink:
  text: "github.com/openobserve/openobserve"
  url: "https://github.com/openobserve/openobserve"
---

[openobserve](https://github.com/openobserve/openobserve) 是一个 Rust 写的开源可观测性平台(日志、指标、追踪一体),性能好、资源占用低,我在用它承接日志与指标的过程中读了不少源码,前后定位了三个问题、提了三个 PR:[#15144](https://github.com/openobserve/openobserve/pull/15144)、[#15143](https://github.com/openobserve/openobserve/pull/15143)、[#15142](https://github.com/openobserve/openobserve/pull/15142)(两个已合并,一个经维护者说明后撤回)。写完回顾才发现,三个问题有一个共同的名字:**边界条件**。这篇文章把三个问题的完整过程记录下来。

## 问题一:Grafana 直方图不渲染(#15144)

### 现象

一条很常见的直方图查询:

```sql
SELECT histogram(_timestamp) AS x, count(*) AS y
FROM t GROUP BY x ORDER BY x LIMIT 100000
```

被系统判定 `is_histogram_eligible=false`,于是**官方 Grafana 插件拒绝把它渲染成直方图**。用户陷入两难:不加 `LIMIT` 会被默认 limit 截断结果;加了 `LIMIT`,直方图渲染又被禁用——死路。

### 根因:一票否决

定位到 `is_eligible_for_histogram`(`src/config/src/utils/sql/eligible_for_histogram.rs`):它对任何带 `LIMIT` 的查询直接判不合格,**完全没有考虑这个查询是不是直方图查询**。但对直方图来说,输出行数是由 `histogram(_timestamp[, interval])` 决定的,`LIMIT` 在这里只是防止被默认 limit 上限截断,并不改变直方图语义。

### 方案

规则改成:只有**不使用** `histogram(...)` 的查询才因 `LIMIT` 被否决。实现上是一个小访问器(`HistogramDetector`),在 AST 里检查是否存在名为 `histogram` 的 `Expr::Function`。这样既救回了 Grafana 插件的查询形态,又保住了原有意图——distinct/CTE/join/union/普通 LIMIT 仍然不是直方图,现有测试一个没动。

验证:Grafana 插件形态和 5 分钟间隔变体保持 eligible,`SELECT * FROM t LIMIT 100` 依旧 ineligible;`cargo test -p config --lib` 3857 个测试全过。改动 1 个文件,+51 −2。

→ [PR #15144](https://github.com/openobserve/openobserve/pull/15144)

**结果:撤回。**维护者说明,`LIMIT` 在这里被排除是**有意为之**——`is_histogram_eligible` 的含义不是「这条查询是不是直方图」,而是「Logs 页能否为这条查询绘制时间分布图」;那张图靠把查询重写为 `SELECT histogram(_timestamp), count(*) …` 得到(见 `convert_to_histogram_query`),所以它与 DISTINCT/CTE/JOIN/UNION 一样,排除 `LIMIT` 才是正确契约。一个反例一锤定音:`SELECT histogram(_timestamp) AS x, * FROM t LIMIT 10`——它带 histogram,却无法被重写成时间分布图。明白这一点后,我主动关闭了这个 PR。

## 问题二:`_around` 传 `size=1`,却返回 2000 行(#15143)

### 现象

上下文查询接口 `POST /api/{org}/{stream}/_around?key=...&size=1`,期望拿 1 行,实际**每个方向返回约 1000 行(合计约 2000 行)**;而且 `size=0`、负数也静默成功。

### 根因:没有下限,0 触发「默认 limit」回退

`src/api/search/src/search/around.rs` 把用户传入的 `around_size` 对半分后直接传给两个子查询,没有下限保护。`size=1` 时对半得到 0,而下游搜索层把非正数 size 解释为「使用默认 limit(1000)」,两个子查询双双膨胀。负数同理静默通过。

### 方案:钳制 + 校验 + 顺手修一个溢出

抽出 `around_subquery_sizes(around_size)`:

- `size <= 0` 直接返回 HTTP 400(`InvalidParams`),不再静默;
- 每半边下限钳到 1,保证 0 永远到不了搜索层;
- 顺手把「向上取整的对半」从 `(size+1)/2` 换成无溢出的 `size/2 + size%2`——原写法在 `i64::MAX` 上会溢出。

测试覆盖 `0/-5 → 错误;1→(1,1), 2→(1,1), 3→(2,1), 10→(5,5)`,以及 `i64::MAX` 不溢出;`cargo test -p openobserve-api-search --lib` 226 全过。响应结构不变,唯一行为变化是非法 `size<=0` 从「静默给默认 limit」变成「400」——这是更正确的语义。这个 PR 还顺带关联修复了一个 issue。

→ [PR #15143](https://github.com/openobserve/openobserve/pull/15143)

## 问题三:quantile 遇到 +Inf 返回 NaN,而 Prometheus 返回 +Inf(#15142)

### 现象

对一个包含 `+Inf` 样本的序列执行 `quantile(0.75, m)`:OpenObserve 返回 `NaN`,Prometheus 返回 `+Inf`。文档(直方图查询、告警)依赖的是 Prometheus 语义,结果对不上。

### 根因:插值公式在无穷边界上翻车

`src/promql/src/common.rs` 用的插值公式是:

```rust
lower + (upper - lower) * fraction
```

当边界是无穷时,`Inf + (Inf - Inf) * w = Inf + NaN * w = NaN`。而 Prometheus 用的是:

```rust
lower * (1 - fraction) + upper * fraction
```

同样的输入是 `Inf * 0.5 + Inf * 0.5 = Inf`——无穷正确传播。

### 方案:对齐 Prometheus 的公式

重写为 Prometheus 形式。有限值的结果**逐位相同**(只是分布项重排);只有边界为无穷时行为变化——从 `NaN` 变成正确传播 `±Inf`。(索引恰好落在端点上、`w==0` 时 `Inf*0` 两种公式都会得到 `NaN`,该情况不变,与 Prometheus 一致。)

测试严格走 RED/GREEN:修复前 `Some(NaN)` vs 期望 `Some(inf)` 确认失败,修复后通过;有限输入逐位不变也有断言兜底。`cargo test -p promql --lib` 630 全过。改动 1 个文件,+22 −1。

→ [PR #15142](https://github.com/openobserve/openobserve/pull/15142)

## 三个问题的共同模式

回头看,三个问题本质上是同一件事的三种变形:

- **#15144**:「有 LIMIT」这个特征被当成否定信号,越过了「这是不是直方图」的判断——*特征越界*;
- **#15143**:「非正数」在边界上被翻译成「用默认值」,而不是「非法输入」——*边界语义吞掉了错误*;
- **#15142**:数学上等价的公式,在 `Inf` 边界上不等价——*恒等式有适用范围*。

边界条件 bug 有个共同特点:主路径上一切正常,单元测试大概率全绿,只有在「恰好踩到边界」的真实数据上才炸。这也是它们值得专门提 PR 的原因——不修,下一个用户还会踩。

## 在 Rust 大项目里提 PR 的几点体会

- **先证明,再动手**。每个 PR 我都先写一个失败的测试(RED),确认自己对根因的理解是对的,再改实现(GREEN)。#15142 里 `Some(NaN)` vs `Some(inf)` 这个断言,比任何文字描述都更能说明问题。
- **Scope 越小越好**。三个 PR 都只动 1 个文件,兼容性说明里明确列出「哪些行为变了、哪些严格不变」(#15142 甚至声明有限值逐位相同)。评审者的信任度完全不同。
- **兼容性是最容易被追问的部分**。#15143 把「静默给默认 limit」改成「400」,必须在 PR 里主动说明这是**更正确**的语义变化、响应结构未变,而不是等评审者来问。
- **对齐既有生态是天然的正确性论证**。#15142 之所以站得住,是因为 Prometheus 语义就是文档承诺的语义;修复不是「我觉得对」,而是「恢复与文档一致」。

## 写在最后

三个 PR 目前都在评审中,合并进展欢迎到仓库围观:

- [PR #15144 — 带 LIMIT 的 histogram 查询保持 eligible](https://github.com/openobserve/openobserve/pull/15144)
- [PR #15143 — _around 分页 size 的钳制与校验](https://github.com/openobserve/openobserve/pull/15143)
- [PR #15142 — quantile 插值对齐 Prometheus 的无穷语义](https://github.com/openobserve/openobserve/pull/15142)

项目地址:[github.com/openobserve/openobserve](https://github.com/openobserve/openobserve)
