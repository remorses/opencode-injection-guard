import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

import { loadConfig, parseModelId, resolveModel } from './config.ts'

describe('parseModelId', () => {
  test('parses provider/model format', () => {
    expect(parseModelId('openai/gpt-4.1-mini')).toMatchInlineSnapshot(`
      {
        "modelID": "gpt-4.1-mini",
        "providerID": "openai",
      }
    `)
  })

  test('defaults to openai provider when no slash', () => {
    expect(parseModelId('gpt-4.1-mini')).toMatchInlineSnapshot(`
      {
        "modelID": "gpt-4.1-mini",
        "providerID": "openai",
      }
    `)
  })

  test('handles anthropic provider', () => {
    expect(parseModelId('anthropic/claude-haiku')).toMatchInlineSnapshot(`
      {
        "modelID": "claude-haiku",
        "providerID": "anthropic",
      }
    `)
  })
})

describe('loadConfig', () => {
  test('returns null when no config file or env var', () => {
    expect(loadConfig({ projectDir: '/nonexistent' })).toBe(null)
  })

  test('returns config when env var is set', () => {
    const original = process.env.OPENCODE_INJECTION_GUARD
    process.env.OPENCODE_INJECTION_GUARD = JSON.stringify({
      model: 'anthropic/claude-haiku',
      confidenceThreshold: 0.5,
    })
    try {
      const config = loadConfig({ projectDir: '/nonexistent' })
      expect(config).not.toBe(null)
      expect(config!.model).toBe('anthropic/claude-haiku')
      expect(config!.confidenceThreshold).toBe(0.5)
      // scanPatterns has no default -- empty when not set
      expect(config!.scanPatterns).toMatchInlineSnapshot(`[]`)
    } finally {
      if (original === undefined) {
        delete process.env.OPENCODE_INJECTION_GUARD
      } else {
        process.env.OPENCODE_INJECTION_GUARD = original
      }
    }
  })

  test('env var overrides file config', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-test-'))
    const configDir = path.join(tmpBase, '.opencode')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'injection-guard.json'),
      JSON.stringify({ scanPatterns: ['bash:*'], confidenceThreshold: 0.5 }),
    )

    const original = process.env.OPENCODE_INJECTION_GUARD
    process.env.OPENCODE_INJECTION_GUARD = JSON.stringify({
      scanPatterns: ['webfetch:*'],
    })
    try {
      const config = loadConfig({ projectDir: tmpBase })
      expect(config).not.toBe(null)
      // Env var scanPatterns wins over file
      expect(config!.scanPatterns).toMatchInlineSnapshot(`
        [
          "webfetch:*",
        ]
      `)
      // File's confidenceThreshold still applies (env didn't set it)
      expect(config!.confidenceThreshold).toBe(0.5)
    } finally {
      if (original === undefined) {
        delete process.env.OPENCODE_INJECTION_GUARD
      } else {
        process.env.OPENCODE_INJECTION_GUARD = original
      }
      fs.rmSync(tmpBase, { recursive: true, force: true })
    }
  })

  test('finds config file via find-up', () => {
    // Create a temp dir structure: /tmp/test-xyz/sub/deep
    // Put config at /tmp/test-xyz/.opencode/injection-guard.json
    // loadConfig from /tmp/test-xyz/sub/deep should find it
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-test-'))
    const deepDir = path.join(tmpBase, 'sub', 'deep')
    const configDir = path.join(tmpBase, '.opencode')
    fs.mkdirSync(deepDir, { recursive: true })
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'injection-guard.json'),
      JSON.stringify({ scanPatterns: ['bash:*curl*'] }),
    )

    try {
      const config = loadConfig({ projectDir: deepDir })
      expect(config).not.toBe(null)
      expect(config!.scanPatterns).toMatchInlineSnapshot(`
        [
          "bash:*curl*",
        ]
      `)
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true })
    }
  })
})

describe('resolveModel', () => {
  // Need a non-null config for resolveModel tests
  function makeConfig(): ReturnType<typeof loadConfig> & {} {
    const original = process.env.OPENCODE_INJECTION_GUARD
    process.env.OPENCODE_INJECTION_GUARD = '{}'
    const config = loadConfig({ projectDir: '/nonexistent' })!
    if (original === undefined) {
      delete process.env.OPENCODE_INJECTION_GUARD
    } else {
      process.env.OPENCODE_INJECTION_GUARD = original
    }
    return config
  }

  test('picks first available model from priority', () => {
    const config = makeConfig()
    const model = resolveModel({
      config,
      availableModels: new Set(['openai/gpt-4.1-nano', 'anthropic/claude-haiku-4-5']),
    })
    expect(model).toBe('openai/gpt-4.1-nano')
  })

  test('skips unavailable models', () => {
    const config = makeConfig()
    const model = resolveModel({
      config,
      availableModels: new Set(['anthropic/claude-haiku-4-5', 'google/gemini-2.5-flash']),
    })
    expect(model).toBe('anthropic/claude-haiku-4-5')
  })

  test('falls back to gpt-5.4-nano when 4.1 unavailable', () => {
    const config = makeConfig()
    const model = resolveModel({
      config,
      availableModels: new Set(['openai/gpt-5.4-nano', 'openai/gpt-5.4-mini']),
    })
    expect(model).toBe('openai/gpt-5.4-nano')
  })

  test('returns first priority when no models available', () => {
    const config = makeConfig()
    const model = resolveModel({
      config,
      availableModels: new Set(),
    })
    expect(model).toBe('openai/gpt-4.1-nano')
  })

  test('respects user-configured model from env var', () => {
    const original = process.env.OPENCODE_INJECTION_GUARD
    process.env.OPENCODE_INJECTION_GUARD = JSON.stringify({
      model: 'custom/my-model',
    })
    try {
      const config = loadConfig({ projectDir: '/nonexistent' })!
      const model = resolveModel({
        config,
        availableModels: new Set(['anthropic/claude-haiku-4-5']),
      })
      expect(model).toBe('custom/my-model')
    } finally {
      if (original === undefined) {
        delete process.env.OPENCODE_INJECTION_GUARD
      } else {
        process.env.OPENCODE_INJECTION_GUARD = original
      }
    }
  })
})
