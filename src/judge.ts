// Judge module: creates a sandboxed OpenCode session to evaluate tool output
// for prompt injection. The session has all tools denied so the judge model
// cannot execute anything — it only produces text.
//
// Uses @opencode-ai/sdk/v2 flat parameter style per kimaki conventions.
// The PluginInput.client is cast to the v2 OpencodeClient type at the boundary
// in index.ts since the plugin types reference the v1 SDK shape but the
// runtime client is v2-compatible.

import type { OpencodeClient, PermissionRuleset } from '@opencode-ai/sdk/v2'

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

// All tools denied so the judge session cannot execute anything.
// Uses wildcard '*' to deny every permission category.
const DENY_ALL_PERMISSIONS: PermissionRuleset = [
  { permission: '*', pattern: '*', action: 'deny' },
]

/**
 * Creates sandboxed sessions to evaluate tool output for prompt injection.
 * Each evaluation creates a fresh session to avoid context leaking between checks.
 */
export class InjectionJudge {
  private client: OpencodeClient
  private config: InjectionGuardConfig
  private directory: string

  constructor({
    client,
    config,
    directory,
  }: {
    client: OpencodeClient
    config: InjectionGuardConfig
    directory: string
  }) {
    this.client = client
    this.config = config
    this.directory = directory
  }

  /**
   * Evaluate tool output for prompt injection.
   * Creates a new session for each check to keep context clean.
   */
  async evaluate({
    tool,
    args,
    output,
  }: {
    tool: string
    args: string
    output: string
  }): Promise<JudgeResult> {
    const sessionId = await this.createJudgeSession()

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

    const response = await this.client.session.prompt({
      sessionID: sessionId,
      model,
      system: systemPrompt,
      parts: [{ type: 'text', text: userMessage }],
    })

    if (!response.data) {
      return { flagged: false, confidence: 0 }
    }

    // Extract text from the response parts
    const textParts = response.data.parts
      .filter((part): part is Extract<typeof part, { type: 'text' }> => {
        return part.type === 'text'
      })
      .map((part) => {
        return 'text' in part ? (part as { text: string }).text : ''
      })

    const fullText = textParts.join('')

    // Clean up the session after evaluation (fire-and-forget)
    this.deleteSession(sessionId)

    return parseJudgeResponse(fullText)
  }

  private async createJudgeSession(): Promise<string> {
    const session = await this.client.session.create({
      directory: this.directory,
      permission: DENY_ALL_PERMISSIONS,
    })

    if (!session.data) {
      throw new Error('Failed to create injection guard judge session')
    }

    return session.data.id
  }

  /**
   * Fire-and-forget session deletion to avoid blocking the tool call.
   */
  private deleteSession(sessionId: string): void {
    this.client.session.delete({ sessionID: sessionId }).catch(() => {
      // Session may already be cleaned up
    })
  }
}

/**
 * Parse the judge model's JSON response into a structured result.
 * Handles markdown code fences and malformed JSON gracefully.
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
    // If parsing fails, check for obvious flags in raw text
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
