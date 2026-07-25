# Even G2 / R1 relay starter

Vite + TypeScript + Even Hub SDK starter for logging G2/R1 input events and forwarding them to other hardware.

## SNAKE ONE 手势

上滑：开始/提前结束 15 秒分析
下滑：显示最新建议
单点 → 双点 → 单点：触发 P0 救场

社交副驾驶使用 Relay 的 `/social/session/*` 接口；音频为 16 kHz、单声道、signed 16-bit little-endian PCM。首个 PCM 段开启严格 15 秒上传窗口，`finish` 另有 2 秒无音频收尾宽限。Relay 为准备期和采集期主动安排过期 timer，即使客户端断线且不再请求，也会关闭 Provider 并删除会话。原始 PCM 只在活动会话内短暂保留，完成、过期或失败即丢弃。

## Run

```bash
npm install
npm run dev
```

Then either:
- **Simulator:** `npm run simulate`
- **Real glasses:** `./node_modules/.bin/evenhub qr --url http://<your-ip>:5173` and scan with the Even Hub companion app.

## Relay to Hardware

首次运行先创建本地配置，并分别填写三个不相同的随机值/凭证：

```bash
cp .env.example .env
# STEPFUN_API_KEY=<本地 StepFun 凭证>
# RELAY_ACCESS_TOKEN=<本地生成的随机访问令牌>
# WINGMAN_SHARED_SECRET=<与 Wingman 相同的本地随机 secret>
```

`RELAY_ACCESS_TOKEN` 为空时 `/even` 和所有 `/social/*` 都返回 `503`。手机端所有请求必须携带这个 token；`WINGMAN_SHARED_SECRET` 只用于 Relay 到本机 Wingman 的第二跳，不输入手机。

Run the Mac relay server:

```bash
npm run relay
```

The relay script requires `even/.env` and exits instead of silently starting
without it. Copy `.env.example` first, then fill only local values.

Relay 默认监听 `8788`。安装 `.ehpk` 后，在手机控制台输入当前 Relay URL 和本地 `RELAY_ACCESS_TOKEN`，再启用转发。新安装默认地址、token 都为空且转发关闭：

```text
http://<your-mac-ip>:8788/even
```

公网演示可将 `127.0.0.1:8788` 暴露为临时 Quick Tunnel，然后把它当次生成的 HTTPS URL 加 `/even` 填入手机。Quick Tunnel 不是固定部署；每次重启 tunnel 都要在手机端更新 endpoint。不要把临时 URL 或 token 固化进源码、构建产物或文档。

The relay accepts:

```http
POST /even
Content-Type: application/json
Authorization: Bearer <RELAY_ACCESS_TOKEN>
```

Payload shape:

```json
{
  "schema": "even-r1-relay/v1",
  "context": {
    "app": { "url": "http://30.201.217.2:5173/", "launchSource": "glassesMenu" },
    "device": { "model": "g2", "sn": "..." },
    "status": { "batteryLevel": 80 },
    "location": null,
    "recentGestures": []
  },
  "event": {
    "gesture": "ring.click",
    "source": { "label": "ring", "kind": "ring" },
    "eventType": { "code": 0, "label": "click" }
  },
  "action": { "name": "ring_select", "confidence": 0.8 }
}
```

To have the Mac relay forward events to another device:

```bash
FORWARD_URL=http://127.0.0.1:8000/api/v1/hardware/even npm run relay
```

Relay 转发到 Wingman 时会发送 `X-Wingman-Secret`。Wingman 必须配置同一个非空 `WINGMAN_SHARED_SECRET`，并且只接受来自 loopback 的请求。

社交会话路由为 `start`、`chunk`、`finish`、`cancel`。最近建议只保存在 Even 客户端内存中，下滑只读取本地结果，不存在公网读取最新建议的接口。

StepFun 只选择一个安全 `suggestion_code`，不会生成可显示的建议文本。
Relay 仅接受
`ask_open_question`、`acknowledge_and_listen`、`share_briefly`、
`change_topic_gently`、`give_space`、`end_politely`，并把合法 code 与
trend 映射成后端固定中文模板。未知/缺失 code、低置信度或不安全旧字段
一律返回 `trend: unknown` 和空建议；G2 不渲染模型的 topic、reason 或旧自由文本字段。

## Pack for distribution

```bash
npm run build
npm run pack
```

Produces an `.ehpk` file.

## What's in here

| File | Purpose |
|---|---|
| `index.html` | WebView host. Viewport meta tag locks zoom; CSS kills iOS double-tap zoom + rubber-band scroll. |
| `src/main.ts` | R1/G2 event logger, gesture recognizer, context collector, and webhook forwarder. |
| `tools/relay-server.mjs` | Local CORS relay for forwarding phone events to hardware. |
| `app.json` | Even Hub manifest. No permissions by default. |
| `tsconfig.json` | Standard Vite vanilla-ts config. |
| `vite.config.ts` | Dev server on port 5173, host binding for LAN QR access. |
