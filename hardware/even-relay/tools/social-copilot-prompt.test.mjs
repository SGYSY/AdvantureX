import assert from 'node:assert/strict'
import test from 'node:test'
import { SOCIAL_COPILOT_INSTRUCTIONS } from './social-copilot-prompt.mjs'

test('requests observable conversation signals without relationship inference', () => {
  for (const field of [
    'speech_present',
    'question_detected',
    'laughter_detected',
    'pace',
    'pause_level',
    'turn_taking',
    'topic',
    'confidence',
  ]) {
    assert.match(SOCIAL_COPILOT_INSTRUCTIONS, new RegExp(`\\b${field}\\b`))
  }
  assert.doesNotMatch(SOCIAL_COPILOT_INSTRUCTIONS, /suggestion_code/)
  assert.doesNotMatch(SOCIAL_COPILOT_INSTRUCTIONS, /comfort|tension|relationship/)
  assert.doesNotMatch(SOCIAL_COPILOT_INSTRUCTIONS, /suggestion_line_[12]/)
  assert.doesNotMatch(SOCIAL_COPILOT_INSTRUCTIONS, /\breason\b/)
})
