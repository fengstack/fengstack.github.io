---
title: "当 jOOQ 遇上 PostGIS：jooq-postgis 诞生记"
description: "工作中需要在 jOOQ 里映射 PostGIS 地理位置字段，于是写了 jooq-postgis：纯 JTS、零 GeoTools 的类型安全空间绑定。记录问题、方案与用法。"
publishDate: 2026-10-06
tags: ["数据库", "Java"]
readTime: "约 4 分钟"
refLink:
  text: "github.com/upowerman/jooq-postgis"
  url: "https://github.com/upowerman/jooq-postgis"
---

事情开始于一个很普通的工作需求:业务表里要有**地理位置字段**。数据库用的是 PostgreSQL + PostGIS,持久层用的是 jOOQ——一个写 SQL 写得很舒服的类型安全 ORM。看起来没什么问题,直到代码生成跑完,我盯着生成的表对象发呆:空间字段被映射成了 `Object`,想读写一个 `Point` 都要自己和字符串搏斗。

这篇文章记录 [**jooq-postgis**](https://github.com/upowerman/jooq-postgis) 这个小项目要解决的问题、设计取舍和用法。它现在已发布到 Maven Central(`top.yunitytech.maven:jooq-postgis`),Java 8+ / jOOQ 3.14+ / PostGIS 3.x 可用。

## 问题:类型安全在空间字段这里断了

jOOQ 的强项是 `codegen`:从数据库 schema 生成类型安全的表和字段,SQL 写错编译期就报错。但 PostGIS 的 `geometry` / `geography` 列不在此列——默认生成出来就是一个没有语义的类型,你得:

- 手动把 `EWKB` / `EWKT` 字符串解析成几何对象,写回去再序列化;
- 调用 `ST_Distance`、`ST_DWithin` 这类原生函数时,还要小心 `geometry` 和 `geography` 的类型转换;
- 常见的现成方案大多依赖 GeoTools——为了绑定一个字段,拖进一整套 `gt-main` 和 OSGeo 仓库依赖,启动慢、体积大。

我想要的其实很简单:**空间字段直接生成成 JTS 的 `org.locationtech.jts.geom.Geometry`,读写零手工解析,原生函数直接调用,依赖越轻越好。**没有就自己写一个,于是有了 jooq-postgis。

## 方案:两个 binding + 一个独立编解码器

jooq-postgis 是一套轻量、production-grade 的 jOOQ 空间绑定,直接映射到 JTS `Geometry`,专为 `jooq-codegen-maven` 自动生成类型安全空间字段设计。几个关键取舍:

### 1. 纯 JTS,零 GeoTools

不引入 `gt-main`,不需要 OSGeo 仓库,100% Maven Central,启动快、依赖干净。

### 2. `geometry` 与 `geography` 分成两个 binding

这是我觉得最重要的语义设计。二者一个是平面笛卡尔空间,一个是测地(球面)空间,混用一个 binding 很容易写错。jooq-postgis 拆成:

- `PostgisGeometryBinding` — 严格对应 `geometry` 列,通过 `PGobject(type="geometry")` 绑定,渲染 `?::geometry`;
- `PostgisGeographyBinding` — 严格对应 `geography` 列,渲染 `?::geography`。

这样语义不混淆,原生函数(`ST_Distance`、`ST_DWithin`、`ST_Intersects`)不需要手工转型就能调。

### 3. 全维度支持:2D / 3D / 3DM / 4D

标准平面 (XY)、带高程 (XYZ)、带度量 (XYM,比如 GPS 时间戳、遥感数据),以及卫星轨迹这种 `POINT ZM` 四维 (XYZM),都支持往返无损。

### 4. JDBC 层面做对细节

- 用 `PGobject` 而不是 `setString()`,消除 PostgreSQL JDBC 驱动的转型歧义;
- 解析器兼容 PostGIS EWKB Hex、EWKT(`SRID=...;...`)、标准 WKT、二进制 `byte[]`;
- 正确处理 `NULL`(`Types.OTHER`)与内联 SQL(`ParamType.INLINED`),批处理也安全。

### 5. `PostgisCodec`:脱离 jOOQ 也能用

编解码器是独立的,自定义 JDBC、REST 接口、队列消费里都能直接用:

```text
// PGobject / EWKB Hex / EWKT / byte[] → JTS Geometry
Geometry geom = PostgisCodec.from(databaseObject);

// JTS Geometry → PostGIS 表示(大端 EWKB Hex,含 SRID)
String repr = PostgisCodec.toSpatialRepresentation(geom);
```

## 快速上手

两步:给 codegen 插件加依赖并配 `forcedTypes`,然后像普通字段一样读写。

### 1. 配置 jOOQ 代码生成

```xml
<forcedTypes>
    <!-- 平面 geometry 列 -->
    <forcedType>
        <userType>org.locationtech.jts.geom.Geometry</userType>
        <binding>top.yunitytech.maven.jooq.binding.PostgisGeometryBinding</binding>
        <includeTypes>(?i:geometry)</includeTypes>
    </forcedType>
    <!-- 球面 geography 列 -->
    <forcedType>
        <userType>org.locationtech.jts.geom.Geometry</userType>
        <binding>top.yunitytech.maven.jooq.binding.PostgisGeographyBinding</binding>
        <includeTypes>(?i:geography)</includeTypes>
    </forcedType>
</forcedTypes>
```

> jOOQ 3.15+ 自带原生空间类型,生成器会把 `geometry` 列解析成 `org.jooq.Geometry`——记得给两个 `` 都加上 `true`,生成的代码才能编译通过;jOOQ 3.14 则必须省略这个元素。

### 2. 读写空间数据

```java
GeometryFactory gf = new GeometryFactory();

// 插入带 SRID 的 2D 点
Point beijing = gf.createPoint(new Coordinate(116.4074, 39.9042));
beijing.setSRID(4326);
dsl.insertInto(SPATIAL_RECORD)
   .set(SPATIAL_RECORD.GEOM, beijing)
   .execute();

// 插入 4D 点(卫星轨迹 XYZM),读回时维度完整保留
Point obs = gf.createPoint(new CoordinateXYZM(116.4, 39.9, 500000.0, 1695888000.0));
obs.setSRID(4326);
// ... 写入后再读出,coord.getZ() == 500000.0, coord.getM() == 1695888000.0
```

### 3. 原生球面距离,无需转型

`geography` 列绑定后,`ST_Distance` 直接返回米,`ST_DWithin` 直接做阈值判断:

```text
// 球面距离(米)
Double distanceMeters = dsl.select(
        DSL.field("ST_Distance({0}, {1})", Double.class, A.GEOG, B.GEOG)
    ).from(A).crossJoin(B)
    .fetchOne(0, Double.class);

// 200 km 内?
Boolean isNearby = dsl.select(
        DSL.field("ST_DWithin({0}, {1}, 200000)", Boolean.class, A.GEOG, B.GEOG)
    ).from(A).crossJoin(B)
    .fetchOne(0, Boolean.class);
```

## 踩过的坑:边界语义

做一个「老实」的编解码器,最难的是把边界情况和 PostgreSQL / PostGIS 的语义对齐。几个印象深的:

- **NaN 是合法坐标值,不是维度信号**。`LINESTRING Z(0 0 NaN, 1 1 5)` 在 PostGIS 里 `ST_NDims = 3`,要无损往返;同一几何内,任一坐标带非 NaN 的 Z/M 即视为该维度存在。
- **集合内维度必须严格一致**。`GEOMETRYCOLLECTION` 混入不同维度的子对象,和 PostGIS 一样直接拒绝,而不是默默丢维度。
- **空几何**序列化为 2D EWKB(JTS 无法表达「POINT Z EMPTY」),写入 Z/M/ZM-typmod 列会被服务端拒绝;已知列类型时可以显式声明维度生成 `POINT Z EMPTY`。
- **曲线/曲面类型不支持**(`CIRCULARSTRING` 等)——JTS 没有对应类型,与其默默丢精度,不如在 codegen 里用 `` 排除这类表。
- 还有一个 jOOQ 侧的坑:jOOQ 3.14–3.19 代码生成要求 **pgjdbc ≤ 42.7.4**,42.7.5+ 的大写元数据标签会破坏所有表的生成(jOOQ [#17873](https://github.com/jOOQ/jOOQ/issues/17873),3.20 才修)。

## 写在最后

这个项目的集成测试跑在真实的 PostgreSQL + PostGIS 上(CI 是 JDK 17/21 × jOOQ 3.14/3.19 的矩阵),每个边界语义都有测试兜底。如果你的项目也是 jOOQ + PostGIS 的组合,希望它能帮你省掉当初我摸的那些黑:

[github.com/upowerman/jooq-postgis](https://github.com/upowerman/jooq-postgis) · Maven Central:`top.yunitytech.maven:jooq-postgis`
