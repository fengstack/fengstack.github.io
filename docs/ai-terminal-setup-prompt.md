# 换新电脑时直接丢给 AI 的自动化配置 Prompt

> **使用方法**：
> 当你更换新 Mac 电脑，配置好任何具有 Shell 执行权限的 AI 编程助手（如 Antigravity、Claude Code、Cursor 等）后，直接复制下方 **Prompt 原文** 粘贴给 AI 即可。

---

## 📋 复制以下 Prompt 给 AI

```markdown
请帮我将这台新 Mac 的终端自动化配置为我习惯的工程级开发环境（iTerm2 + Oh My Zsh + agnoster + 现代工具链支持）。

### 目标架构与技术栈：
1. **终端与字体**：
   - 安装最新版 iTerm2。
   - 安装 Powerline 字体：`Meslo LG M Regular for Powerline`，并将 iTerm2 的 Default Profile 主字体配置为 `MesloLGM-RegularForPowerline 14`，开启粗体与斜体。
2. **主题与配色**：
   - 安装并配置 Oh My Zsh，主题采用 `agnoster`。
   - 配置 `DEFAULT_USER="$USER"`，自动隐藏冗余的用户名与主机名。
   - 启用 iTerm2 明暗模式自适应 (`Use Separate Colors for Light and Dark Mode`)：深色模式采用经典的 `Solarized Dark` 配色，浅色模式采用明亮干净的浅灰白背景。
3. **插件生态**：
   - 官方内置插件：`git`、`z`、`extract`。
   - 核心第三方插件：`zsh-autosuggestions`（补全提示样式设置为 `fg=244` 浅灰）和 `zsh-syntax-highlighting`（置于插件列表最后）。
4. **工程规范与缓存防污染**：
   - 严格遵循 XDG 规范，所有缓存与历史文件统一收纳在 `~/.cache/zsh/` 下：
     - `HISTFILE="$HOME/.cache/zsh/history"`（容量 50000 行）。
     - `_Z_DATA="$HOME/.cache/zsh/z"`。
     - `ZSH_COMPDUMP="$HOME/.cache/zsh/zcompdump-..."`。
     - `SHELL_SESSION_DIR="$HOME/.cache/zsh/sessions"`（写入 `~/.zshenv`）。
5. **工具链与环境集成**：
   - 规范编写 `~/.zshenv` 与 `~/.zshrc`。
   - 为 mise 运行时管理器提供双层激活：`.zshenv` 中对非交互 shell 注入 `mise hook-env -s zsh`，`.zshrc` 中对交互 shell 执行 `mise activate zsh`。
   - 自动检测兼容 OrbStack 终端集成（`~/.orbstack/shell/init.zsh`）。
   - 添加长任务防休眠别名：`alias claude='caffeinate -i claude'` 与 `alias agy='caffeinate -i agy'`。

### 执行要求：
- 请优先检查当前系统环境（操作系统版本、CPU 架构 arm64/x86_64、Homebrew 安装状态）。
- 具备幂等性执行能力（已安装的组件自动跳过或更新，不重复报错或覆盖破坏）。
- 若已有现成的一键脚本 `scripts/setup-terminal.sh`，可直接执行它并校验结果；若没有，请严格按照上述要求逐项配置并测试验证，最后输出一份配置检查报告。
```

---

## ⚡ 附：离线/独立一键安装命令

如果新电脑尚未克隆本仓库，可以直接在终端执行这一行命令快速拉取并自动配置：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/fengstack/fengstack.github.io/main/scripts/setup-terminal.sh)"
```
