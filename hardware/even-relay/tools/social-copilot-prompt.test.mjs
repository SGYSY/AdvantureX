import assert from 'node:assert/strict'
import test from 'node:test'
import { SOCIAL_COPILOT_INSTRUCTIONS } from './social-copilot-prompt.mjs'

test('requests only an allowlisted suggestion code, never free-text advice', () => {
  for (const code of [
    'ask_open_question',
    'acknowledge_and_listen',
    'share_briefly',
    'change_topic_gently',
    'give_space',
    'end_politely',
  ]) {
    assert.match(SOCIAL_COPILOT_INSTRUCTIONS, new RegExp(`\\b${code}\\b`))
  }
  assert.match(SOCIAL_COPILOT_INSTRUCTIONS, /suggestion_code/)
  assert.doesNotMatch(SOCIAL_COPILOT_INSTRUCTIONS, /suggestion_line_[12]/)
  assert.doesNotMatch(SOCIAL_COPILOT_INSTRUCTIONS, /\breason\b/)
})
