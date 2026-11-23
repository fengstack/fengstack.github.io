# AGENTS.md · 个人技术品牌主页与博客系统开发与协作指南

> 本指南面向所有在此仓库中工作的 AI Agent 与人类开发者，旨在规范代码编写、博文创作、架构演进、自动化校验与持续部署流程。

---

## 1. 项目简介与定位

* **项目名称**：fengstack 的个人品牌主页与技术博客 (`fengstack-blog`)
* **线上地址**：[https://blog.yunitytech.top/](https://blog.yunitytech.top/)
* **仓库地址**：[https://github.com/fengstack/fengstack.github.io](https://github.com/fengstack/fengstack.github.io)
* **默认部署分支**：`master`
* **设计哲学**：**Editorial Technology Publication × Minimal Developer Portfolio**（现代技术出版物与极简工程师个人品牌相结合），主张温润纸白（Light）与深邃炭墨（Dark）自适应双主题、零 JS 包袱（SSG 极速静态）、强排版感（切片衬线字体）与极致的 SEO 基础设施。

---

## 2. 核心技术栈与工具链

| 领域 | 选型 / 方案 | 说明 |
| :--- | :--- | :--- |
| **框架引擎** | Astro 5.x (`astro`) | 静态站点生成 (SSG)，首屏秒开，按需水合 |
| **开发语言** | TypeScript 5.7+ | 严格类型模式，配合 `@astrojs/check` |
| **内容管理** | Astro Content Collections | 基于 Zod Schema 强类型约束博文元数据 |
| **样式系统** | Tailwind CSS 3.4+ | 结合 CSS Variables 实现双主题 Design Tokens |
| **排版与高亮** | Noto Serif SC + IBM Plex Mono + Shiki | 自托管切片中文字体与等宽字体；双主题代码高亮 (`github-light` / `github-dark`) |
| **站内搜索** | 编译时静态索引 (`/api/search.json`) | 纯前端极轻量快捷搜索弹窗（`⌘K` / `Ctrl+K`） |
| **SEO 与收录** | JSON-LD + Sitemap + RSS + IndexNow | 结构化知识图谱、全网主动推送 (`scripts/seo-ping.js`) |
| **部署托管** | GitHub Pages | 绑定自定义域名 `blog.yunitytech.top`，启用 HTTPS 与强制尾部斜杠 |
| **环境管理** | `mise` / Node.js 22+ | 推荐使用 `mise` 保持开发环境与 CI 构建版本一致 |

---

## 3. 目录结构与模块说明

```text
fengstack.github.io/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions: 自动校验、构建、发布 Pages 与 SEO 主动推送
├── public/                     # 部署时直推到网站根目录的静态资产（严禁随意修改或删除凭据）
│   ├── CNAME                   # 域名绑定 (blog.yunitytech.top)
│   ├── robots.txt              # 搜索引擎爬虫放行规则
│   ├── BingSiteAuth.xml        # 微软 Bing 站长验证凭据
│   ├── 75d73fb2*.txt           # 微信域名所有权校验
│   ├── 9f8e4b7a*.txt           # IndexNow 密钥验证文件
│   ├── fonts/                  # 自托管 Noto Serif SC 与 IBM Plex Mono 字体切片 (woff2)
│   └── images/                 # 头像、技术架构图、项目与社区 Logo
├── src/
│   ├── components/             # Astro 复用组件（BaseHead, Header, Footer, TableOfContents 等）
│   ├── content/                # 博客内容集合
│   │   ├── config.ts           # 博文 Schema 强校验定义 (Zod)
│   │   └── posts/              # Markdown / MDX 技术博文源文件
│   ├── data/                   # 站点配置与专题元数据
│   │   ├── site.ts             # 站点全局配置、开源项目与社区贡献常量
│   │   └── topics.ts           # 技术专题分类与文章映射定义
│   ├── layouts/                # 页面骨架布局 (BaseLayout, PostLayout)
│   ├── pages/                  # 文件路由与动态端点
│   │   ├── index.astro         # 首页（个人介绍、开源项目、贡献实战、精选文章）
│   │   ├── about.astro         # 关于我
│   │   ├── 404.astro           # 404 页面
│   │   ├── post/               # 博客路由 ([...slug].astro 动态详情页, index.astro 聚合页, index.xml.ts 兼容 RSS)
│   │   ├── topic/              # 专题路由 (index.astro 专题聚合页, [slug].astro 专题详情页)
│   │   ├── api/search.json.ts  # 编译时搜索数据索引生成器
│   │   ├── sitemap.xml.ts      # 动态全站 Sitemap
│   │   └── rss.xml.ts          # 官方 RSS 2.0 订阅源
│   ├── styles/
│   │   ├── fonts.css           # 字体声明
│   │   └── global.css          # 全局色彩令牌、排版重置与技术出版物样式
│   └── utils/
│       └── posts.ts            # 已发布文章过滤、确定性排序与专题匹配工具
├── scripts/
│   ├── verify-seo.mjs          # 构建产物自动化 SEO 质量验收测试脚本 (CI 必跑)
│   ├── seo-ping.js             # 微软 IndexNow / 百度 API 主动广播脚本
│   ├── generate-icons.js       # 多尺寸 Favicon 与 Touch Icon 生成脚本
│   └── setup-terminal.sh       # 开发者终端初始化脚本
├── astro.config.mjs            # Astro 站点主配置（包含 trailingSlash: 'always' 等规则）
├── tailwind.config.mjs         # Tailwind 扩展与 Design Tokens 映射
└── tsconfig.json               # TypeScript 严格配置
```

---

## 4. 开发与构建指令

Agent 在进行任何代码或博文更改后，应使用以下指令进行本地开发与三级质量验收：

```bash
# 1. 依赖安装
npm install

# 2. 本地开发预览（默认端口 4321）
npm run dev

# 3. 第一级质量校验：TypeScript 与 Astro 模板元数据类型检查
npm run check

# 4. 生产构建（产物输出至 dist/ 目录）
npm run build

# 5. 第二级质量校验：自动化 SEO 验收（必须在 build 之后执行）
npm run seo:check

# 6. 本地预览生产构建产物
npm run preview
```

---

## 5. 博文编写与内容规范 (Blogging Workflow)

### 5.1 文章存放与文件命名
* **存放路径**：`src/content/posts/<slug>.md`（或 `.mdx`）。
* **命名规范**：使用小写字母、数字及英文连字符 `-`（如 `small-rpc-v3-governance.md`），禁止包含中文或特殊字符作为文件名。

### 5.2 Frontmatter 必填与可选字段 (`src/content/config.ts`)
所有文章必须包含合法的 YAML Frontmatter，严格符合 Zod 校验规则：

```markdown
---
title: "文章主标题：清晰传达核心价值与技术实体"
description: "文章的深度摘要（供搜索列表与 Google/Bing SEO 展示，建议 80~150 字，严谨客观）"
publishDate: 2026-11-17
updatedDate: 2026-11-18      # 可选：最后更新日期
draft: false                 # 可选：是否为草稿，true 会在生产构建时排除
tags: ["Java", "分布式系统", "Netty"] # 标签数组，至少 1 个，建议 2~5 个
readTime: "约 12 分钟"        # 可选：预估阅读时间
series:                      # 可选：系列文章专题
  name: "RPC 核心架构设计与实战"
  order: 1
refLink:                     # 可选：文首项目参考外链
  text: "参考工程：fengstack/small-rpc"
  url: "https://github.com/fengstack/small-rpc"
---
```

### 5.3 正文排版与写作规范
1. **中英文排版**：中英文、中文与数字之间自然留出空格；专有名词严格区分大小写（如 `Astro`、`TypeScript`、`Tailwind CSS`、`Netty`、`GitHub`、`jOOQ`、`PostGIS`）。
2. **架构可视化**：优先使用清晰工整的 ASCII 字符画 / 文本框图展示复杂架构、状态机或调用链路（兼容各端且渲染开销最低），或使用标准 Mermaid 图。编写 Mermaid 图时需注意：
   * 节点文字包含括号、空格或特殊符号时，必须显式用引号包裹（如 `id["节点文本 (说明)"]`）；
   * 流程图连线边标签必须使用双引号包裹（如 `-->|"1. 描述说明 (附加信息)"|`），避免直接裸写括号或斜杠导致词法解析异常；
   * 泛型与尖括号避免裸写引起 HTML 标签解析冲突，推荐使用实体字符（如 `&lt;Type&gt;`）。
3. **代码块规范**：必须显式标注代码语言（如 ````java`、````typescript`、````bash`、````xml`），方便 Shiki 进行语法高亮。
4. **内部链接**：引用站内文章时，必须遵循 `trailingSlash: 'always'` 规范，使用绝对路径且结尾必须带 `/`（例如 `/post/small-rpc-intro/`），否则会被 `verify-seo.mjs` 判定为死链或产生重定向。
5. **图片引用**：静态图片统一存放于 `public/images/`，Markdown 中通过 `/images/<file>` 绝对根路径引用，且必须提供有意义的 `alt` 文本。

---

## 6. 组件、样式与前端修改规范

1. **主题自适应 (Design Tokens)**：
   * 站点通过 `data-theme="dark"` / `data-theme="light"` 控制明暗主题。
   * 新增或修改样式时，严禁硬编码纯黑 `#000` 或纯白 `#fff`，优先使用全局 CSS 变量：
     * 背景：`var(--color-bg)` / `bg-bg`
     * 文本前景色：`var(--color-fg)` / `text-fg`
     * 次要文本：`var(--color-muted)` / `text-muted`
     * 品牌强调色：`var(--color-accent)` / `text-accent`
     * 边框线条：`var(--color-line)` / `border-line`
     * 卡片表面：`var(--color-surface)` / `bg-surface`
2. **字体与排版**：
   * 标题与出版物强调内容采用衬线字体（`font-serif`：Noto Serif SC）。
   * 代码与数字优先采用等宽字体（`font-mono`：自托管的 IBM Plex Mono）。
3. **保持零客户端 JavaScript 原则**：
   * 保持 Astro 的 Islands 架构纯净，页面级组件尽量保持纯静态 HTML 渲染；仅搜索弹窗 (`SearchModal.astro`) 与目录滚动监听 (`TableOfContents.astro`) 包含必要的微型客户端脚本。

---

## 7. SEO、知识图谱与静态资产保护规则

1. **绝对受保护文件**（严禁无授权改动、重置或删除）：
   * `public/CNAME`：固定为 `blog.yunitytech.top`
   * `public/robots.txt`：搜索引擎爬虫规则
   * `public/BingSiteAuth.xml`：微软站长凭证
   * `public/75d73fb293db81641d655c4aaed5262b.txt`：微信业务域名校验凭证
   * `public/9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b.txt`：IndexNow 密钥凭证
2. **SEO 自动化校验底线**：
   * 每篇文章必须具有独一无二且非空的 `<title>` 和 `<meta name="description">`。
   * 必须注入有效的 Schema.org JSON-LD（`BlogPosting`、`BreadcrumbList`、`Person`、`WebSite`）。
   * 全站站内链接不允许出现任何 404 死链。

---

## 8. Agent 提交与交付底线 (Verification Pipeline)

当 Agent 完成任何代码、配置或博文的修改并准备交付或提交时，**必须按顺序执行以下闭环校验**：

```mermaid
flowchart LR
    A[修改代码/文章] --> B["npm run check\n(类型与模板检查)"]
    B --> C["npm run build\n(静态站点构建)"]
    C --> D["npm run seo:check\n(SEO质量验收)"]
    D --> E[提交 Git 记录]
```

1. **严禁带伤交付**：若 `npm run check` 或 `npm run seo:check` 出现报错（`[FAIL]`），Agent 必须就地修复，直至所有检查全部 `[PASS]`。
2. **Git 提交规范**：
   * 遵循 Conventional Commits 语义化前缀：
     * `feat(post): add article about ...`
     * `fix(seo): correct canonical url in ...`
     * `style(css): adjust font sizing on mobile`
     * `refactor(component): optimize TableOfContents`
   * 生产发布统一基于 `master` 分支，严禁执行 `git push --force`。
   * 严禁将本地临时生成文件（如 `.astro/`、`dist/`、`node_modules/`、`.DS_Store`）提交进版本控制。
