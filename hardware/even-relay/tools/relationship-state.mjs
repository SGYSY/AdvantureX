const TRENDS = new Set(['warming', 'stable', 'cooling', 'awkward', 'unknown'])
const SCORE_KEYS = [
  'engagement',
  'comfort',
  'reciprocity',
  'tension',
  'opportunity',
  'confidence',
]
const TREND_TEMPLATES = new Map([
  ['warming', '互动正在升温'],
  ['stable', '互动较稳定'],
  ['cooling', '互动有些变淡'],
  ['awkward', '现在有些冷场'],
])
export const SUGGESTION_TEMPLATES = new Map([
  ['ask_open_question', '问一个开放问题'],
  ['acknowledge_and_listen', '先回应，再认真听'],
  ['share_briefly', '简短分享一点'],
  ['change_topic_gently', '温和换个话题'],
  ['give_space', '停一下，留点空间'],
  ['end_politely', '礼貌结束对话'],
])

// Defense in depth for legacy or non-conforming provider fields. The primary
// boundary is the suggestion-code allowlist above; model text is never rendered.
const UNSAFE_PATTERN = /操控|控制(?:他|她|对方).*?(?:情绪|决定|选择)|欺骗|骗(?:他|她|对方)|撒谎|说谎|谎称|虚假紧急|假装|编造|虚构|威胁|恐吓|要挟|施压|强迫|逼迫|下药|迷药|灌醉|灌酒|醉了|套话|跟踪|尾随|manipulat(?:e|ion)|mislead|deceiv(?:e|ing)|deception|\blie\b|\blying\b|fake\s+emergency|fabricat(?:e|ed).{0,20}emergency|threaten|blackmail|coerc(?:e|ion)|pressur(?:e|ing)|force\s+(?:him|her|them)|spike.{0,20}drink|drug\s+(?:him|her|them)|get\s+(?:him|her|them)\s+drunk|intoxicat(?:e|ed|ing|ion)|stalk(?:ing)?|follow\s+(?:him|her|them)\s+home/iu

export function parseRelationshipState(text, observedAt = Date.now()) {
  const match = String(text).match(/\{[\s\S]*\}/)
  if (!match) throw new Error('StepFun response did not contain JSON')
  const value = JSON.parse(match[0])
  if (Object.hasOwn(value, 'speech_present')) {
    return deriveStateFromObservableSignals(value, observedAt)
  }

  for (const key of SCORE_KEYS) {
    if (typeof value[key] !== 'number' || value[key] < 0 || value[key] > 1) {
      throw new Error(`Invalid relationship score: ${key}`)
    }
  }
  if (!TRENDS.has(value.trend)) throw new Error('Invalid relationship trend')

  const safetyText = [
    value.topic,
    value.suggestion_line_1,
    value.suggestion_line_2,
    value.reason,
  ].filter(item => typeof item === 'string').join('\n')
  const unsafe = UNSAFE_PATTERN.test(safetyText)
  const actionTemplate = SUGGESTION_TEMPLATES.get(value.suggestion_code)
  const trendTemplate = TREND_TEMPLATES.get(value.trend)
  const confidence = unsafe ? 0 : value.confidence
  const confident = confidence >= 0.65 && Boolean(actionTemplate && trendTemplate)
  return {
    engagement: value.engagement,
    comfort: value.comfort,
    reciprocity: value.reciprocity,
    tension: value.tension,
    opportunity: value.opportunity,
    confidence,
    trend: confident ? value.trend : 'unknown',
    topic: typeof value.topic === 'string' ? value.topic.slice(0, 24) : null,
    suggestionCode: confident ? value.suggestion_code : null,
    suggestion: confident ? [trendTemplate, actionTemplate] : [],
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 160) : '',
    observedAt,
    expiresAt: observedAt + 10 * 60 * 1000,
  }
}

function deriveStateFromObservableSignals(value, observedAt) {
  if (typeof value.speech_present !== 'boolean') throw new Error('Invalid speech_present')
  if (typeof value.question_detected !== 'boolean') throw new Error('Invalid question_detected')
  if (typeof value.laughter_detected !== 'boolean') throw new Error('Invalid laughter_detected')
  if (!['slow', 'steady', 'fast', 'unknown'].includes(value.pace)) throw new Error('Invalid pace')
  if (!['low', 'medium', 'high', 'unknown'].includes(value.pause_level)) throw new Error('Invalid pause_level')
  if (!['one_sided', 'balanced', 'unknown'].includes(value.turn_taking)) throw new Error('Invalid turn_taking')
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) {
    throw new Error('Invalid observable confidence')
  }

  const tension = {
    low: 0.2,
    medium: 0.4,
    high: 0.75,
    unknown: 0.5,
  }[value.pause_level]
  const reciprocity = {
    one_sided: 0.35,
    balanced: 0.8,
    unknown: 0.5,
  }[value.turn_taking]
  const engagement = value.speech_present
    ? value.question_detected ? 0.8 : value.laughter_detected ? 0.75 : 0.6
    : 0
  const opportunity = value.question_detected ? 0.85 : value.pause_level === 'high' ? 0.35 : 0.65
  const safetyText = typeof value.topic === 'string' ? value.topic : ''
  const confident = value.speech_present && value.confidence >= 0.65 && !UNSAFE_PATTERN.test(safetyText)

  let trend = 'unknown'
  let suggestionCode = null
  if (confident && value.pause_level === 'high') {
    trend = 'awkward'
    suggestionCode = 'change_topic_gently'
  } else if (confident && (value.question_detected || value.laughter_detected)) {
    trend = 'warming'
    suggestionCode = 'acknowledge_and_listen'
  } else if (confident && value.turn_taking === 'one_sided') {
    trend = 'cooling'
    suggestionCode = 'give_space'
  } else if (confident) {
    trend = 'stable'
    suggestionCode = 'ask_open_question'
  }

  const actionTemplate = SUGGESTION_TEMPLATES.get(suggestionCode)
  const trendTemplate = TREND_TEMPLATES.get(trend)
  return {
    engagement,
    comfort: 1 - tension,
    reciprocity,
    tension,
    opportunity,
    confidence: confident ? value.confidence : Math.min(value.confidence, 0.64),
    trend,
    topic: typeof value.topic === 'string' ? value.topic.slice(0, 24) : null,
    suggestionCode,
    suggestion: actionTemplate && trendTemplate ? [trendTemplate, actionTemplate] : [],
    reason: '',
    observedAt,
    expiresAt: observedAt + 10 * 60 * 1000,
  }
}

export function isInsightFresh(state, nowMs = Date.now()) {
  return Boolean(state && state.suggestion.length > 0 && nowMs < state.expiresAt)
}
