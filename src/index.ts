// opencode-injection-guard: OpenCode plugin that detects prompt injection
// in tool call outputs using an LLM judge session.
//
// Opt-in: only active if .opencode/injection-guard.json exists (searched
// upward from project dir) or OPENCODE_INJECTION_GUARD env var is set.
// If neither is found, the plugin is a no-op.
//
// Two exports:
// - injectionGuard: for npm users. Skips when KIMAKI=1 to avoid double-loading.
// - injectionGuardInternal: for Kimaki's own plugin file. No env check.

import type { Plugin } from '@opencode-ai/plugin'

import {
  getDefaultConfig,
  loadConfig,
  readKimakiSessionScanPatterns,
  resolveModel,
} from './config.ts'
import { InjectionJudge } from './judge.ts'
import { matchesScanPatterns } from './patterns.ts'

/**
 * Public export for npm users. Skips when running inside Kimaki
 * (process.env.KIMAKI === '1') because Kimaki loads injectionGuardInternal
 * from its own plugin file instead.
 */
export const injectionGuard: Plugin = async (input) => {
  if (process.env.KIMAKI === '1') {
    return {}
  }
  return injectionGuardInternal(input)
}

/**
 * Internal export for Kimaki. No KIMAKI env check -- this is the one
 * Kimaki's plugin file re-exports so it always runs.
 */
export const injectionGuardInternal: Plugin = async (input) => {
  const baseConfig = loadConfig({ projectDir: input.directory })

  if (baseConfig) {
    console.error(`[injection-guard] enabled, scanPatterns: ${JSON.stringify(baseConfig.scanPatterns)}`)
  }

  // Resolve model lazily on first scan so providers are ready at that point
  let modelResolved = false
  let resolvedModel = (baseConfig ?? getDefaultConfig()).model
  const resolveModelOnce = async () => {
    if (modelResolved) {
      return
    }
    modelResolved = true
    try {
      const providers = await input.client.provider.list({
        query: { directory: input.directory },
      })

      const allProviders = providers.data?.all ?? []
      const availableModels = new Set<string>()
      for (const p of allProviders) {
        for (const mid of Object.keys(p.models ?? {})) {
          availableModels.add(`${p.id}/${mid}`)
        }
      }

      resolvedModel = resolveModel({
        config: baseConfig ?? getDefaultConfig(),
        availableModels,
      })
    } catch (e) {
      console.error(`[injection-guard] failed to list providers: ${e}`)
    }
    console.error(`[injection-guard] using model: ${resolvedModel}`)
  }

  const judge = new InjectionJudge({
    client: input.client,
  })

  return {
    'tool.execute.after': async (toolInput, output) => {
      const sessionScanPatterns = process.env.KIMAKI === '1'
        ? readKimakiSessionScanPatterns({ sessionId: toolInput.sessionID })
        : null
      const config = {
        ...(baseConfig ?? getDefaultConfig()),
        ...(sessionScanPatterns ? { scanPatterns: sessionScanPatterns } : {}),
        model: resolvedModel,
      }

      if (config.scanPatterns.length === 0) {
        return
      }

      if (!baseConfig && sessionScanPatterns) {
        console.error(
          `[injection-guard] enabled for session ${toolInput.sessionID}, scanPatterns: ${JSON.stringify(sessionScanPatterns)}`,
        )
      }

      const argsString = typeof toolInput.args === 'string'
        ? toolInput.args
        : JSON.stringify(toolInput.args ?? '')

      const shouldScan = matchesScanPatterns({
        tool: toolInput.tool,
        args: argsString,
        patterns: config.scanPatterns,
      })

      if (!shouldScan) {
        return
      }

      await resolveModelOnce()

      const result = await judge.evaluate({
        config,
        tool: toolInput.tool,
        args: argsString,
        output: output.output,
      })

      if (result.flagged && result.confidence >= config.confidenceThreshold) {
        const reason = result.observation
          ? ` Reason: ${result.observation}`
          : ''
        output.output = [
          `[BLOCKED BY INJECTION GUARD] Tool output contained potential prompt injection`,
          `(confidence: ${result.confidence.toFixed(2)}).${reason}`,
          `Original output was suppressed for security.`,
        ].join(' ')
      }
    },
  }
}
