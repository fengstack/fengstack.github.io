---
title: "从半成品到完整闭环：重拾波波老师的 simple-seata，我手写了 TC、防脏写与可观察 AT 模式"
description: "重拾当年在极客时间跟随波波老师学习时 fork 的 simple-seata，从零手写 seata-server（内嵌 TC 协调器与全局行锁）、seata-tm 事务模板，修复防脏写后镜像校验与锁重试缺陷，构建双独立 H2 物理库与每步打印前后镜像 JSON 的可观察 AT 模式闭环。"
publishDate: 2026-10-22
tags: ["分布式事务", "Java", "开源实战"]
readTime: "约 12 分钟"
refLink:
  text: "参考工程：simple-seata"
  url: "https://github.com/fengstack/simple-seata"
---

几年前在极客时间系统学习波波老师（杨波，spring2go）的微服务架构课程时，有一部分深入剖析了分布式事务的核心原理。当时阿里刚开源 Fescar（后更名为 Apache Seata）不久，波波老师为了让大家摆脱上万行生产级代码中 Spring 胶水层与复杂微服务注册中心的干扰，专门写了一个精简版的教学工程 —— `simple-seata`。

那份代码令人惊艳：它摒弃一切繁文缛节，只用最凝练的 Java 代码直接切入分布式事务的两大命脉：**Netty 4 实现的二进制私有 RPC 协议**（魔数 `0xdada`、14 字节定长头与请求合并）与 **AT 模式无侵入代理的核心驱动**（基于 Druid AST 的 SQL 解析器 + JDBC 代理链路 + 前后镜像构造）。

然而，原作者的开源仓库后来下线了，更让人遗憾的是，**它当时是一个未完成的“半成品”**。最近在整理技术库时，我重新拾起了这份代码。看着工程里只有 RM（资源管理器）在孤独地拦截 SQL、生成前后镜像，却由于**缺少 TC（事务协调器）与 TM（事务管理器）**，整个二阶段提交根本无法闭环、一行 Demo 都跑不起来，我决定给它来一次彻底的“闭环手术”：**把缺失的大脑手写出来，把致命的防脏写防线补齐，打造一个双独立数据库、每一步都能肉眼直视前后镜像 JSON 的教学级 AT 闭环。**

## 一、诊断遗产：原版 simple-seata 到底缺了什么？

要让一个分布式事务框架真正运转，**TM（事务管理器）、RM（资源管理器）、TC（事务协调器）三位一体缺一不可**：

```text
       ┌────────────────────────┐
       │   TM (事务管理器)       │
       │   发起 begin / commit   │
       └───────────┬────────────┘
                   │ 1. 开启全局事务 / 4. 决议提交或回滚
                   ▼
       ┌────────────────────────┐
       │   TC (事务协调器)       │◄── 3. 注册分支事务 & 申请全局行锁
       │   "大脑"：维护全局会话状态 │──► 5. 驱动二阶段 Commit/Rollback
       └───────────▲────────────┘
                   │ 2. 拦截 SQL / 记录 undo_log
                   │
       ┌───────────┴────────────┐
       │   RM (资源管理器)       │
       │   数据源代理 + 前后镜像    │
       └────────────────────────┘
```

翻开当年的代码库，现状非常纯粹却也致命：

1. **有手脚，无大脑（缺失 `seata-server`）**：RM 能够在本地事务提交前拼出 `BranchRegisterRequest`（分支注册）向网络发包，但服务端根本不存在接收者；没有全局 XID 分配器，没有会话状态机，更没有全局行锁管理器。
2. **有士兵，无司令（缺失 `seata-tm`）**：没有 `GlobalTransaction` API 和编程式事务模板，业务代码根本不知道如何在调用链中开启一个全局事务，`RootContext` 里的 XID 只能靠手动硬编码。
3. **致命的防脏写空白（Fake Rollback）**：在 `AbstractUndoExecutor` 中，原实现直接用前镜像生成反向 SQL 回滚。**这完全忽略了 AT 模式最脆弱的命门 —— 脏写（Dirty Write）**：如果有一笔改动在全局事务之外绕过 Seata 动了该行，盲目用旧值覆盖回去，就会直接覆盖掉别人的有效更新！
4. **锁重试引发的重复扣款漏洞**：当本地事务遇到全局行锁冲突时，RM 需要重试。但原实现重试时未对本地物理连接执行回滚，导致同一条业务扣款 SQL 在多轮重试中被执行了多次。

## 二、补齐大脑：从零实现轻量级 seata-server (TC)

为了让学习者开箱即用，无需在本地部署 ZooKeeper、MySQL 或独立开一个几十兆的 Server 进程，我决定构建一个**既能独立运行、又能以 `EmbeddedTC` 形式在进程内一秒拉起**的纯内存协调器。

### 1. 全局行锁管理器：`LockManager`

AT 模式在本地一阶段提交后，数据库本地锁就释放了。为了防止两个全局事务并发修改同一行数据，必须在 TC 内存中维护一把**全局逻辑行锁**：

- **LockKey 格式**：`resourceId^^^tableName^^^pkValue`（例如：`jdbc:h2:mem:storage^^^storage_tbl^^^1`）
- **核心数据结构**：采用 `ConcurrentHashMap` 记录 `lockKey -> transactionId`。

```java
public class LockManager {
    // 资源 + 表 + 主键 -> 持有锁的全局事务 ID
    private final ConcurrentMap<String, Long> lockMap = new ConcurrentHashMap<>();

    public boolean acquireLock(BranchSession branchSession) {
        List<RowLock> locks = collectRowLocks(branchSession);
        // 先检查冲突，保证原子性占用；若有一行被其他事务占用，全部放弃
        for (RowLock lock : locks) {
            Long holder = lockMap.putIfAbsent(lock.getLockKey(), branchSession.getTransactionId());
            if (holder != null && !holder.equals(branchSession.getTransactionId())) {
                // 发生锁冲突：回滚本轮已登记的行锁，并返回失败
                releaseLocks(branchSession.getTransactionId(), acquiredLocks);
                return false;
            }
        }
        return true;
    }
}
```

### 2. 状态机与二阶段调度编排：`DefaultCoordinator`

`DefaultCoordinator` 是整个 TC 的中枢神经，处理四类核心入站指令：

- `GlobalBeginRequest`：分配全局唯一的递增 XID（`ip:port:txId`），初始化 `GlobalSession`；
- `BranchRegisterRequest`：登记分支并抢占 `LockManager` 行锁；
- `GlobalCommitRequest`：发起二阶段提交。**遍历所有分支下发 `BranchCommitRequest`，只有全部成功才释放全局锁并销毁会话；任何一个分支失败，会话转入 `CommitRetrying`**；
- `GlobalRollbackRequest`：发起二阶段回滚。**严格按照分支注册的逆序（Reverse Order）逐一下发 `BranchRollbackRequest`**，若失败则置为 `RollbackRetrying`。

```text
// DefaultCoordinator.java
private void completeRollback(GlobalSession session) {
    session.changeStatus(GlobalStatus.Rollbacking);
    // 逆序回滚：最后操作的数据最先还原，严格对齐事务日志反向恢复直觉
    boolean allBranchesDone = dispatchBranchRollback(session);

    if (allBranchesDone) {
        lockManager.releaseLocks(session);
        session.changeStatus(GlobalStatus.Rollbacked);
        sessionManager.removeGlobalSession(session);
    } else {
        // 关键改动：绝不吞掉分支错误，保持行锁并进入重试状态
        session.changeStatus(GlobalStatus.RollbackRetrying);
    }
}
```

此外，增加了一个每秒轮询的 `timeoutCheck()` 守护线程：

- **清理孤儿事务**：若 TM 在 `Begin` 之后意外宕机，超时后 TC 自动下发回滚，防止全局行锁永久锁死；
- **驱动重试**：对处于 `CommitRetrying` 和 `RollbackRetrying` 的事务持续下发二阶段重试。

## 三、补齐司令官：seata-tm 与客户端编程式事务

为了彻底剥离对 Spring AOP 的强依赖，让执行流可以直接在单步 Debug 中看透，我实现了编程式事务模板 `TransactionalTemplate` 与 `DefaultGlobalTransaction`：

```java
public class TransactionalTemplate {
    public Object execute(TransactionalExecutor business) throws Throwable {
        GlobalTransaction tx = new DefaultGlobalTransaction();
        try {
            tx.begin(); // 1. 向 TC 发送 GlobalBeginRequest，获取 XID 并绑定到 RootContext
            Object rs = business.execute(); // 2. 执行业务代码（内部触发 RM 分支注册与本地提交）
            tx.commit(); // 3. 业务无异常，向 TC 请求全局提交
            return rs;
        } catch (Throwable ex) {
            tx.rollback(); // 4. 捕获任何异常，向 TC 请求全局回滚（驱动 RM 反向补偿）
            throw ex;
        } finally {
            RootContext.unbind(); // 5. 清理线程上下文中的 XID
        }
    }
}
```

## 四、补齐防线：AT 模式那些致命的暗礁

重构过程中，我修复了两个极具代表性、但在很多手写框架中经常被忽略的致命漏洞：

### 1. 真正的防脏写（Dirty-Write Validation）

很多初学者甚至生产环境的二次定制者都会误以为：“既然有一阶段记录的前镜像（Before Image），回滚时直接用前镜像 `UPDATE table SET col = before_val WHERE pk = ?` 不就行了吗？”

**答案是：绝对不行！**考虑以下场景：

1. 全局事务 A 开启，将库存从 `100` 扣减为 `90`（前镜像=100，后镜像=90），一阶段提交并释放物理锁；
2. 此时，另一个没有走 Seata 代理的外部定时任务（或未加全局锁的普通业务）直接把库存改成了 `55`；
3. 全局事务 A 随后发生异常，开始二阶段回滚。如果直接用前镜像恢复，库存会瞬间被刷回 `100` —— **外部系统的修改（55）被凭空蒸发了！**

真正的 AT 模式防脏写必须在反向补偿前执行**后镜像核验**：

```text
// AbstractUndoExecutor.java
protected void dataValidation(Connection conn) throws SQLException {
    TableRecords afterImage = sqlUndoLog.getAfterImage();
    if (afterImage != null && afterImage.size() > 0) {
        for (Row expectedRow : afterImage.getRows()) {
            // 实时查询当前数据库中的物理数据
            Row currentRow = queryCurrentRow(conn, expectedRow);
            if (currentRow == null) {
                throw new SQLException("Dirty write detected: row was deleted after phase one!");
            }
            // 逐字段核对是否完全吻合后镜像
            if (!rowsEqual(expectedRow, currentRow)) {
                throw new SQLException("Dirty write detected: row was modified after phase one! "
                        + "expect(after)=" + expectedRow + ", actual=" + currentRow);
            }
        }
    }
}
```

如果校验失败，说明发生了脏写，**RM 坚决拒绝盲目补偿**，向上抛出异常；TC 收到后将事务挂起在 `RollbackRetrying` 状态并保留全局锁。只有在运维人员介入、将数据纠正为应然状态后，TC 的超时重试线程才会通过校验并完成自动补偿。

### 2. 锁冲突重试必须“预回滚物理连接”

当多个分支事务并发修改同一行数据时，行锁被占用，RM 侧会通过 `LockRetryController` 按退避算法重试。原代码在同一物理连接里直接循环重新执行业务 SQL，导致重试几次就执行了几次扣款！

因此，我提炼了 `connectionProxy.rollbackForRetry()`：

```java
public void rollbackForRetry() throws SQLException {
    targetConnection.rollback();       // 必须回滚底层未提交的物理事务！
    context.reset(context.getXid());    // 清空本轮积累的 undo_log，但绝不能清掉 XID 绑定
}
```

每轮重试前先清扫现场，让重试保持幂等与安全。

## 五、肉眼可见的 AT 模式：双独立库演练实录

为了让读者能够亲眼看清 AT 模式底层的一切细节，我在 `seata-examples` 中彻底放弃了虚假的单数据源模拟，而是**初始化了两个完全独立的 H2 内存数据库**：

- `jdbc:h2:mem:storage`（库存库，拥有独立的物理 `storage_tbl` 和 `undo_log` 表）；
- `jdbc:h2:mem:account`（账户库，拥有独立的物理 `account_tbl` 和 `undo_log` 表）。

只需一行命令即可运行端到端演示：

```bash
mvn -pl seata-examples -am test -Dtest=EndToEndIntegrationTest
# 或直接运行可观察的交互式 DemoApp
mvn -pl seata-examples exec:java -Dexec.mainClass="io.spring2go.seata.examples.DemoApp"
```

DemoApp 将整个执行生命周期拆解为清晰的三幕：

### 场景一：两阶段提交（下单成功）

```text
[场景一：下单成功 —— 两个分支（扣库存 + 扣账户）两阶段提交]
  >>> 一阶段：TM 开启全局事务，两个库各自执行：
      记录前镜像 -> 执行业务 SQL -> 记录后镜像 -> 向 TC 注册分支申请全局行锁
      -> undo_log 与业务数据在同一个本地事务里原子提交
  >>> 一阶段结束后的数据状态（两个库的本地事务都已提交）:
      库存 C001 = 90 (100-10), 账户 U001 = 900 (1000-100)
  [库存库] undo_log 内容（反向补偿依据）:
    {"afterImage":{"rows":[{"fields":[{"name":"COUNT","type":4,"value":90}]}]},"beforeImage":{"rows":[{"fields":[{"name":"COUNT","type":4,"value":100}]}]}}
  [账户库] undo_log 内容:
    {"afterImage":{"rows":[{"fields":[{"name":"MONEY","type":4,"value":900}]}]},"beforeImage":{"rows":[{"fields":[{"name":"MONEY","type":4,"value":1000}]}]}}

  >>> 二阶段提交：TC 通知两个分支提交，RM 只是异步批量删除 undo_log（几乎零开销）
  >>> 二阶段完成: undo_log 已清理, 库存 undo_log = 0, 账户 undo_log = 0
```

**核心领悟**：为什么说 AT 模式快？一阶段业务数据早就入库了，二阶段提交只要后台开个 `AsyncWorker` 定时线程把 `undo_log` 删掉即可，**对业务链路毫无延迟阻碍！**

### 场景二：两阶段回滚（业务异常反向补偿）

模拟下单时库存扣减成功、账户扣减成功，但随后下游订单系统抛出异常：

```text
[场景二：下单失败 —— 业务异常触发全局回滚，用 undo_log 反向补偿]
  >>> 模拟：扣库存成功、扣账户成功后，下游业务抛出 BusinessException
  >>> 捕获业务异常: Order service mock exception!
  >>> 二阶段回滚：TC 按分支注册的逆序下发回滚指令，
      RM 校验后镜像（防脏写）后，用前镜像构造反向 SQL 把数据还原:
      库存 C001 = 100 (已自动逆向补偿), 账户 U001 = 1000 (已自动逆向补偿)
      undo_log: 库存 = 0, 账户 = 0 (补偿成功即物理删除)
```

### 场景三：发生脏写与自愈（防御体系激活）

这是整个重构中最精彩的部分 —— 模拟外部系统绕过全局事务直接篡改数据：

```text
[场景三：脏写检测 —— 有人绕过全局事务改了数据，AT 拒绝盲目补偿]
  >>> 一阶段完成: 库存 C001 = 90（本地事务已提交，等待二阶段）
  >>> 模拟脏写: 外部程序直接通过原生连接把库存改成了 55！
  >>> 二阶段回滚: RM 发现当前物理数据(55) != 后镜像(90)，判定为脏写，拒绝补偿！
      库存 C001 = 55 (保持脏值，没有用 100 盲目覆盖！), undo_log = 1 (TC 挂起在 RollbackRetrying 重试)
  >>> 人工修复: 运维核实后把数据修复为应然状态 90...
  >>> TC 超时检查线程感知并自动重试成功: 库存 C001 = 100 (反向补偿完成), undo_log = 0
```

## 六、深入思考：AT 模式的设计哲学与取舍

通过亲手补齐这套极简实现，我们可以深刻体会到以 Seata 为代表的 AT 模式与传统 XA 两阶段提交的本质区别：

| 维度 | XA (2PC 强一致模式) | AT (无侵入应用层补偿模式) |
| --- | --- | --- |
| **锁定时间** | **跨越两个阶段**：一阶段执行完一直握着数据库物理行锁，直到 TC 下发二阶段指令才释放。 | **仅一阶段本地事务**：执行完立刻提交并释放数据库行锁；二阶段全靠 TC 内存全局行锁保障隔离性。 |
| **并发性能** | 差。长时间持有行锁极易引发热点锁冲突与雪崩。 | **极高**。正常提交路径几乎等同于本地事务性能。 |
| **隔离级别** | 读写强隔离（Serializable / Repeatable Read）。 | **读未提交（Read Uncommitted）**。默认不加读锁，可通过 `SELECT ... FOR UPDATE` 升级为读已提交。 |
| **适用场景** | 跨部门、短流程、银行账务等强一致场景。 | 高并发互联网业务、电商交易链条。 |

**AT 模式的本质，是工业界在“绝对隔离性”与“高并发吞吐”之间做出的一场精妙妥协。**它把事务隔离性的担保从底层数据库引擎挪到了应用层的 TC 内存中，用反向 SQL 弥补了本地提前提交带来的回滚困难。

## 结语：向经典的开源致敬

很多时候，学习大型工业级中间件是一件令人沮丧的事。数十万行代码里，充满了为了适配各种极端环境、SPI 发现、Spring 自动注入、多协议兼容的“脚手架与装饰代码”，真正的算法与架构核心往往被掩埋其中。

波波老师当年的 `simple-seata` 是一颗闪亮的种子，它抽离了所有噪音，直指问题本质。而今天我为它补上 `seata-server`、`seata-tm`、防脏写机制与端到端演练，则是让这颗种子真正破土发芽，形成了一个能够自由把玩、随时下断点推演的完整世界。

如果你也想彻底弄懂分布式事务与 Netty 二进制通信协议，不妨 clone 下来走一遍测试断点：

- **项目仓库**：[https://github.com/fengstack/simple-seata](https://github.com/fengstack/simple-seata)
- **学习路线指南**：[docs/learning/at-mode-guide.md](https://github.com/fengstack/simple-seata/blob/master/docs/learning/at-mode-guide.md)

愿我们在追求技术底层的路上，永远保持拆开黑盒的热情。
