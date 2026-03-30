// Wildcard pattern matching for tool:args scan patterns.
// Format: "toolname:argsGlob"
// The "*" character matches any substring (including empty).

/**
 * Check if a tool call matches any of the scan patterns.
 * Pattern format: "tool:argsGlob"
 * - "bash:*" matches all bash calls
 * - "bash:*curl*" matches bash calls containing "curl" in args
 * - "*:*" matches everything
 */
export function matchesScanPatterns({
  tool,
  args,
  patterns,
}: {
  tool: string
  args: string
  patterns: string[]
}): boolean {
  return patterns.some((pattern) => {
    return matchPattern({ pattern, tool, args })
  })
}

function matchPattern({
  pattern,
  tool,
  args,
}: {
  pattern: string
  tool: string
  args: string
}): boolean {
  const colonIndex = pattern.indexOf(':')
  if (colonIndex === -1) {
    // No colon: treat the whole pattern as a tool name match with any args
    return wildcardMatch(pattern, tool)
  }
  const toolPattern = pattern.slice(0, colonIndex)
  const argsPattern = pattern.slice(colonIndex + 1)
  return wildcardMatch(toolPattern, tool) && wildcardMatch(argsPattern, args)
}

/**
 * Simple wildcard matching where "*" matches any substring.
 * Case-insensitive.
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  const lowerPattern = pattern.toLowerCase()
  const lowerValue = value.toLowerCase()

  // Split by * and check that all parts appear in order
  const parts = lowerPattern.split('*')

  // Fast path: no wildcards
  if (parts.length === 1) {
    return lowerPattern === lowerValue
  }

  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part === '') {
      continue
    }

    // First segment must match at the start if pattern doesn't start with *
    if (i === 0 && !lowerPattern.startsWith('*')) {
      if (!lowerValue.startsWith(part)) {
        return false
      }
      pos = part.length
      continue
    }

    // Last segment must match at the end if pattern doesn't end with *
    if (i === parts.length - 1 && !lowerPattern.endsWith('*')) {
      if (!lowerValue.endsWith(part)) {
        return false
      }
      continue
    }

    const idx = lowerValue.indexOf(part, pos)
    if (idx === -1) {
      return false
    }
    pos = idx + part.length
  }

  return true
}
