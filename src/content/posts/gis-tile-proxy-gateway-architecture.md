---
title: "高并发 GIS 瓦片代理网关架构实战：高分影像反向中继、单终端互斥与流量计量流水线"
description: "记录遥感高分影像切片代理网关的设计与落地：针对海量 XYZ 瓦片请求，实现流式反向中继、基于 Redis + Cookie 的单终端并发互斥，以及结合双轨内存自增、Kafka 异步削峰、消费端毒丸隔离与断网补偿的流量计量流水线。"
publishDate: 2026-11-17
tags: ["架构设计", "遥感GIS", "高并发", "网关", "Redis", "Kafka", "分布式系统", "Java"]
readTime: "约 15 分钟"
series:
  name: "遥感与分布式系统架构实战"
  order: 1
---

## 引言

在地理信息系统（GIS）与商业遥感平台中，高分辨率卫星影像的在线浏览通常基于 XYZ 瓦片金字塔规范（如 Slippy Map Tiles 或 WMTS 协议）。用户在前端地图上平移、缩放或切换图层时，浏览器或桌面 GIS 软件（如 QGIS、ArcGIS）会并发发出数十甚至上百个切片 HTTP 请求。

如果直接把上游商业卫星供应商（如长光吉林一号、四维高景等）的切片服务地址交给前端访问，会遇到几个实际问题：

1. **凭证暴露与盗刷**：商业卫星影像调用成本较高，直连会让供应商凭证（Token / Key）暴露在前端网络请求中；
2. **账号多开与超量使用**：单个企业机构账号如果被复制到多台设备同时并发拖拽下载，配额会很快被耗尽；
3. **缺乏分级计费手段**：上游供应商通常只按总调用次数收费，无法区分用户是在浏览低分辨率的全球概览，还是在查看高分辨率的细节图层；
4. **高频请求冲击数据库**：瓦片请求具有高频、短连接和突发性，如果每次瓦片响应都同步写关系型数据库记账，数据库连接池与 I/O 很快就会出现瓶颈。

为了解决这些问题，我们在遥感数据服务系统（RSSC）中实现了一套切片代理网关（High-Definition Imagery Proxy，简称 HDI）。本文记录这套网关的结构划分、流式反向中继、单终端防刷机制，以及异步计量与容错流水线的实现细节。

---

## 一、 整体结构：流式中继与异步计量流水线

系统拆分为两个独立服务：生产端代理网关 `rssc-hdi-producer`（hfp）与消费端统计引擎 `rssc-hdi-consumer`（hfc）。

网关的请求处理与流量计量流程如下：

```text
+-----------------------+
|  Web / Desktop GIS    |
| (QGIS, Mapbox, Cesium)|
+-----------+-----------+
            | 1. GET /hdimage-cg?x={x}&y={y}&z={z}&token={t} (Cookie: GSessionId)
            v
+---------------------------------------------------------------------------------+
|                       hfp (HDI Tile Proxy Gateway)                             |
|                                                                                 |
|  [ Step 1: 鉴权与单终端校验 ]                                                    |
|  +--------------------+    +--------------------+    +-----------------------+  |
|  | Token 身份鉴权      | -> | 单终端 Cookie 互斥  | -> | 缩放层级与配额判定      |  |
|  | (Redis Token 校验)  |    | (GSessionId 独占)  |    | (z >= 13 & 限额拦截)  |  |
|  +--------------------+    +--------------------+    +-----------+-----------+  |
|                                                                  |              |
|  [ Step 2: 上游流式反向中继 ]                                     v              |
|  +---------------------------------------------------------------------------+  |
|  | RestTemplate 字节流中继: GET {vendor_url}/{z}/{x}/{y} -> image/png (200 OK)|  |
|  +---------------------------------------+-----------------------------------+  |
|                                          |                                      |
|  [ Step 3: 双轨内存计量与异步分流 ]      v                                      |
|  +---------------------------------------+-----------------------------------+  |
|  | 标准流量包: Redis incr (原子累加)                                          |  |
|  | 时长周期包: RedisLockRegistry 分布式锁 -> 日用量/周期 List 复合更新         |  |
|  | 消息削峰投递: KafkaTemplate.send(topic, payload)                         |  |
|  | 降级容错缓冲: Kafka 故障时 -> 写入 Redis 重试队列                           |  |
|  +---------------------------------------+-----------------------------------+  |
+------------------------------------------|--------------------------------------+
                                           |
                                           | 2. Kafka Topic: rssc-flow-stat
                                           v
+---------------------------------------------------------------------------------+
|                       hfc (HDI Flow Stat Consumer)                              |
|                                                                                 |
|  [ Step 4: 消费幂等与持久化落库 ]                                                |
|  +---------------------------------------------------------------------------+  |
|  | 毒丸防御: 畸形反序列化捕获与 ACK 提交 (防止分区阻塞)                           |  |
|  | 幂等去重: setIfAbsent("topic:partition:offset", 24h)                       |  |
|  | 事务入库: PostgreSQL 当月分表存储流量明细流水                               |  |
|  | 异常回退: DB 异常立即删除 Redis 幂等标记，触发 Kafka 容器重试                 |  |
|  +---------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------+
                                           |
                                           | 3. 定时对账与配额重置 (分布式锁保护)
                                           v
                          +----------------------------------+
                          |   ScheduleStatFlowTask (00:00)   |
                          |   - 每日流量对账与历史汇总       |
                          |   - 跨天日配额刷新与计数器重置   |
                          +----------------------------------+
```

---

## 二、 核心机制：请求过滤与反向中继

### 1. 缩放层级感知与按需计费

在瓦片金字塔体系中，全球切片层级通常分布在 $z \in [1, 20]$：
* 当 $z \le 12$ 时，影像多为几十米至数百米分辨率的中低分卫星概览图（主要用于大范围快速定位）；
* 当 $z \ge 13$ 时，影像进入米级、亚米级的高分商业卫星切片（单景采购与服务成本较高）。

如果在所有层级上一刀切计费，用户在缩小地图找位置时就会被频繁扣费。因此网关需要根据瓦片缩放层级（Zoom Level）实施按需计费：

```java
// AuthQuotaServiceImpl.java
public CgQuotaResult checkChangguangQuota(int orgId, int z) {
    // 1. 检查当前机构是否配置了时长套餐（TimeFlow Plan）
    List<OrgTimeFlow> orgTimeFlowList = timeFlowRedisTemplate.opsForList()
            .range(redisPreTimeflowRl + orgId, 0, -1);
    boolean withinTimeFlowPlan = orgTimeFlowList != null && orgTimeFlowList.parallelStream().anyMatch(t -> {
        OffsetDateTime now = OffsetDateTime.now();
        return !now.isBefore(t.getBeginTime()) && !now.isAfter(t.getEndTime()) && t.isEnabled();
    });

    // 2. 读取当日已用流量与单日上限阈值
    String dayFD = redisPreOrgTimeflowDay + orgId;
    OrgTimeFlowDay orgTimeFlowDay = (OrgTimeFlowDay) timeFlowDayRedisTemplate.opsForHash().get(keyOrgTimeflowDay, dayFD);
    double dayUsage = orgTimeFlowDay != null ? orgTimeFlowDay.getUsage() : 0d;
    double upperLimit = orgTimeFlowDay != null ? orgTimeFlowDay.getUpperLimit() : 0d;

    // 3. 读取总阈值与实时已消耗总流量
    String thresholdStr = strRedisTemplate.opsForValue().get(FlowRedisKeys.thresholdKey(orgId));
    long flowThreshold = (thresholdStr == null) ? -1 : new BigDecimal(thresholdStr).longValue();
    String realtimeStr = strRedisTemplate.opsForValue().get(FlowRedisKeys.realtimeKey(orgId));
    long flowRealTime = (realtimeStr == null) ? 0 : new BigDecimal(realtimeStr).longValue();

    // 4. 层级判定：缩放级别达到配置的 chargeThreshold 时才受限额约束
    boolean zoomThresholdReached = z >= Integer.parseInt(chargeThreshold);

    // 5. 超额拦截：达到计费层级且流量超标，阻断请求
    if (flowThreshold != -1 && flowRealTime >= flowThreshold && zoomThresholdReached) {
        if (!withinTimeFlowPlan) {
            return CgQuotaResult.builder().allowed(false).errorResponse(error).build();
        } else if (dayUsage >= upperLimit) {
            return CgQuotaResult.builder().allowed(false).errorResponse(error).build();
        }
    }

    return CgQuotaResult.builder()
            .allowed(true)
            .zoomThresholdReached(zoomThresholdReached)
            .billType(withinTimeFlowPlan && dayUsage < upperLimit ? BillStrategy.TIMESPAN_FLOW.getCode() : BillStrategy.STANDARD_FLOW.getCode())
            .build();
}
```

### 2. 单终端 Cookie 会话互斥防刷

在桌面端 GIS（如自研分析工具、QGIS 插件）场景中，客户端通常在 Header 中携带 Token 发起请求。如果同一个 Token 被多名员工共用，或有脚本在后台并发爬取瓦片，会导致账号配额在短时间内被刷爆。

网关结合 Token 与客户端 Cookie（`GSessionId`）来维护单终端排他会话：

```java
// AuthQuotaServiceImpl.java
@Override
public ResponseEntity<Object> checkSessionCookie(String token, String cookie, HttpServletResponse response) {
    String strCookie;
    String cName;
    String cValue;
    String cookieInRedis = strRedisTemplate.opsForValue().get(redisPreTokenCookie + token);

    if (StringUtils.isBlank(cookie)) {
        // 首次请求：未携带 Cookie
        if (null != cookieInRedis) {
            // Redis 中已存在该 Token 的活跃会话，说明已有其他终端在使用
            HttpHeaders rspHeaders = new HttpHeaders();
            rspHeaders.setContentType(MediaType.APPLICATION_JSON);
            return new ResponseEntity<>("Another user is currently using this session.", rspHeaders, HttpStatus.FORBIDDEN.value());
        }
        // 生成全局唯一会话 ID 并通过 Set-Cookie 返回
        cName = "GSessionId";
        cValue = UUID.randomUUID().toString().replace("-", "");
        strCookie = cName + "=" + cValue;
    } else {
        // 后续请求：携带了 Cookie
        if (null != cookieInRedis && !cookieInRedis.equals(cookie)) {
            // 会话不匹配，说明该 Token 已被其他终端重新接管
            HttpHeaders rspHeaders = new HttpHeaders();
            rspHeaders.setContentType(MediaType.APPLICATION_JSON);
            return new ResponseEntity<>("Another user is currently using this session.", rspHeaders, HttpStatus.FORBIDDEN.value());
        }
        strCookie = cookie;
        String[] parts = strCookie.split(";")[0].split("=", 2);
        cName = parts[0];
        cValue = parts.length > 1 ? parts[1] : "";
    }

    // 写入响应 Cookie 并刷新 Redis 会话有效期（如 30 分钟）
    Cookie ck = new Cookie(cName, cValue);
    response.addCookie(ck);
    strRedisTemplate.opsForValue().set(redisPreTokenCookie + token, strCookie, 
            Integer.parseInt(redisTokenCookieExpire), TimeUnit.MINUTES);
    return null;
}
```

* **互斥规则**：终端 A 处于使用状态时，终端 B 携带相同 Token 访问，因缺少终端 A 的 `GSessionId`，直接返回 `403 Forbidden`；
* **自然释放**：终端 A 停止操作并超过过期时间后，Redis 记录自动失效，其他终端即可正常建连。

---

## 三、 流量扣减：Redis 原子自增与分布式锁

网关在把切片响应流式透传给客户端的同时，需要统计实际返回的字节大小（`Content-Length`）。

系统支持两种结算模式：标准流量包（按量购买）与时长套餐包（包月/包年，带单日用量上限）。两者的更新路径不同：

```java
// FlowMeteringServiceImpl.java
private void saveToRedis(UserFlowVO userFlowVO) {
    if (userFlowVO.getBillType() == BillStrategy.STANDARD_FLOW.getCode()) {
        // 模式一：标准按量包，使用 Redis 原子递增，无锁操作
        String rtKey = FlowRedisKeys.realtimeKey(userFlowVO.getOrgId());
        strRedisTemplate.opsForValue().increment(rtKey, userFlowVO.getContentLength());
    } else if (userFlowVO.getBillType() == BillStrategy.TIMESPAN_FLOW.getCode()) {
        // 模式二：时长周期包，需要读取和修改 Hash 与 List 复合状态，加分布式锁避免并发写丢失
        String lockKey = FlowRedisKeys.lockHdiFlowKey(userFlowVO.getOrgId());
        Lock lock = redisLockRegistry.obtain(lockKey);
        try {
            if (lock.tryLock(3, TimeUnit.SECONDS)) {
                try {
                    // 1. 更新当前机构今日已用流量 (Hash 结构)
                    String fdKey = redisPreOrgTimeflowDay + userFlowVO.getOrgId();
                    OrgTimeFlowDay orgTimeFlowDay = (OrgTimeFlowDay) timeFlowDayRedisTemplate
                            .opsForHash().get(keyOrgTimeflowDay, fdKey);
                    if (orgTimeFlowDay != null) {
                        orgTimeFlowDay.setUsage(orgTimeFlowDay.getUsage() + userFlowVO.getContentLength());
                        timeFlowDayRedisTemplate.opsForHash().put(keyOrgTimeflowDay, fdKey, orgTimeFlowDay);
                    }

                    // 2. 更新当前生效时间周期的总用量 (List 结构)
                    String rlKey = redisPreTimeflowRl + userFlowVO.getOrgId();
                    List<OrgTimeFlow> orgTimeFlowList = timeFlowRedisTemplate.opsForList().range(rlKey, 0, -1);
                    if (orgTimeFlowList != null && !orgTimeFlowList.isEmpty()) {
                        OffsetDateTime now = OffsetDateTime.now();
                        IntStream.range(0, orgTimeFlowList.size()).forEach(i -> {
                            OrgTimeFlow rule = orgTimeFlowList.get(i);
                            if (rule.isEnabled() && !now.isBefore(rule.getBeginTime()) && !now.isAfter(rule.getEndTime())) {
                                rule.setUsage(rule.getUsage() + userFlowVO.getContentLength());
                                timeFlowRedisTemplate.opsForList().set(rlKey, i, rule);
                            }
                        });
                    }
                } finally {
                    lock.unlock();
                }
            } else {
                log.warn("Acquire flow lock timeout for orgId: {}", userFlowVO.getOrgId());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Interrupted while acquiring flow lock for orgId: {}", userFlowVO.getOrgId(), e);
        }
    }
}
```

> [!NOTE] 为什么对时长套餐使用分布式锁？
> 时长套餐的数据存储在 Redis 的 `Hash` 与 `List` 中，包含生效时间检查、单日配额与总配额的累加。如果不加锁，在高并发拉取瓦片时，两个请求可能同时读取到相同的旧对象并分别加和写回，导致后一次写入覆盖前一次的结果（Lost Updates），从而使统计数据偏小。

---

## 四、 容错与一致性：缓冲降级、毒丸防御与幂等消费

瓦片请求量大且与计费挂钩。高并发下遇到 Kafka 网络抖动、分区重平衡或数据库锁竞争时，需要兼顾低延迟响应和计费数据的准确性。

### 1. 生产者端：Kafka 异常降级至 Redis 缓冲队列

在 `FlowStatProducer` 中，为 Kafka 发送增加了同步捕获与异步回调处理：

```java
// FlowStatProducer.java
public void sendPayload(String key, String payload) {
    try {
        ListenableFuture<SendResult<String, String>> future = kafkaTemplate.send(topicName, key, payload);
        future.addCallback(
                result -> log.debug("Send data to kafka succeeded. key:{}", key),
                ex -> {
                    log.error("Send data to kafka failed, buffering to Redis retry queue. key:{}", key, ex);
                    bufferFailedMessage(payload);
                }
        );
    } catch (Exception ex) {
        log.error("Synchronous exception sending data to kafka, buffering to Redis retry queue. key:{}", key, ex);
        bufferFailedMessage(payload);
    }
}

private void bufferFailedMessage(String payload) {
    if (stringRedisTemplate != null) {
        try {
            stringRedisTemplate.opsForList().rightPush(HDI_FLOW_RETRY_QUEUE, payload);
            log.warn("Flow metering message buffered to Redis retry queue for compensation: {}", payload);
        } catch (Exception re) {
            log.error("Failed to buffer flow message to Redis retry queue: {}", payload, re);
        }
    }
}
```

### 2. 补偿定时任务：重发暂存消息

当网络或 Kafka 恢复后，后台定时任务从 Redis 队列取出暂存的消息重新投递至 Kafka：

```java
// FlowStatCompensationTask.java
@Scheduled(fixedDelay = 60000)
@CacheLock(lockedPrefix = CacheLockKeys.JOB_FLOW_COMPENSATE, expireTime = 50, timeUnit = TimeUnit.SECONDS)
public void retryBufferedFlowMessages() {
    if (stringRedisTemplate == null) return;

    for (int i = 0; i < BATCH_SIZE; i++) {
        String payload = stringRedisTemplate.opsForList().leftPop(FlowStatProducer.HDI_FLOW_RETRY_QUEUE);
        if (payload == null) break;

        try {
            JSONObject json = JSON.parseObject(payload);
            Integer userId = json != null ? json.getInteger("userId") : null;
            String key = (userId != null) ? redisPrefixDetail + userId : "unknown";
            
            // 同步等待确认发送成功
            kafkaTemplate.send(topicName, key, payload).get(5, TimeUnit.SECONDS);
            log.info("Successfully compensated buffered flow message to Kafka: {}", payload);
        } catch (Exception ex) {
            log.error("Failed to compensate flow message, pushing back to retry queue: {}", payload, ex);
            // 发送失败则插回队列头部并中断本轮重试，避免死循环
            stringRedisTemplate.opsForList().leftPush(FlowStatProducer.HDI_FLOW_RETRY_QUEUE, payload);
            break;
        }
    }
}
```

### 3. 消费者端：毒丸隔离与幂等落库

在消费端 `hfc`，主要处理两类异常：
1. **反序列化异常（Poison Pill）**：如果队列中出现畸形格式的消息，重复反序列化报错会导致消费循环重试，单分区被卡住；
2. **重复投递问题**：Kafka 重平衡或网络丢包可能导致重复消费，重复入库会导致多记流量。

```java
// HdiConsumer.java
@KafkaListener(topics = {"${spring.kafka.topic-name}"})
public void listen(ConsumerRecord<String, String> record, Acknowledgment ack) {
    AddUserFlowDetail addUserFlowDetail;
    try {
        addUserFlowDetail = JSON.parseObject(record.value(), AddUserFlowDetail.class);
    } catch (Exception e) {
        // 反序列化异常时记录日志并直接提交 ACK，跳过坏消息以防止分区阻塞
        log.error("反序列化 HDI 流量消息失败 (Poison Pill), topic={}, partition={}, offset={}",
                record.topic(), record.partition(), record.offset(), e);
        ack.acknowledge();
        return;
    }

    // 幂等判重：使用 topic:partition:offset 作为唯一键
    String deduplicationKey = "rssc:hdi:flow:consumed:" + record.topic() + ":" + record.partition() + ":" + record.offset();
    if (stringRedisTemplate != null) {
        Boolean isNew = stringRedisTemplate.opsForValue().setIfAbsent(deduplicationKey, "1", 24, TimeUnit.HOURS);
        if (Boolean.FALSE.equals(isNew)) {
            log.info("Duplicate HDI Kafka message detected and skipped: offset={}", record.offset());
            ack.acknowledge();
            return;
        }
    }

    try {
        // 流量流水写入数据库
        userFlowDetailService.add(addUserFlowDetail);
        ack.acknowledge();
    } catch (Exception e) {
        // 关键处理：如果写库失败，立即删除幂等标记，以便 Kafka 后续重试
        if (stringRedisTemplate != null) {
            try {
                stringRedisTemplate.delete(deduplicationKey);
            } catch (Exception ex) {
                log.warn("Failed to delete deduplication key upon DB error: {}", deduplicationKey, ex);
            }
        }
        throw e;
    }
}
```

> [!IMPORTANT] 幂等标记的异常回退是关键细节
> 如果在 Redis `setIfAbsent` 成功后下游写库失败，若不清除该 Key，下一次重试时该 Key 已存在，会导致重试逻辑将该消息视作“重复消息”跳过，从而丢失计费数据。这里的 `catch` 块主动删除 `deduplicationKey`，保证了数据库恢复后能继续重试。

---

## 五、 总结与工程权衡

将高分影像瓦片代理拆分为**反向流式中继**与**异步流水线**后，网关在实现效果上主要有以下权衡：

| 关注维度 | 直连 / 单体落库方案 | 网关中继与异步流水方案 |
| :--- | :--- | :--- |
| **凭证管理** | 前端持有上游凭证，存在被提取风险 | 网关后端统一注入凭证，对外仅暴露内部会话 Token |
| **并发防护** | 无法限制同一账号在多台设备上并发下载 | 基于 Redis + Cookie 维持单终端排他会话，超限阻断 |
| **吞吐能力** | 每个瓦片请求同步写库，I/O 竞争明显 | 内存原子操作计数 + Kafka 异步削峰，减轻数据库写入压力 |
| **容错处理** | 中间件抖动时容易丢请求或失败报错 | 异常时降级至 Redis 队列并由定时任务补偿重试 |
| **计费粒度** | 粗粒度全量统计 | 依据缩放层级（Zoom Level）分级，概览免流，高分计费 |

在这套实现中，核心思路是把高频的读路径（切片透传）与慢速的写路径（明细落库）分开处理。对于标准计费直接使用单键原子自增，避免过多锁竞争；对于有复合状态的时长套餐，则在组织维度使用短时分布式锁避免写冲突；通过消息队列削峰并在异常时回退重试，在保证吞吐量的同时尽量减少计量漏记。
