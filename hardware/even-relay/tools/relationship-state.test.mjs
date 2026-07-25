import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isInsightFresh,
  parseRelationshipState,
} from './relationship-state.mjs'

const valid = JSON.stringify({
  engagement: 0.8,
  comfort: 0.7,
  reciprocity: 0.6,
  tension: 0.2,
  opportunity: 0.9,
  confidence: 0.86,
  trend: 'warming',
  topic: '旅行',
  suggestion_line_1: '她对旅行有兴趣',
  suggestion_line_2: '问问最想再去的城市',
  reason: '双方围绕旅行有连续回应',
})

test('parses a safe two-line insight and assigns a ten-minute TTL', () => {
  const state = parseRelationshipState(valid, 1_000)
  assert.equal(state.trend, 'warming')
  assert.deepEqual(state.suggestion, ['她对旅行有兴趣', '问问最想再去的城市'])
  assert.equal(state.expiresAt, 601_000)
  assert.equal(isInsightFresh(state, 600_999), true)
  assert.equal(isInsightFresh(state, 601_000), false)
})

test('suppresses low-confidence advice', () => {
  const data = JSON.parse(valid)
  data.confidence = 0.4
  const state = parseRelationshipState(JSON.stringify(data), 1_000)
  assert.equal(state.trend, 'unknown')
  assert.deepEqual(state.suggestion, [])
})

test('rejects out-of-range values and overlong lines', () => {
  const data = JSON.parse(valid)
  data.engagement = 1.2
  assert.throws(() => parseRelationshipState(JSON.stringify(data), 1_000))
  data.engagement = 0.8
  data.suggestion_line_1 = '这是一条超过眼镜显示安全长度的建议文本内容'
  assert.throws(() => parseRelationshipState(JSON.stringify(data), 1_000))
})

test('fails closed on explicit manipulation, deception, coercion, drugging, or stalking patterns', () => {
  const unsafePatterns = [
    '操控她的情绪',
    '骗他说这是紧急情况',
    '谎称家里出事让她离开',
    '用虚假紧急事件让她离开',
    '假装出了事故让她走',
    '虚构朋友生病让她离开',
    '威胁对方必须答应',
    '继续施压直到同意',
    '偷偷在饮料里下药',
    '灌醉她再说服她',
    '离开后继续跟踪她',
    'manipulate them into agreeing',
    'lie to her about an accident',
    'create a fake emergency',
    'threaten and coerce them',
    'blackmail them into staying',
    'intoxicate her before asking',
    'spike their drink',
    'stalk them after they leave',
  ]

  for (const line of unsafePatterns) {
    const data = JSON.parse(valid)
    data.suggestion_line_1 = line
    data.suggestion_line_2 = null
    const state = parseRelationshipState(JSON.stringify(data), 1_000)
    assert.equal(state.trend, 'unknown', line)
    assert.deepEqual(state.suggestion, [], line)
    assert.ok(state.confidence < 0.65, line)
  }
})
