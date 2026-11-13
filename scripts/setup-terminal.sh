#!/usr/bin/env bash
# ==============================================================================
# macOS 终端全自动化配置脚本 (iTerm2 + Oh My Zsh + agnoster + 现代化工程规范)
# 适用平台: macOS (Apple Silicon / Intel)
# 特性: 幂等执行、XDG 缓存规范、深浅自适应配色、mise 运行时双层无缝激活
# ==============================================================================

set -eo pipefail

# 颜色输出
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}[INFO]${RESET} $1"; }
log_ok()   { echo -e "${GREEN}[OK]${RESET} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${RESET} $1"; }
log_err()  { echo -e "${RED}[ERROR]${RESET} $1"; }

# 1. 系统与架构检查
if [[ "$(uname -s)" != "Darwin" ]]; then
    log_err "本脚本专为 macOS 设计，当前操作系统为: $(uname -s)"
    exit 1
fi

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
    BREW_PREFIX="/opt/homebrew"
else
    BREW_PREFIX="/usr/local"
fi
log_info "检测到 macOS 系统，CPU 架构: $ARCH，Homebrew 根路径: $BREW_PREFIX"

# 2. 检查或安装 Homebrew
if ! command -v brew &>/dev/null; then
    log_warn "未检测到 Homebrew，正在执行安装..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$("$BREW_PREFIX/bin/brew" shellenv)"
else
    log_ok "Homebrew 已就绪: $(brew --version | head -n 1)"
fi

# 确保常用基础工具
brew list git &>/dev/null || brew install git
brew list curl &>/dev/null || brew install curl

# 3. 安装 iTerm2
if [[ ! -d "/Applications/iTerm.app" ]]; then
    log_info "正在安装 iTerm2..."
    brew install --cask iterm2
    log_ok "iTerm2 安装完成"
else
    log_ok "iTerm2 已存在，跳过安装"
fi

# 4. 安装 Powerline 字体 (Meslo LG M for Powerline)
FONT_DIR="$HOME/Library/Fonts"
mkdir -p "$FONT_DIR"
MESLO_FONT="$FONT_DIR/Meslo LG M Regular for Powerline.ttf"
if [[ ! -f "$MESLO_FONT" ]]; then
    log_info "正在下载 Meslo LG M for Powerline 字体..."
    curl -fsSL "https://raw.githubusercontent.com/powerline/fonts/master/Meslo%20Slashed/Meslo%20LG%20M%20Regular%20for%20Powerline.ttf" -o "$MESLO_FONT"
    log_ok "字体已成功安装至: $MESLO_FONT"
else
    log_ok "Meslo LG M for Powerline 字体已就绪"
fi

# 5. 安装 Oh My Zsh (非交互式、无人值守)
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
    log_info "正在安装 Oh My Zsh 框架..."
    RUNZSH=no CHSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    log_ok "Oh My Zsh 安装完成"
else
    log_ok "Oh My Zsh 已存在，跳过安装"
fi

ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
mkdir -p "$ZSH_CUSTOM/plugins"

# 6. 安装扩展插件 (zsh-autosuggestions, zsh-syntax-highlighting)
install_or_update_plugin() {
    local repo_url="$1"
    local plugin_dir="$2"
    local name="$3"

    if [[ -d "$plugin_dir" ]]; then
        log_ok "插件 $name 已存在，尝试拉取最新版本..."
        git -C "$plugin_dir" pull --quiet --ff-only || true
    else
        log_info "正在克隆插件 $name..."
        git clone --depth=1 "$repo_url" "$plugin_dir"
        log_ok "插件 $name 安装成功"
    fi
}

install_or_update_plugin \
    "https://github.com/zsh-users/zsh-autosuggestions.git" \
    "$ZSH_CUSTOM/plugins/zsh-autosuggestions" \
    "zsh-autosuggestions"

install_or_update_plugin \
    "https://github.com/zsh-users/zsh-syntax-highlighting.git" \
    "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" \
    "zsh-syntax-highlighting"

# 7. 规范化收纳目录与缓存
log_info "创建并检查缓存收纳目录: ~/.cache/zsh..."
mkdir -p "$HOME/.cache/zsh/sessions"

# 8. 备份与生成 ~/.zshenv
if [[ -f "$HOME/.zshenv" ]]; then
    cp "$HOME/.zshenv" "$HOME/.zshenv.bak.$(date +%s)"
fi

log_info "写入 ~/.zshenv 配置..."
cat << 'EOF' > "$HOME/.zshenv"
# 统一收纳 macOS 终端会话至缓存目录
export SHELL_SESSION_DIR="$HOME/.cache/zsh/sessions"

# 全局注入 Homebrew 路径（供脚本与非交互子 Shell 读取）
if [[ -d "/opt/homebrew/bin" ]]; then
  typeset -U path PATH
  path=(/opt/homebrew/bin /opt/homebrew/sbin $path)
elif [[ -d "/usr/local/bin" ]]; then
  typeset -U path PATH
  path=(/usr/local/bin /usr/local/sbin $path)
fi

# 全局注入 mise 运行时钩子（仅非交互 shell；交互 shell 由 .zshrc 的 mise activate 负责）
if (( $+commands[mise] )) && [[ ! -o interactive ]]; then
  eval "$(mise hook-env -s zsh)"
fi
EOF
log_ok "~/.zshenv 写入完毕"

# 9. 备份与生成 ~/.zshrc
if [[ -f "$HOME/.zshrc" ]]; then
    cp "$HOME/.zshrc" "$HOME/.zshrc.bak.$(date +%s)"
fi

log_info "写入 ~/.zshrc 配置..."
cat << 'EOF' > "$HOME/.zshrc"
# ============================================================
# 1. 基础环境与 PATH（前置初始化）
# ============================================================
export ZSH="$HOME/.oh-my-zsh"

# 自动去重并前置自定义工具链
typeset -U path PATH
path=(
  ${PNPM_HOME:+"$PNPM_HOME"}  # pnpm 全局 CLI（由 mise 统一管理；未定义时安全跳过）
  "$HOME/.local/bin"          # uv / Python 本地工具
  "$HOME/go/bin"              # Go 工具链（对应 mise GOBIN）
  /opt/homebrew/sbin
  /usr/local/sbin
  $path
)

# 统一缓存路径，避免污染 $HOME
[[ -d "$HOME/.cache/zsh" ]] || mkdir -p "$HOME/.cache/zsh"
export ZSH_COMPDUMP="$HOME/.cache/zsh/zcompdump-${(%):-%m}-${ZSH_VERSION}"
export _Z_DATA="$HOME/.cache/zsh/z"
HISTFILE="$HOME/.cache/zsh/history"
HISTSIZE=50000
SAVEHIST=50000

# ============================================================
# 2. Oh My Zsh 框架与插件
# ============================================================
ZSH_THEME="agnoster"
DEFAULT_USER="$USER"  # 省略 user@host 提示前缀

plugins=(
  git
  z
  extract
  zsh-autosuggestions
  zsh-syntax-highlighting  # 语法高亮，官方要求必须放在最后一个
)

export ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=244"  # 浅灰补全提示

source "$ZSH/oh-my-zsh.sh"

# ============================================================
# 3. 工具集成与别名
# ============================================================
# mise 运行时激活
command -v mise >/dev/null && eval "$(mise activate zsh)"

# OrbStack 终端集成
[[ -f "$HOME/.orbstack/shell/init.zsh" ]] && source "$HOME/.orbstack/shell/init.zsh"

# 运行长任务时阻止系统空闲休眠
alias claude='caffeinate -i claude'
alias agy='caffeinate -i agy'
EOF
log_ok "~/.zshrc 写入完毕"

# 10. 自动注入 iTerm2 偏好设置 (字体、Solarized Dark 配色、自适应明暗、50000 行缓冲区)
log_info "配置 iTerm2 核心属性 (字体、配色、回滚缓冲区)..."
python3 - << 'PYEOF'
import plistlib
import os
import sys

plist_path = os.path.expanduser("~/Library/Preferences/com.googlecode.iterm2.plist")
if not os.path.exists(plist_path):
    print("[INFO] 未找到既存的 iTerm2 plist，启动一次 iTerm2 或由其后续读取系统默认值")
    sys.exit(0)

try:
    with open(plist_path, "rb") as f:
        data = plistlib.load(f)

    # Solarized Dark 核心色盘
    solarized_dark = {
        "Background Color (Dark)": {"Red Component": 0.0, "Green Component": 0.168, "Blue Component": 0.211, "Alpha Component": 1.0, "Color Space": "sRGB"},
        "Foreground Color (Dark)": {"Red Component": 0.513, "Green Component": 0.580, "Blue Component": 0.588, "Alpha Component": 1.0, "Color Space": "sRGB"},
        "Cursor Text Color (Dark)": {"Red Component": 0.027, "Green Component": 0.211, "Blue Component": 0.258, "Alpha Component": 1.0, "Color Space": "sRGB"},
        "Cursor Color (Dark)": {"Red Component": 0.513, "Green Component": 0.580, "Blue Component": 0.588, "Alpha Component": 1.0, "Color Space": "sRGB"},
        "Selection Color (Dark)": {"Red Component": 0.027, "Green Component": 0.211, "Blue Component": 0.258, "Alpha Component": 1.0, "Color Space": "sRGB"},
        "Selected Text Color (Dark)": {"Red Component": 0.584, "Green Component": 0.631, "Blue Component": 0.631, "Alpha Component": 1.0, "Color Space": "sRGB"},
        "Bold Color (Dark)": {"Red Component": 0.584, "Green Component": 0.631, "Blue Component": 0.631, "Alpha Component": 1.0, "Color Space": "sRGB"},
    }

    bookmarks = data.get("New Bookmarks", [])
    if not bookmarks:
        print("[WARN] 尚未生成 Bookmarks 列表")
        sys.exit(0)

    for b in bookmarks:
        # 设置字体为 Meslo LG M for Powerline 14
        b["Normal Font"] = "MesloLGM-RegularForPowerline 14"
        b["Use Bold Font"] = True
        b["Use Italic Font"] = True
        b["Scrollback Lines"] = 50000
        b["Cursor Shape"] = 0  # 方块光标
        # 开启明暗模式自适应
        b["Use Separate Colors for Light and Dark Mode"] = True
        # 浅色默认背景为干净的灰白
        b["Background Color"] = {"Red Component": 0.98, "Green Component": 0.98, "Blue Component": 0.98, "Alpha Component": 1.0, "Color Space": "sRGB"}
        b["Foreground Color"] = {"Red Component": 0.06, "Green Component": 0.06, "Blue Component": 0.06, "Alpha Component": 1.0, "Color Space": "sRGB"}
        # 注入 Dark 模式配色
        for k, v in solarized_dark.items():
            b[k] = v

    data["New Bookmarks"] = bookmarks

    with open(plist_path, "wb") as f:
        plistlib.dump(data, f)
    print("[OK] iTerm2 配置项已更新并回写成功")
except Exception as e:
    print(f"[WARN] 更新 iTerm2 plist 偏好时发生跳过: {e}")
PYEOF

# 11. 默认登录 Shell 设置为 zsh
CURRENT_SHELL="$(dscl . -read /Users/"$USER" UserShell | awk '{print $2}')"
if [[ "$CURRENT_SHELL" != *"zsh" ]]; then
    log_info "将默认 Shell 更改为 zsh..."
    chsh -s "$(which zsh)"
fi

echo -e "\n${GREEN}================================================================${RESET}"
echo -e "${GREEN}🎉 macOS 现代化工程级终端环境已自动安装并配置完毕！${RESET}"
echo -e "${GREEN}================================================================${RESET}"
echo -e "请完全退出并重新打开 iTerm2，或执行: ${BLUE}source ~/.zshrc${RESET} 即可体验！"
