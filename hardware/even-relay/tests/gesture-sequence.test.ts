import { describe, expect, it } from 'vitest'
import { RescueSequenceRecognizer } from '../src/gesture-sequence'

describe('RescueSequenceRecognizer', () => {
  it('recognizes click, double-click, click within the timing window', () => {
    const recognizer = new RescueSequenceRecognizer()
    expect(recognizer.push('click', 0)).toBeNull()
    expect(recognizer.push('double_click', 800)).toBeNull()
    expect(recognizer.push('click', 1500)).toBe('snake1_rescue')
  })

  it('rejects a raw double-click and wrong-order sequences', () => {
    const recognizer = new RescueSequenceRecognizer()
    expect(recognizer.push('double_click', 0)).toBeNull()
    expect(recognizer.push('click', 500)).toBeNull()
    expect(recognizer.push('click', 900)).toBeNull()
  })

  it('expires after a 1600ms gap or a 4000ms total window', () => {
    const recognizer = new RescueSequenceRecognizer()
    recognizer.push('click', 0)
    expect(recognizer.push('double_click', 1700)).toBeNull()
    expect(recognizer.push('click', 2500)).toBeNull()
  })

  it('suppresses duplicate rescue sequences for eight seconds', () => {
    const recognizer = new RescueSequenceRecognizer()
    recognizer.push('click', 0)
    recognizer.push('double_click', 500)
    expect(recognizer.push('click', 1000)).toBe('snake1_rescue')
    recognizer.push('click', 2000)
    recognizer.push('double_click', 2500)
    expect(recognizer.push('click', 3000)).toBeNull()
    recognizer.push('click', 9100)
    recognizer.push('double_click', 9600)
    expect(recognizer.push('click', 10100)).toBe('snake1_rescue')
  })
})
