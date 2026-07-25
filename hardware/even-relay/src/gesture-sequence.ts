export type RescueGesture = 'click' | 'double_click'
export type RescueAction = 'snake1_rescue'

const EXPECTED: RescueGesture[] = ['click', 'double_click', 'click']

export class RescueSequenceRecognizer {
  private tokens: Array<{ gesture: RescueGesture; at: number }> = []
  private cooldownUntil = 0

  push(gesture: RescueGesture, nowMs: number): RescueAction | null {
    if (nowMs < this.cooldownUntil) return null

    const first = this.tokens[0]
    const previous = this.tokens.at(-1)
    if (
      (first && nowMs - first.at > 4000) ||
      (previous && nowMs - previous.at > 1600)
    ) {
      this.tokens = []
    }

    const expected = EXPECTED[this.tokens.length]
    if (gesture !== expected) {
      this.tokens = gesture === 'click' ? [{ gesture, at: nowMs }] : []
      return null
    }

    this.tokens.push({ gesture, at: nowMs })
    if (this.tokens.length !== EXPECTED.length) return null

    this.tokens = []
    this.cooldownUntil = nowMs + 8000
    return 'snake1_rescue'
  }
}
