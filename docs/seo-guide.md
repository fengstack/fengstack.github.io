# 高云峰的个人主页与博客 · 全网搜索引擎收录实战指南

本指南旨在帮助您的网站（[https://blog.yunitytech.top/](https://blog.yunitytech.top/)）在 **Google、百度、微软 Bing** 等国内外搜索引擎中以最快速度被收录，并在搜索 **“高云峰”** 时精准排在前列。

---

## 目录
1. [站内技术优化现状](#一站内技术优化现状)
2. [Google Search Console 提交与收录](#二google-search-console-提交与收录)
3. [微软 Bing 站长平台与 IndexNow 实时推送](#三微软-bing-站长平台与-indexnow-实时推送)
4. [百度搜索资源平台与 API 主动推送](#四百度搜索资源平台与-api-主动推送)
5. [搜索“高云峰”登顶首页的关键：外链与实体绑定](#五搜索高云峰登顶首页的关键外链与实体绑定)
6. [日常更新与自动推送维护](#六日常更新与自动推送维护)

---

## 一、站内技术优化现状

项目中已经完成了所有核心 SEO 基础设施的搭建：

- **H1 与 Title 实体强化**：全站 `<title>`、`<h1>`、导航 Logo 锚文本全面围绕“高云峰”进行了权重集中。
- **爬虫放行规则 (`robots.txt`)**：完整支持 Googlebot、Bingbot、Baiduspider、360Spider、Sogou、Bytespider 等。
- **全站站点地图 (`sitemap.xml`)**：收录首页、博文列表及所有文章，权重与更新周期分级设定。
- **结构化知识图谱 (Schema.org / JSON-LD)**：
  - 首页配置了符合 Google 规范的 `Person`（高云峰）与 `WebSite` 实体声明，绑定了 GitHub 社交主页。
  - 博文详情页配置了 `BlogPosting`，文章列表页配置了 `CollectionPage` 和 `BreadcrumbList`（面包屑）。
- **IndexNow 实时推送协议**：已生成验证文件 `9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b.txt` 与推送脚本 `scripts/seo-ping.js`。
- **站长验证代码预留**：`index.html` 的 `<head>` 中已预留 Google、Bing、百度、360 的验证 meta 标签。

---

## 二、Google Search Console 提交与收录

Google 是程序员群体最核心的搜索引擎，收录速度快、重视语义与移动端适配。

1. 访问并登录 [Google Search Console](https://search.google.com/search-console)。
2. 点击左上角 **「添加资源」**，选择 **网址前缀**，输入：
   ```
   https://blog.yunitytech.top/
   ```
3. 选择验证方式：
   - **方式 A（推荐，HTML 标记）**：复制其中的 `content` 字符串，替换 `index.html` 中的：
     ```html
     <meta name="google-site-verification" content="你的Google验证Token" />
     ```
     提交部署后，在 Google 平台点击“验证”。
   - **方式 B（DNS TXT 记录）**：在域名解析商处添加对应的 TXT 记录。
4. **提交 Sitemap**：
   - 验证成功后，点击左侧菜单的 **「站点地图 (Sitemaps)」**。
   - 输入 `sitemap.xml`，点击提交。
5. **申请主页编入索引**：
   - 在顶部搜索框输入 `https://blog.yunitytech.top/`，回车后点击 **「请求编入索引」**。

---

## 三、微软 Bing 站长平台与 IndexNow 实时推送

Bing 覆盖了所有 Windows/Edge 默认搜索以及雅虎（Yahoo）搜索，且支持 IndexNow 实时通知。

1. 访问 [Bing Webmaster Tools](https://www.bing.com/webmasters) 并登录。
2. **快捷导入**：Bing 支持直接一键从 **Google Search Console 导入**（强烈推荐，无需重新验证，直接同步 Sitemap）。
3. 如需单独验证：
   - 选择 HTML Meta 标签验证，将 Token 填入 `index.html`：
     ```html
     <meta name="msvalidate.01" content="你的Bing验证Token" />
     ```
4. **IndexNow 极速推送**（无需等待蜘蛛抓取）：
   - 本项目已预置认证秘钥文件：`9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b.txt`。
   - 每次发布新文章或更新后，直接在项目根目录运行：
     ```bash
     node scripts/seo-ping.js
     ```
   - Bing 和 Yandex 收到通知后，通常数小时内就会派发蜘蛛完成索引。

---

## 四、百度搜索资源平台与 API 主动推送

百度是国内流量最大的中文搜索引擎。由于 GitHub Pages 部署在海外，百度蜘蛛无法自动发现时，主动推送尤为重要。

1. 访问并登录 [百度搜索资源平台](https://ziyuan.baidu.com/)。
2. 进入 **用户中心 -> 站点管理**，点击 **添加网站**，输入 `https://blog.yunitytech.top`。
3. **完成站点验证**：
   - 选择 HTML 标签验证，复制 `content` 字符串，填入 `index.html`：
     ```html
     <meta name="baidu-site-verification" content="你的百度Token" />
     ```
   - 部署生效后点击百度平台的“完成验证”。
4. **提交 Sitemap**：
   - 导航至 **资源提交 -> 普通收录 -> sitemap**。
   - 提交 `https://blog.yunitytech.top/sitemap.xml`。
5. **API 主动推送（最有效的收录手段）**：
   - 在“普通收录 -> API 提交”中找到您的 **接口调用地址**，其中包含 `token=xxxxxx`。
   - 以后每次推送文章时，执行以下命令即可直通百度爬虫库：
     ```bash
     BAIDU_TOKEN=你的百度Token node scripts/seo-ping.js
     ```

---

## 五、搜索“高云峰”登顶首页的关键：外链与实体绑定

搜索引擎在计算“高云峰”是谁的网站时，**反向链接（Backlinks）与锚文本（Anchor Text）** 是权重最高的决定性因素。

请务必按以下步骤建立权威反链（这会让您的域名权重呈几何倍数增长）：

### 1. GitHub Profile（权重极高，DA 96+）
- 打开您的 GitHub 账号设置（Profile Settings），在 **Website** 一栏填入：
  `https://blog.yunitytech.top/`
- 在您的个人主页 README 仓库（`https://github.com/fengstack/fengstack`）中，添加一段介绍：
  ```markdown
  ### 博客与个人主页
  欢迎访问 [高云峰的技术博客与个人主页](https://blog.yunitytech.top/)，记录 RPC 架构、数据库与开源贡献。
  ```
  > **关键点**：链接文字必须明确包含 **“高云峰”**，这就是告诉搜索引擎该网址对应“高云峰”。

### 2. 开源项目仓库 README（small-rpc / jooq-postgis 等）
- 在您的代表作项目 README 头部或底部（如 `About the Author`）：
  ```markdown
  ## 作者
  由 [高云峰](https://blog.yunitytech.top/) 开发与维护。
  ```

### 3. 技术社区与社交账号反链
- 在您活跃的技术社区个人资料中留下主页链接（链接文本均建议设置为 **“高云峰”** 或 **“高云峰的博客”**）：
  - 掘金 / 知乎 / 博客园 / CSDN / 简书 / V2EX
  - Twitter (X) / LinkedIn
  - 发表技术文章（如在掘金分享 small-rpc）时，文末附带：
    *“本文首发于 [高云峰的个人技术博客](https://blog.yunitytech.top/)”*。

---

## 六、日常更新与自动推送维护

当您写了一篇新博文（例如新建了 `post/new-article/index.html`）后：

1. 在 `sitemap.xml` 中追加新文章 URL，并将日期更新为当日。
2. 运行一键推送脚本：
   ```bash
   node scripts/seo-ping.js
   # 若配置了百度 Token：
   BAIDU_TOKEN=你的百度Token node scripts/seo-ping.js
   ```
3. 提交并推送到 GitHub：
   ```bash
   git add -A
   git commit -m "feat: add new post and update sitemap"
   git push origin master
   ```

按照上述步骤操作后，Google、Bing 通常在 **1~3 天** 内完成收录，百度在 **1~2 周** 左右建立首批索引。随着 GitHub 及各大外链生效，搜索 **“高云峰”** 便会迅速跻身前列！
