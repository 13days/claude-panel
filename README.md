# ⌘ Claude Panel

**You've spent hundreds of dollars on Claude Code. Do you know where it went?**

A beautiful, zero-dependency local dashboard for everything in your `~/.claude` — slash commands, skills, agents, plugins, workflows, sessions, config files, and a real-time token usage dashboard that matches `ccusage` to the cent.

```bash
npx claude-code-panel
```

[中文文档](README.zh-CN.md) · [Quick Start](#quick-start) · [Features](#features) · [Screenshots](#screenshots)

![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-blue) ![license MIT](https://img.shields.io/badge/license-MIT-orange) ![i18n](https://img.shields.io/badge/i18n-中文%20%7C%20EN%20%7C%20日本語-purple)

![demo](https://raw.githubusercontent.com/13days/claude-panel/main/docs/demo.gif)

## Why

Claude Code stores your customizations as loose files scattered across `~/.claude` — commands here, skills there, plugins in a JSON manifest, usage buried in 300MB of transcript JSONL. Claude Panel puts all of it in one place:

- **See** everything Claude Code can do for you — including its built-in slash commands and everything your plugins ship
- **Edit** any command / skill / agent / workflow / config file right in the browser, with Markdown rendering and `⌘S` to save
- **Measure** your token spend with a live dashboard computed from the same source as [ccusage](https://github.com/ryoppippi/ccusage) — deduplicated, streaming-aware, cost-priced per model

## Features

| Section | What you get |
|---|---|
| **/ Commands** | Your commands + plugin-provided + Claude Code built-ins, all in one searchable list. Full CRUD on yours; built-ins clearly marked read-only |
| **Skills** | `~/.claude/skills` with frontmatter rendered as chips. Marketplace-installed skills (symlinks) are detected and protected from accidental edits |
| **Agents** | Subagent definitions with the same editing experience |
| **Plugins** | Installed plugins with version, marketplace, and everything they provide. One-click uninstall (manifest-only, cache preserved) |
| **Workflows** | Named workflow scripts for the Workflow tool, with `meta` parsed for descriptions and a starter template on create |
| **Config** | `CLAUDE.md`, `settings.json`, keybindings — edited in place, with JSON validation before save so you can't brick your setup |
| **Sessions** | Your last 200 sessions grouped from `history.jsonl`: prompt history, time range, and a copy-paste `claude --resume` command |
| **Stats** | Live usage dashboard: daily messages, per-model tokens, 24h activity heatline, and a `ccusage daily`-style cost table — all computed from transcripts on the fly |
| **🕵️ Inspector** | A built-in local reverse proxy captures live Claude Code API traffic. Launch with `ANTHROPIC_BASE_URL=http://localhost:4322 claude` and inspect every request's **full system prompt, tool definitions, messages, and streamed response (including thinking)** — the stuff transcripts don't keep. Last 50 requests, memory-only, API keys never recorded |
| **🔴 Live monitor** | Real-time SSE ticker on the Stats page: today's spend, burn rate ($/h over the last 10 min), active sessions — plus a daily budget with macOS notifications when you blow through it |
| **🔍 Full-text search** | Press Enter in the Sessions tab to search across every transcript — find that conversation from three weeks ago by any word you or Claude said |
| **▶ Session replay** | Full chat-style replay of any session: bubbles, timestamps, models, and collapsible tool calls |
| **🎁 Wrapped** | One-click shareable PNG stats card (week/month/all-time) with spend, tokens, top command, favorite model and an earned badge |
| **📦 Export / Import** | Bundle your commands/skills/agents/workflows into one JSON and share it with your team — import skips existing files |

Plus the cross-cutting stuff:

- 🌏 **Full i18n** — 中文 / English / 日本語, switchable live, covering UI, backend messages, and generated content. Adding a language is a dictionary file with automatic fallback for missing keys
- 📁 **Project scope** — a dropdown switches Commands / Skills / Agents / Workflows / Config to any project's `.claude/` directory, including per-project memory files
- 🎯 **Accurate usage stats** — recursive transcript scan (subagent trees included), `message.id + requestId` dedup, final-value handling for streamed responses, 5-minute vs 1-hour cache write pricing. Validated day-by-day against ccusage
- ⚡ **Fast** — ~0.8s cold scan of 300MB of transcripts, ~13ms warm (mtime-based incremental cache)
- 🔒 **Local only** — binds to `127.0.0.1`, path-traversal guarded, project scope restricted to known paths

## Quick Start

Requires Node.js ≥ 18.

```bash
npx claude-code-panel
# open http://localhost:4321
```

Or from source (no `npm install` needed — there are zero dependencies):

```bash
git clone https://github.com/13days/claude-panel.git
cd claude-panel
node server.js
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4321` | HTTP port |
| `CLAUDE_DIR` | `~/.claude` | The Claude Code directory to manage |

### One-command Inspector setup

Instead of prefixing every launch, wire the proxy into all your shells once:

```bash
npx claude-code-panel install-proxy   # writes a smart `claude` wrapper to .zshrc / .bashrc / fish
```

The wrapper checks whether the panel is running **at call time**: if it is, `claude` routes through the inspector; if not, it connects directly — so it never breaks when the panel is off. Remove it anytime with `uninstall-proxy`.

### Terminal statusline integration

Show today's spend at the bottom of your Claude Code terminal. In `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "curl -s http://localhost:4321/api/statusline" } }
```

You'll get: `$23.40 today · 40.6M tok · fable-5` — updating as you work.

### Try it with demo data

Don't want to point it at your real `~/.claude` yet? Generate a fake one:

```bash
python3 scripts/gen-demo-data.py
CLAUDE_DIR="$PWD/demo-data/claude" PORT=4999 node server.js
# open http://localhost:4999
```

## Screenshots

### 🎁 Claude Code Wrapped — your shareable stats card

One click on the Stats page generates a beautiful PNG card of your week/month/all-time: spend, tokens, favorite command, favorite model, peak hours and an earned badge. Show off responsibly.

<img src="https://raw.githubusercontent.com/13days/claude-panel/main/docs/10-wrapped-card.png" width="420" alt="wrapped card">

### Usage dashboard — know what you burned

Daily message volume with hover tooltips and time-range switching, per-model token usage, 24h activity distribution:

![stats dashboard](https://raw.githubusercontent.com/13days/claude-panel/main/docs/01-stats-dashboard.png)

…and a `ccusage daily`-compatible cost table, priced per model with 5m/1h cache-tier awareness:

![hover tooltip](https://raw.githubusercontent.com/13days/claude-panel/main/docs/02-stats-hover.png)

### Every slash command in one place

Yours, your plugins', and Claude Code's 34 built-ins — with source tags:

![commands](https://raw.githubusercontent.com/13days/claude-panel/main/docs/03-commands.png)

### Skills, rendered properly

Frontmatter as chips, Markdown with tables and code blocks; installed skills flagged and read-only:

![skill detail](https://raw.githubusercontent.com/13days/claude-panel/main/docs/04-skill-detail.png)

### Edit in place

`⌘S` to save. JSON config files are validated before writing:

![edit mode](https://raw.githubusercontent.com/13days/claude-panel/main/docs/05-edit-mode.png)

### Workflows, plugins, sessions

![workflows](https://raw.githubusercontent.com/13days/claude-panel/main/docs/06-workflows.png)

![plugins](https://raw.githubusercontent.com/13days/claude-panel/main/docs/07-plugins.png)

Find that session from last week and resume it in one paste:

![sessions](https://raw.githubusercontent.com/13days/claude-panel/main/docs/08-sessions.png)

### Speaks your language

![english ui](https://raw.githubusercontent.com/13days/claude-panel/main/docs/09-english-ui.png)

## How it works

Two files. That's the whole thing.

- **`server.js`** — a dependency-free Node HTTP server exposing a small REST API (`/api/commands`, `/api/skills`, `/api/stats`, …) over the files in `CLAUDE_DIR`. Writes are guarded (name validation, JSON parse checks, symlink detection); the usage aggregator parses transcript JSONL with an mtime-keyed in-memory cache
- **`index.html`** — a single-page UI with its own tiny Markdown renderer and CSS charts. No build step, no framework

### Adding a language

1. Register it in `LANGS` in `index.html` (shows up in the dropdown)
2. Add a dictionary to `I18N` in `index.html` (UI strings)
3. Add a dictionary to `STRINGS` in `server.js` (API messages & generated content)

Partial translations are fine — missing keys fall back `your language → English → default`.

## Caveats

- Cost figures are estimates from official per-model pricing (validated against ccusage, but your billing may differ — e.g. batch discounts)
- Transcripts are retained by Claude Code for ~30 days by default; stats can only see what's still on disk
- The built-in command list is a static snapshot — new Claude Code versions may add commands (PRs welcome!)

## License

[MIT](LICENSE)

---

*Built with [Claude Code](https://claude.com/claude-code), for Claude Code.*
