#!/usr/bin/env python3
"""Generate a fake CLAUDE_DIR with rich demo data for screenshots."""
import json, os, shutil, random, uuid
from datetime import datetime, timedelta, timezone

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "demo-data")
CD = os.path.join(BASE, 'claude')  # CLAUDE_DIR
shutil.rmtree(BASE, ignore_errors=True)
os.makedirs(CD)
random.seed(42)
compact = lambda d: d  # 占位，实际靠 dumps 的 separators

def w(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f: f.write(content)

# ---------- commands ----------
w(f'{CD}/commands/review-pr.md', "Review the current PR diff for correctness bugs, missing tests and style issues.\nSummarize findings ranked by severity, then post them as inline comments with `gh`.\nUse $ARGUMENTS as the PR number if provided.\n")
w(f'{CD}/commands/write-tests.md', "Write unit tests for $ARGUMENTS.\nFollow the existing test conventions in this repo, cover edge cases first, and run the suite to verify everything passes.\n")
w(f'{CD}/commands/changelog.md', "Generate a CHANGELOG entry from the commits since the last release tag.\nGroup by Added / Fixed / Changed, keep each line under 80 chars.\n")
w(f'{CD}/commands/standup.md', "Summarize what changed in this repo in the last 24h: commits, merged PRs, open review threads.\nFormat as a short standup update I can paste into Slack.\n")

# ---------- skills (real dirs = user-created) ----------
w(f'{CD}/skills/sql-helper/SKILL.md', """---
name: sql-helper
description: "Build and run read-only SQL queries against the analytics warehouse. Use when the user asks for data pulls, table schemas or quick aggregations."
---

# SQL Helper

Turn natural-language questions into safe, read-only SQL.

## Rules

- **SELECT only** — never write, update or delete
- Always `LIMIT 100` unless the user explicitly asks for more
- Show the generated SQL before running it

## Quick Reference

| Action | Command |
|---|---|
| List tables | `warehouse tables` |
| Table schema | `warehouse schema <table>` |
| Run query | `warehouse query "<sql>"` |

## Example

```sql
SELECT date, count(*) AS signups
FROM events
WHERE name = 'user_signed_up'
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;
```
""")
w(f'{CD}/skills/release-notes/SKILL.md', """---
name: release-notes
description: "Draft user-facing release notes from merged PRs. Use when preparing a release or when the user mentions release notes."
---

# Release Notes

Collect merged PRs since the last tag, cluster them by feature area,
and draft human-friendly release notes (not commit messages).
""")
w(f'{CD}/skills/api-designer/SKILL.md', """---
name: api-designer
description: "Design REST/gRPC APIs with consistent naming, pagination and error conventions. Use for new endpoint or schema design."
---

# API Designer

House rules for API design: plural nouns, cursor pagination,
RFC7807 errors, verbs only for actions (`:cancel`, `:retry`).
""")

# installed skills = symlinks (like axon-cli / marketplace installs)
src_root = os.path.join(BASE, 'agents-skills')
for name, desc in [
    ('web-scraper', 'Scrape and summarize web pages politely (robots.txt aware). Installed from the skill marketplace.'),
    ('pdf-tools', 'Extract text, tables and images from PDF files. Installed from the skill marketplace.'),
    ('i18n-checker', 'Find hard-coded strings and missing translation keys. Installed from the skill marketplace.'),
]:
    w(f'{src_root}/{name}/SKILL.md', f'---\nname: {name}\ndescription: "{desc}"\n---\n\n# {name}\n\nInstalled skill content.\n')
    os.symlink(f'{src_root}/{name}', f'{CD}/skills/{name}')

# ---------- agents ----------
w(f'{CD}/agents/code-reviewer.md', """---
name: code-reviewer
description: Reviews diffs for correctness bugs and risky patterns before merge
tools: Read, Grep, Bash
---

You are a strict code reviewer. Hunt for real bugs (off-by-one, race conditions,
unchecked errors), not style nits. Report findings ranked by severity with
file:line references and a concrete failure scenario for each.
""")
w(f'{CD}/agents/perf-profiler.md', """---
name: perf-profiler
description: Profiles slow endpoints and proposes optimizations with benchmarks
tools: Read, Bash
---

You are a performance engineer. Measure first, guess never.
""")

# ---------- workflows ----------
w(f'{CD}/workflows/nightly-audit.js', """export const meta = {
  name: 'nightly-audit',
  description: 'Fan out reviewers over yesterday\\'s commits, verify findings adversarially, file issues for confirmed bugs',
  phases: [
    { title: 'Scan', detail: 'one reviewer per commit' },
    { title: 'Verify', detail: '3 skeptics per finding' },
  ],
}
phase('Scan')
const commits = await agent('List yesterday\\'s commit SHAs, one per line', { schema: { type: 'object', properties: { shas: { type: 'array', items: { type: 'string' } } }, required: ['shas'] } })
const findings = await parallel(commits.shas.map(sha => () =>
  agent(`Review commit ${sha} for correctness bugs`, { phase: 'Scan', label: `review:${sha.slice(0, 7)}` })))
phase('Verify')
const confirmed = []
for (const f of findings.filter(Boolean)) {
  const votes = await parallel([1, 2, 3].map(() => () =>
    agent(`Try to refute: ${f}. Default to refuted if uncertain.`, { phase: 'Verify' })))
  if (votes.filter(v => v && !v.includes('refuted')).length >= 2) confirmed.push(f)
}
return { confirmed }
""")
w(f'{CD}/workflows/deps-upgrade.js', """export const meta = {
  name: 'deps-upgrade',
  description: 'Upgrade outdated dependencies one at a time, run tests in isolated worktrees, merge the green ones',
  phases: [{ title: 'Discover' }, { title: 'Upgrade' }],
}
phase('Discover')
const outdated = await agent('Run npm outdated --json and return the package names as a JSON array')
phase('Upgrade')
const results = await pipeline(JSON.parse(outdated),
  pkg => agent(`Upgrade ${pkg} to latest, run the test suite, report pass/fail`, { isolation: 'worktree', phase: 'Upgrade' }))
return { results }
""")

# ---------- settings ----------
w(f'{CD}/settings.json', json.dumps({
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {"allow": ["Bash(npm run test:*)", "Bash(gh pr view:*)"]},
  "hooks": {
    "PostToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "npx prettier --write \"$CLAUDE_FILE_PATHS\""}]}]
  },
  "statusLine": {"type": "command", "command": "~/.claude/statusline.sh"}
}, indent=2))
w(f'{CD}/CLAUDE.md', "# Global instructions\n\n- Prefer small, reviewable commits\n- Always run the test suite before claiming a task is done\n- When in doubt about product behavior, ask instead of guessing\n")

# ---------- plugins ----------
plug_root = os.path.join(BASE, 'plugin-cache')
def mk_plugin(market, name, version, skills):
    ip = f'{plug_root}/{market}/{name}/{version}'
    w(f'{ip}/.claude-plugin/plugin.json', json.dumps({"name": name, "description": f"{name.replace('-', ' ').title()} toolkit for Claude Code."}))
    w(f'{ip}/README.md', f'# {name}\n\nDemo plugin.\n')
    for s, d in skills:
        w(f'{ip}/skills/{s}/SKILL.md', f'---\nname: {s}\ndescription: "{d}"\n---\n\n# {s}\n')
    return {"scope": "user", "installPath": ip, "version": version,
            "installedAt": "2026-05-14T09:00:00.000Z", "lastUpdated": "2026-06-28T09:00:00.000Z",
            "gitCommitSha": uuid.uuid4().hex[:40]}

plugins = {
  "document-skills@anthropic-agent-skills": [mk_plugin('anthropic-agent-skills', 'document-skills', '1.4.0', [
      ('pdf', 'Read, create and edit PDF files'), ('docx', 'Read, create and edit Word documents'),
      ('xlsx', 'Read, create and edit Excel spreadsheets'), ('pptx', 'Read, create and edit PowerPoint decks')])],
  "git-toolkit@community-plugins": [mk_plugin('community-plugins', 'git-toolkit', '2.1.3', [
      ('smart-rebase', 'Interactive-free rebase with conflict auto-resolution hints'),
      ('pr-splitter', 'Split a huge PR into reviewable stacked PRs')])],
}
w(f'{CD}/plugins/installed_plugins.json', json.dumps({"version": 2, "plugins": plugins}, indent=2))

# ---------- projects + transcripts + history ----------
proj_root = os.path.join(BASE, 'repos')
projects = [f'{proj_root}/acme-web', f'{proj_root}/api-server', f'{proj_root}/data-pipeline']
for p in projects: os.makedirs(p, exist_ok=True)
# project-scope resources for acme-web
w(f'{projects[0]}/.claude/commands/deploy-preview.md', 'Build the app and deploy a preview environment, then post the URL.\n')
w(f'{projects[0]}/CLAUDE.md', '# acme-web\n\n- Next.js 15, App Router, pnpm\n- Run `pnpm test:unit` before committing\n')

enc = lambda p: p.replace('/', '-').replace('.', '-')
MODELS = ['claude-fable-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929']
PROMPTS = [
  'Add rate limiting to the public API gateway',
  'Why is the checkout page slow on mobile? Profile and fix it',
  'Refactor the billing module to use the new event bus',
  'Write integration tests for the webhook retry logic',
  'Upgrade React 18 -> 19 and fix the breaking changes',
  'Design a migration plan for splitting the users table',
  'Investigate the flaky CI job on main',
  'Add dark mode support to the settings page',
  'Build a CLI to backfill missing analytics events',
  'Document the deploy pipeline for new hires',
  'Fix the memory leak in the websocket handler',
  'Add OpenTelemetry tracing to the order service',
]
history = []
now = datetime(2026, 7, 6, 21, 30, tzinfo=timezone.utc)
sid_count = 0
for day_off in range(44, -1, -1):
    day = now - timedelta(days=day_off)
    if day.weekday() >= 5 and random.random() < 0.6: continue  # most weekends off
    n_sessions = random.randint(1, 3)
    for s in range(n_sessions):
        sid = str(uuid.uuid4()); sid_count += 1
        proj = random.choice(projects)
        pdir = f'{CD}/projects/{enc(proj)}'
        os.makedirs(pdir, exist_ok=True)
        start = day.replace(hour=random.choice([10, 11, 14, 15, 16, 20, 21, 22]), minute=random.randint(0, 59))
        lines = []
        n_turns = random.randint(2, 6)
        # recent 12 days lean fable+opus, older lean opus/sonnet/haiku
        pool = ['claude-fable-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'] if day_off <= 12 else ['claude-opus-4-8', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
        def J(o): return json.dumps(o, separators=(",", ":"))
        REPLIES = [
            "Let me look at how this is wired up before changing anything.",
            "Found it — the handler wasn't awaiting the async call. Fixing now.",
            "I'll add a test that reproduces this first, then apply the fix.",
            "Done. Ran the suite and all 42 tests pass.",
            "Here's the plan: 1) add rate limiter middleware 2) wire it into the gateway 3) add tests.",
        ]
        TOOLCALLS = [
            ("Bash", {"command": "npm test", "description": "Run the test suite"}),
            ("Read", {"file_path": "src/gateway/index.ts"}),
            ("Edit", {"file_path": "src/billing/events.ts", "old_string": "sync()", "new_string": "await sync()"}),
            ("Grep", {"pattern": "rateLimit", "output_mode": "files_with_matches"}),
        ]
        RESULTS = ["✓ 42 passing (3.1s)", "export function handler(req, res) { … }", "Applied 1 edit to src/billing/events.ts", "src/gateway/rateLimit.ts"]
        for turn in range(n_turns):
            ts = start + timedelta(minutes=turn * random.randint(3, 12))
            prompt = random.choice(PROMPTS)
            history.append({"display": prompt, "pastedContents": {}, "timestamp": int(ts.timestamp() * 1000), "project": proj, "sessionId": sid})
            lines.append(J({"type": "user", "message": {"role": "user", "content": prompt}, "sessionId": sid, "timestamp": ts.strftime('%Y-%m-%dT%H:%M:%S.000Z')}))
            for a in range(random.randint(3, 14)):
                ats = ts + timedelta(seconds=20 * (a + 1))
                model = pool[0] if random.random() < 0.6 else random.choice(pool)
                usage = {
                    "input_tokens": random.randint(5, 4000),
                    "output_tokens": random.randint(80, 3500),
                    "cache_read_input_tokens": random.randint(20000, 900000),
                    "cache_creation_input_tokens": random.randint(1000, 60000),
                }
                usage["cache_creation"] = {"ephemeral_1h_input_tokens": int(usage["cache_creation_input_tokens"] * 0.3), "ephemeral_5m_input_tokens": int(usage["cache_creation_input_tokens"] * 0.7)}
                msg_id = f'msg_{uuid.uuid4().hex[:16]}'
                # 内容块：文本 +（部分）工具调用，让回放有实际内容
                content = [{"type": "text", "text": random.choice(REPLIES)}]
                tool_id = None
                if random.random() < 0.6:
                    tname, tinput = random.choice(TOOLCALLS)
                    tool_id = f'toolu_{uuid.uuid4().hex[:12]}'
                    content.append({"type": "tool_use", "id": tool_id, "name": tname, "input": tinput})
                lines.append(J({"type": "assistant", "requestId": f'req_{uuid.uuid4().hex[:12]}',
                    "message": {"id": msg_id, "role": "assistant", "model": model, "content": content, "usage": usage},
                    "sessionId": sid, "timestamp": ats.strftime('%Y-%m-%dT%H:%M:%S.000Z')}))
                # 工具返回（下一条 user 里的 tool_result）
                if tool_id:
                    lines.append(J({"type": "user", "message": {"role": "user", "content": [
                        {"type": "tool_result", "tool_use_id": tool_id, "content": random.choice(RESULTS)}]},
                        "sessionId": sid, "timestamp": (ats + timedelta(seconds=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z')}))
                # 记录最新会话的所有 assistant 消息，用于生成多轮对齐抓包
                if day_off == 0:
                    globals().setdefault('demo_rounds', [])
                    if len(globals()['demo_rounds']) < 6:
                        globals()['demo_rounds'].append({"sid": sid, "msg_id": msg_id, "model": model})
            # 每轮耗时标记
            lines.append(J({"type": "system", "subtype": "turn_duration", "durationMs": random.randint(30000, 400000),
                "messageCount": random.randint(8, 40), "sessionId": sid, "timestamp": ts.strftime('%Y-%m-%dT%H:%M:%S.000Z')}))
        with open(f'{pdir}/{sid}.jsonl', 'w') as f: f.write('\n'.join(lines) + '\n')
history.sort(key=lambda h: h['timestamp'])
with open(f'{CD}/history.jsonl', 'w') as f:
    for h in history: f.write(json.dumps(h) + '\n')

# ---------- 抓包记录（让 Inspector + 增强回放在 demo 数据上有内容）----------
DEMO_SYSTEM = (
    "You are Claude Code, Anthropic's official CLI for Claude.\n\n"
    "You are an interactive agent that helps users with software engineering tasks.\n\n"
    "# Tone and style\n"
    "Be concise, direct, and to the point. Answer in fewer than 4 lines unless asked for detail.\n\n"
    "# Following conventions\n"
    "When making changes to files, first understand the file's code conventions. "
    "Mimic code style, use existing libraries and utilities, and follow existing patterns.\n\n"
    "# Doing tasks\n"
    "Use the TodoWrite tool to plan the task if required. Use search tools to understand the codebase.\n"
    "[... full system prompt captured live via the Inspector proxy ...]"
)
DEMO_TOOLS = [
    {"name": "Bash", "description": "Executes a bash command in a persistent shell session with optional timeout. Use for running scripts, git, package managers. Avoid using it for file search — prefer Grep/Glob."},
    {"name": "Read", "description": "Reads a file from the local filesystem. Supports images, PDFs and Jupyter notebooks. Returns content with line numbers in cat -n format."},
    {"name": "Edit", "description": "Performs exact string replacements in a file. You must Read the file before editing. old_string must be unique unless replace_all is set."},
    {"name": "Write", "description": "Writes a file to the local filesystem, overwriting if it exists. Prefer Edit for partial changes to existing files."},
    {"name": "Grep", "description": "A powerful search tool built on ripgrep. Supports full regex, glob filtering, and output modes (content / files_with_matches / count)."},
    {"name": "TodoWrite", "description": "Create and manage a structured task list for the current coding session to track progress and give the user visibility."},
    {"name": "Task", "description": "Launch a new subagent to handle complex, multi-step tasks autonomously. Choose the agent type that best matches the task."},
]
# 多轮抓包：模拟一次对话里 Claude Code 的 agentic loop（每轮一次 API 往返）
ROUND_STEPS = [
    ("I'll add a token-bucket rate limiter as gateway middleware. Let me check the existing structure first.",
     "The user wants rate limiting on the public API gateway. A token-bucket limiter fits best. Let me read the gateway entry point before writing code."),
    ("The gateway registers routes in a single file. I'll add the limiter as middleware there.",
     "Now I understand the structure. I'll create the limiter module, then wire it into the route registration."),
    ("Created the limiter and wired it in. Now writing tests for the burst and refill behavior.",
     "Implementation done. I should add tests covering: normal requests pass, burst is allowed, sustained overflow is 429'd."),
    ("All tests pass. Rate limiting is live on the gateway with 100 req/min per key and a burst of 20.",
     "Tests are green. Let me summarize what changed for the user."),
]
rounds = globals().get('demo_rounds', [])
recs = []
for i, cap in enumerate(rounds[:len(ROUND_STEPS)]):
    out, think = ROUND_STEPS[i]
    ts_i = (now + timedelta(seconds=i * 40)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    recs.append({
        "id": i + 1, "ts": ts_i, "path": "/v1/messages", "status": 200,
        "durationMs": random.randint(4000, 12000), "model": cap["model"], "system": DEMO_SYSTEM,
        "tools": DEMO_TOOLS,
        "messagesCount": 4 + i * 3, "lastUser": "Add rate limiting to the public API gateway",
        "respMsgId": cap["msg_id"], "userAgent": "claude-cli/2.1.4 (external, cli)", "clientVersion": "2.1.4",
        "anthropicVersion": "2023-06-01", "betas": "context-1m-2025-08-07",
        "messages": [
            {"role": "user", "parts": [{"kind": "text", "text": "Add rate limiting to the public API gateway"}]},
        ] + ([] if i == 0 else [
            {"role": "assistant", "parts": [{"kind": "text", "text": ROUND_STEPS[i-1][0]}, {"kind": "tool_use", "name": "Read", "input": '{\n  "file_path": "src/gateway/index.ts"\n}'}]},
            {"role": "user", "parts": [{"kind": "tool_result", "text": "export function createGateway(routes) {\n  const app = express();\n  routes.forEach(r => app.use(r.path, r.handler));\n  return app;\n}"}]},
        ]),
        "outText": out, "thinking": think,
        "usage": {"input_tokens": random.randint(3000, 6000), "output_tokens": random.randint(400, 2200),
                  "cache_read_input_tokens": random.randint(600000, 900000), "cache_creation_input_tokens": random.randint(10000, 40000)},
        "requestBytes": random.randint(40000, 60000), "responseBytes": random.randint(5000, 12000),
    })
if recs:
    with open(f'{CD}/panel-captures.jsonl', 'w') as f:
        for rec in recs: f.write(json.dumps(rec) + '\n')

print(f'demo ready: {CD}\nsessions={sid_count} history_lines={len(history)}')
