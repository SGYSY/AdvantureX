import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isInsightFresh,
  parseRelationshipState,
} from './relationship-state.mjs'

const base = {
  engagement: 0.8,
  comfort: 0.7,
  reciprocity: 0.6,
  tension: 0.2,
  opportunity: 0.9,
  confidence: 0.86,
  trend: 'stable',
  topic: '旅行',
  suggestion_code: 'ask_open_question',
}

const actionTemplates = {
  ask_open_question: '问一个开放问题',
  acknowledge_and_listen: '先回应，再认真听',
  share_briefly: '简短分享一点',
  change_topic_gently: '温和换个话题',
  give_space: '停一下，留点空间',
  end_politely: '礼貌结束对话',
}

test('maps every allowed suggestion code to fixed backend copy', () => {
  for (const [suggestionCode, actionLine] of Object.entries(actionTemplates)) {
    const state = parseRelationshipState(JSON.stringify({
      ...base,
      suggestion_code: suggestionCode,
    }), 1_000)
    assert.equal(state.trend, 'stable', suggestionCode)
    assert.deepEqual(state.suggestion, ['互动较稳定', actionLine], suggestionCode)
    assert.equal(state.expiresAt, 601_000)
    assert.equal(isInsightFresh(state, 600_999), true)
    assert.equal(isInsightFresh(state, 601_000), false)
  }
})

test('maps observable trends to fixed backend copy', () => {
  const trendTemplates = {
    warming: '互动正在升温',
    stable: '互动较稳定',
    cooling: '互动有些变淡',
    awkward: '现在有些冷场',
  }

  for (const [trend, trendLine] of Object.entries(trendTemplates)) {
    const state = parseRelationshipState(JSON.stringify({ ...base, trend }), 1_000)
    assert.deepEqual(state.suggestion, [trendLine, '问一个开放问题'], trend)
  }
})

test('ignores legacy free-text suggestion fields even when the code is valid', () => {
  const state = parseRelationshipState(JSON.stringify({
    ...base,
    suggestion_line_1: '模型写出的任意句子',
    suggestion_line_2: '另一句自由文本',
  }), 1_000)
  assert.deepEqual(state.suggestion, ['互动较稳定', '问一个开放问题'])
  assert.equal(state.suggestion.includes('模型写出的任意句子'), false)
})

test('fails closed for missing, unknown, or natural-language suggestion codes', () => {
  for (const suggestionCode of [null, undefined, 'invent_a_crisis', '拿隐私要挟她留下']) {
    const state = parseRelationshipState(JSON.stringify({
      ...base,
      suggestion_code: suggestionCode,
    }), 1_000)
    assert.equal(state.trend, 'unknown')
    assert.deepEqual(state.suggestion, [])
  }
})

test('fails closed for Object.prototype suggestion codes', () => {
  for (const suggestionCode of ['constructor', 'toString', 'valueOf', '__proto__']) {
    const state = parseRelationshipState(JSON.stringify({
      ...base,
      suggestion_code: suggestionCode,
    }), 1_000)
    assert.equal(state.trend, 'unknown', suggestionCode)
    assert.deepEqual(state.suggestion, [], suggestionCode)
  }
})

test('suppresses low-confidence or unknown-trend advice', () => {
  for (const patch of [{ confidence: 0.4 }, { trend: 'unknown' }]) {
    const state = parseRelationshipState(JSON.stringify({ ...base, ...patch }), 1_000)
    assert.equal(state.trend, 'unknown')
    assert.deepEqual(state.suggestion, [])
  }
})

test('legacy unsafe text is defense-in-depth only and never reaches output', () => {
  const unsafeLegacyText = [
    '拿隐私要挟她留下',
    '趁她醉了套话',
    'mislead her',
    'get her drunk',
    'follow her home',
  ]

  for (const line of unsafeLegacyText) {
    const state = parseRelationshipState(JSON.stringify({
      ...base,
      suggestion_line_1: line,
      suggestion_line_2: null,
    }), 1_000)
    assert.equal(state.trend, 'unknown', line)
    assert.deepEqual(state.suggestion, [], line)
    assert.equal(state.suggestion.includes(line), false)
  }
})

test('rejects out-of-range relationship scores', () => {
  assert.throws(() => parseRelationshipState(JSON.stringify({
    ...base,
    engagement: 1.2,
  }), 1_000))
})
