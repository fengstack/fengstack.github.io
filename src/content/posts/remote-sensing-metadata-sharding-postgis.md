---
title: "遥感归档影像千万级元数据分表实战：全球网格编码、PostgreSQL 哈希分区与两阶段空间检索"
description: "记录遥感归档影像元数据在 PostgreSQL 中的分表设计与检索演进：利用全球 5°×5° 经纬度网格编码（grid_id）配合 72 个声明式 Hash 分区实现一维整数降维粗筛，结合 PostGIS 空间列精筛与 Java JTS 级联并集计算覆盖率，在保护数据库 CPU 的同时解决大网格陪跑数据过多与跨网格去重问题。"
publishDate: 2026-11-18
tags: ["PostgreSQL", "PostGIS", "遥感GIS", "分库分表", "jOOQ", "JTS", "性能优化", "架构设计"]
readTime: "约 16 分钟"
series:
  name: "遥感与分布式系统架构实战"
  order: 2
---

## 引言

在商业遥感数据服务平台中，历史归档影像检索是最高频的核心接口之一。用户在地图上绘制或上传一个感兴趣区域（AOI，小到几平方公里的矿区，大到上万顶点的省级行政边界），附带拍摄时间范围、云量上限、侧摆角、太阳高度角和卫星列表等筛选条件，后端需要从目前约 4,700 万条的归档元数据中查出所有命中该区域的卫星景记录，并实时算出单景覆盖率以及多景合并后的总覆盖率（Area Coverage）。

面对 4,700 万级的数据体量，如果把这套逻辑直接丢给一张未分表的 PostgreSQL + PostGIS 大表，用 `ST_Intersects` 加 `ST_UnaryUnion` 全量下推给数据库硬扛，主库很快就会遇上 CPU 瓶颈。原因在于 PostGIS 的 `ST_Intersects(geom, aoi)` 内部包含两步：

1. `geom && aoi`：利用 GiST 索引做外包络矩形（Bounding Box）碰撞比较，只需比对 4 个浮点数，CPU 开销极低；
2. `_ST_Intersects(geom, aoi)`：从数据页读取完整几何顶点，调用底层 C++ GEOS 引擎逐边求交，CPU 开销极高。

当用户上传上万顶点的 Shapefile 多边形，或者拉大时间跨度搜索上千万平方公里的区域时，数据库必须在内核里做数千次复杂多边形求交，如果再叠加 `ST_Intersection` 算面积和 `ST_UnaryUnion` 合并多边形，单台数据库主库的 CPU 很容易被打满——而数据库主库恰恰是整套系统里最难水平扩容的单点资源。

为此，我们在[瓦片代理网关](/post/gis-tile-proxy-gateway-architecture/)之外，围绕归档影像元数据表 `archive.image_metadata` 设计了一套基于空间网格编码的 PostgreSQL 哈希分区方案，并在业务量增长后将其演进为「`grid_id` 粗筛 + PostGIS `geom` 精筛 + Java 应用层算面积与分页」的两阶段混合架构。本文记录这套分表方案的设计初衷、踩坑复盘与最终落地细节。

---

## 一、`grid_id` 的设计初衷：Hash 分表与一维整数降维

在引入空间网格编码时，核心目的只有两个：

1. **作为 Hash 分片键均匀打散物理表**：把单张千万级大表拆成多张轻量物理子表，控制单表体积与索引深度；
2. **用一维整数匹配替代高开销的二维空间计算**：把二维球面多边形预编码为整数，让数据库先用廉价的整数 `IN` 查询挡掉绝大部分无关数据，减少数据库内的几何计算。

### 1. 全球 5° × 5° 网格编号与 72 张 Hash 分区

系统约定全球空间网格固定步长为 5°（经纬度各 5 度）。地球经度范围 `[-180°, 180°]` 共 360°，按 5° 步长恰好切分为 72 列；纬度范围 `[-90°, 90°]` 共 180°，按 5° 步长切分为 36 行。全球陆地与海洋表面由此被划分为 `36 × 72 = 2592` 个网格，每个网格拥有唯一的整数编号 `grid_id`（取值 1 ~ 2592）：

```text
+90°N  +-------+-------+-------+-----+-------+
       | 2521  | 2522  | 2523  | ... | 2592  |   第 36 行
       +-------+-------+-------+-----+-------+
       |  ...  |  ...  |  ...  | ... |  ...  |
       +-------+-------+-------+-----+-------+
 -85°S |  73   |  74   |  75   | ... |  144  |   第 2 行
       +-------+-------+-------+-----+-------+
 -90°S |   1   |   2   |   3   | ... |   72  |   第 1 行 (col = 0..71)
       +-------+-------+-------+-----+-------+
    -180°W  -175°W  -170°W         +175°E  +180°E

网格编号公式:
  gridId = floor((lat + 90) / 5) * (360 / 5) + floor((lng + 180) / 5) + 1
```

在数据库层，父表 `archive.image_metadata` 使用 PostgreSQL 原生声明式分区 `PARTITION BY HASH (grid_id)`，下挂 **72 张物理子表**（`image_metadata_part0` 至 `image_metadata_part71`，按 `modulus 72, remainder 0..71` 路由）：

* **为什么是 72 个分区？** 全球经度 360° 除以 5° 正好是 72 列。按 72 取模后，同一纬度带相邻的网格会依次落入 0 ~ 71 号子表，每个子表平均承接 `2592 / 72 = 36` 个不同纬度的网格。相比按大洲或按单纬度带分表，模 72 Hash 能有效避免陆地热点集中与海洋空表倾斜。
* **单表容量实测估算**：按当前总规模约 4,700 万条计算，均匀打散到 72 张物理子表后，**单张子表平均仅承载约 65 万行记录**，单表体积和 B-Tree 索引高度（通常稳定在 3 层以内）都非常轻量。

### 2. Java 侧网格编码与外包络剪枝

无论是上游影像入库还是用户画 AOI 查询，都需要计算几何体覆盖的 `grid_id` 列表。为了避免每次都遍历全球 2592 个网格，计算逻辑会先提取几何体的外包络矩形（`Envelope`）裁剪遍历边界，并对压在 5° 网格线上的点返回相邻网格：

```java
// SpatialGridUtils.java
public static final int DEFAULT_GRID_STEP = 5;

public List<Long> getPolygonGridIds(Geometry geometry, long step) {
    List<Long> gridIdList = new ArrayList<>();
    if (geometry == null || geometry.isEmpty() || step <= 0) {
        return gridIdList;
    }

    // 1. 先用外包络矩形缩小经纬度搜索范围，避免全量遍历 2592 个网格
    Envelope env = geometry.getEnvelopeInternal();
    long startLat = Math.max(-90, -90 + (long) Math.floor((env.getMinY() + 90.0) / step) * step);
    long endLat = Math.min(90, -90 + (long) Math.floor((env.getMaxY() + 90.0) / step) * step + step);

    long startLng = Math.max(-180, -180 + (long) Math.floor((env.getMinX() + 180.0) / step) * step);
    long endLng = Math.min(180, -180 + (long) Math.floor((env.getMaxX() + 180.0) / step) * step + step);

    GeometryFactory geometryFactory = new GeometryFactory();
    for (long lat = startLat; lat < endLat; lat += step) {
        for (long lng = startLng; lng < endLng; lng += step) {
            long gridId = ((lat + 90) / step) * (360 / step) + (lng + 180) / step + 1;
            Coordinate[] coords = new Coordinate[] {
                    new Coordinate(lng, lat),
                    new Coordinate(lng, lat + step),
                    new Coordinate(lng + step, lat + step),
                    new Coordinate(lng + step, lat),
                    new Coordinate(lng, lat)
            };
            // 2. 只有真正与当前 5° 网格相交的格号才加入列表
            Geometry gridGeometry = geometryFactory.createPolygon(coords);
            if (geometry.intersects(gridGeometry)) {
                gridIdList.add(gridId);
            }
        }
    }
    return gridIdList;
}
```

对于“单点查询”（用户只点选了一个经纬度坐标），`getPointGridId` 会专门检查点是否正好压在 5° 经线或纬线上（`convertedLng % step == 0 || convertedLat % step == 0`），若是则把共用这条边界的 2 个或 4 个相邻网格一并返回，防止边界点漏检。

---

## 二、 写入侧取舍：为什么选择“一景多条记录”而非“单景取最小 grid_id”？

在设计存储模型时，很容易产生一个直觉上的优化念头：**一景卫星影像如果只占几十公里宽，却正好横跨在两个 5° 网格的边界上，能不能只取它覆盖到的最小那个 `grid_id`，保证数据库里一景永远只存 1 条记录？**

答案是：**如果查询依赖 `WHERE grid_id IN (...)` 做分区裁剪，只存最小 `grid_id` 会导致跨网格边界漏检。**

看下面这个几何位置关系：

```text
          115°E (5° 网格分界线)
            │
  Grid_100  │   Grid_101
 (part_28)  │  (part_29)
            │
     ┌──────┼──────┐
     │  影像 S     │  <-- 影像 S 横跨 Grid_100 与 Grid_101
     │      │  ██  │      若入库只取最小 grid_id = 100，记录只落入 part_28
     └──────┼──────┘
            │  ^
            │  └── 用户 AOI 完全位于 Grid_101 内部，但与影像 S 右侧重叠
```

1. **入库时**：影像 S 覆盖了 `Grid_100` 和 `Grid_101`。若只存最小 `grid_id = 100`，它只会进入 `part_28` 子表，`Grid_101`（`part_29`）里没有任何关于影像 S 的索引记录；
2. **查询时**：用户画了一个小 AOI，完全落在 115°E 以东的 `Grid_101` 内部。`SpatialGridUtils` 算出该 AOI 只命中 `grid_id = 101`。SQL 执行 `WHERE grid_id IN (101)` 后，PostgreSQL 分区裁剪只扫 `part_29`，直接跳过 `part_28`——影像 S 就这样被漏掉了。

除非在查询侧对每个 AOI 的外包络额外做“向西、向南外扩一个最大影像跨度”的补偿缓冲（若后续接入超长条带影像，外扩阈值依然会失效），否则最稳妥的做法就是在写入侧采用**跨网格冗余展开（空间换正确性与查询速度）**：

* **上游拆单分发**：在同步服务 `CatalogSyncDispatcher` 中，先调用 `getPolygonGridIds(sceneGeometry, 5)` 算出单景边界覆盖的全部网格，跨越几个网格就拆成几条消息（同 `scene_id`，不同 `grid_id`）投递入库；
* **联合约束与幂等写入**：数据库主表定义联合主键 `PRIMARY KEY (id, grid_id)` 和联合唯一索引 `UNIQUE (scene_id, grid_id)`（PostgreSQL 声明式分区也强制要求唯一约束必须包含分区键）。业务层通过 jOOQ 直接写入父表 `IMAGE_METADATA`，完全不需要拼子表名，配合 `ON CONFLICT (scene_id, grid_id) DO NOTHING` 即可幂等消化上游消息重投。

> **为什么跨网格多写的存储膨胀其实很低？**
> 常规高分商业卫星单景幅宽多在 10 km ~ 60 km，而 5°×5° 网格在赤道宽约 555 km、在中纬度宽约 400 km。绝大多数景落在单个网格内，只有少数压线影像会分裂为 2 条（极少跨四角点分裂为 4 条），平均冗余倍率远低于 1.2 倍。

---

## 三、 第一代方案的瓶颈：30 万平方公里的“陪跑数据”与缺失的前导索引

最初的第一代实现里，数据库表只用 `json` 列存四角坐标，没有引入 PostGIS 空间列，所有空间相交都在 Java 内存里靠 JTS 逐条反序列化计算。当归档影像积累到 4,700 万条的规模后，这套纯网格方案暴露出三个明显的瓶颈：

1. **5°×5° 网格粗筛粒度太粗，陪跑数据过多**：
   赤道处一个 5°×5° 网格的面积约 30 万 km²。如果用户只想查一个 10 km × 10 km 的局部地块，数据库会把命中网格内所有历史年份里根本不挨边的影像 JSON 全部拉回 Java 进程，造成巨大的网络传输和 JSON 反序列化压力。
2. **子表内缺失 `grid_id` 前导索引，退化为子表全扫**：
   由于表上只有主键 `(id, grid_id)` 与唯一约束 `(scene_id, grid_id)`，`grid_id` 全都排在索引的第二列。而 2592 个网格哈希到 72 张物理子表后，每张 `partX` 子表内部依然混装着 36 个不同 `grid_id` 的历史数据。查询裁剪到某张 `partX` 子表后，在子表内部实际上一直在跑顺序扫描（Seq Scan）。
3. **SARGABLE 索引失效陷阱**：
   早期代码曾直接在数据库列上套函数做过滤，例如 `CAST(image_time AS date) >= fromDate` 或 `ABS(off_nadir_angle) <= ona`，破坏了字段的 SARGABLE（可索引利用）特性。必须将其改写为原生时间戳半开区间 `[fromDate, toDate + 1天)` 与对称数值区间 `off_nadir_angle BETWEEN -absOna AND absOna`。

---

## 四、 演进后的最佳方案：`grid_id` 粗筛 + `geom` 精筛 + Java 算面积与分页

要解决第一代方案的陪跑问题，同时又守住“不打爆数据库 CPU”的底线，关键在于**把 PostGIS 用在刀刃上：只让数据库做轻量的外包络和布尔相交精筛，而把重度的面积切割、多边形合并与复杂业务校验留在可水平扩展的 Java 应用层**。

### 1. 四级漏斗检索流水线

演进后的检索链路形成四级漏斗：

```text
用户画 AOI 查询 (面向 4,700 万总量，附带时间、产品类型、云量、侧摆角等条件)
  │
  ├─► [第 1 级: PG 72 分区裁剪]  WHERE grid_id IN (aoiGridIds)
  │     └── 跳过 95%+ 无关物理分区，将扫描范围从 4,700 万收缩至 1~4 张子表 (每表约 65 万行)
  │
  ├─► [第 2 级: 子表 B-Tree 复合索引粗筛]  (grid_id, product_type, image_time DESC)
  │     └── 在约 65 万行的子表内通过轻量整数/时间 B-Tree 索引，将候选集快速收窄至几十~数百行
  │
  ├─► [第 3 级: PostGIS geom 空间精筛]  AND ST_Intersects(geom, :aoiGeom)
  │     └── 仅对百来行记录做相交布尔判定 (< 1ms)，剔除 5° 网格内不相交的陪跑数据
  │     └── 返回 100% 落在 AOI 内的景记录 (通常几十条)
  │
  └─► [第 4 级: Java 应用层去重、覆盖率计算与分页]
        ├── 跨网格去重: 单网格免去重；多网格用 HashSet 按 scene_id O(1) 去重
        ├── 面积计算:   parallelStream + JTS 算单景覆盖率，UnaryUnionOp 算总覆盖率
        └── 前端分页:   按业务模式走 Redis taskId 内存分页或 SQL LIMIT/OFFSET 分页
```

### 2. 为什么引入 `geom` 后不需要在 72 张表上维护重型 GiST 索引？

这里有一个很关键的工程权衡。如果一张 4,700 万行的大表没有 `grid_id`，直接跑 `ST_Intersects(geom, aoi)` 就必须建 GiST（R-Tree）索引来避免全表几何计算。

但在这套架构里，**`grid_id` 已经替数据库挡掉了 99% 的数据量**：
* 经过第 1 级（72 分区裁剪，单表平均仅约 65 万行）和第 2 级（`(grid_id, product_type, image_time)` 复合 B-Tree 索引）过滤后，通常只剩下同网格、同类型、同时间窗口内的几十到几百条记录；
* 第 3 级的 `ST_Intersects(geom, aoi)` 只需要在内存页上对这百来条记录做一次快速过滤（PostGIS 内核对四角矩形与多边形做短路相交判定耗时在 1 ms 以内）；
* 因此数据库侧只需要建一个写入极快、体积轻巧的**部分 B-Tree 复合索引**（排除软删除数据），省去了在 72 张子表上维护空间索引树的写入开销与磁盘膨胀。

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. 主表新增 PostGIS 空间列 (SRID 4326)，分区声明与联合唯一约束保持不变
CREATE TABLE archive.image_metadata (
    id              int generated by default as identity not null,
    scene_id        varchar(64) not null,
    grid_id         int not null,
    product_type    int not null,
    image_time      timestamp(6) with time zone not null,
    cloud_coverage  double precision,
    off_nadir_angle double precision,
    sun_zenith_angle double precision,
    satellite_id    int,
    geometry        json not null,
    geom            geometry(Polygon, 4326),
    deleted         smallint default 0,
    CONSTRAINT image_metadata_pkey PRIMARY KEY (id, grid_id),
    CONSTRAINT uk_image_metadata_scene_grid UNIQUE (scene_id, grid_id)
) PARTITION BY HASH (grid_id);

-- 2. 挂载 72 张物理子表 (part0 ~ part71)
CREATE TABLE IF NOT EXISTS archive.image_metadata_part0
    PARTITION OF archive.image_metadata FOR VALUES WITH (modulus 72, remainder 0);
-- ... 直至 image_metadata_part71 (modulus 72, remainder 71)

-- 3. 补齐子表前导复合 B-Tree 索引：同时覆盖网格、产品类型、时间范围与软删过滤
CREATE INDEX idx_meta_grid_type_time
ON archive.image_metadata (grid_id, product_type, image_time DESC)
WHERE deleted = 0;

-- 4. 补齐按景号反查索引（加速 WHERE scene_id IN (...)）
CREATE INDEX idx_meta_scene_id
ON archive.image_metadata (scene_id)
WHERE deleted = 0;
```

### 3. 查询层实现：AOI 预抽稀、SARGABLE 写法与免 `DISTINCT ON` 优化

在持久层（基于 [jooq-postgis](/post/jooq-postgis-intro/) 或原生 jOOQ Condition）组装 SQL 时，有三个落地细节非常关键：

1. **AOI 入参先做道格拉斯-普克抽稀**：用户上传的复杂矢量多边形可能有上万个顶点，在传入数据库执行 `ST_Intersects` 前，先在 Java 侧调用 `DouglasPeuckerReducer.reduce(aoiJts)` 压缩顶点数，防止单个超大 WKT 拖慢单次相交判定；
2. **SARGABLE 条件写法**：所有日期与角度过滤必须保持列名裸露，不用列函数包装；
3. **拿掉耗 CPU 的 `DISTINCT ON`**：以前 SQL 里用 `DISTINCT ON (image_time, scene_id)` 去重会触发 PostgreSQL 的大结果集 `Sort` 排序。现在因为数据库返回的数据集经过 `geom` 精筛后体积已经很小，直接流式返回给 Java，用 `HashSet` 做 `O(1)` 内存去重即可。当 `gridIds.size() == 1` 时，由于唯一约束 `(scene_id, grid_id)`，单个网格内本身就不存在重复景。

```java
// ImageMetadataRepository.java
public List<ImageMetadataRecord> searchInAoi(
        int productType,
        ImageCondition condition,
        List<Integer> satIds,
        List<Long> gridIds,
        LocalDate fromDate,
        LocalDate toDate,
        Geometry aoiJtsGeometry) {

    // 1. 复杂 AOI 顶点抽稀，防止万级顶点矢量拖慢数据库相交判断
    Geometry simplifiedAoi = DouglasPeuckerReducer.reduce(aoiJtsGeometry);
    String aoiWkt = simplifiedAoi.toText();

    double absOna = Math.abs(condition.getOna());
    double absSza = Math.abs(condition.getSza());

    SelectConditionStep<ImageMetadataRecord> query = dsl
            .selectFrom(IMAGE_METADATA)
            // 2. 触发 72 分区裁剪 + 命中 idx_meta_grid_type_time 复合索引前两列
            .where(IMAGE_METADATA.GRID_ID.in(gridIds))
            .and(IMAGE_METADATA.PRODUCT_TYPE.eq(productType))
            .and(IMAGE_METADATA.DELETED.eq((short) 0))
            // 3. SARGABLE 区间条件：保留原生列以利用时间索引
            .and(IMAGE_METADATA.IMAGE_TIME.ge(fromDate.atStartOfDay().atOffset(ZoneOffset.UTC)))
            .and(IMAGE_METADATA.IMAGE_TIME.lt(toDate.plusDays(1).atStartOfDay().atOffset(ZoneOffset.UTC)))
            .and(IMAGE_METADATA.CLOUD_COVERAGE.le(condition.getCc()))
            .and(IMAGE_METADATA.OFF_NADIR_ANGLE.between(-absOna, absOna))
            .and(IMAGE_METADATA.SUN_ZENITH_ANGLE.ge(absSza))
            .and(IMAGE_METADATA.SATELLITE_ID.in(satIds))
            // 4. PostGIS 行级精筛：仅对前面粗筛出的百来条记录算相交，剔除 5° 网格内的陪跑数据
            .and(DSL.condition(
                    "ST_Intersects({0}, ST_SetSRID(ST_GeomFromText({1}), 4326))",
                    IMAGE_METADATA.GEOM, aoiWkt
            ));

    return query.fetch();
}
```

### 4. 应用层：跨网格去重、级联并集算覆盖率与前端分页

数据库返回的数据已经 100% 落在用户 AOI 内。接下来在 Java 服务层完成三件事：

1. **跨网格 `O(1)` 去重**：使用并发安全的 `ConcurrentHashMap.newKeySet()` 按 `scene_id` 过滤跨网格副本；
2. **单景与总覆盖率计算**：利用 `parallelStream` 计算每景影像与 AOI 的交集面积占比；再通过 `GeometryUnionHelper.union()`（底层基于 JTS `UnaryUnionOp` 级联并集，比逐个 `Geometry::union` 的 `O(N²)` 算法快一个数量级，并内置 `buffer(0)` 与微距精度回退策略）算出多景合并后的总覆盖率 `ac`；
3. **前端分页衔接**：
   * 如果当前搜索页面需要汇总“总覆盖率 `ac`”（例如用户要求“总覆盖率必须大于等于 80% 才展示这组检索结果”），首次请求在内存算完有效列表后，按 `taskId` 写入 Redis 缓存，前端翻页、按云量/时间/倾角重新排序时直接从 Redis 切片返回，免去重复算并集；
   * 如果某类查询列表不需要校验全局总覆盖率，只需常规展示，则可在上述 jOOQ 查询末尾（针对单网格查询，或多网格外层包裹去重子查询）直接下推 `ORDER BY ... LIMIT :size OFFSET :offset` 真分页，Java 层只针对当前页返回的 20 条记录算一下单景覆盖率即可。

```java
// ArchiveSearchService.java
Set<String> seenSceneIds = ConcurrentHashMap.newKeySet();

// 1. 若只落入单个网格，免去重；跨多个网格时用 HashSet 按 scene_id 去重
Stream<ImageMetadataRecord> stream = records.size() > 100 ? records.parallelStream() : records.stream();
if (gridIds.size() > 1) {
    stream = stream.filter(r -> seenSceneIds.add(r.getSceneId()));
}

// 2. 黑白名单安全区校验 + 计算单景覆盖率
List<ArchiveImageInfo> matchedImages = stream
        .map(record -> convertAndComputeCoverage(record, aoiJtsGeometry, ruleContext))
        .filter(Objects::nonNull)
        .collect(Collectors.toList());

// 3. 使用 UnaryUnionOp 级联并集算多景合并总覆盖率
List<Geometry> sceneGeoms = matchedImages.stream()
        .map(ArchiveImageInfo::getJtsGeometry)
        .filter(Objects::nonNull)
        .collect(Collectors.toList());
Geometry unionGeom = GeometryUnionHelper.union(sceneGeoms);
double totalCoverage = computeCoveragePercent(aoiJtsGeometry, unionGeom);
```

---

## 五、 总结：三种方案的工程权衡

| 评估维度 | 第一代方案 (`grid_id` + JSON) | 纯 PostGIS 全下推方案 | 最终混合方案 (`grid_id` 粗筛 + `geom` 精筛 + Java 算面积) |
| :--- | :--- | :--- | :--- |
| **分区裁剪** | 按 `grid_id` 裁剪 72 张表 | 无网格分区（或按时间分区） | **保留 `grid_id` 72 张 Hash 分区** |
| **索引结构** | 缺 `grid_id` 前导索引，子表内 Seq Scan | 全表维护重型 GiST 索引 | **轻量部分 B-Tree 复合索引 `(grid_id, type, time)`** |
| **DB → Java 传输量** | 大（30 万 km² 整格陪跑数据全拉回） | 小（仅返回精确命中的数据） | **小（只返回 100% 落在 AOI 内的记录）** |
| **数据库 CPU 压力** | 高在子表全扫与 `DISTINCT ON` 排序 | 极高（大范围/多顶点时 GEOS 与并集计算极重） | **极低（仅对百来条候选集跑一次布尔 `ST_Intersects`）** |
| **跨网格去重** | 数据库内 `DISTINCT ON` 排序去重 | 无需去重 | **单网格免去重；多网格 Java 内存 `HashSet` `O(1)` 去重** |
| **覆盖率与业务计算** | Java 算大量无效记录后才算并集 | SQL `ST_UnaryUnion` 算并集 | **Java 仅对精筛结果算单景与级联并集覆盖率** |

这套架构没有抛弃最初 `grid_id` 用于 Hash 分表和降维过滤的设计初衷，而是顺着它补齐了**子表前导索引**与 **PostGIS 空间精筛**两块短板。数据库负责把范围缩到最小、把真正相交的记录挑出来；Java 负责去重、拓扑并集和分页组装，在数据规模持续增长时依然能保持数据库 CPU 的稳定可控。
