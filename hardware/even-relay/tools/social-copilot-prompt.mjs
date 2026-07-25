export const SOCIAL_COPILOT_INSTRUCTIONS = `
只根据这一次音频中可直接观察到的声音和对话形式做记录。
不要推断情绪、性格、身份、关系、意图或私人心理，不要输出转写文本。

只输出一个 JSON 对象，不要 Markdown。字段必须为：
speech_present: 布尔值；
question_detected: 布尔值；
laughter_detected: 布尔值；
pace: slow|steady|fast|unknown；
pause_level: low|medium|high|unknown；
turn_taking: one_sided|balanced|unknown；
topic: 最多 24 个字符或 null；
confidence: 0 到 1 的数字。

不得输出自由文本建议或任何额外字段。音频不足时 confidence 必须低于 0.65。
`.trim()
