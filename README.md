# 高云峰的个人主页与技术博客 (fengstack.github.io)

<p align="center">
  <a href="https://blog.yunitytech.top/"><strong>🌐 线上访问：https://blog.yunitytech.top/</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Framework-Astro_5-BC52EE?style=flat-square&logo=astro" alt="Astro">
  <img src="https://img.shields.io/badge/Language-TypeScript-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Styling-Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/Syntax-Shiki-000000?style=flat-square" alt="Shiki">
  <img src="https://img.shields.io/badge/Deployment-GitHub_Pages-222222?style=flat-square&logo=github-pages" alt="GitHub Pages">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License">
</p>

---

## 📖 项目简介

本项目是 **高云峰（fengstack / upowerman）** 的个人技术品牌主页与技术博客仓库。

网站采用 **Editorial Technology Publication × Minimal Developer Portfolio**（现代技术出版物与极简工程师个人品牌相结合）的设计哲学。主站基于 **Astro 5 + TypeScript + Tailwind CSS** 构建，采用 Astro Content Collections 统一强类型管理博文，部署于 GitHub Pages，绑定独立域名 [blog.yunitytech.top](https://blog.yunitytech.top/)。

内容深度聚焦于：
1. **Java 后端核心与高性能通信**：Netty 二进制私有网络协议、微内核 SPI 架构。
2. **分布式系统与中间件治理**：RPC 消费端熔断限流降级闭环（`small-rpc`）、分布式事务 AT 模式手写与脏写防线（`simple-seata`）。
3. **空间数据库与开源工具链**：jOOQ + PostGIS 类型安全空间计算绑定（`jooq-postgis`）、Maven Central 工业级发布实战。
4. **现代 AI Agent 编程工程化实践**：从 Vibe Coding 到双轨 SDD（规范驱动开发）与 TDD（客观机器评判）交付体系，Token 经济学与编程语言选型重估。
5. **开源社区贡献实战**：持续向 `apache/dolphinscheduler`、`openobserve/openobserve`、`gotoeasy/glogcenter` 等主流开源项目贡献高质量代码与边界问题修复。

---

## 🚀 架构与技术栈

### 核心技术体系
- **框架引擎**：[Astro 5.x](https://astro.build/)，极速静态站点生成（SSG），零客户端 JavaScript 包袱，首屏秒开。
- **类型安全**：TypeScript 严格模式，基于 Zod 的 Content Collections Schema 强类型约束。
- **样式系统**：Tailwind CSS + CSS Design Tokens，沉淀一套温润纸白（Light）与深邃炭墨（Dark）的双主题技术出版物视觉体系。
- **排版与代码**：自托管切片 Noto Serif SC 衬线排版，Shiki 语法高亮（双主题自适应），集成一键复制代码块与浮动目录（TOC Scrollspy）。
- **站内搜索**：基于编译时索引（`/api/search.json`）的轻量客户端模态搜索（快捷键 `⌘K` / `Ctrl+K`），支持键盘极速导航与无结果兜底。
- **SEO & 知识图谱**：
  - [Schema.org](https://schema.org)（JSON-LD）标准：`Person`、`WebSite`、`BlogPosting` 实体关系建模。
  - Open Graph 与 Twitter Card 跨平台社交分享卡片。
  - 自动生成符合规范的 `sitemap.xml` 与全站 RSS 2.0 订阅源（`/post/index.xml` 和 `/rss.xml`）。
  - 集成微软 Bing [IndexNow 协议](https://www.indexnow.org/)，构建完成自动将全站 URL 广播至搜索引擎。
- **自动化 CI/CD**：GitHub Actions（`.github/workflows/deploy.yml`），每次 push 自动执行类型校验、生产编译、发布至 GitHub Pages，并自动触发 IndexNow SEO Ping。

---

## 📂 项目结构规范

```text
fengstack.github.io/
├── .github/
│   └── workflows/
│       ├── deploy.yml          # GitHub Actions: 自动构建、检查、发布 GitHub Pages 与 SEO Ping
│       └── seo-push.yml        # IndexNow 手动/备份推送流水线
├── public/                     # 部署时复制到根目录的纯静态资源
│   ├── CNAME                   # 自定义域名配置 (blog.yunitytech.top)
│   ├── robots.txt              # 搜索引擎爬虫抓取规则
│   ├── BingSiteAuth.xml        # 微软 Bing 站长验证
│   ├── 75d73fb2...txt          # 微信域名所有权校验
│   ├── 9f8e4b7a...txt          # IndexNow 密钥验证文件
│   ├── fonts/                  # 自托管 Noto Serif SC 字体切片 (woff2)
│   └── images/                 # 头像、Bear 图标、项目与社区 Logo
├── src/
│   ├── components/             # Astro 复用组件
│   │   ├── BaseHead.astro      # 全局 Head、SEO、OG、Schema.org、主题防闪烁
│   │   ├── Header.astro        # 顶栏导航、主题切换、移动端抽屉
│   │   ├── Footer.astro        # 页脚
│   │   ├── TableOfContents.astro # 浮动文章目录与阅读滚动高亮
│   │   ├── SeriesBox.astro     # 系列专题文章导航卡片
│   │   └── SearchModal.astro   # ⌘K 站内实时搜索弹窗
│   ├── content/
│   │   ├── config.ts           # 文章 Schema 强校验定义 (Zod)
│   │   └── posts/              # 9 篇真实技术博客 (标准 Markdown)
│   │       ├── simple-seata-at-mode.md
│   │       ├── agent-programming-language-benchmark.md
│   │       ├── agent-programming-sdd-tdd.md
│   │       ├── small-rpc-v3-governance.md
│   │       ├── maven-central-publish-guide.md
│   │       ├── openobserve-three-prs.md
│   │       ├── glogcenter-two-prs.md
│   │       ├── jooq-postgis-intro.md
│   │       └── small-rpc-intro.md
│   ├── layouts/
│   │   ├── BaseLayout.astro    # 全站通用布局骨架
│   │   └── PostLayout.astro    # 技术博文专属排版布局（TOC、代码复制、上下篇）
│   ├── pages/                  # 页面路由
│   │   ├── index.astro         # 首页（Hero、技术关注点、开源项目、贡献、精选博文）
│   │   ├── about.astro         # “关于我”
│   │   ├── 404.astro           # 404 错误页
│   │   ├── post/
│   │   │   ├── index.astro     # 文章聚合列表（时间线、分类与标签实时筛选）
│   │   │   ├── [...slug].astro # 博文详情动态路由
│   │   │   └── index.xml.ts    # 原有 RSS 路由兼容 (/post/index.xml)
│   │   ├── api/
│   │   │   └── search.json.ts  # 搜索索引动态生成端点
│   │   ├── sitemap.xml.ts      # 站点地图生成器
│   │   └── rss.xml.ts          # 官方 RSS 2.0 端点
│   └── styles/
│       ├── fonts.css           # 本地字体定义
│       └── global.css          # Editorial 技术出版物全局设计令牌与样式
├── scripts/
│   ├── migrate_posts.py        # HTML 转高保真 Markdown 提取脚本
│   └── seo-ping.js             # IndexNow 搜索引擎主动广播脚本
├── astro.config.mjs            # Astro 配置文件
├── tailwind.config.mjs         # Tailwind 设计系统扩展配置
├── tsconfig.json               # TypeScript 严格模式配置
├── package.json                # 项目依赖与运行脚本
└── legacy-archive/             # 历史纯 HTML/JS/CSS 完整备份归档
```

---

## 🛠 本地开发与构建

### 1. 安装依赖

```bash
npm install
```

### 2. 启动本地开发服务

```bash
npm run dev
```
启动后在浏览器中访问：`http://localhost:4321/`。

### 3. 类型与模板检查

```bash
npm run check
```

### 4. 生产构建与预览

```bash
npm run build
npm run preview
```
构建产物输出至 `dist/` 目录，完全由纯静态 HTML、CSS、JS 与 XML 组成。

---

## ✍️ 日常发文与内容维护

### 1. 新建文章

在 `src/content/posts/` 目录下创建新 Markdown 文件（如 `my-new-post.md`），头部遵循标准 YAML Frontmatter：

```markdown
---
title: "文章标题"
description: "文章的简明摘要（供 SEO 与搜索展示）"
publishDate: 2026-10-24
tags: ["Java", "分布式系统", "开源实战"]
readTime: "约 10 分钟"
series:
  name: "系列专题名称" # 可选，属于某一专题时自动渲染系列卡片
  order: 1
refLink:
  text: "参考工程：my-repo" # 可选，文首外链
  url: "https://github.com/fengstack/my-repo"
---

这里开始正文内容。支持标准 Markdown、GFM 表格、标准代码块（带语言标识自动语法高亮）、引用提示块等。
```

### 2. 自动构建与发布

将代码提交并推送至 `master` 分支：

```bash
git add .
git commit -m "feat(post): add my new post"
git push origin master
```

GitHub Actions 会全自动执行：
1. **代码检查**：TypeScript 类型、Content Collections 元数据校验；
2. **生产构建**：静态生成 HTML、`sitemap.xml`、RSS Feed、搜索索引；
3. **安全部署**：通过官方 `actions/deploy-pages` 部署至 GitHub Pages，并自动应用自定义域名 `blog.yunitytech.top`；
4. **主动收录**：调用 `scripts/seo-ping.js` 将新发布的 URL 自动广播至微软 Bing / IndexNow 搜索引擎。

---

## 📬 联系方式

- **个人主页**：[blog.yunitytech.top](https://blog.yunitytech.top/)
- **GitHub**：[@fengstack](https://github.com/fengstack) / [@upowerman](https://github.com/upowerman)
- **电子邮箱**：[gyf718@hotmail.com](mailto:gyf718@hotmail.com)
- **RSS 订阅**：[https://blog.yunitytech.top/post/index.xml](https://blog.yunitytech.top/post/index.xml)

---

## 📄 开源许可证

本项目源码及博文内容遵循 [MIT License](https://opensource.org/licenses/MIT) 开源协议。
