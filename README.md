# godozo

**Notify and get approvals from your AI agents — on your phone.**

`godozo` (from *go* + どうぞ *dōzo*, "go ahead") is a tiny, self-hostable
human-in-the-loop relay. Your agent — Claude Code, an MCP client, or any shell
script — can **ping you** when something finishes or needs attention, and
**pause for your approval** before it does anything risky. You tap **Approve**
or **Deny** on your phone; the agent continues.

- 📣 **Notify** — "the migration finished", "the build failed", "deploy #128 shipped"
- 🚦 **Approve** — the agent blocks on `request_approval` until you decide
- 🤖 **Works anywhere** — MCP server (any MCP client), a CLI (any script), or a Claude Code hook
- 🏠 **Self-host in a minute** — Telegram channel needs **no public webhook, no inbound port** (long-polling). Runs behind NAT, on a laptop, next to a build.
- 🪶 **Tiny & Apache-2.0** — core + CLI are zero-dependency (just Node ≥ 18)

> Status: **v0** — Telegram channel, CLI, and MCP server. Slack / email / SMS
> and the deterministic hook helpers are on the roadmap below.

---

## Quickstart (2 minutes)

**1. Make a Telegram bot** (the v0 channel — free, two-way buttons, no phone-number/10DLC hassle):
- Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **token**.
- Message [@userinfobot](https://t.me/userinfobot) → copy your numeric **chat id**.
- Send your new bot any message once, so it's allowed to DM you.

**2. Configure:**
```bash
git clone https://github.com/morganchristian/godozo.git && cd godozo
cp .env.example .env      # paste your token + chat id
node bin/godozo.js doctor # → ✅ channel=telegram bot=@yourbot chat=...
```

**3. Use it:**
```bash
# fire-and-forget notification
node bin/godozo.js notify "the nightly job finished"

# blocking approval — exit code IS the decision
node bin/godozo.js gate --title "deploy to prod?" --detail "docker compose up -d" \
  && ./deploy.sh
```
(Install globally with `npm link` or `npm i -g .` to just type `godozo`.)

---

## Use it from an AI agent (MCP)

`godozo` ships an MCP server exposing two tools — `notify` and
`request_approval` — so **any** MCP client can reach you.

```bash
npm install                      # MCP server needs @modelcontextprotocol/sdk + zod
```

**Claude Code:**
```bash
claude mcp add godozo -- node /absolute/path/to/godozo/mcp/server.js
```
Other clients (Cursor `.cursor/mcp.json`, Claude Desktop, Codex, Gemini CLI, …)
use the same idea — point them at `node .../mcp/server.js`. See
[`DESIGN.md`](./DESIGN.md#registering-across-clients).

Then tell the agent *when* to use it (e.g. in `CLAUDE.md`):
```markdown
- When a long task finishes or errors, call godozo `notify`.
- Before any prod deploy or destructive action, call godozo `request_approval`
  and WAIT for the answer.
```

### The prompt is the policy; the hook is the seatbelt
Telling the agent to ask is **cooperative** — it decides what counts as "a
decision." For the handful of actions that must *never* slip, add a
deterministic Claude Code `PreToolUse` hook so it blocks no matter what:
```json
{ "hooks": { "PreToolUse": [
  { "matcher": "Bash(docker compose*prod*up*)",
    "hooks": [{ "type": "command",
      "command": "godozo gate --title 'prod deploy' --detail \"$CLAUDE_TOOL_INPUT\"" }] }
]}}
```
More on this split in [`DESIGN.md`](./DESIGN.md).

---

## Two-way: text your bot (`godozo listen`)

godozo also runs *the other direction* — you text your bot, it runs a command on
your machine, and the output comes back. This turns any agent or script into
something you can drive from your phone.

```bash
# echo loop — text your bot, it replies "you said: ..." (great first test)
node bin/godozo.js listen --echo

# chat-only agent bridge (SAFE) — tools disabled, so it can only ANSWER,
# never run commands or edit files. The message is read from stdin.
node bin/godozo.js listen --exec 'claude -p --tools ""'

# full-agent bridge (POWERFUL, RISKY) — the agent CAN use tools driven by your
# texts, unattended. Only if you fully trust the channel: texting becomes acting.
node bin/godozo.js listen --exec 'claude -p "$GODOZO_MESSAGE"'
```

> ⚠️ **Chat vs agent.** A *chat* bridge (`--tools ""`) just answers — low risk.
> An *agent* bridge with tools can take actions from whatever is texted to the
> bot, with no per-action approval. Prefer chat-only unless you really mean it.

Each incoming message is passed to the command on **stdin** and as
**`$GODOZO_MESSAGE`** (never spliced into the command string, so message text
can't inject shell). stdout is sent back as the reply. Only allowlisted users
(`GODOZO_TELEGRAM_ALLOW`, default = your chat id) can drive it.

> **One poller per bot token.** Telegram allows a single `getUpdates` listener
> per token, so don't run `listen` and a `gate` on the *same* token at once
> (outbound `notify` is fine alongside `listen`). Use a second bot for both, or
> the unified daemon on the roadmap.

---

## Configuration

| Env | Meaning | Default |
|-----|---------|---------|
| `GODOZO_TELEGRAM_TOKEN`   | bot token from @BotFather | — (required) |
| `GODOZO_TELEGRAM_CHAT_ID` | your chat id from @userinfobot | — (required) |
| `GODOZO_LABEL`            | source name shown in messages | `godozo` |
| `GODOZO_DEFAULT_TIMEOUT`  | approval wait, seconds | `600` |
| `GODOZO_CHANNEL`          | which channel to use (`telegram` or `slack`) | `telegram` |
| `GODOZO_SLACK_BOT_TOKEN`  | Slack bot token (`xoxb-…`) when channel=slack | — |
| `GODOZO_SLACK_CHANNEL`    | Slack channel id (`C…`) | — |
| `GODOZO_AUDIT`            | audit log on/off (`off` disables) | on |
| `GODOZO_AUDIT_FILE`       | audit log path | `~/.godozo/audit.jsonl` |

Config is read from the environment or a `.env` file in the working directory.

## Audit log

Every notify, approval (with the decision + who + when), and inbound message is
appended as one JSON line to `~/.godozo/audit.jsonl` — a durable, greppable
record. On by default; `GODOZO_AUDIT=off` disables it, `GODOZO_AUDIT_FILE`
relocates it.

```bash
godozo log --tail 20       # recent entries, human-readable
cat ~/.godozo/audit.jsonl  # raw JSONL for grep / jq
```

---

## Roadmap

- **Channels:** Slack *notify* ships now (`GODOZO_CHANNEL=slack`); Slack interactive *approvals* (Socket Mode), email, SMS/WhatsApp, and escalation ("no answer in N min → escalate") are next. Multi-channel fan-out (alert Slack *and* Telegram at once) planned.
- **Hooks:** first-class Claude Code hook helpers (`Stop`/`Notification` → notify, `PreToolUse` → gate).
- **SDK:** thin Python/TS clients for custom agents.
- **Audit:** local JSONL ships today (`godozo log`); hosted, queryable, retention + export is the roadmap.

## License

Apache License 2.0 © 2026 MC375 Ventures — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
