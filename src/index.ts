// opencode-injection-guard: OpenCode plugin that detects prompt injection
// in tool call outputs using an LLM judge session.
//
// Opt-in: only active if .opencode/injection-guard.json exists (searched
// upward from project dir) or OPENCODE_INJECTION_GUARD env var is set.
// If neither is found, the plugin is a no-op.
//
// Config: .opencode/injection-guard.json or OPENCODE_INJECTION_GUARD env var.
// Default model: auto-detected from connected providers via priority list.
// Priority: gpt-4.1-mini -> claude-haiku -> gemini-2.5-flash -> bedrock haiku
//
// IMPORTANT: we create our own v2 SDK client from input.serverUrl instead of
// using input.client directly. The plugin system provides a v1-shaped client
// but we need v2 flat params and the `permission` field on session.create
// which only exists in v2.

import type { Plugin } from '@opencode-ai/plugin'
import { createOpencodeClient } from '@opencode-ai/sdk/v2'

import { loadConfig, resolveModel } from './config.ts'
import { InjectionJudge } from './judge.ts'
import { matchesScanPatterns } from './patterns.ts'

export const injectionGuard: Plugin = async (input) => {
  const config = loadConfig({ projectDir: input.directory })

  // No config found -- user hasn't opted in, return empty hooks
  if (!config) {
    return {}
  }

  // Create a v2 SDK client from the server URL so we get flat params
  // and the `permission` field on session.create.
  const client = createOpencodeClient({
    baseUrl: input.serverUrl.toString(),
    directory: input.directory,
  })

  // Resolve the best available model by checking which providers are connected.
  const providers = await client.provider.list()
  const connectedProviders = providers.data?.connected ?? []
  config.model = resolveModel({ config, connectedProviders })

  const judge = new InjectionJudge({
    client,
    config,
    directory: input.directory,
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
