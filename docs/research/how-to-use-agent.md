# AI Agents: CLI vs Cloud

**Last Updated:** June 25, 2026  
**Structure:** By Deployment Type → Maker → Authentication & Usage

---

## Quick Overview

Two deployment models:
- **CLI Agents**: Local, terminal-native, full codebase access, tight control
- **Cloud Agents**: API-based, enterprise scaling, model flexibility

---

## Table of Contents

### CLI Agents
- [Anthropic → Claude Code](#anthropic--claude-code)
- [OpenAI → Codex](#openai--codex)
- [Google → Antigravity](#google--antigravity)

### Cloud Agents
- [Anthropic → Claude API](#anthropic--claude-api)
- [OpenAI → Responses API](#openai--responses-api)
- [Google → Gemini API](#google--gemini-api)
- [OpenRouter → Agent SDK](#openrouter--agent-sdk)
- [Nvidia → NIM](#nvidia--nim)

### Advanced Topics
- [Multi-Account Strategy](#multi-account-strategy)
- [Non-Interactive/Scripting](#non-interactivescripting)
- [Comparison Matrix](#comparison-matrix)

---

# CLI AGENTS

## Anthropic → Claude Code

**Status:** Active, flagship CLI (v2026.6+)  
**Latest:** June 2026  
**Interfaces:** CLI, VS Code, JetBrains, Desktop, Web

### Key Features
- Terminal-native with multi-level sub-agents (3 layers)
- Nested sub-agents with fallback models
- Cost attribution per agent
- Desktop app redesigned April 2026
- Community tool marketplace

### Authentication

#### Method 1: OAuth Token (Recommended)
```bash
# Set token from Claude Console or account
export CLAUDE_CODE_OAUTH_TOKEN="<your-oauth-token>"

# Use directly
claude -p "task"
```

**Availability:**
- Claude Pro/Max
- Teams/Enterprise
- Claude Console

#### Method 2: Multi-Account Setup
```bash
# Each account gets isolated config directory
alias claude-tu="CLAUDE_CODE_OAUTH_TOKEN=$(cat ~/.agents/claude-tu/.token) \
  CLAUDE_CONFIG_DIR=~/.agents/claude-tu \
  claude --dangerously-skip-permissions"

alias claude-thai="CLAUDE_CODE_OAUTH_TOKEN=$(cat ~/.agents/claude-thai/.token) \
  CLAUDE_CONFIG_DIR=~/.agents/claude-thai \
  claude --dangerously-skip-permissions"
```

### Usage

#### Interactive Mode
```bash
claude
# Opens REPL, can create sub-agents, manage tools
```

#### Non-Interactive (Scripting)
```bash
# Single prompt execution
claude -p "Fix the bug in auth.py"

# Bare mode (skip discovery for CI)
claude --bare -p "your task" > output.txt

# Piping
cat error.log | claude -p "analyze this error" > analysis.txt

# JSON output with cost tracking
claude -p "optimize code" --output-format json | jq '.metadata.cost_usd'
```

#### Sub-Agents & Delegation
Sub-agents are created dynamically by the agent during conversations.
They are not controlled via CLI flags.

### Rate Limits & Pricing
- Tier-based (cumulative deposit: $5 → $400)
- Tier 1: 50 RPM / 100K ITPM
- Tier 4: 4,000 RPM / 4M ITPM
- Cached tokens: exempt

---

## OpenAI → Codex

**Status:** Active, Rust-based (fast startup, low memory)  
**Latest:** June 2026  
**Type:** Code generation agent

### Key Features
- Built in Rust (faster than Node)
- Multi-file edits with planning
- Multimodal input (text, screenshots, diagrams)
- Code stays local unless shared
- Full-screen TUI interface

### Authentication

#### Method 1: ChatGPT Login (Recommended for personal use)
```bash
# Browser-based login (connects to ChatGPT subscription)
codex login

# Creates local cache at ~/.codex/auth.json
# Reuses ChatGPT subscription (no API credits needed)
```

**Auth file structure:**
```json
{
  "access_token": "Bearer ...",
  "refresh_token": "...",
  "expires_in": 604800,
  "account_id": "user-xxx"
}
```

#### Method 2: API Key (for backend systems)
```bash
export CODEX_API_KEY="sk-..."
codex exec "task"
```

#### Method 3: Multi-Account Setup
```bash
alias codex-plus="CODEX_HOME=~/.agents/codex-plus \
  codex --dangerously-bypass-approvals-and-sandbox"

alias codex-go="CODEX_HOME=~/.agents/codex-go \
  codex --dangerously-bypass-approvals-and-sandbox"

# Each account has separate auth
codex-plus login  # Store token in ~/.agents/codex-plus/auth.json
codex-go login    # Store token in ~/.agents/codex-go/auth.json
```

### Usage

#### Interactive Mode
```bash
codex
# Full-screen TUI, chat about codebase
```

#### Non-Interactive (Scripting)
```bash
# Execute task non-interactively
codex exec "refactor this function"

# Read from stdin
cat task.txt | codex exec -

# JSON output (JSONL stream)
codex exec "optimize" --json >> events.jsonl

# CI-safe (ignore user config)
codex exec "task" --ignore-user-config --ignore-rules
```

#### Streaming & Real-time
```bash
# Watch progress as it happens
codex exec "task" --stream

# Capture all events
codex exec "task" --json --stream > all-events.jsonl
```

### Rate Limits
- ChatGPT subscription: 5-hour rolling window
- API key: Per-minute TPM limits

---

## Google → Antigravity

**Status:** New, replaces Gemini CLI (June 2026)  
**Built:** Go (faster startup than Node)  
**Features:** Async sub-agents, parallel execution, native scheduling

### Key Features
- TUI with agentic interface
- Async subagents for parallelization
- Bidirectional sync with Antigravity 2.0 desktop
- Cron-style task scheduling
- Free tier available

### Authentication

#### Method 1: Google Account (Recommended)
```bash
# Browser-based authentication (automatically triggered on first run)
agy

# Creates local OAuth cache
# Works with Google AI Pro, Ultra, Code Assist
```

#### Method 2: API Key (Enterprise)
```bash
export GOOGLE_API_KEY="..."
agy -p "task"
```

#### Method 3: Multi-Account Setup
```bash
alias agy-prod="HOME=~/.agents/agy-prod agy --dangerously-skip-permissions"
alias agy-research="HOME=~/.agents/agy-research agy --dangerously-skip-permissions"

agy-prod   # Triggers OAuth flow, stores token in ~/.agents/agy-prod/.config
agy-research
```

### Usage

#### Interactive Mode
```bash
agy
# Terminal UI with agent interface
```

#### Non-Interactive (Scripting)
```bash
# Single prompt
agy -p "deploy to cloud run"

# From file
agy -p "$(cat task.txt)"


```

#### Parallel Sub-Agents
Sub-agents are managed internally by the agent during conversations
and are not controlled via CLI flags.

### Pricing & Availability
- Free: GitHub installation
- Google AI Pro/Ultra: Subscription-based
- Enterprise: Via paid Gemini API keys

---

# CLOUD AGENTS

## Anthropic → Claude API

**Models:** Claude Opus 4.8, Fable 5  
**Status:** Active & expanding  
**Focus:** Complex tool orchestration

### Key Features
- Claude Agent SDK (renamed Sep 2025)
- Advanced tool use (Programmatic Calling, Tool Search)
- Managed Agents with sandboxing
- Multi-agent sub-agent orchestration
- MCP server integration (private)

### Authentication

#### Method 1: API Key
```bash
export ANTHROPIC_API_KEY="sk-ant-..."

curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-8","max_tokens":4096,"messages":[...]}'
```

**Get API Key:**
- Visit [console.anthropic.com](https://console.anthropic.com/settings/keys)
- Create new key
- Store in `~/.agents/anthropic/.key`

#### Method 2: Multi-Account Setup
```bash
alias claude-api-tu="ANTHROPIC_API_KEY=$(cat ~/.agents/claude-api-tu/.key) python agent.py"
alias claude-api-research="ANTHROPIC_API_KEY=$(cat ~/.agents/claude-api-research/.key) python agent.py"
```

### Usage

#### Python SDK
```python
from anthropic import Anthropic

client = Anthropic(api_key="sk-ant-...")

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=2048,
    messages=[{"role": "user", "content": "task"}],
    tools=[...]  # Your tools
)
```

#### Curl/HTTP
```bash
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 2048,
    "messages": [{"role": "user", "content": "task"}]
  }'
```

#### Advanced Tool Use
```python
# Programmatic tool calling (Claude writes orchestration code)
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    messages=[...],
    tools=[...],
    tool_choice={"type": "auto"},
    system="Use tools to solve this step-by-step"
)

# Tool Search (access thousands of tools without context bloat)
```

### Rate Limits & Pricing
- Tier 1 ($5): 50 RPM / 100K ITPM
- Tier 2 ($50): 500 RPM / 1M ITPM
- Tier 4 ($400): 4,000 RPM / 4M ITPM
- Cached tokens: Exempt from rate limits

---

## OpenAI → Responses API

**Models:** GPT-5.5, GPT-5.4, GPT-4o, GPT-4o-mini  
**Status:** Active, replacing Assistants API  
**Deprecation:** Agent Builder sunset Nov 30, 2026

### Key Features
- Responses API (new standard, more flexible)
- Built-in tools: Web Search, Code Interpreter, Function Calls
- Remote MCP server support
- Agents SDK (Python & TypeScript)
- AgentKit ecosystem

### Authentication

#### Method 1: API Key (Standard)
```bash
export OPENAI_API_KEY="sk-proj-..."

curl -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "task"}]
  }'
```

**Get API Key:**
- Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Create new key
- Store securely

**Rate Limits:**
- Tier 1 ($5): Starting limits
- Tier 5+ ($200+): Higher rate limits
- Check dashboard for current limits

#### Method 2: OAuth Token (ChatGPT Subscription)
```bash
# Login with ChatGPT account
npx @openai/codex login

# Uses chatgpt.com/backend-api/codex/responses (undocumented backend)
# NOT compatible with api.openai.com directly
```

**Important Difference:**
- ❌ CANNOT use directly with `api.openai.com`
- ✅ Must use via proxy (openai-oauth)
- Uses ChatGPT subscription credits, not API credits

#### Method 3: OAuth Token via Local Proxy
```bash
# Install proxy
npm install -g openai-oauth

# Start proxy
npx openai-oauth
# Output: OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1

# Use like standard API
curl -X POST http://127.0.0.1:10531/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4","messages":[...]}'
```

Proxy automatically:
- Reads OAuth token from `~/.codex/auth.json`
- Refreshes expired tokens
- Translates to backend API format
- Streams responses as OpenAI-compatible SSE

#### Method 4: Multi-Account Setup
```bash
# API Key approach
alias openai-prod="OPENAI_API_KEY=$(cat ~/.agents/openai-prod/.key) python agent.py"
alias openai-dev="OPENAI_API_KEY=$(cat ~/.agents/openai-dev/.key) python agent.py"

# OAuth + Proxy approach
alias openai-via-chatgpt="CODEX_HOME=~/.agents/codex-main npx openai-oauth"
```

### Usage

#### JavaScript SDK
```javascript
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "task" }],
  tools: [...]
});
```

#### Responses API (New)
```bash
curl -X POST https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "input": "your task here",
    "tools": [
      {"type": "web_search"},
      {"type": "code_interpreter", "container": {"type": "auto"}}
    ]
  }'
```

#### Built-in Tools
```python
# Web search
tools=[{"type": "web_search"}]

# Code interpreter
tools=[{"type": "code_interpreter"}]

# Function calls (custom)
tools=[{
  "type": "function",
  "function": {
    "name": "deploy_to_cloud",
    "parameters": {...}
  }
}]
```

### API Key vs OAuth Token Comparison

| Aspect | API Key | OAuth Token |
|--------|---------|------------|
| **Endpoint** | `api.openai.com/v1/...` | `chatgpt.com/backend-api/codex` |
| **Direct Use** | ✅ Works directly | ❌ Requires proxy |
| **Billing** | API credits (pay-per-token) | ChatGPT subscription |
| **Rate Limit** | Per-minute TPM | 5-hour rolling window |
| **Official** | ✅ Public API | ❌ Undocumented backend |
| **Setup** | Buy credits, create key | Have ChatGPT subscription |

---

## Google → Gemini API

**Models:** Gemini 3.5 Flash, Gemini 3.1 Pro  
**Status:** New & hot (Google I/O 2026 focus)  
**Focus:** Parallel workflows, fast inference

### Key Features
- Managed Agents in Gemini API
- Sandbox execution (Linux environment)
- Code execution support
- File handling, tool use
- Antigravity 2.0 integration
- Parallel subagents

### Authentication

#### Method 1: API Key
```bash
export GOOGLE_API_KEY="..."

curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"your task"}]}]}'
```

**Get API Key:**
- Visit [aistudio.google.com](https://aistudio.google.com)
- Create new API key
- Store in `~/.agents/gemini/.key`

#### Method 2: Google Cloud Project
```bash
# Use Google Cloud credentials
gcloud auth application-default login

export GOOGLE_CLOUD_PROJECT="your-project"
export GOOGLE_API_KEY="..."
```

#### Method 3: Multi-Account Setup
```bash
alias gemini-prod="GOOGLE_API_KEY=$(cat ~/.agents/gemini-prod/.key) \
  GOOGLE_CLOUD_PROJECT=prod python agent.py"

alias gemini-dev="GOOGLE_API_KEY=$(cat ~/.agents/gemini-dev/.key) \
  GOOGLE_CLOUD_PROJECT=dev python agent.py"
```

### Usage

#### Python SDK
```python
from google import genai

client = genai.Client(api_key="...")

response = client.models.generate_content(
    model="gemini-3.5-flash",
    contents="task"
)
```

#### Managed Agents API (Vertex AI)
```bash
curl -X POST https://aiplatform.googleapis.com/v1beta1/projects/YOUR_PROJECT/locations/us-central1/agents \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": "You are a helpful agent",
    "tools": [{"type": "google_search"}],
    "sandbox": true
  }'
```

#### Parallel Sub-Agents
Parallel sub-agents are managed by the Gemini API internally
and are not controlled via a Python SDK parameter.

### Gemini 3.5 Flash (June 2026)
- 4x faster than 3.1 Pro
- Outperforms 3.1 Pro on benchmarks
- Ideal for real-world agentic workflows

### Pricing & Rate Limits
- Free tier: Limited requests
- Paid: Per-token pricing
- Rate limits: Project-based

---

## OpenRouter → Agent SDK

**Models:** 500+ across 60+ providers  
**Status:** Active, agentic-first positioning  
**Focus:** Model flexibility & cost optimization

### Key Features
- Model-agnostic Agent SDK
- Handles conversation loops, tool dispatch, state tracking
- Cost optimization via routing
- Tool Search support
- Agentic AI governance layer

### Authentication

#### Method 1: API Key
```bash
export OPENROUTER_API_KEY="sk-or-..."

curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/llama-3.1-405b","messages":[...]}'
```

**Get API Key:**
- Visit [openrouter.ai](https://openrouter.ai)
- Create account & API key
- Store in `~/.agents/router/.key`

#### Method 2: Multi-Account Setup
```bash
alias router-account1="OPENROUTER_API_KEY=$(cat ~/.agents/router-account1/.key) python agent.py"
alias router-account2="OPENROUTER_API_KEY=$(cat ~/.agents/router-account2/.key) python agent.py"
```

### Usage

#### JavaScript Agent SDK
```javascript
import OpenRouter from "@openrouter/sdk";
import { callModel, tool } from "@openrouter/agent";

const client = new OpenRouter({ apiKey: "sk-or-..." });

const result = callModel(client, {
  model: "anthropic/claude-sonnet-4",
  input: "user task",
  tools: [...]
});

const text = await result.getText();
```

#### API Call (Model-agnostic)
```bash
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "meta-llama/llama-3.1-405b",
    "messages": [{"role": "user", "content": "task"}],
    "tools": [...]
  }'
```

#### Spawn Feature (VM Provisioning)
```bash
openrouter spawn --model gpt-4o --agent my-agent
# Automatically provisions VM with your credentials
```

### Pricing & Rate Limits
- Model-dependent (varies by provider)
- Cost optimization via routing
- Real-time pricing on each model

---

## Nvidia → NIM

**Models:** NVIDIA Nemotron + partners  
**Status:** Active, expanded June 2026  
**Focus:** GPU-optimized inference

### Key Features
- Accelerated inference microservices
- Self-hosted OR cloud API
- Nemotron (multimodal, agentic reasoning)
- NIM Agent Blueprints
- NemoClaw security (out-of-process enforcement)

### Authentication

#### Method 1: Cloud API Key
```bash
export NVIDIA_API_KEY="..."

curl -X POST https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.1-405b","messages":[...]}'
```

**Get API Key:**
- Visit [build.nvidia.com](https://build.nvidia.com)
- Create API key
- Free tier: ~1,000 API credits; self-hosted dev/test on up to 16 GPUs

#### Method 2: Self-Hosted NIM
```bash
# Deploy on your GPU
docker run --gpus all nvcr.io/nim/meta/llama-3.1-405b-instruct:latest

# API endpoint at localhost:8000
curl -X POST http://localhost:8000/v1/chat/completions \
  -d '{"model":"meta-llama/llama3.1-405b","messages":[...]}'
```

#### Method 3: Multi-Account Setup
```bash
alias nim-prod="NVIDIA_API_KEY=$(cat ~/.agents/nim-prod/.key) python agent.py"
alias nim-research="NVIDIA_API_KEY=$(cat ~/.agents/nim-research/.key) python agent.py"
```

### Usage

#### Python SDK
```python
from openai import OpenAI

client = OpenAI(
    api_key="$NVIDIA_API_KEY",
    base_url="https://integrate.api.nvidia.com/v1"
)

response = client.chat.completions.create(
    model="meta/llama-3.1-405b",
    messages=[{"role": "user", "content": "task"}]
)
```

#### Agent Blueprints
```python
# Use NIM Agent Blueprints for workflows
```

### Pricing & Availability
- Cloud API: Per-token pricing
- Free tier: ~1,000 API credits (hosted); self-hosted dev/test on up to 16 GPUs
- Self-hosted: Your GPU cost
- 2026: Rubin-optimized inference profiles added

---

# ADVANCED TOPICS

## Multi-Account Strategy

### Directory Structure

```
~/.agents/
├── claude-tu/
│   ├── .token
│   ├── .claude/
│   │   ├── config.json
│   │   └── memory.md
├── claude-thai/
│   ├── .token
│   └── .claude/
├── codex-plus/
│   ├── auth.json (from: codex login)
│   └── .codex/
├── codex-go/
│   ├── auth.json
│   └── .codex/
├── agy-prod/
│   ├── .config/
│   └── auth.json
├── agy-research/
│   ├── .config/
│   └── auth.json
├── openai-prod/
│   ├── .key
│   └── config.json
├── openai-oauth/
│   ├── auth.json (from: codex login)
│   └── .codex/
├── gemini-prod/
│   ├── .key
│   └── config.json
├── router-account1/
│   ├── .key
│   └── config.json
└── nim-prod/
    ├── .key
    └── config.json
```

### Alias Patterns

#### CLI Agents
```bash
# Anthropic Claude
alias claude-tu="CLAUDE_CODE_OAUTH_TOKEN=$(cat ~/.agents/claude-tu/.token) \
  CLAUDE_CONFIG_DIR=~/.agents/claude-tu claude"

# OpenAI Codex
alias codex-plus="CODEX_HOME=~/.agents/codex-plus codex"

# Google Antigravity
alias agy-prod="HOME=~/.agents/agy-prod agy"
```

#### Cloud Agents
```bash
# Anthropic Claude API
alias claude-api-tu="ANTHROPIC_API_KEY=$(cat ~/.agents/claude-api-tu/.key) python agent.py"

# OpenAI API
alias openai-prod="OPENAI_API_KEY=$(cat ~/.agents/openai-prod/.key) python agent.py"

# Google Gemini API
alias gemini-prod="GOOGLE_API_KEY=$(cat ~/.agents/gemini-prod/.key) \
  GOOGLE_CLOUD_PROJECT=prod python agent.py"

# OpenRouter
alias router-account1="OPENROUTER_API_KEY=$(cat ~/.agents/router-account1/.key) python agent.py"

# Nvidia NIM
alias nim-prod="NVIDIA_API_KEY=$(cat ~/.agents/nim-prod/.key) python agent.py"
```

### Function-Based Wrapper

```bash
agent-call() {
  local account=$1
  local agent_type=$2
  local prompt=$3

  case $agent_type in
    claude-cli)
      CLAUDE_CODE_OAUTH_TOKEN=$(cat ~/.agents/$account/.token) \
      CLAUDE_CONFIG_DIR=~/.agents/$account \
      claude -p "$prompt"
      ;;
    codex)
      CODEX_HOME=~/.agents/$account \
      codex exec "$prompt"
      ;;
    agy)
      HOME=~/.agents/$account \
      agy -p "$prompt"
      ;;
    claude-api)
      ANTHROPIC_API_KEY=$(cat ~/.agents/$account/.key) \
      python -c "from agent import Agent; Agent().run('$prompt')"
      ;;
    openai)
      OPENAI_API_KEY=$(cat ~/.agents/$account/.key) \
      python -c "from agent import Agent; Agent().run('$prompt')"
      ;;
    gemini)
      GOOGLE_API_KEY=$(cat ~/.agents/$account/.key) \
      python -c "from agent import Agent; Agent().run('$prompt')"
      ;;
  esac
}

# Usage
agent-call tu claude-cli "find bugs in main.py"
agent-call prod codex "refactor this function"
agent-call research agy "analyze deployment options"
```

---

## Non-Interactive/Scripting

### CLI Agents

#### Claude Code
```bash
# Single prompt
claude -p "Find and fix the bug in auth.py"

# Bare mode (CI-friendly)
claude --bare -p "your task" > result.txt

# Piping
cat build-error.txt | claude -p "explain this error" > analysis.txt

# JSON output with cost
claude -p "optimize this code" --output-format json | jq '.metadata'
```

#### Codex
```bash
# Non-interactive execution
codex exec "refactor this function"

# From stdin
cat task.txt | codex exec -

# JSON stream (all events)
codex exec "task" --json > events.jsonl

# CI-safe (ignore local config)
codex exec "task" --ignore-user-config --ignore-rules
```

#### Antigravity
```bash
# Prompt execution
agy -p "deploy to cloud run"

# From file
agy -p "$(cat task.txt)"


```

### Cloud Agents (via HTTP/SDK)

#### All APIs (Generic)
```bash
# Save prompt to file
echo '{"messages":[{"role":"user","content":"task"}]}' > prompt.json

# Call API, save result
curl -X POST https://api.provider.com/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -d @prompt.json > result.json

# Parse result
jq '.choices[0].message.content' result.json
```

---

## Comparison Matrix

### CLI Agents

| Factor | Claude Code | Codex | Antigravity |
|--------|-----------|-------|------------|
| **Maker** | Anthropic | OpenAI | Google |
| **Latency** | Low | Very Low | Very Low |
| **Codebase Access** | ✅ Full | ✅ Full | ✅ Full |
| **Cost** | Subscription | API or ChatGPT | Free/Pro/Ultra |
| **Sub-agents** | ✅ 3 levels | Limited | ✅ Async |
| **Desktop** | ✅ Apr 2026 | — | ✅ 2.0 |
| **Scheduling** | Cowork | — | ✅ Cron |
| **Best For** | Complex workflows | Intent-driven | Parallel tasks |

### Cloud Agents

| Factor | Claude API | OpenAI | Gemini | OpenRouter | NIM |
|--------|-----------|--------|--------|-----------|-----|
| **Maker** | Anthropic | OpenAI | Google | Multi | Nvidia |
| **Speed** | Fast | Fast | ⚡ Fastest | Fast | Very Fast |
| **Models** | 1 family | 1 family | 1 family | 500+ | 1-5 |
| **Cost** | Per-token | Per-token | Per-token | Flexible | GPU-hours |
| **Tools** | ✅ Advanced | Standard | Standard | Standard | Standard |
| **Parallelism** | Sub-agents | Manual | ✅ Native | SDK | Blueprints |
| **Official** | ✅ Public | ✅ Public | ✅ Public | ✅ Public | ✅ Public |
| **Best For** | Tool complexity | Reliability | Speed | Flexibility | GPU workloads |

---

## Use Case Decision Tree

```
Need local codebase access?
├─ YES
│  └─ Which priority?
│     ├─ Sub-agent complexity? → Claude Code
│     ├─ Speed critical? → Codex
│     └─ Parallel workflows? → Antigravity
│
└─ NO → Cloud API
   └─ Which priority?
      ├─ Tool orchestration? → Claude API
      ├─ Reliability + web search? → OpenAI
      ├─ Speed critical? → Gemini
      ├─ Model flexibility? → OpenRouter
      └─ GPU optimization? → Nvidia NIM
```

---

## References

### CLI Agents
- [Claude Code Docs](https://code.claude.com/docs/en/cli-reference)
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli)
- [Codex Authentication](https://developers.openai.com/codex/auth)
- [Google Antigravity](https://antigravity.google/)
- [GoClaw OAuth Implementation](https://github.com/nextlevelbuilder/goclaw)

### Cloud Agents
- [Anthropic Claude API](https://platform.claude.com/docs)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [OpenAI Responses API](https://developers.openai.com/api/docs/guides/agents)
- [Google Gemini API](https://ai.google.dev/gemini-api)
- [OpenRouter Agent SDK](https://openrouter.ai/docs/agent-sdk)
- [Nvidia NIM](https://developer.nvidia.com/nim)

### Authentication & OAuth
- [openai-oauth README (OAuth backend API usage)](https://github.com/EvanZhouDev/openai-oauth/blob/main/README.md) ⭐
- [OpenAI Apps SDK Auth](https://developers.openai.com/apps-sdk/build/auth)
- [GoClaw PKCE Implementation](https://github.com/nextlevelbuilder/goclaw/blob/cfb7f4632473a85eb8443864bbd038c53bd6a2bf/internal/oauth/openai.go)
- [OpenAI Authentication in 2026](https://www.datastudios.org/post/openai-authentication-in-2025-api-keys-service-accounts-and-secure-token-flows-for-developers-and)

---

**Status:** Complete refactor  
**Structure:** Maker → Auth Methods → Usage  
**Scope:** CLI + Cloud agents with practical examples
