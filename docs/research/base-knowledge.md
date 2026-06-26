# Quick Research Notes

## 1. Harness Engineering
**Definition:** Discipline of designing control systems for AI agents
- **Formula:** Agent = LLM Model + Harness
- **Harness covers:** Tools, guardrails, feedback loops, observability, hooks, linters, quality gates, repo management
- **Key Finding:** Harness design can create **6x performance differences** with same model (Stanford & Tsinghua study)
- **Bottom line:** The wrapper matters more than the underlying model

---

## 2. extensions-factory/superpowers
**What:** Complete software development methodology for coding agents
**Repo:** https://github.com/extensions-factory/superpowers

**How it works:**
- Doesn't jump to code—clarifies requirements first
- Extracts specs, validates with user
- Composable skills framework
- Compatible with: Claude Code, Cursor, GitHub Copilot CLI, Antigravity, Codex, Gemini CLI, Kimi Code, OpenCode, Pi, Factory Droid

**Latest (v6.0):** 
- 2x faster execution
- 50% fewer tokens
- Stricter, cheaper reviews

---

## Connection to Skynet Harness
All three concepts reinforce the same principle: **Orchestration > Model**
- Harness engineering emphasizes wrapper design over model selection
- Superpowers provides methodology for coding agent development

The key insight: Better harnesses, frameworks, and orchestration drive larger performance gains than underlying model improvements.
