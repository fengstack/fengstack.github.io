# 高云峰的个人主页与技术博客 (fengstack.github.io)

<p align="center">
  <a href="https://blog.yunitytech.top/"><strong>🌐 在线访问：blog.yunitytech.top</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Online-success?style=flat-square" alt="Status">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/RSS-Feed-orange?style=flat-square&logo=rss" alt="RSS">
  <img src="https://img.shields.io/badge/Author-高云峰%20(fengstack)-1081c2?style=flat-square" alt="Author">
</p>

---

## 📖 项目简介

本项目是 **高云峰（fengstack / upowerman）** 的个人主页与技术博客站点源码仓库。

主站基于 **原生现代 Web 技术（Vanilla HTML5 / CSS3 / ES6）** 构建，托管于 GitHub Pages，绑定独立域名 [blog.yunitytech.top](https://blog.yunitytech.top/)。内容主要围绕 **Java 后端核心技术、分布式 RPC 框架治理、现代 AI Agent 规范驱动编程实践（SDD 与 TDD）、空间数据库与开源实战贡献**。

---

## 🚀 站点架构与技术特色

- **⚡️ 零框架包袱，极致加载**：
  - 摒弃复杂重型前端框架与构建工具链，采用原生静态语义化 HTML5 与轻量 CSS，首屏毫秒级直出。
- **🌓 优雅双主题切换**：
  - 支持随系统偏好（`prefers-color-scheme`）自适应深色/浅色模式，并支持一键手动切换与 `localStorage` 本地状态记忆。
- **🔍 现代全网 SEO 基础设施**：
  - **结构化知识图谱**：深度集成 [Schema.org](https://schema.org)（JSON-LD）标准，配置了 `Person`、`WebSite`、`BlogPosting` 与 `BreadcrumbList` 实体关系。
  - **跨平台元标签**：完整支持 Open Graph 与 Twitter Card 社交分享卡片。
  - **动态地图与推送**：自动生成 `sitemap.xml`，配合 [IndexNow 协议](https://www.indexnow.org/) 支持将全站更新实时广播推送至微软 Bing、Yandex、Naver 等搜索引擎。
- **🤖 持续集成与主动收录 (CI/CD)**：
  - 通过 GitHub Actions 工作流（[`.github/workflows/seo-push.yml`](.github/workflows/seo-push.yml)），每次 push 自动执行 [`scripts/seo-ping.js`](scripts/seo-ping.js) 实现全自动 SEO Ping。

---

## 📚 核心内容与导航

### 🛠 代表性开源项目

| 项目 | 说明 | 仓库地址 |
| :--- | :--- | :--- |
| **`small-rpc`** | 基于 Netty 与 Hessian 的轻量级 RPC 治理框架，微内核架构、支持服务治理闭环（熔断、限流、降级、背压）与 Maven Central 发布。 | [GitHub](https://github.com/upowerman/small-rpc) |
| **`jooq-postgis`** | jOOQ 与 PostGIS 的集成库，纯 JTS、零 GeoTools 依赖，实现类型安全的空间数据库 SQL 查询映射。 | [GitHub](https://github.com/upowerman/jooq-postgis) |
| **`simple-seata`** | 轻量级教学分布式事务框架，提炼 Seata 精髓，补全内嵌 TC 协调器、全局行锁、防脏写核验与双物理库可观察 AT 模式闭环。 | [GitHub](https://github.com/fengstack/simple-seata) |

### 🌟 开源社区贡献

- **[openobserve/openobserve](https://github.com/openobserve/openobserve)**：云原生可观测性平台
  - [PR #15142](https://github.com/openobserve/openobserve/pull/15142) · `fix(promql): quantile interpolation keeps infinite bounds like Prometheus`（已合并）
  - [PR #15143](https://github.com/openobserve/openobserve/pull/15143) · `fix(search): clamp _around page size so small or invalid sizes stop expanding to the default limit`（已合并）
- **[gotoeasy/glogcenter](https://github.com/gotoeasy/glogcenter)**：轻量日志中心
  - [PR #92](https://github.com/gotoeasy/glogcenter/pull/92) · 集群模式节点通信与转发失效修复（已合并）
  - [PR #93](https://github.com/gotoeasy/glogcenter/pull/93) · 修复潜在的 Goroutine 资源泄漏问题（已合并）

### 📝 精选技术博文

1. [从半成品到完整闭环：重拾波波老师的 simple-seata，我手写了 TC、防脏写与可观察 AT 模式](post/simple-seata-at-mode/)
2. [AI Agent 编程时代的编程语言重估：谁在偷走你的 Token？谁是真正的架构之王？](post/agent-programming-language-benchmark/)
2. [从 Vibe Coding 到双轨 SDD：大模型时代的现代 Agent 编程工程化实践](post/agent-programming-sdd-tdd/)
3. [small-rpc 3.0：手写熔断、限流、降级，给 RPC 消费端补上治理闭环](post/small-rpc-v3-governance/)
4. [从零到一：基于 small-rpc 实战将 Java 开源库发布到 Maven 中央仓库](post/maven-central-publish-guide/)
5. [当 jOOQ 遇上 PostGIS: jooq-postgis 诞生记](post/jooq-postgis-intro/)

---

## 📂 仓库目录结构

```text
fengstack.github.io/
├── .github/
│   └── workflows/
│       └── seo-push.yml        # GitHub Actions：推送更新至搜索引擎 IndexNow
├── about/
│   └── index.html              # “关于我” 个人介绍页面与 Profile 知识图谱
├── css/
│   ├── main.css                # 博客全局核心样式与主题变量
│   └── ...                     # 代码语法高亮与组件样式
├── docs/
│   └── seo-guide.md            # 搜索引擎收录与站长平台配置实战指南
├── images/                     # 站点静态资源与头像图片
├── js/
│   ├── nav.js                  # 响应式移动端导航脚本
│   ├── posts.js                # 动态博文列表加载与渲染逻辑
│   └── theme-mode.js           # 深浅色主题检测与切换
├── post/                       # 博客文章目录
│   ├── agent-programming-sdd-tdd/
│   ├── small-rpc-v3-governance/
│   ├── index.html              # 文章聚合列表页
│   └── index.xml               # 全站 RSS 2.0 Feed 订阅源
├── scripts/
│   └── seo-ping.js             # Node.js 搜索引擎主动推送脚本
├── CNAME                       # 独立域名配置文件 (blog.yunitytech.top)
├── index.html                  # 站点主页 (Hero, 技术栈, 项目, 贡献, 精选博文)
├── robots.txt                  # 搜索引擎爬虫抓取规则
├── sitemap.xml                 # 全站站点地图
└── README.md                   # 本说明文档
```

---

## 💻 本地预览与调试

因为本项目为标准纯静态站点，本地无需安装重型编译环境，任意静态 HTTP 服务器均可快速启动预览：

### 方法 1：使用 Python（推荐，系统自带）

```bash
# Python 3
python3 -m http.server 8080
```
然后在浏览器中打开：`http://localhost:8080`

### 方法 2：使用 Node.js / npx

```bash
npx serve . -p 8080
```

### 方法 3：VS Code / IDE 插件

直接通过 VS Code 的 **Live Server** 插件或 IntelliJ IDEA 的内置浏览器预览功能右键打开 `index.html`。

---

## ✍️ 日常更新与发文流程

1. **新建文章**：
   - 在 `post/` 目录下创建新文章目录（如 `post/your-post-title/index.html`）。
   - 复用既有文章模板，保持规范的 `<head>` 元标签（Title、Canonical、Schema JSON-LD）。
2. **更新索引与聚合**：
   - 在 `index.html` 与 `post/index.html` 的文章列表中增加条目。
   - 在 `sitemap.xml` 中加入新 URL 并更新 `<lastmod>`。
   - 在 `index.xml` (RSS) 中添加新的 `<item>` 条目。
3. **提交与推送**：
   - 提交代码推送至 `master` 分支，GitHub Pages 自动完成发布。
   - GitHub Actions 触发 `seo-push.yml`，通过 IndexNow 自动将新 URL 实时广播至全网搜索引擎。

---

## 📬 联系方式

- **个人主页**：[blog.yunitytech.top](https://blog.yunitytech.top/)
- **GitHub**：[@fengstack](https://github.com/fengstack) / [@upowerman](https://github.com/upowerman)
- **电子邮箱**：[gyf718@hotmail.com](mailto:gyf718@hotmail.com)
- **RSS 订阅**：[https://blog.yunitytech.top/post/index.xml](https://blog.yunitytech.top/post/index.xml)

---

## 📄 开源许可证

本项目内容与源码遵循 [MIT License](https://opensource.org/licenses/MIT) 开源协议。
