#!/usr/bin/env python3
"""DeepSeek Cute · 主题生成器

从正太主题 (theme.css) 生成其它内置主题与「主题工坊」模板。

原理: 主题的视觉身份由一组「令牌行」决定(颜色 / 壁纸 / 吉祥物 / 极光),
结构层(玻璃、极光动画、滚动条、按钮语言、阅读玻璃)完全不变。
生成 = 对 theme.css 做确定性的整行字符串替换。

令牌表中的每一行在源文件里要么出现一次, 要么出现多次且语义相同
(例如深色阅读标签同时定义在 retro 段与阅读段, 值一致)。因此 replace-all
是安全的。

校验: 用正太主题原值回代, 输出必须与原文件逐字节一致 —— 令牌表不完整
时会立刻失败, 不会带着漏洞发布。

用法:
  python3 make-themes.py [theme.css 路径]
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SRC = Path.home() / "Documents/修复任务/deepseek-pop-theme/theme.css"
OUT_DIR = HERE.parent / "themes"
STUDIO_IN = HERE.parent / "theme-studio.template.html"
STUDIO_OUT = HERE.parent / "theme-studio.html"


# ---------------------------------------------------------------------------
# 令牌表: (token, find)。find 是 theme.css 中的完整原文(整行/整段)。
# ---------------------------------------------------------------------------
TOKENS = [
    # :root 六色
    ("coral", "  --dsm-coral: #f36b50;"),
    ("sun", "  --dsm-sun: #f5dc26;"),
    ("mint", "  --dsm-mint: #62e8d3;"),
    ("slate", "  --dsm-slate: #587273;"),
    ("ink", "  --dsm-ink: #211a19;"),
    ("cream", "  --dsm-cream: #fff1d7;"),
    # 壁纸 / 吉祥物(单行 base64)
    ("wall", None),   # 用正则处理
    ("mascot", None),
    # ---- 深色 retro 段
    ("dk_bg_base", "  --dsw-alias-bg-base: rgba(28, 27, 28, 0.76) !important;"),
    ("dk_bg_l1", "  --dsw-alias-bg-layer-1: rgba(42, 37, 35, 0.88) !important;"),
    ("dk_bg_l2", "  --dsw-alias-bg-layer-2: rgba(78, 62, 54, 0.82) !important;"),
    ("dk_bg_ov", "  --dsw-alias-bg-overlay: rgba(34, 31, 31, 0.96) !important;"),
    ("dk_b_l1", "  --dsw-alias-border-l1: rgba(98, 232, 211, 0.18) !important;"),
    ("dk_b_l2", "  --dsw-alias-border-l2: rgba(245, 220, 38, 0.30) !important;"),
    ("dk_label_p", "  --dsw-alias-label-primary: #fff5df !important;"),
    ("dk_label_pb", "  --dsw-alias-label-primary-bluish: #d8fff6 !important;"),
    ("dk_label_pd", "  --dsw-alias-label-primary-dimmed: #ead9bd !important;"),
    ("dk_label_s", "  --dsw-alias-label-secondary: #d8c3aa !important;"),
    ("dk_label_t", "  --dsw-alias-label-tertiary: #cbb598 !important;"),
    ("dk_label_c", "  --dsw-alias-label-caption: #c7af91 !important;"),
    ("dk_label_ld", "  --dsw-alias-label-dimmed: #bca78d !important;"),
    ("dk_err", "  --dsw-alias-state-error-primary: #ff7968 !important;"),
    ("dk_sidebar", "  --dsw-specific-sidebar-fill: rgba(31, 29, 29, 0.86) !important;"),
    ("dk_veil", "  --dsm-veil:\n    linear-gradient(90deg, rgba(24, 23, 24, 0.58), rgba(24, 23, 24, 0.42) 52%, rgba(55, 66, 66, 0.30));"),
    ("dk_glow", "  --dsm-accent-glow: rgba(243, 107, 80, 0.38);"),
    # ---- 浅色 retro 段
    ("lt_bg_base", "  --dsw-alias-bg-base: rgba(255, 241, 215, 0.78) !important;"),
    ("lt_bg_l1", "  --dsw-alias-bg-layer-1: rgba(255, 247, 228, 0.92) !important;"),
    ("lt_bg_l2", "  --dsw-alias-bg-layer-2: rgba(250, 222, 184, 0.86) !important;"),
    ("lt_bg_ov", "  --dsw-alias-bg-overlay: rgba(255, 246, 226, 0.97) !important;"),
    ("lt_b_l1", "  --dsw-alias-border-l1: rgba(88, 114, 115, 0.20) !important;"),
    ("lt_b_l2", "  --dsw-alias-border-l2: rgba(243, 107, 80, 0.34) !important;"),
    ("lt_brand", "  --dsw-alias-brand-primary: #df553f !important;"),
    ("lt_label_p", "  --dsw-alias-label-primary: #1f1512 !important;"),
    ("lt_label_pb", "  --dsw-alias-label-primary-bluish: #174d48 !important;"),
    ("lt_label_pd", "  --dsw-alias-label-primary-dimmed: #3d2b25 !important;"),
    ("lt_label_s", "  --dsw-alias-label-secondary: #49342d !important;"),
    ("lt_label_t", "  --dsw-alias-label-tertiary: #584036 !important;"),
    ("lt_label_c", "  --dsw-alias-label-caption: #4f392f !important;"),
    ("lt_label_ld", "  --dsw-alias-label-dimmed: #60493e !important;"),
    ("lt_err", "  --dsw-alias-state-error-primary: #ce4437 !important;"),
    ("lt_ok", "  --dsw-alias-state-success-primary: #168c7d !important;"),
    ("lt_warn", "  --dsw-alias-state-warn-primary: #a97900 !important;"),
    ("lt_sidebar", "  --dsw-specific-sidebar-fill: rgba(255, 244, 219, 0.88) !important;"),
    ("lt_veil", "  --dsm-veil:\n    linear-gradient(90deg, rgba(255, 245, 224, 0.32), rgba(255, 245, 224, 0.20) 54%, rgba(230, 239, 229, 0.16));"),
    ("lt_glow", "  --dsm-accent-glow: rgba(243, 107, 80, 0.28);"),
    # ---- 最终级联锁 · 深色
    ("lkdk_bg_base", "  --dsw-alias-bg-base: rgba(25, 24, 26, .78) !important;"),
    ("lkdk_bg_l1", "  --dsw-alias-bg-layer-1: rgba(38, 34, 34, .90) !important;"),
    ("lkdk_bg_l2", "  --dsw-alias-bg-layer-2: rgba(55, 47, 44, .86) !important;"),
    ("lkdk_bg_ov", "  --dsw-alias-bg-overlay: rgba(28, 27, 29, .97) !important;"),
    ("lkdk_label_p", "  --dsw-alias-label-primary: #fff4df !important;"),
    ("lkdk_label_pb", "  --dsw-alias-label-primary-bluish: #d8fff7 !important;"),
    ("lkdk_label_pd", "  --dsw-alias-label-primary-dimmed: #ead6b8 !important;"),
    ("lkdk_label_s", "  --dsw-alias-label-secondary: #ddc6a8 !important;"),
    ("lkdk_label_t", "  --dsw-alias-label-tertiary: #ccb395 !important;"),
    ("lkdk_label_c", "  --dsw-alias-label-caption: #c2aa8d !important;"),
    ("lkdk_label_ld", "  --dsw-alias-label-dimmed: #b7a186 !important;"),
    ("lkdk_b_l1", "  --dsw-alias-border-l1: rgba(98, 232, 211, .22) !important;"),
    ("lkdk_b_l2", "  --dsw-alias-border-l2: rgba(245, 220, 38, .32) !important;"),
    ("lkdk_sidebar", "  --dsw-specific-sidebar-fill: rgba(25, 25, 27, .88) !important;"),
    # ---- 最终级联锁 · 浅色
    ("lklt_bg_base", "  --dsw-alias-bg-base: rgba(255, 241, 215, .78) !important;"),
    ("lklt_bg_l1", "  --dsw-alias-bg-layer-1: rgba(255, 247, 228, .92) !important;"),
    ("lklt_bg_l2", "  --dsw-alias-bg-layer-2: rgba(250, 222, 184, .86) !important;"),
    ("lklt_bg_ov", "  --dsw-alias-bg-overlay: rgba(255, 246, 226, .97) !important;"),
    ("lklt_sidebar", "  --dsw-specific-sidebar-fill: rgba(255, 244, 219, .88) !important;"),
    # ---- 三栏底色
    ("col_ls", "  background: rgba(255, 247, 229, .90) !important;"),
    ("col_lc", "  background: rgba(255, 247, 229, .48) !important;"),
    ("col_lde", "  background: rgba(255, 246, 226, .80) !important;"),
    ("col_ds", "  background: rgba(25, 25, 27, .88) !important;"),
    ("col_dc", "  background: rgba(24, 24, 26, .58) !important;"),
    ("col_dde", "  background: rgba(31, 29, 30, .78) !important;"),
    # ---- 阅读玻璃
    ("read_lp", "  --dsw-alias-label-primary: #241a18 !important;"),
    ("read_ls", "  --dsw-alias-label-secondary: #5c493f !important;"),
    ("read_grad_l", "  background: linear-gradient(90deg,\n    rgba(255, 248, 232, .94) 0%,\n    rgba(255, 248, 232, .88) 68%,\n    rgba(255, 248, 232, .72) 100%);"),
    ("read_grad_d", "  background: linear-gradient(90deg,\n    rgba(24, 24, 26, .90) 0%,\n    rgba(24, 24, 26, .84) 68%,\n    rgba(24, 24, 26, .70) 100%);"),
    # ---- 指针柔光
    ("pg_mint", "    radial-gradient(24% 26% at var(--dsm-pointer-x, 78%) var(--dsm-pointer-y, 18%), rgba(98, 232, 211, .16), transparent 70%),"),
    ("pg_sun", "    radial-gradient(42% 36% at 86% 14%, rgba(245, 220, 38, .14), transparent 64%),"),
    ("pg_coral", "    radial-gradient(36% 34% at 10% 90%, rgba(243, 107, 80, .14), transparent 64%);"),
]

WALL_RE = re.compile(r'  --dsm-reference-wall: url\("data:image/jpeg;base64,[A-Za-z0-9+/=]+"\);')
MASCOT_RE = re.compile(r'  --dsm-mascot-ui: url\("data:image/png;base64,[A-Za-z0-9+/=]+"\);')


def values_for_find(find: str) -> str:
    """正太主题原值(回代校验用)。"""
    return find


def apply(css: str, values: dict) -> str:
    out = WALL_RE.sub(values["wall"], css, count=1)
    out = MASCOT_RE.sub(values["mascot"], out, count=1)
    for token, find in TOKENS:
        if find is None:
            continue
        assert token in values, f"缺少令牌值: {token}"
        if find not in out:
            raise AssertionError(f"令牌行在输出中未找到(已被替换或表错误): {find[:60]}")
        out = out.replace(find, values[token])
    return out


# ---------------------------------------------------------------------------
# 内置主题色板
# ---------------------------------------------------------------------------
THEMES = {
    "aurora": dict(
        label="暗夜极光",
        coral="#8b7cf6", sun="#4cc9f0", mint="#55d8c2", slate="#3b4670",
        ink="#14162b", cream="#eef0ff",
        wall="  --dsm-reference-wall: linear-gradient(160deg, #0a0e24 0%, #1a2151 38%, #233d6b 68%, #17455c 100%);",
        mascot="  --dsm-mascot-ui: radial-gradient(circle at 35% 30%, #cfeaff, #4cc9f0 55%, #8b7cf6 100%);",
        dk_bg_base="  --dsw-alias-bg-base: rgba(12, 15, 34, .88) !important;",
        dk_bg_l1="  --dsw-alias-bg-layer-1: rgba(22, 26, 52, .93) !important;",
        dk_bg_l2="  --dsw-alias-bg-layer-2: rgba(36, 42, 74, .90) !important;",
        dk_bg_ov="  --dsw-alias-bg-overlay: rgba(16, 18, 40, .97) !important;",
        dk_b_l1="  --dsw-alias-border-l1: rgba(85, 216, 194, .22) !important;",
        dk_b_l2="  --dsw-alias-border-l2: rgba(76, 201, 240, .32) !important;",
        dk_label_p="  --dsw-alias-label-primary: #eef1ff !important;",
        dk_label_pb="  --dsw-alias-label-primary-bluish: #cfeaff !important;",
        dk_label_pd="  --dsw-alias-label-primary-dimmed: #b9c2f0 !important;",
        dk_label_s="  --dsw-alias-label-secondary: #9aa6d8 !important;",
        dk_label_t="  --dsw-alias-label-tertiary: #8593c6 !important;",
        dk_label_c="  --dsw-alias-label-caption: #7a88bb !important;",
        dk_label_ld="  --dsw-alias-label-dimmed: #6d7baa !important;",
        dk_err="  --dsw-alias-state-error-primary: #ff8a9a !important;",
        dk_sidebar="  --dsw-specific-sidebar-fill: rgba(14, 16, 36, .93) !important;",
        dk_veil="  --dsm-veil:\n    linear-gradient(90deg, rgba(10, 12, 30, 0.58), rgba(10, 12, 30, 0.42) 52%, rgba(35, 61, 107, 0.30));",
        dk_glow="  --dsm-accent-glow: rgba(139, 124, 246, 0.38);",
        lt_bg_base="  --dsw-alias-bg-base: rgba(238, 241, 255, .88) !important;",
        lt_bg_l1="  --dsw-alias-bg-layer-1: rgba(247, 249, 255, .92) !important;",
        lt_bg_l2="  --dsw-alias-bg-layer-2: rgba(224, 231, 252, .86) !important;",
        lt_bg_ov="  --dsw-alias-bg-overlay: rgba(244, 247, 255, .97) !important;",
        lt_b_l1="  --dsw-alias-border-l1: rgba(120, 140, 220, .22) !important;",
        lt_b_l2="  --dsw-alias-border-l2: rgba(139, 124, 246, .34) !important;",
        lt_brand="  --dsw-alias-brand-primary: #7a68e8 !important;",
        lt_label_p="  --dsw-alias-label-primary: #1a2040 !important;",
        lt_label_pb="  --dsw-alias-label-primary-bluish: #14425a !important;",
        lt_label_pd="  --dsw-alias-label-primary-dimmed: #3a4470 !important;",
        lt_label_s="  --dsw-alias-label-secondary: #454f80 !important;",
        lt_label_t="  --dsw-alias-label-tertiary: #565f92 !important;",
        lt_label_c="  --dsw-alias-label-caption: #4c5585 !important;",
        lt_label_ld="  --dsw-alias-label-dimmed: #5a6396 !important;",
        lt_err="  --dsw-alias-state-error-primary: #c84a7f !important;",
        lt_ok="  --dsw-alias-state-success-primary: #1f6f8b !important;",
        lt_warn="  --dsw-alias-state-warn-primary: #6a55a8 !important;",
        lt_sidebar="  --dsw-specific-sidebar-fill: rgba(238, 241, 255, .88) !important;",
        lt_veil="  --dsm-veil:\n    linear-gradient(90deg, rgba(238, 241, 255, 0.32), rgba(238, 241, 255, 0.20) 54%, rgba(222, 232, 255, 0.16));",
        lt_glow="  --dsm-accent-glow: rgba(139, 124, 246, 0.28);",
        col_ls="  background: rgba(247, 249, 255, .94) !important;",
        col_lc="  background: rgba(247, 249, 255, .78) !important;",
        col_lde="  background: rgba(244, 247, 255, .86) !important;",
        col_ds="  background: rgba(14, 16, 36, .94) !important;",
        col_dc="  background: rgba(12, 14, 32, .82) !important;",
        col_dde="  background: rgba(18, 20, 42, .86) !important;",
        read_lp="  --dsw-alias-label-primary: #20264a !important;",
        read_ls="  --dsw-alias-label-secondary: #4a5384 !important;",
        read_grad_l="  background: linear-gradient(90deg,\n    rgba(247, 249, 255, .94) 0%,\n    rgba(247, 249, 255, .88) 68%,\n    rgba(247, 249, 255, .72) 100%);",
        read_grad_d="  background: linear-gradient(90deg,\n    rgba(16, 18, 40, .92) 0%,\n    rgba(16, 18, 40, .88) 68%,\n    rgba(16, 18, 40, .80) 100%);",
        pg_mint="    radial-gradient(24% 26% at var(--dsm-pointer-x, 78%) var(--dsm-pointer-y, 18%), rgba(85, 216, 194, .16), transparent 70%),",
        pg_sun="    radial-gradient(42% 36% at 86% 14%, rgba(76, 201, 240, .14), transparent 64%),",
        pg_coral="    radial-gradient(36% 34% at 10% 90%, rgba(139, 124, 246, .14), transparent 64%);",
        # 最终级联锁 = 主题深/浅色板(覆盖 retro 段)
        lkdk_bg_base="  --dsw-alias-bg-base: rgba(12, 15, 34, .88) !important;", lkdk_bg_l1="  --dsw-alias-bg-layer-1: rgba(22, 26, 52, .93) !important;", lkdk_bg_l2="  --dsw-alias-bg-layer-2: rgba(36, 42, 74, .90) !important;", lkdk_bg_ov="  --dsw-alias-bg-overlay: rgba(16, 18, 40, .97) !important;",
        lkdk_label_p="  --dsw-alias-label-primary: #eef1ff !important;", lkdk_label_pb="  --dsw-alias-label-primary-bluish: #cfeaff !important;", lkdk_label_pd="  --dsw-alias-label-primary-dimmed: #b9c2f0 !important;",
        lkdk_label_s="  --dsw-alias-label-secondary: #9aa6d8 !important;", lkdk_label_t="  --dsw-alias-label-tertiary: #8593c6 !important;", lkdk_label_c="  --dsw-alias-label-caption: #7a88bb !important;", lkdk_label_ld="  --dsw-alias-label-dimmed: #6d7baa !important;",
        lkdk_b_l1="  --dsw-alias-border-l1: rgba(85, 216, 194, .22) !important;", lkdk_b_l2="  --dsw-alias-border-l2: rgba(76, 201, 240, .32) !important;", lkdk_sidebar="  --dsw-specific-sidebar-fill: rgba(14, 16, 36, .93) !important;",
        lklt_bg_base="  --dsw-alias-bg-base: rgba(238, 241, 255, .88) !important;", lklt_bg_l1="  --dsw-alias-bg-layer-1: rgba(247, 249, 255, .92) !important;", lklt_bg_l2="  --dsw-alias-bg-layer-2: rgba(224, 231, 252, .86) !important;", lklt_bg_ov="  --dsw-alias-bg-overlay: rgba(244, 247, 255, .97) !important;",
        lklt_sidebar="  --dsw-specific-sidebar-fill: rgba(238, 241, 255, .88) !important;",
    ),
    "paper": dict(
        label="奶油纸感",
        coral="#e07856", sun="#e8b04b", mint="#6fae9e", slate="#8a8172",
        ink="#33302a", cream="#faf6ec",
        wall="  --dsm-reference-wall: linear-gradient(165deg, #fbf7ee 0%, #f4ead8 45%, #e9ddc4 100%);",
        mascot="  --dsm-mascot-ui: radial-gradient(circle at 35% 30%, #fde8d7, #e8b04b 55%, #e07856 100%);",
        dk_bg_base="  --dsw-alias-bg-base: rgba(38, 35, 30, .88) !important;",
        dk_bg_l1="  --dsw-alias-bg-layer-1: rgba(52, 48, 42, .93) !important;",
        dk_bg_l2="  --dsw-alias-bg-layer-2: rgba(70, 64, 56, .90) !important;",
        dk_bg_ov="  --dsw-alias-bg-overlay: rgba(42, 39, 35, .97) !important;",
        dk_b_l1="  --dsw-alias-border-l1: rgba(111, 174, 158, .22) !important;",
        dk_b_l2="  --dsw-alias-border-l2: rgba(232, 176, 75, .32) !important;",
        dk_label_p="  --dsw-alias-label-primary: #f7f1e4 !important;",
        dk_label_pb="  --dsw-alias-label-primary-bluish: #dcefe8 !important;",
        dk_label_pd="  --dsw-alias-label-primary-dimmed: #e2d8c2 !important;",
        dk_label_s="  --dsw-alias-label-secondary: #c9bfa8 !important;",
        dk_label_t="  --dsw-alias-label-tertiary: #b3a98f !important;",
        dk_label_c="  --dsw-alias-label-caption: #a89e84 !important;",
        dk_label_ld="  --dsw-alias-label-dimmed: #998f76 !important;",
        dk_err="  --dsw-alias-state-error-primary: #ff8a7a !important;",
        dk_sidebar="  --dsw-specific-sidebar-fill: rgba(40, 37, 32, .93) !important;",
        dk_veil="  --dsm-veil:\n    linear-gradient(90deg, rgba(35, 32, 27, 0.58), rgba(35, 32, 27, 0.42) 52%, rgba(70, 64, 56, 0.30));",
        dk_glow="  --dsm-accent-glow: rgba(224, 120, 86, 0.35);",
        lt_bg_base="  --dsw-alias-bg-base: rgba(250, 246, 236, .88) !important;",
        lt_bg_l1="  --dsw-alias-bg-layer-1: rgba(253, 250, 242, .95) !important;",
        lt_bg_l2="  --dsw-alias-bg-layer-2: rgba(240, 230, 208, .90) !important;",
        lt_bg_ov="  --dsw-alias-bg-overlay: rgba(252, 249, 241, .97) !important;",
        lt_b_l1="  --dsw-alias-border-l1: rgba(138, 129, 114, .20) !important;",
        lt_b_l2="  --dsw-alias-border-l2: rgba(224, 120, 86, .32) !important;",
        lt_brand="  --dsw-alias-brand-primary: #d06a48 !important;",
        lt_label_p="  --dsw-alias-label-primary: #33302a !important;",
        lt_label_pb="  --dsw-alias-label-primary-bluish: #3d5a52 !important;",
        lt_label_pd="  --dsw-alias-label-primary-dimmed: #574f42 !important;",
        lt_label_s="  --dsw-alias-label-secondary: #665d4e !important;",
        lt_label_t="  --dsw-alias-label-tertiary: #786e5d !important;",
        lt_label_c="  --dsw-alias-label-caption: #6d6454 !important;",
        lt_label_ld="  --dsw-alias-label-dimmed: #7d7361 !important;",
        lt_err="  --dsw-alias-state-error-primary: #c2503f !important;",
        lt_ok="  --dsw-alias-state-success-primary: #2e8b74 !important;",
        lt_warn="  --dsw-alias-state-warn-primary: #a06a00 !important;",
        lt_sidebar="  --dsw-specific-sidebar-fill: rgba(252, 249, 241, .88) !important;",
        lt_veil="  --dsm-veil:\n    linear-gradient(90deg, rgba(250, 246, 236, 0.32), rgba(250, 246, 236, 0.20) 54%, rgba(236, 229, 214, 0.16));",
        lt_glow="  --dsm-accent-glow: rgba(224, 120, 86, 0.25);",
        col_ls="  background: rgba(253, 250, 242, .94) !important;",
        col_lc="  background: rgba(253, 250, 242, .78) !important;",
        col_lde="  background: rgba(252, 249, 241, .86) !important;",
        col_ds="  background: rgba(40, 37, 32, .94) !important;",
        col_dc="  background: rgba(38, 35, 30, .82) !important;",
        col_dde="  background: rgba(46, 43, 37, .86) !important;",
        read_lp="  --dsw-alias-label-primary: #3a362e !important;",
        read_ls="  --dsw-alias-label-secondary: #6a6152 !important;",
        read_grad_l="  background: linear-gradient(90deg,\n    rgba(253, 250, 242, .96) 0%,\n    rgba(253, 250, 242, .90) 68%,\n    rgba(253, 250, 242, .80) 100%);",
        read_grad_d="  background: linear-gradient(90deg,\n    rgba(42, 39, 35, .90) 0%,\n    rgba(42, 39, 35, .84) 68%,\n    rgba(42, 39, 35, .70) 100%);",
        pg_mint="    radial-gradient(24% 26% at var(--dsm-pointer-x, 78%) var(--dsm-pointer-y, 18%), rgba(111, 174, 158, .16), transparent 70%),",
        pg_sun="    radial-gradient(42% 36% at 86% 14%, rgba(232, 176, 75, .14), transparent 64%),",
        pg_coral="    radial-gradient(36% 34% at 10% 90%, rgba(224, 120, 86, .14), transparent 64%);",
        # 最终级联锁 = 主题深/浅色板(覆盖 retro 段)
        lkdk_bg_base="  --dsw-alias-bg-base: rgba(38, 35, 30, .88) !important;", lkdk_bg_l1="  --dsw-alias-bg-layer-1: rgba(52, 48, 42, .93) !important;", lkdk_bg_l2="  --dsw-alias-bg-layer-2: rgba(70, 64, 56, .90) !important;", lkdk_bg_ov="  --dsw-alias-bg-overlay: rgba(42, 39, 35, .97) !important;",
        lkdk_label_p="  --dsw-alias-label-primary: #f7f1e4 !important;", lkdk_label_pb="  --dsw-alias-label-primary-bluish: #dcefe8 !important;", lkdk_label_pd="  --dsw-alias-label-primary-dimmed: #e2d8c2 !important;",
        lkdk_label_s="  --dsw-alias-label-secondary: #c9bfa8 !important;", lkdk_label_t="  --dsw-alias-label-tertiary: #b3a98f !important;", lkdk_label_c="  --dsw-alias-label-caption: #a89e84 !important;", lkdk_label_ld="  --dsw-alias-label-dimmed: #998f76 !important;",
        lkdk_b_l1="  --dsw-alias-border-l1: rgba(111, 174, 158, .22) !important;", lkdk_b_l2="  --dsw-alias-border-l2: rgba(232, 176, 75, .32) !important;", lkdk_sidebar="  --dsw-specific-sidebar-fill: rgba(40, 37, 32, .93) !important;",
        lklt_bg_base="  --dsw-alias-bg-base: rgba(250, 246, 236, .88) !important;", lklt_bg_l1="  --dsw-alias-bg-layer-1: rgba(253, 250, 242, .95) !important;", lklt_bg_l2="  --dsw-alias-bg-layer-2: rgba(240, 230, 208, .90) !important;", lklt_bg_ov="  --dsw-alias-bg-overlay: rgba(252, 249, 241, .97) !important;",
        lklt_sidebar="  --dsw-specific-sidebar-fill: rgba(252, 249, 241, .88) !important;",
    ),
    "deepsea": dict(
        label="深海鲸语",
        coral="#4da3ff", sun="#ffd166", mint="#6fe3d4", slate="#2c4a63",
        ink="#0d1b2a", cream="#e8f4ff",
        wall="  --dsm-reference-wall: linear-gradient(165deg, #061224 0%, #0b2545 40%, #13406b 75%, #1b5e83 100%);",
        mascot="  --dsm-mascot-ui: radial-gradient(circle at 35% 30%, #d2f1ff, #4da3ff 55%, #13406b 100%);",
        dk_bg_base="  --dsw-alias-bg-base: rgba(6, 17, 32, .88) !important;",
        dk_bg_l1="  --dsw-alias-bg-layer-1: rgba(13, 32, 54, .93) !important;",
        dk_bg_l2="  --dsw-alias-bg-layer-2: rgba(22, 48, 76, .90) !important;",
        dk_bg_ov="  --dsw-alias-bg-overlay: rgba(9, 23, 40, .97) !important;",
        dk_b_l1="  --dsw-alias-border-l1: rgba(111, 227, 212, .22) !important;",
        dk_b_l2="  --dsw-alias-border-l2: rgba(255, 209, 102, .30) !important;",
        dk_label_p="  --dsw-alias-label-primary: #eaf6ff !important;",
        dk_label_pb="  --dsw-alias-label-primary-bluish: #d2f1ff !important;",
        dk_label_pd="  --dsw-alias-label-primary-dimmed: #c3dcee !important;",
        dk_label_s="  --dsw-alias-label-secondary: #9fc3dd !important;",
        dk_label_t="  --dsw-alias-label-tertiary: #86acc8 !important;",
        dk_label_c="  --dsw-alias-label-caption: #7ba2bd !important;",
        dk_label_ld="  --dsw-alias-label-dimmed: #6d95af !important;",
        dk_err="  --dsw-alias-state-error-primary: #ff8a9a !important;",
        dk_sidebar="  --dsw-specific-sidebar-fill: rgba(8, 21, 38, .93) !important;",
        dk_veil="  --dsm-veil:\n    linear-gradient(90deg, rgba(6, 16, 30, 0.58), rgba(6, 16, 30, 0.42) 52%, rgba(19, 64, 107, 0.30));",
        dk_glow="  --dsm-accent-glow: rgba(77, 163, 255, 0.38);",
        lt_bg_base="  --dsw-alias-bg-base: rgba(232, 244, 255, .88) !important;",
        lt_bg_l1="  --dsw-alias-bg-layer-1: rgba(244, 250, 255, .92) !important;",
        lt_bg_l2="  --dsw-alias-bg-layer-2: rgba(219, 236, 250, .86) !important;",
        lt_bg_ov="  --dsw-alias-bg-overlay: rgba(242, 249, 255, .97) !important;",
        lt_b_l1="  --dsw-alias-border-l1: rgba(44, 74, 99, .20) !important;",
        lt_b_l2="  --dsw-alias-border-l2: rgba(77, 163, 255, .32) !important;",
        lt_brand="  --dsw-alias-brand-primary: #2f8ae0 !important;",
        lt_label_p="  --dsw-alias-label-primary: #122a42 !important;",
        lt_label_pb="  --dsw-alias-label-primary-bluish: #0f4c66 !important;",
        lt_label_pd="  --dsw-alias-label-primary-dimmed: #2f4a66 !important;",
        lt_label_s="  --dsw-alias-label-secondary: #3c5570 !important;",
        lt_label_t="  --dsw-alias-label-tertiary: #4a617a !important;",
        lt_label_c="  --dsw-alias-label-caption: #425a72 !important;",
        lt_label_ld="  --dsw-alias-label-dimmed: #4e6580 !important;",
        lt_err="  --dsw-alias-state-error-primary: #cf4a3d !important;",
        lt_ok="  --dsw-alias-state-success-primary: #177e6e !important;",
        lt_warn="  --dsw-alias-state-warn-primary: #96700a !important;",
        lt_sidebar="  --dsw-specific-sidebar-fill: rgba(242, 249, 255, .88) !important;",
        lt_veil="  --dsm-veil:\n    linear-gradient(90deg, rgba(232, 244, 255, 0.32), rgba(232, 244, 255, 0.20) 54%, rgba(216, 233, 250, 0.16));",
        lt_glow="  --dsm-accent-glow: rgba(77, 163, 255, 0.28);",
        col_ls="  background: rgba(244, 250, 255, .94) !important;",
        col_lc="  background: rgba(244, 250, 255, .78) !important;",
        col_lde="  background: rgba(242, 249, 255, .86) !important;",
        col_ds="  background: rgba(8, 21, 38, .94) !important;",
        col_dc="  background: rgba(6, 15, 29, .82) !important;",
        col_dde="  background: rgba(11, 27, 48, .86) !important;",
        read_lp="  --dsw-alias-label-primary: #1c3350 !important;",
        read_ls="  --dsw-alias-label-secondary: #48617e !important;",
        read_grad_l="  background: linear-gradient(90deg,\n    rgba(244, 250, 255, .94) 0%,\n    rgba(244, 250, 255, .88) 68%,\n    rgba(244, 250, 255, .72) 100%);",
        read_grad_d="  background: linear-gradient(90deg,\n    rgba(9, 23, 40, .92) 0%,\n    rgba(9, 23, 40, .88) 68%,\n    rgba(9, 23, 40, .80) 100%);",
        pg_mint="    radial-gradient(24% 26% at var(--dsm-pointer-x, 78%) var(--dsm-pointer-y, 18%), rgba(111, 227, 212, .16), transparent 70%),",
        pg_sun="    radial-gradient(42% 36% at 86% 14%, rgba(255, 209, 102, .14), transparent 64%),",
        pg_coral="    radial-gradient(36% 34% at 10% 90%, rgba(77, 163, 255, .14), transparent 64%);",
        # 最终级联锁 = 主题深/浅色板(覆盖 retro 段)
        lkdk_bg_base="  --dsw-alias-bg-base: rgba(6, 17, 32, .88) !important;", lkdk_bg_l1="  --dsw-alias-bg-layer-1: rgba(13, 32, 54, .93) !important;", lkdk_bg_l2="  --dsw-alias-bg-layer-2: rgba(22, 48, 76, .90) !important;", lkdk_bg_ov="  --dsw-alias-bg-overlay: rgba(9, 23, 40, .97) !important;",
        lkdk_label_p="  --dsw-alias-label-primary: #eaf6ff !important;", lkdk_label_pb="  --dsw-alias-label-primary-bluish: #d2f1ff !important;", lkdk_label_pd="  --dsw-alias-label-primary-dimmed: #c3dcee !important;",
        lkdk_label_s="  --dsw-alias-label-secondary: #9fc3dd !important;", lkdk_label_t="  --dsw-alias-label-tertiary: #86acc8 !important;", lkdk_label_c="  --dsw-alias-label-caption: #7ba2bd !important;", lkdk_label_ld="  --dsw-alias-label-dimmed: #6d95af !important;",
        lkdk_b_l1="  --dsw-alias-border-l1: rgba(111, 227, 212, .22) !important;", lkdk_b_l2="  --dsw-alias-border-l2: rgba(255, 209, 102, .30) !important;", lkdk_sidebar="  --dsw-specific-sidebar-fill: rgba(8, 21, 38, .93) !important;",
        lklt_bg_base="  --dsw-alias-bg-base: rgba(232, 244, 255, .88) !important;", lklt_bg_l1="  --dsw-alias-bg-layer-1: rgba(244, 250, 255, .92) !important;", lklt_bg_l2="  --dsw-alias-bg-layer-2: rgba(219, 236, 250, .86) !important;", lklt_bg_ov="  --dsw-alias-bg-overlay: rgba(242, 249, 255, .97) !important;",
        lklt_sidebar="  --dsw-specific-sidebar-fill: rgba(242, 249, 255, .88) !important;",
    ),
}


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        sys.exit(f"找不到主题源文件: {src}")
    css = src.read_text(encoding="utf-8")

    # 1) 回代校验
    roundtrip = apply(css, {t: f for t, f in TOKENS if f} |
                      {"wall": WALL_RE.search(css).group(0),
                       "mascot": MASCOT_RE.search(css).group(0)})
    if roundtrip != css:
        import difflib
        diff = list(difflib.unified_diff(css.splitlines(), roundtrip.splitlines(), lineterm="", n=1))
        sys.exit("回代校验失败, 令牌表不完整:\n" + "\n".join(diff[:100]))
    print("[ok] 正太主题回代校验通过(逐字节一致)")

    # 2) 内置主题
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, theme in THEMES.items():
        out = apply(css, theme)
        (OUT_DIR / f"{name}.css").write_text(out, encoding="utf-8")
        print(f"[ok] 生成主题 {name} ({theme['label']}): {len(out)} bytes")

    # 3) 主题工坊模板(占位符 + 令牌表)
    tpl = css
    tpl = WALL_RE.sub("__WALL__", tpl, count=1)
    tpl = MASCOT_RE.sub("__MASCOT__", tpl, count=1)
    for token, find in TOKENS:
        if find is None:
            continue
        tpl = tpl.replace(find, "__" + token.upper() + "__")
    meta = {
        "tokens": [t for t, _ in TOKENS if _],
        "template": tpl,
        "themes": {n: {"label": v["label"]} for n, v in THEMES.items()},
    }
    meta_json = json.dumps(meta, ensure_ascii=False)
    studio_in = HERE.parent / "theme-studio.template.html"
    if studio_in.exists():
        # 占位符直接替换为 meta_json(本身已是 JSON 文本)。
        # 切勿再包一层 json.dumps —— 那样会变成带引号的 JS 字符串,
        # 导致 const THEME_META = "..." 而 THEME_META.tokens 全部为 undefined。
        studio_html = studio_in.read_text(encoding="utf-8").replace("/*__THEME_META__*/null", meta_json)
        (HERE.parent / "theme-studio.html").write_text(studio_html, encoding="utf-8")
        print(f"[ok] 生成主题工坊: {len(studio_html)} bytes")
    else:
        (HERE.parent / "theme-meta.json").write_text(meta_json, encoding="utf-8")
        print(f"[ok] 生成主题元数据(工坊模板待写入): {len(meta_json)} bytes")


if __name__ == "__main__":
    main()
