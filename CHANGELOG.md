## 0.1.0

1. **Initial release** -- OpenCode plugin that detects prompt injection in tool call outputs using an LLM-as-judge. Intercepts `tool.execute.after` and replaces injected content with a warning before the main agent ever sees it:

   ```
   [BLOCKED BY INJECTION GUARD] Tool output contained potential prompt injection
   (confidence: 0.99). Original output was suppressed for security.
   ```

2. **Wildcard scan patterns** -- configure which tool calls to scan using `tool:argsGlob` patterns. Only matched calls are scanned; everything else passes through with zero overhead:

   ```json
   {
     "scanPatterns": ["bash:*", "webfetch:*", "bash:*zele read*"]
   }
   ```

3. **Opt-in via config file** -- the plugin is a no-op unless `.opencode/injection-guard.json` exists (or `OPENCODE_INJECTION_GUARD` env var is set). No config = no scanning.

4. **Auto-detects best available model** -- checks the OpenCode model registry at runtime and picks the first available cheap/fast model from the priority list. No extra API keys needed -- uses your existing configured providers:

   Priority: `openai/gpt-4.1-nano` > `openai/gpt-4.1-mini` > `openai/gpt-5.4-nano` > `openai/gpt-5.4-mini` > `anthropic/claude-haiku-4-5` > `google/gemini-2.5-flash` > ...

5. **Config find-up** -- config file is searched upward from the project directory, so a single `.opencode/injection-guard.json` at a monorepo root covers all packages.

6. **Sandboxed judge sessions** -- judge sessions are created with all permissions denied and use `os.tmpdir()` as cwd, so they cannot execute tools or appear in the project session list.

7. **Kimaki-aware** -- when running inside Kimaki (`KIMAKI=1`), the standalone `injectionGuard` export is a no-op. Use `injectionGuardInternal` for embedding in other hosts.
