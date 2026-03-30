// Config loading for opencode-injection-guard.
//
// The plugin is opt-in: if no config file is found AND no env var is set,
// loadConfig() returns null and the plugin does nothing.
//
// Priority order (highest wins):
//   1. OPENCODE_INJECTION_GUARD env var (JSON string)
//   2. .opencode/injection-guard.json file (find-up from project dir)
//   3. Hardcoded defaults (model, threshold, etc.)
//
// scanPatterns has no default -- the user must specify which tools to scan.
// An empty scanPatterns means nothing gets scanned.

import fs from 'node:fs'
import path from 'node:path'

export interface InjectionGuardConfig {
  /** Model to use for injection detection, format: "providerID/modelID" */
  model: string
  /** Confidence threshold (0.0-1.0) to flag as injection. Default: 0.7 */
  confidenceThreshold: number
  /** Whether to include reasoning in the judge response. Default: false */
  includeReasoning: boolean
  /** Max characters of tool output to send to the judge. Default: 8000 */
  maxOutputLength: number
  /**
   * Patterns determining which tool calls to scan.
   * Format: "toolname:argsGlob"
   * Examples: "bash:*", "webfetch:*", "bash:*curl*"
   * Only matched tool calls are scanned; everything else is skipped.
   * No default -- the user must specify which tools to scan.
   */
  scanPatterns: string[]
}

/**
 * Priority list of cheap/fast models for injection detection.
 * The first model whose provider is connected will be used as default.
 * Users can override this by setting "model" in config.
 * IDs from https://models.dev/api.json -- format is "provider/modelID".
 */
export const MODEL_PRIORITY: string[] = [
  'openai/gpt-4.1-nano',
  'openai/gpt-4.1-mini',
  'openai/gpt-5.4-nano',
  'openai/gpt-5.4-mini',
  'anthropic/claude-haiku-4-5',
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
  'anthropic/claude-3-5-haiku-latest',
]

const DEFAULTS: Omit<InjectionGuardConfig, 'model'> = {
  confidenceThreshold: 0.7,
  includeReasoning: false,
  maxOutputLength: 8000,
  scanPatterns: [],
}

/**
 * Load config by merging: defaults <- file <- env var.
 * Env var has highest priority and overrides file values.
 * Returns null if neither source provides config -- the user
 * hasn't opted in to injection guard.
 */
export function loadConfig({ projectDir }: { projectDir: string }): InjectionGuardConfig | null {
  const fileConfig = findConfigFile({ startDir: projectDir })
  const envConfig = loadEnvConfig()

  // No config anywhere -> plugin is disabled
  if (!fileConfig && !envConfig) {
    return null
  }

  return {
    model: MODEL_PRIORITY[0]!,
    ...DEFAULTS,
    ...fileConfig,
    ...envConfig,
  }
}

/**
 * Pick the best model from the priority list based on available models.
 * Checks against the actual model registry (provider/modelId pairs),
 * not just connected providers, to avoid ProviderModelNotFoundError.
 * If the user explicitly set a model in config, returns that unchanged.
 */
export function resolveModel({
  config,
  availableModels,
}: {
  config: InjectionGuardConfig
  availableModels: Set<string>
}): string {
  // If user explicitly configured a model, keep it
  const explicit = getExplicitModel()
  if (explicit) {
    return explicit
  }

  for (const model of MODEL_PRIORITY) {
    if (availableModels.has(model)) {
      return model
    }
  }

  // No connected provider matches -- fall back to first entry
  return MODEL_PRIORITY[0]!
}

/**
 * Search upward from startDir for .opencode/injection-guard.json.
 * Stops at filesystem root. Returns parsed config or null.
 */
function findConfigFile({ startDir }: { startDir: string }): Partial<InjectionGuardConfig> | null {
  let dir = path.resolve(startDir)
  const root = path.parse(dir).root

  while (true) {
    const configPath = path.join(dir, '.opencode', 'injection-guard.json')
    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(raw) as Partial<InjectionGuardConfig>
    } catch {
      // File doesn't exist or isn't valid JSON, keep searching
    }

    if (dir === root) {
      return null
    }
    dir = path.dirname(dir)
  }
}

function loadEnvConfig(): Partial<InjectionGuardConfig> | null {
  const envValue = process.env.OPENCODE_INJECTION_GUARD
  if (!envValue) {
    return null
  }
  try {
    return JSON.parse(envValue) as Partial<InjectionGuardConfig>
  } catch {
    return null
  }
}

/**
 * Check if the user explicitly set a model via env var or file config.
 */
function getExplicitModel(): string | null {
  const envValue = process.env.OPENCODE_INJECTION_GUARD
  if (envValue) {
    try {
      const parsed = JSON.parse(envValue) as Record<string, unknown>
      if (typeof parsed.model === 'string') {
        return parsed.model
      }
    } catch {
      // ignore
    }
  }
  return null
}

/**
 * Parse "providerID/modelID" string into the shape expected by the SDK.
 * Falls back to using the full string as modelID with "openai" as provider.
 */
export function parseModelId(model: string): { providerID: string; modelID: string } {
  const slashIndex = model.indexOf('/')
  if (slashIndex === -1) {
    return { providerID: 'openai', modelID: model }
  }
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  }
}
