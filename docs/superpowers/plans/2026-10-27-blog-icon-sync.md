# 博客新图标 (C-3 架构天梯) 同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将选定的 C-3「架构天梯：三维升腾之栈」图标作为博客主品牌标识，生成高质量矢量与位图资产，并全面替换博客中的小熊图标（Favicon、导航栏、关于页、元数据）。

**Architecture:** 
1. 编写原生精密 SVG 矢量源码（支持深浅模式高保真缩放）作为主资产。
2. 利用 Node.js 脚本或原生工具将 SVG 渲染导出为多分辨率 PNG（16px、32px、96px、192px、512px）。
3. 替换与重定向 Astro 核心组件（`BaseHead.astro`、`Header.astro`、`about.astro`）并保留旧路径兼容性。
4. 全量构建 `npm run build` 确保 Astro 编译零错误。

**Tech Stack:** Astro, SVG, Node.js (sharp / sips / resvg), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-10-27-blog-icon-design.md`

## Global Constraints
- 彻底移除前台展示中的小熊图案（`bear.png`），以现代化极客立体架构徽标替代。
- 保证 16px、24px、32px、80px 等多尺寸下的极致清晰度。
- 不破坏现有页面布局与排版样式，构建必须 100% 成功。

## Review Focus
- Favicon 兼容性：同时提供现代浏览器推荐的 `image/svg+xml` 和经典 `image/png` 回退。
- Header 导航栏：原头像使用 `rounded-full` 圆形剪裁，新立体徽章应使用 `rounded-md` 带来更佳视觉边框感。
- 静态资产路径：新老路径（`logo.svg`, `logo.png`, `bear.png`）双向兼容，防止缓存或第三方反向引用失效。

---

### Task 1: 编写核心矢量资产 (Vector SVG Assets)

**Files:**
- Create: `public/favicon.svg`
- Create: `public/images/logo.svg`

**Interfaces:**
- Produces: `public/favicon.svg`, `public/images/logo.svg` (viewBox="0 0 64 64")

- [ ] **Step 1: 编写 `public/images/logo.svg`**
  包含 C-3「架构天梯」的三层等角悬浮方舟（底层数据基石、中层分布式 RPC 总线、顶层 AI 逻辑巅峰）、垂直数据链路（形成发光立体“F”）以及峰顶极光信标。
- [ ] **Step 2: 编写 `public/favicon.svg`**
  适配浏览器标签页与暗色/亮色外观的紧凑 Favicon 矢量版本。
- [ ] **Step 3: 验证 SVG 结构合法性**
  执行验证命令检查标签完整性与格式。

---

### Task 2: 生成多分辨率位图资产 (Raster PNG Assets)

**Files:**
- Create: `scripts/generate-icons.js`
- Create: `public/favicon.png` (32x32 / 48x48)
- Create: `public/images/logo.png` (512x512)
- Modify: `public/images/bear.png` (替换为新图标位图，保证旧链接无缝过渡)
- Modify: `public/images/avatar.png` (同步更新为新品牌徽标位图)

**Interfaces:**
- Consumes: `public/images/logo.svg`
- Produces: `public/favicon.png`, `public/images/logo.png`, `public/images/bear.png`, `public/images/avatar.png`

- [ ] **Step 1: 编写轻量生成脚本 `scripts/generate-icons.js` 并导出 PNG 资产**
  将 SVG 栅格化为高质量抗锯齿 PNG。
- [ ] **Step 2: 验证生成的各规格位图尺寸与文件有效性**
  执行 `file public/images/logo.png public/favicon.png public/images/bear.png` 验证。

---

### Task 3: 更新 Astro 组件与页面引用

**Files:**
- Modify: `src/components/BaseHead.astro`
- Modify: `src/components/Header.astro`
- Modify: `src/pages/about.astro`

**Interfaces:**
- Consumes: `public/favicon.svg`, `public/favicon.png`, `public/images/logo.svg`, `public/images/logo.png`

- [ ] **Step 1: 修改 `src/components/BaseHead.astro`**
  - 更新 `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`
  - 更新 `<link rel="icon" type="image/png" href="/favicon.png" />`
  - 更新 `logoImageURL` 默认指向 `/images/logo.png`
- [ ] **Step 2: 修改 `src/components/Header.astro`**
  - 将导航栏左上角品牌图更新为 `<img src="/images/logo.svg" alt="高云峰" width="24" height="24" class="h-6 w-6 rounded-md object-contain" />`
- [ ] **Step 3: 修改 `src/pages/about.astro`**
  - 更新关于页头像为新品牌图标 `<img src="/images/logo.png" alt="高云峰" width="80" height="80" class="h-20 w-20 rounded-2xl border border-line object-contain bg-surface/50 p-1.5 shadow-sm" />`

---

### Task 4: 校验与生产构建测试 (Build Verification)

**Files:**
- Test: 全量构建测试

- [ ] **Step 1: 运行 `npm run build`**
  Run: `npm run build`
  Expected: 成功构建无报错，输出静态页面于 `dist/`。
- [ ] **Step 2: 检查构建产物与引用**
  确保 `dist/` 中包含新生成的 `favicon.svg`、`logo.svg` 等，且 HTML 页面中的图标引用准确无误。
