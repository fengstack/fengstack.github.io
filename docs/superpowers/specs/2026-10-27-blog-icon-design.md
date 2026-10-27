# 博客技术图标设计方案与同步规范 (2026-10-27)

## 1. 目标与背景 (Intent & The Why)
- **背景**：博客当前使用 `public/images/bear.png`（小熊形象）作为 Favicon、顶部导航栏 Logo 和关于页头像。
- **目标**：彻底告别小熊形象，采用契合“软件技术改变世界”宏大主题的高质感现代工程图标，呼应个人品牌 `fengstack`（高云峰）及核心领域（分布式 RPC 治理、AI Agent SDD/TDD 规范驱动、空间计算）。
- **非目标 (Non-goals)**：不更改博客现有的布局框架与配色体系，新图标无缝融入现有“Editorial Technology Publication”的板岩蓝风格。

## 2. 方案权衡与最终决策 (Approaches)
在头脑风暴与交互式画布推演中，经过多轮概念与美学迭代：
- **方案 A（分层堆栈与全球经纬）**：以地球经纬拓扑贯穿分层堆栈。意境宏大，但在 16px 极小尺寸下线条较为密集。
- **方案 B（终端杠杆）**：以命令行 `>_` 切破全球轨道。极简锐利，但偏向单一终端隐喻，缺乏个人技术栈的纵深映射。
- **方案 C（技术基石与登峰之印）**：将名字“云峰”与“fengstack”中的“峰 (Peak)”与字母“F”化为三维空间架构，贯穿分布式 RPC 节点。
  - **C-1（双峰折射：晶体棱柱）**：主副双峰与激光总线贯穿，偏向几何切面质感。
  - **C-2（极简锋芒：负空间登峰之印）**：外轮廓高山剪影结合内嵌 F 飞翼。
  - **C-3（架构天梯：三维升腾之栈）[最终选定]**：
    - **视觉构型**：三层等角悬浮方舟（底层数据基石、中层分布式 RPC 总线、顶层 AI 逻辑巅峰）逐级升腾破空登峰；左侧垂直高速数据链路（Data Bus）串联三大层级，形成发光的立体“F”。
    - **隐喻内涵**：把“Stack（架构栈）”与“峰（Peak）”直接立体融合，象征工程师用扎实技术底座搭建起通往智能未来的技术高峰。

## 3. 落地实施规划 (Implementation Scope)
1. **矢量源资产生成**：
   - 生成 `public/favicon.svg` 与 `public/images/logo.svg`：原生精准矢量代码，支持明暗主题自适应与无限缩放。
2. **多分辨率位图生成**：
   - 生成高质量多尺寸 PNG 资源（16×16、32×32、96×96、192×192、512×512）：
     - `public/favicon.ico` / `public/favicon.png`：用于浏览器标签页。
     - `public/images/bear.png`（替换更新，保留兼容性）与 `public/images/logo.png`。
     - `public/images/avatar.png`（关于页头像同步更新为高精尖架构徽标）。
3. **前端组件引用同步**：
   - 更新 `src/components/BaseHead.astro`：Favicon 引用与 OpenGraph/SEO 结构化数据 Logo。
   - 更新 `src/components/Header.astro`：导航栏品牌标识与无损渲染优化。
   - 更新 `src/pages/about.astro`：个人介绍页头像展示。
4. **编译与验证**：
   - 运行 `npm run build` 确保 Astro 编译通过，并检查各端显示效果。
