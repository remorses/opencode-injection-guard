import { describe, expect, test } from 'vitest'

import { matchesScanPatterns, wildcardMatch } from './patterns.ts'

describe('wildcardMatch', () => {
  test('exact match', () => {
    expect(wildcardMatch('bash', 'bash')).toBe(true)
    expect(wildcardMatch('bash', 'read')).toBe(false)
  })

  test('single wildcard matches everything', () => {
    expect(wildcardMatch('*', 'anything')).toBe(true)
    expect(wildcardMatch('*', '')).toBe(true)
  })

  test('prefix wildcard', () => {
    expect(wildcardMatch('*curl', 'some curl')).toBe(true)
    expect(wildcardMatch('*curl', 'curl')).toBe(true)
    expect(wildcardMatch('*curl', 'some wget')).toBe(false)
  })

  test('suffix wildcard', () => {
    expect(wildcardMatch('curl*', 'curl https://example.com')).toBe(true)
    expect(wildcardMatch('curl*', 'curl')).toBe(true)
    expect(wildcardMatch('curl*', 'wget https://example.com')).toBe(false)
  })

  test('contains wildcard', () => {
    expect(wildcardMatch('*zele read*', 'bash -c "zele read --inbox"')).toBe(true)
    expect(wildcardMatch('*zele read*', 'zele read')).toBe(true)
    expect(wildcardMatch('*zele read*', 'zele write')).toBe(false)
  })

  test('case insensitive', () => {
    expect(wildcardMatch('BASH', 'bash')).toBe(true)
    expect(wildcardMatch('*Curl*', 'run curl command')).toBe(true)
  })

  test('multiple wildcards', () => {
    expect(wildcardMatch('*zele*read*', 'run zele then read inbox')).toBe(true)
    expect(wildcardMatch('*zele*read*', 'read then zele')).toBe(false)
  })
})

describe('matchesScanPatterns', () => {
  test('matches tool:args pattern', () => {
    expect(matchesScanPatterns({
      tool: 'bash',
      args: 'curl https://example.com',
      patterns: ['bash:*curl*'],
    })).toBe(true)
  })

  test('skips non-matching tool', () => {
    expect(matchesScanPatterns({
      tool: 'read',
      args: '/some/file.ts',
      patterns: ['bash:*'],
    })).toBe(false)
  })

  test('matches wildcard tool', () => {
    expect(matchesScanPatterns({
      tool: 'bash',
      args: 'ls -la',
      patterns: ['bash:*'],
    })).toBe(true)
  })

  test('matches everything pattern', () => {
    expect(matchesScanPatterns({
      tool: 'read',
      args: '/etc/passwd',
      patterns: ['*:*'],
    })).toBe(true)
  })

  test('no patterns means no match', () => {
    expect(matchesScanPatterns({
      tool: 'bash',
      args: 'echo hello',
      patterns: [],
    })).toBe(false)
  })

  test('tool-only pattern (no colon)', () => {
    expect(matchesScanPatterns({
      tool: 'webfetch',
      args: 'https://example.com',
      patterns: ['webfetch'],
    })).toBe(true)
  })

  test('specific args pattern for zele read', () => {
    expect(matchesScanPatterns({
      tool: 'bash',
      args: 'zele read --inbox --limit 5',
      patterns: ['bash:*zele read*'],
    })).toBe(true)

    expect(matchesScanPatterns({
      tool: 'bash',
      args: 'zele write --to someone',
      patterns: ['bash:*zele read*'],
    })).toBe(false)
  })

  test('multiple patterns, any match succeeds', () => {
    expect(matchesScanPatterns({
      tool: 'webfetch',
      args: 'https://example.com',
      patterns: ['bash:*', 'webfetch:*'],
    })).toBe(true)
  })
})
