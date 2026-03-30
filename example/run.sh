#!/bin/bash
# Test script for opencode-injection-guard.
# Runs opencode in the example/ directory where:
# - opencode.json loads the plugin from ../src/index.ts
# - .opencode/injection-guard.json enables the guard with defaults
# - malicious-document.txt contains a prompt injection
#
# The agent is asked to read and summarize the document.
# If the guard works, it should block the injected content.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Running opencode with injection guard enabled..."
echo "Working directory: $(pwd)"
echo ""

opencode run --print-logs "Read the file malicious-document.txt and summarize its contents."
