# SNAKE1 前端 Demo（静态原型）

纯静态 HTML 原型，演示 SNAKE1 的基础产品与 UX（对照 PRD《SNAKE1 基础产品与 UX》）。无需构建，直接用浏览器打开 `index.html` 即可。

## 打开方式

- 本地：浏览器打开 `index.html`（等同 `snake-chat.html`，Snake 对话主页）
- 线上预览：https://snakedeploy.vercel.app

## 页面清单（15 页）

| 页面 | 说明 |
|------|------|
| `snake-chat.html` | Snake 对话主页（首页）· 四大入口 + 已连接设备状态 |
| `snake-onboarding.html` | 首次引导：用一个 Moment 讲清 Snake/预案/暗号/装备四对象 |
| `snake-conversation.html` | 对话流：聊出预案 + 卷宗组装动画 |
| `snake-plan-list.html` | 预案库（tab · 预案） |
| `snake-plan-detail.html` | 救急脱身预案详情 |
| `snake-run-active.html` | 运行中（倒计时状态机，三种结局） |
| `snake-run-record.html` / `snake-run-detail.html` | 运行记录 / 单次运行复盘 |
| `snake-signal-config.html` / `snake-signal-detail.html` / `snake-signal-add.html` | 暗号 tab / 详情 / 接入向导 |
| `snake-tool-config.html` / `snake-tool-detail.html` | 装备 tab / 详情 |
| `snake-casefile-library.html` | 预案卷宗库（手动加载模板） |
| `snake-settings.html` | 账户与设置 |

## 说明

- 视觉：neo-brutalist 像素风（暖色 pastel + 粗黑描边 + 硬阴影），390×844 手机壳。
- 主链路已打通：`认识产品(onboarding) → 聊出预案 → 详情 → 运行 → 复盘`。
- `snake/snake_cut.png` 为主形象素材（透明底像素 Snake）。
