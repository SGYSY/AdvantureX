# Even R1 Relay — HTTP API Specification

> **Event schema version:** `even-r1-relay/v1`。社交副驾驶使用本文件定义的会话端点与 JSON 音频段请求体。
> **Last updated:** 2026-07-23

---

## 1. Overview

Even R1 Relay 是一个 HTTP 事件转发系统，将 Even G2 眼镜和 R1 戒指的输入事件通过 POST 请求转发到任意硬件或服务端。

**数据流向：**

```
R1 戒指 / G2 眼镜
      ↓ (BLE)
Even App (iOS/Android)
      ↓ (WebView bridge)
手机 Web 页面 (Vite dev server)
      ↓ (HTTP POST)
Mac Relay Server (:8788)
      ↓ (HTTP POST, optional)
目标硬件 / 微控制器 / 服务端
```

---

## 2. Endpoint

### 2.1 Relay Server (Mac 侧)

| 属性 | 值 |
|------|-----|
| **URL** | `http://<mac-ip>:8788/even` |
| **Method** | `POST` |
| **Content-Type** | `application/json` |
| **CORS** | `Access-Control-Allow-Origin: *` |

### 2.2 社交副驾驶 (Relay 侧实时分析)

```text
POST /social/session/start
POST /social/session/{id}/chunk
POST /social/session/{id}/finish
POST /social/session/{id}/cancel

PCM format: signed 16-bit little-endian, mono, 16 kHz.
Maximum active capture: 15 seconds.
Finish grace after capture deadline: 2 seconds.
Maximum chunk: 64,000 decoded bytes.
Maximum session: 640,000 decoded bytes.
Maximum concurrent sessions for the single configured token: 2.
Raw PCM is discarded after finish, expiry, or failure.
```

`start` 创建一次短暂的分析会话并安排准备期过期 timer；首个有效 `chunk` 将 timer 重置为严格 15 秒采集窗口加 2 秒收尾宽限，`chunk` 接收按顺序编号的 Base64 PCM 数据；采集截止后不再接受音频，`finish` 可在宽限内结束并返回分析结果；`cancel` 幂等取消。即使客户端断线且不再请求，timer 也会主动关闭 Provider 并删除会话。最近建议只保存在 Even 客户端内存中。会话失败、过期或任一音频校验失败时，Relay 会立即关闭 Provider 并丢弃已缓存的原始 PCM。

`RELAY_ACCESS_TOKEN` 代表这个 Relay 的单一用户/owner；所有会话端点与 `/even` 都要求完全相同的 Bearer token。Relay 同时最多保留 2 个会话，并继续执行请求体、单段 PCM 和累计 PCM 上限。

---

## 3. Request

### 3.1 HTTP Headers

```
POST /even HTTP/1.1
Host: <relay-or-hardware-ip>:8788
Content-Type: application/json
Authorization: Bearer <RELAY_ACCESS_TOKEN>
```

### 3.2 Payload Schema

```jsonc
{
  "schema": "even-r1-relay/v1",     // 协议版本标识，固定值
  "context": {                       // 设备和应用上下文
    "app": {
      "url": string,                 // 当前页面 URL
      "userAgent": string,           // WebView User-Agent
      "launchSource": "appMenu" | "glassesMenu" | null
    },
    "device": DeviceInfo | null,     // 设备信息（见 §4.1）
    "status": DeviceStatus | null,   // 设备状态（见 §4.2）
    "location": AppLocation | null,  // GPS 位置（见 §4.3）
    "recentGestures": GestureToken[] // 最近 8 条手势记录（见 §4.4）
  },
  "event": NormalizedEvent,          // 当前事件（见 §5）
  "action": RecognizedAction | null  // 识别到的组合动作（见 §6）
}
```

---

## 4. Context Types

### 4.1 DeviceInfo

```jsonc
{
  "model": "g2" | "g1" | "ring",    // 设备型号
  "sn": string,                      // 序列号
  "status": DeviceStatus | null      // 嵌套状态
}
```

### 4.2 DeviceStatus

```jsonc
{
  "sn": string,                      // 序列号
  "batteryLevel": number,            // 电量 0-100
  "connectType": number              // 连接类型枚举
}
```

### 4.3 AppLocation

```jsonc
{
  "latitude": number,
  "longitude": number,
  "altitude": number,
  "accuracy": number,
  "timestamp": string                // ISO 8601
}
```

> 仅当用户点击 Location 按钮后才有值，否则为 `null`。

### 4.4 GestureToken

```jsonc
{
  "at": string,                      // ISO 8601 时间戳
  "source": SourceKind,              // 见 §5.2
  "name": string,                    // 事件标签：click / double_click / swipe_up / swipe_down
  "label": string                    // 完整标签：ring.click / glasses_right.swipe_up 等
}
```

---

## 5. NormalizedEvent

```jsonc
{
  "id": number,                      // 自增事件 ID
  "receivedAt": string,              // ISO 8601 接收时间
  "envelope": EventEnvelope,         // 见 §5.1
  "gesture": string,                 // 可读手势标签，如 "ring.click"
  "source": {                        // 事件来源
    "code": number | undefined,      // SDK 枚举值
    "label": string,                 // 来源名称
    "kind": SourceKind               // 见 §5.2
  },
  "eventType": {                     // 事件类型
    "code": number | undefined,      // SDK 枚举值
    "label": string                  // 类型标签，见 §5.3
  },
  "container": {                     // 可选：触发事件的 UI 容器
    "id": number | undefined,
    "name": string | undefined
  } | undefined,
  "selected": {                      // 可选：列表选中项
    "index": number | undefined,
    "name": string | undefined
  } | undefined,
  "imu": {                           // 可选：IMU 数据
    "x": number | undefined,
    "y": number | undefined,
    "z": number | undefined
  } | undefined,
  "audio": {                         // 可选：音频帧
    "source": string,                // "glasses" | "phone"
    "byteLength": number             // PCM 数据字节数
  } | undefined,
  "raw": object | undefined          // 可选：原始 JSON（includeRaw=true 时包含）
}
```

### 5.1 EventEnvelope

| 值 | 含义 |
|----|------|
| `sysEvent` | 系统事件（点击、滑动、IMU、前后台切换） |
| `textEvent` | 文本容器事件 |
| `listEvent` | 列表容器事件 |
| `audioEvent` | 音频帧事件 |
| `unknown` | 未识别（仍保留 raw 数据） |

### 5.2 SourceKind

| 值 | 含义 | 物理设备 |
|----|------|----------|
| `ring` | R1 戒指输入 | Even R1 |
| `glasses_right` | G2 右侧镜腿触控 | Even G2 |
| `glasses_left` | G2 左侧镜腿触控 | Even G2 |
| `unknown` | 未知来源 | — |

### 5.3 eventType.label

| label | 含义 | 典型来源 |
|-------|------|----------|
| `click` | 单击 | ring / glasses |
| `double_click` | 双击 | ring / glasses |
| `swipe_up` | 上滑 | ring / glasses |
| `swipe_down` | 下滑 | ring / glasses |
| `imu` | IMU 数据上报 | ring |
| `foreground_enter` | 进入前台 | system |
| `foreground_exit` | 退出前台 | system |
| `abnormal_exit` | 异常退出 | system |
| `system_exit` | 系统退出 | system |
| `unknown` | 未识别 | — |

### 5.4 gesture 命名规则

格式：`{source.kind}.{eventType.label}`

示例：
- `ring.click` — R1 戒指单击
- `ring.swipe_up` — R1 戒指上滑
- `glasses_right.double_click` — G2 右镜腿双击
- `glasses_left.click` — G2 左镜腿单击
- `ring.imu` — R1 IMU 数据
- `audio.frame` — 音频帧（固定）

---

## 6. RecognizedAction

基于 2.5 秒窗口内的手势序列识别出的组合动作。

```jsonc
{
  "name": string,       // 动作名称
  "confidence": number  // 置信度 0.0-1.0
}
```

| name | 手势序列 | confidence | 含义 |
|------|----------|------------|------|
| `ring_confirm_up` | swipe_up → click | 0.95 | 上滑确认 |
| `ring_confirm_down` | swipe_down → click | 0.95 | 下滑确认 |
| `ring_debug_context` | double_click → swipe_up | 0.85 | 调试上下文 |
| `ring_select` | click | 0.80 | 选择/确认 |
| `ring_cancel_or_shortcut` | double_click | 0.80 | 取消/快捷操作 |
| `ring_previous` | swipe_up | 0.75 | 上一个 |
| `ring_next` | swipe_down | 0.75 | 下一个 |
| `snake1_rescue` | click → double_click → click | 1 | P0 救场 |

> 当序列不匹配任何组合时，`action` 为 `null`。

---

## 6.5 社交副驾驶音频 Schema

Even Hub SDK 提供原始 PCM（`audioEvent.audioPcm`，`Uint8Array`），而非可保存的转写文本。客户端把数据作为短时、单次会话送往 Relay 的实时分析接口；首个有效音频段开始后，每个会话最多活跃 15 秒。

### 6.5.1 创建会话 → `POST /social/session/start`

响应携带 Relay 分配的 `id`，后续的音频段必须发送给这个 ID。

### 6.5.2 上传音频段 → `POST /social/session/{id}/chunk`

```jsonc
{
  "seq": 0,                 // 从 0 开始、严格递增
  "pcmBase64": "..."       // PCM S16LE、mono、16 kHz；解码后最多 64,000 字节
}
```

单个会话累计解码数据最多 640,000 字节。Relay 不将 PCM 写入磁盘，并会在 `finish`、会话过期或任意失败后清除内存中的原始数据。

Provider 的结构化结果只使用分数、`trend`、内部 `topic` 与
`suggestion_code`。允许的 code 为：

```text
ask_open_question
acknowledge_and_listen
share_briefly
change_topic_gently
give_space
end_politely
```

模型不提供可显示的建议文案。Relay 只把合法 code 和
`warming|stable|cooling|awkward` 映射为固定中文两行模板。未知或缺失
code、`unknown` trend、低于 `0.65` 的置信度均 fail closed 为
`trend: "unknown"`、`suggestion: []`。旧自由文本字段只参与
defense-in-depth 检查，绝不会进入公开响应的 `suggestion` 或 G2 显示。

### 6.5.3 完成会话 → `POST /social/session/{id}/finish`

结束采集、请求实时模型分析，并返回最新 insight。首个 PCM 后 15 秒是严格音频上传截止线，`finish` 额外允许 2 秒无音频收尾；超过宽限会话会被关闭并删除。若音频不足，Provider 返回 `suggestion_code: null`；Provider 不可用时 Relay 返回受控的 `422` 错误。公开响应中不包含凭证、原始 PCM 或内部 `reason` 诊断，G2 只消费 Relay 固定模板生成的 `suggestion`。

### 6.5.4 取消会话 → `POST /social/session/{id}/cancel`

幂等关闭并删除未完成会话。下滑读取 Even 客户端内存中的 `latestInsight`，不会发起公网读取请求。

---

## 7. Response (Relay Server)

### 7.1 成功

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"ok": true, "forwarded": false}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `ok` | boolean | 请求处理成功 |
| `forwarded` | boolean | 是否已转发到 `FORWARD_URL` |

### 7.2 错误

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json; charset=utf-8

{"ok": false, "error": "FORWARD_URL returned HTTP 502"}
```

## 8. Full Example

### 8.1 R1 单击事件

```json
{
  "schema": "even-r1-relay/v1",
  "context": {
    "app": {
      "url": "http://192.168.1.10:5173/",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ...",
      "launchSource": "glassesMenu"
    },
    "device": {
      "model": "g2",
      "sn": "EVR-G2-XXXX",
      "status": { "sn": "EVR-G2-XXXX", "batteryLevel": 82 }
    },
    "status": { "sn": "EVR-G2-XXXX", "batteryLevel": 82 },
    "location": null,
    "recentGestures": [
      { "at": "2026-07-23T10:30:01.123Z", "source": "ring", "name": "click", "label": "ring.click" }
    ]
  },
  "event": {
    "id": 12,
    "receivedAt": "2026-07-23T10:30:01.123Z",
    "envelope": "sysEvent",
    "gesture": "ring.click",
    "source": { "code": 2, "label": "ring", "kind": "ring" },
    "eventType": { "code": 0, "label": "click" },
    "container": { "id": 1, "name": "relay-main" },
    "selected": null,
    "imu": null,
    "audio": null
  },
  "action": { "name": "ring_select", "confidence": 0.8 }
}
```

### 8.2 R1 上滑 + 单击组合

```json
{
  "schema": "even-r1-relay/v1",
  "context": { "..." : "..." },
  "event": {
    "id": 15,
    "receivedAt": "2026-07-23T10:30:05.456Z",
    "envelope": "sysEvent",
    "gesture": "ring.click",
    "source": { "code": 2, "label": "ring", "kind": "ring" },
    "eventType": { "code": 0, "label": "click" }
  },
  "action": { "name": "ring_confirm_up", "confidence": 0.95 }
}
```

### 8.3 G2 镜腿双击 + IMU

```json
{
  "schema": "even-r1-relay/v1",
  "context": { "..." : "..." },
  "event": {
    "id": 20,
    "receivedAt": "2026-07-23T10:31:00.789Z",
    "envelope": "sysEvent",
    "gesture": "glasses_right.double_click",
    "source": { "code": 1, "label": "glasses_right", "kind": "glasses_right" },
    "eventType": { "code": 3, "label": "double_click" },
    "imu": { "x": 0.12, "y": -0.34, "z": 9.78 }
  },
  "action": { "name": "ring_cancel_or_shortcut", "confidence": 0.8 }
}
```

---

## 9. Hardware Integration Guide

### 9.1 ESP32 / Arduino（作为 Relay 的 `FORWARD_URL`）

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "your-wifi";
const char* password = "your-password";
const int port = 80;

WiFiServer server(port);

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.println(WiFi.localIP());
  server.begin();
}

void loop() {
  WiFiClient client = server.available();
  if (!client) return;

  // 读取 POST body
  String body = "";
  while (client.available()) body += (char)client.read();

  // 解析 JSON
  StaticJsonDocument<2048> doc;
  deserializeJson(doc, body);

  const char* gesture = doc["event"]["gesture"];
  const char* action  = doc["action"]["name"];

  Serial.printf("gesture=%s action=%s\n", gesture, action);

  // 根据 action 控制硬件
  if (action && strcmp(action, "ring_select") == 0) {
    // 执行选择操作
  } else if (action && strcmp(action, "ring_next") == 0) {
    // 下一个
  }

  // Relay 要求目标明确返回 2xx
  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: application/json");
  client.println();
  client.println("{\"ok\":true}");
  client.stop();
}
```

### 9.2 Python (通过 Relay 转发)

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/even', methods=['POST'])
def handle_even_event():
    payload = request.json
    event = payload.get('event', {})
    action = payload.get('action')

    gesture = event.get('gesture', 'unknown')
    action_name = action['name'] if action else 'none'

    print(f"gesture={gesture} action={action_name}")

    # 根据 action 执行硬件控制
    if action_name == 'ring_select':
        print(">> 执行选择")
    elif action_name == 'ring_next':
        print(">> 下一个")
    elif action_name == 'ring_previous':
        print(">> 上一个")
    elif action_name == 'ring_confirm_up':
        print(">> 确认")

    return jsonify(ok=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
```

启动 relay 并指定转发地址：

```bash
FORWARD_URL=http://<python-server-ip>:8080/even npm run relay
```

### 9.3 Raspberry Pi / Node.js

```javascript
import http from 'node:http'

http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    const { event, action } = JSON.parse(body)

    console.log(`${event.gesture} → ${action?.name ?? 'none'}`)

    // GPIO 控制
    if (action?.name === 'ring_select') {
      // gpio.write(pin, HIGH)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
}).listen(8080, '0.0.0.0')
```

---

## 10. Relay Server 配置

| 环境变量 | 默认值 | 含义 |
|----------|--------|------|
| `PORT` | `8788` | Relay 监听端口 |
| `FORWARD_URL` | *(空)* | 二级事件转发目标 URL；留空则仅接收 |
| `RELAY_ACCESS_TOKEN` | *(空，服务不可用)* | `/even` 与 `/social/*` 的单用户 Bearer token |
| `WINGMAN_SHARED_SECRET` | *(空)* | Relay 转发到 Wingman 时使用的 `X-Wingman-Secret` |
| `STEPFUN_API_KEY` | *(空)* | StepFun 实时分析凭证；只保存在本地忽略的 `.env` |
| `STEPFUN_MODEL` | `stepaudio-2.5-realtime` | StepFun 实时模型 |
| `STEPFUN_REALTIME_URL` | `wss://api.stepfun.com/step_plan/v1/realtime` | StepFun 实时 WebSocket 地址 |
| `MAX_BODY_BYTES` | `4194304` | HTTP 请求体最大字节数 |

```bash
# 仅接收，不转发（先在 .env 配置本地 token）
npm run relay

# 接收并转发到硬件
FORWARD_URL=http://192.168.1.50:8080/even npm run relay

# 自定义端口
PORT=9000 npm run relay
```

---

## 11. Error Handling

| 场景 | HTTP Status | Response Body |
|------|-------------|---------------|
| 正常接收 | 200 | `{"ok": true, "forwarded": false}` |
| 正常接收 + 已转发 | 200 | `{"ok": true, "forwarded": true}` |
| Relay token 未配置 | 503 | `{"ok": false, "error": "Relay access token is not configured"}` |
| Bearer token 缺失或错误 | 401 | `{"ok": false, "error": "Unauthorized"}` |
| 非法路径或方法 | 404 | `{"ok": false, "error": "..."}` |
| 社交副驾驶未配置 | 503 | `{"ok": false, "error": "Social copilot unavailable"}` |
| PCM 过大、无效会话或 Provider/音频错误 | 422 | `{"ok": false, "error": "<message>"}` |
| FORWARD_URL 不可达 | 500 | `{"ok": false, "error": "FORWARD_URL returned HTTP <code>"}` |
| 请求体超限 | 422 | `{"ok": false, "error": "Request body exceeded <bytes> bytes"}` |

---

## 12. CORS Headers

Relay server 所有响应均包含：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

`OPTIONS` 预检请求返回 `204 No Content`。

---

## 13. Quick Reference Card

```
┌─────────────────────────────────────────────────────┐
│  Endpoint:  POST /even                              │
│  Content-Type: application/json                     │
│  Authorization: Bearer <local token>                 │
│                                                     │
│  Key Fields:                                        │
│    event.gesture    → "ring.click"                  │
│    event.source.kind → "ring" | "glasses_right"     │
│    event.eventType.label → "click" | "swipe_up"     │
│    action.name      → "ring_select" | "ring_next"   │
│    action.confidence → 0.0 ~ 1.0                   │
│                                                     │
│  Response:  {"ok": true, "forwarded": false}        │
└─────────────────────────────────────────────────────┘
```
