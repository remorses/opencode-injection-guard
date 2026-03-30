// opencode-injection-guard: OpenCode plugin that detects prompt injection
// in tool call outputs using an LLM judge session.
//
// Opt-in: only active if .opencode/injection-guard.json exists (searched
// upward from project dir) or OPENCODE_INJECTION_GUARD env var is set.
// If neither is found, the plugin is a no-op.

import type { Plugin } from '@opencode-ai/plugin'

import { loadConfig, resolveModel } from './config.ts'
import { InjectionJudge } from './judge.ts'
import { matchesScanPatterns } from './patterns.ts'

export const injectionGuard: Plugin = async (input) => {
  const config = loadConfig({ projectDir: input.directory })

  if (!config) {
    return {}
  }

  console.error(`[injection-guard] enabled, scanPatterns: ${JSON.stringify(config.scanPatterns)}`)

  // Resolve model lazily on first scan so providers are ready at that point
  let modelResolved = false
  const resolveModelOnce = async () => {
    if (modelResolved) {
      return
    }
    modelResolved = true
    try {
      const providers = await input.client.provider.list({
        query: { directory: input.directory },
      })

      // Build set of all available "provider/modelId" from registry
      const allProviders = providers.data?.all ?? []
      const availableModels = new Set<string>()
      for (const p of allProviders) {
        for (const mid of Object.keys(p.models ?? {})) {
          availableModels.add(`${p.id}/${mid}`)
        }
      }

      config.model = resolveModel({ config, availableModels })
    } catch (e) {
      console.error(`[injection-guard] failed to list providers: ${e}`)
    }
    console.error(`[injection-guard] using model: ${config.model}`)
  }

  const judge = new InjectionJudge({
    client: input.client,
    config,
  })

  return {
    'tool.execute.after': async (toolInput, output) => {
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
