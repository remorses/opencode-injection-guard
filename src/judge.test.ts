import { describe, expect, test } from 'vitest'

import { parseJudgeResponse } from './judge.ts'

describe('parseJudgeResponse', () => {
  test('parses clean JSON', () => {
    const result = parseJudgeResponse('{"flagged": true, "confidence": 0.95}')
    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0.95,
        "evidence": null,
        "flagged": true,
        "observation": undefined,
      }
    `)
  })

  test('parses JSON with reasoning fields', () => {
    const result = parseJudgeResponse(JSON.stringify({
      flagged: true,
      confidence: 0.9,
      observation: 'Contains directive to ignore instructions',
      evidence: '"Ignore all previous instructions and..."',
    }))
    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0.9,
        "evidence": ""Ignore all previous instructions and..."",
        "flagged": true,
        "observation": "Contains directive to ignore instructions",
      }
    `)
  })

  test('parses JSON wrapped in code fence', () => {
    const text = '```json\n{"flagged": false, "confidence": 0.1}\n```'
    const result = parseJudgeResponse(text)
    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0.1,
        "evidence": null,
        "flagged": false,
        "observation": undefined,
      }
    `)
  })

  test('handles malformed JSON by checking for flagged text', () => {
    const result = parseJudgeResponse('Some text with "flagged": true in it')
    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0.5,
        "flagged": true,
      }
    `)
  })

  test('returns safe default for completely unparseable text', () => {
    const result = parseJudgeResponse('I could not analyze this output')
    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0,
        "flagged": false,
      }
    `)
  })

  test('handles not-flagged response', () => {
    const result = parseJudgeResponse('{"flagged": false, "confidence": 0.05}')
    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0.05,
        "evidence": null,
        "flagged": false,
        "observation": undefined,
      }
    `)
  })
})
