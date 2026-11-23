# fengstack 的个人主页与博客 · 全网搜索引擎收录实战指南

本指南说明当前 **Astro 5 静态站点生成（SSG）** 架构下的站内 SEO 自动化工作机制，并指导如何在 **Google、百度、微软 Bing** 等搜索引擎中完成站长验证、索引提交与外链实体建设。

---

## 目录
1. [站内技术优化与 Astro 5 SSG 自动化机制](#一站内技术优化与-astro-5-ssg-自动化机制)
2. [Google Search Console 提交与收录](#二google-search-console-提交与收录)
3. [微软 Bing 站长平台与 IndexNow 实时推送](#三微软-bing-站长平台与-indexnow-实时推送)
4. [百度搜索资源平台与 API 主动推送](#四百度搜索资源平台与-api-主动推送)
5. [搜索“fengstack”登顶首页的关键：外链与实体绑定](#五搜索fengstack登顶首页的关键外链与实体绑定)
6. [日常发文与自动构建推送流程](#六日常发文与自动构建推送流程)

---

## 一、站内技术优化与 Astro 5 SSG 自动化机制

本项目由 Astro 5 在构建阶段全自动生成所有 SEO 元数据、站点地图与结构化知识图谱，无需手工编辑生成后的 HTML 或 `sitemap.xml`：

- **全局 Head 与元数据枢纽 (`src/components/BaseHead.astro`)**：
  - 自动生成唯一 `<title>`、`<meta name="description">`、Open Graph、Twitter Cards（使用标准 `name="twitter:*"`）与单主入口 RSS 声明（`<link rel="alternate" href="/rss.xml" />`）。
  - 自动基于 `URL.pathname` 规范化输出带尾部斜杠的 `<link rel="canonical">`（与 `astro.config.mjs` 的 `trailingSlash: 'always'` 保持一致）。
  - 当页面设置 `noindex={true}`（如 `src/pages/404.astro`）时，自动输出 `noindex, follow` 且不输出 `<link rel="canonical">` 与全站知识图谱 JSON-LD。
- **爬虫放行规则 (`public/robots.txt`)**：完整放行 Googlebot、Bingbot、Baiduspider、360Spider、Sogou、Bytespider 等主流搜索引擎爬虫，并显式声明 `Sitemap: https://blog.yunitytech.top/sitemap.xml`。
- **全站站点地图自动生成 (`src/pages/sitemap.xml.ts`)**：
  - 构建时通过 `getPublishedPosts()` 自动排除 `draft: true` 草稿，按 `(updatedDate || publishDate)` 降序汇总首页、归档页、关于页、所有专题页（`/topic/` 与 `src/data/topics.ts` 定义的 `/topic/<slug>/`）及全部已发布博文（`/post/<slug>/`），确保 URL 均带尾部斜杠与准确 `lastmod`。
- **结构化知识图谱 (Schema.org / JSON-LD)**：
  - 首页、列表页等常规页面：`BaseHead.astro` 自动注入 `Person` 与 `WebSite` 实体声明，并在传入 `breadcrumbs` 时注入 `BreadcrumbList`。
  - 博文详情页（`src/layouts/PostLayout.astro` + `BaseHead.astro`）：自动注入 `BlogPosting`（含 `headline`、`description`、`datePublished`、`dateModified`、`author`、`publisher`、`keywords`）与 `BreadcrumbList`。
  - 技术专题详情页（`src/pages/topic/[slug].astro`）：自动注入 `CollectionPage`（含 `ItemList` 有序文章清单）与 `BreadcrumbList`。
- **自动化 SEO 质量门禁 (`scripts/verify-seo.mjs`)**：
  - 通过 `npm run seo:check` 对 `dist/` 进行全量验收：校验 `robots.txt`、`sitemap.xml` 合法性与静态文件一致性、`404.html` 仅含 `noindex` 且不含 `canonical`/JSON-LD、全站零重复 `<title>` 与空 `description`、文章详情页必含 `BlogPosting`、以及所有非静态资源站内链接严格带尾部斜杠且零 404 死链。
- **IndexNow 与 CI 自动推送 (`.github/workflows/deploy.yml` + `scripts/seo-ping.js`)**：
  - 已在 `public/` 预置 IndexNow 密钥验证文件 `9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b.txt`。
  - CI 在构建验收完成后上传 `dist/sitemap.xml` 工件（`sitemap-xml`），待 GitHub Pages 部署完成后由 `seo-ping` 任务下载该 `sitemap.xml` 到 `dist/` 并执行 `node scripts/seo-ping.js` 自动广播全部上线 URL。
- **站长验证配置**：
  - `BaseHead.astro` 中已预置 Bing Meta 验证标签（`msvalidate.01`），`public/` 下已配置 `BingSiteAuth.xml`。若需新增其他平台 HTML Meta 验证标签，统一在 `src/components/BaseHead.astro` 中添加，或将平台验证文件放入 `public/` 目录。

---

## 二、Google Search Console 提交与收录

Google 是程序员群体最核心的搜索引擎，收录速度快、重视语义与移动端适配。

1. 访问并登录 [Google Search Console](https://search.google.com/search-console)。
2. 点击左上角 **「添加资源」**，选择 **网址前缀**，输入：
   ```text
   https://blog.yunitytech.top/
   ```
3. 选择验证方式：
   - **方式 A（推荐，HTML 标记）**：复制其中的 `content` 字符串，添加到 `src/components/BaseHead.astro` 的 `<head>` 模板区域：
     ```html
     <meta name="google-site-verification" content="你的Google验证Token" />
     ```
     推送部署生效后，在 Google 平台点击“验证”。
   - **方式 B（DNS TXT 记录）**：在域名解析商处添加对应的 TXT 记录。
4. **提交 Sitemap**：
   - 验证成功后，点击左侧菜单的 **「站点地图 (Sitemaps)」**。
   - 输入 `sitemap.xml`，点击提交（该文件由 `src/pages/sitemap.xml.ts` 在每次构建时自动生成最新全站列表）。
5. **申请主页编入索引**：
   - 在顶部搜索框输入 `https://blog.yunitytech.top/`，回车后点击 **「请求编入索引」**。

---

## 三、微软 Bing 站长平台与 IndexNow 实时推送

Bing 覆盖了 Windows/Edge 默认搜索及雅虎（Yahoo）等渠道，并支持 IndexNow 实时通知。

1. 访问 [Bing Webmaster Tools](https://www.bing.com/webmasters) 并登录。
2. **快捷导入**：Bing 支持一键从 **Google Search Console 导入**（推荐，可直接同步验证与 Sitemap）。
3. 如需单独验证：项目已预置 `public/BingSiteAuth.xml` 与 `src/components/BaseHead.astro` 中的 `<meta name="msvalidate.01" ... />`，如有新 Token 直接更新该模板或验证文件即可。
4. **IndexNow 极速推送**（无需等待爬虫轮询）：
   - 本项目已预置密钥文件：`public/9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b.txt`。
   - 推送至 `master` 后，GitHub Actions 会自动读取真实构建产物 `dist/sitemap.xml` 并运行 `scripts/seo-ping.js` 完成 IndexNow 广播。
   - 若需在本地手动触发，先构建最新 `dist/` 再执行推送脚本：
     ```bash
     npm run build && node scripts/seo-ping.js
     ```
   - 说明：`scripts/seo-ping.js` 优先解析 `dist/sitemap.xml`；当本地尚未构建时，会自动回退读取 `src/content/posts/`（跳过 `draft: true` 草稿）与 `src/data/topics.ts` 动态拼装全站 URL。

---

## 四、百度搜索资源平台与 API 主动推送

百度是国内流量最大的中文搜索引擎。由于 GitHub Pages 部署在海外，主动推送尤为重要。

1. 访问并登录 [百度搜索资源平台](https://ziyuan.baidu.com/)。
2. 进入 **用户中心 -> 站点管理**，点击 **添加网站**，输入 `https://blog.yunitytech.top`。
3. **完成站点验证**：
   - 将百度提供的 HTML Meta 验证标签添加到 `src/components/BaseHead.astro`（或将验证文件放入 `public/` 目录），推送部署生效后完成验证。
4. **提交 Sitemap**：
   - 导航至 **资源提交 -> 普通收录 -> sitemap**，提交 `https://blog.yunitytech.top/sitemap.xml`。
5. **API 主动推送**：
   - 在“普通收录 -> API 提交”中获取接口调用 `token`。
   - 推荐将该值配置为 GitHub 仓库 Secret `BAIDU_TOKEN`：此后每次部署都会由 `.github/workflows/deploy.yml` 自动完成百度推送。
   - 本地亦可手动执行：
     ```bash
     BAIDU_TOKEN=你的百度Token node scripts/seo-ping.js
     ```

---

## 五、搜索“fengstack”登顶首页的关键：外链与实体绑定

搜索引擎在计算“fengstack”是谁的网站时，**反向链接（Backlinks）与锚文本（Anchor Text）** 是决定性因素。建议持续完善以下权威反链：

### 1. GitHub Profile
- 打开 GitHub 账号设置（Profile Settings），在 **Website** 一栏填入 `https://blog.yunitytech.top/`。
- 在个人主页 Profile README 仓库（`https://github.com/fengstack/fengstack`）中添加介绍，链接文本明确包含 **“fengstack”**：
  ```markdown
  ### 博客与个人主页
  欢迎访问 [fengstack 的技术博客与个人主页](https://blog.yunitytech.top/)，记录 RPC 架构、分布式系统、GIS 空间计算与 AI Agent 工程实践。
  ```

### 2. 开源项目仓库 README（`small-rpc` / `jooq-postgis` 等）
- 在代表作项目 README 头部或底部（如 `About the Author`）添加主页链接：
  ```markdown
  ## 作者
  由 [fengstack](https://blog.yunitytech.top/) 开发与维护。
  ```

### 3. 技术社区与社交账号反链
- 在活跃的技术社区个人资料中留下主页链接（链接文本建议设为 **“fengstack”** 或 **“fengstack 的博客”**），发表文章时在文末注明：
  *“本文首发于 [fengstack 的个人技术博客](https://blog.yunitytech.top/)”*。

---

## 六、日常发文与自动构建推送流程

基于 Astro 5 SSG 流水线，日常新增或更新文章无需手动修改 `index.html` 或 `sitemap.xml`：

1. 在 `src/content/posts/` 下新建 `<slug>.md`（或 `.mdx`），填写符合 `src/content/config.ts` 校验的 Frontmatter（正式发布时保持 `draft: false` 或省略）。
2. 在 `src/data/topics.ts` 中将 `<slug>` 加入对应技术专题的 `postSlugs` 数组。
3. 在本地执行三级闭环校验：
   ```bash
   npm run check
   npm run build
   npm run seo:check
   ```
   构建阶段会自动重新生成全站 HTML、`sitemap.xml`、`rss.xml`、搜索索引及各页面 JSON-LD。
4. 提交并推送到 `master` 分支：
   ```bash
   git add .
   git commit -m "feat(post): add <slug>"
   git push origin master
   ```
5. `.github/workflows/deploy.yml` 会自动依次执行：
   - **`build` 任务**：运行 `npm run check` → `npx astro build` → `npm run seo:check`，并上传 GitHub Pages 产物与 `sitemap-xml` 工件；
   - **`deploy` 任务**：发布至 GitHub Pages（`https://blog.yunitytech.top/`）；
   - **`seo-ping` 任务**：下载 `sitemap-xml` 工件至 `dist/`，运行 `node scripts/seo-ping.js` 自动广播全部真实上线 URL 至 IndexNow（及配置了 `BAIDU_TOKEN` 时的百度收录接口）。
