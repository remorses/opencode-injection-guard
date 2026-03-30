// Judge module: creates a sandboxed OpenCode session to evaluate tool output
// for prompt injection. The session has all tools denied so the judge model
// cannot execute anything -- it only produces text.
//
// Uses input.client from the plugin (in-process, no HTTP).
// The SDK uses body/path/query nested params.

import type { PluginInput } from '@opencode-ai/plugin'

import type { InjectionGuardConfig } from './config.ts'
import { parseModelId } from './config.ts'
import {
  INJECTION_DETECTION_PROMPT,
  INJECTION_DETECTION_PROMPT_WITH_REASONING,
  buildJudgeUserMessage,
} from './prompt.ts'

export interface JudgeResult {
  flagged: boolean
  confidence: number
  observation?: string
  evidence?: string | null
}

const DENY_ALL_PERMISSIONS = [
  { permission: '*', pattern: '*', action: 'deny' as const },
]

type PluginClient = PluginInput['client']

export class InjectionJudge {
  private client: PluginClient
  private config: InjectionGuardConfig
  private directory: string

  constructor({
    client,
    config,
    directory,
  }: {
    client: PluginClient
    config: InjectionGuardConfig
    directory: string
  }) {
    this.client = client
    this.config = config
    this.directory = directory
  }

  async evaluate({
    tool,
    args,
    output,
  }: {
    tool: string
    args: string
    output: string
  }): Promise<JudgeResult> {
    console.error(`[injection-guard] evaluating tool=${tool} output=${output.length} chars`)

    const sessionId = await this.createJudgeSession()
    console.error(`[injection-guard] judge session created: ${sessionId}`)

    const systemPrompt = this.config.includeReasoning
      ? INJECTION_DETECTION_PROMPT_WITH_REASONING
      : INJECTION_DETECTION_PROMPT

    const userMessage = buildJudgeUserMessage({
      tool,
      args,
      output,
      maxLength: this.config.maxOutputLength,
    })

    const model = parseModelId(this.config.model)
    console.error(`[injection-guard] sending to judge model: ${this.config.model}`)

    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        model,
        system: systemPrompt,
        parts: [{ type: 'text', text: userMessage }],
      },
      query: { directory: this.directory },
    })

    if (!response.data) {
      console.error(`[injection-guard] judge prompt returned no data`)
      return { flagged: false, confidence: 0 }
    }

    const textParts = response.data.parts
      .filter((part) => {
        return part.type === 'text'
      })
      .map((part) => {
        return 'text' in part ? (part as { text: string }).text : ''
      })

    const fullText = textParts.join('')
    console.error(`[injection-guard] judge response: ${fullText}`)

    this.deleteSession(sessionId)

    const result = parseJudgeResponse(fullText)
    console.error(`[injection-guard] verdict: flagged=${result.flagged} confidence=${result.confidence}`)

    return result
  }

  private async createJudgeSession(): Promise<string> {
    console.error(`[injection-guard] creating judge session`)

    // v1 SessionCreateData.body doesn't have permission, but the runtime
    // server accepts it. Pass it via body and let TS complain only about
    // the extra field.
    const session = await this.client.session.create({
      body: {
        permission: DENY_ALL_PERMISSIONS,
      } as { parentID?: string; title?: string },
      query: { directory: this.directory },
    })

    if (!session.data) {
      const error = (session as { error?: unknown }).error
      console.error(`[injection-guard] session.create failed: ${JSON.stringify(error)}`)
      throw new Error(`Failed to create injection guard judge session: ${JSON.stringify(error)}`)
    }

    return session.data.id
  }

  private deleteSession(sessionId: string): void {
    this.client.session.delete({
      path: { id: sessionId },
      query: { directory: this.directory },
    }).catch(() => {})
  }
}

/**
 * Parse the judge model's JSON response into a structured result.
 */
export function parseJudgeResponse(text: string): JudgeResult {
  const cleaned = stripJsonCodeFence(text.trim())

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    return {
      flagged: parsed.flagged === true,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      observation: typeof parsed.observation === 'string' ? parsed.observation : undefined,
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence : null,
    }
  } catch {
    const lowerText = text.toLowerCase()
    if (lowerText.includes('"flagged": true') || lowerText.includes('"flagged":true')) {
      return { flagged: true, confidence: 0.5 }
    }
    return { flagged: false, confidence: 0 }
  }
}

function stripJsonCodeFence(text: string): string {
  const lines = text.split('\n')
  if (lines.length < 3) {
    return text
  }
  const first = lines[0]!.trim()
  const last = lines[lines.length - 1]!.trim()
  if (first.startsWith('```') && last === '```') {
    return lines.slice(1, -1).join('\n')
  }
  return text
}
