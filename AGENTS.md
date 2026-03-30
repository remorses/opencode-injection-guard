# opencode-injection-guard

OpenCode plugin that detects prompt injection in tool call outputs using an LLM judge.

## Project structure

```
src/
  index.ts       plugin entrypoint, tool.execute.after hook
  config.ts      config loading (find-up .opencode/injection-guard.json + env var)
  patterns.ts    wildcard pattern matching for tool:args scan patterns
  prompt.ts      system prompt for the judge model (adapted from OpenAI Guardrails)
  judge.ts       session creation + prompt via SDK, response parsing
  *.test.ts      tests next to each source file
example/
  malicious-document.txt   test file with embedded prompt injection
  .opencode/injection-guard.json   config enabling the guard
  opencode.json            loads the plugin from ../src/index.ts
  run.sh                   script to run the example
```

## How to try out the plugin

### Quick test with the example

```bash
cd example
git init   # opencode needs a git repo
./run.sh
```

This runs `opencode run` in the example directory. The agent is asked to read `malicious-document.txt` which contains a prompt injection. The guard should detect it and block the output.

To see the guard logs:

```bash
cd example
opencode run --print-logs "Read malicious-document.txt and summarize it" 2>&1 | grep "\[injection-guard\]"
```

Expected output:

```
[injection-guard] enabled, scanPatterns: ["bash:*","webfetch:*","task:*","read:*"]
[injection-guard] using model: openai/gpt-5.4-mini
[injection-guard] tool=read flagged=true confidence=0.99
```

### Test in your own project

1. Add the plugin to your `opencode.json`:

```json
{
  "plugin": ["opencode-injection-guard"]
}
```

2. Create `.opencode/injection-guard.json` to enable it:

```json
{
  "scanPatterns": ["bash:*", "webfetch:*"]
}
```

3. Run opencode normally. The guard scans tool outputs matching the patterns.

## Development

```bash
pnpm install
pnpm test --run     # run tests
pnpm tsc --noEmit   # typecheck
pnpm build          # compile to dist/
```

## Key design decisions

- **Opt-in**: no config file = plugin is a no-op. Users must create `.opencode/injection-guard.json`.
- **SDK v1 params**: the plugin's `input.client` uses the v1 SDK with nested `body`/`path`/`query` params. Do not try to cast to v2 or create separate HTTP clients -- the plugin runs in-process.
- **os.tmpdir() for judge sessions**: judge sessions use the system temp directory as cwd so they don't pollute the project's session list.
- **Model resolution from registry**: `resolveModel` checks the actual model registry (`provider/modelId` pairs), not just connected provider names. This avoids `ProviderModelNotFoundError` when a provider is connected but doesn't have a specific model.
- **Deny all permissions**: judge sessions are created with `{ permission: '*', pattern: '*', action: 'deny' }` so the judge model cannot execute any tools.
- **Lazy model resolution**: `provider.list()` is called on first tool scan, not at plugin init, because providers may not be fully ready during initialization.
