# godozo

**Notify and get approvals from your AI agents — on your phone.**

`godozo` is a tiny, self-hostable
human-in-the-loop relay. Your agent — Claude Code, an MCP client, or any shell
script — can **ping you** when something finishes or needs attention, and
**pause for your approval** before it does anything risky. You tap **Approve**
or **Deny** on your phone; the agent continues.

- 📣 **Notify** — "the migration finished", "the build failed", "deploy #128 shipped"
- 🚦 **Approve** — the agent blocks on `request_approval` / `gate` until you decide
- 🤖 **Works anywhere** — MCP server (any MCP client), a CLI (any script), or a Claude Code hook
- 🏠 **Self-host in a minute** — Telegram channel needs **no public webhook, no inbound port** (long-polling). Runs behind NAT, on a laptop, next to a build.
- 🪶 **Tiny & Apache-2.0** — core + CLI are zero-dependency (just Node ≥ 18)

> Status: **v0** — Telegram (notify + interactive approvals + two-way listen),
> Slack (notify), a CLI, an MCP server, and a fail-closed Claude Code hook.
> Slack approvals, email/SMS, and escalation are on the roadmap below.

---

## Wire it in with one prompt (for AI agents)

godozo is meant to be installed *by* an agent. Point Claude Code (or any coding
agent) at the machine-readable doc and let it do the setup:

```
Read ./llms.txt (or https://github.com/morganchristian/godozo/blob/main/llms.txt)
and wire godozo into this project: configure .env, verify with `godozo doctor`,
and add a PreToolUse hook that blocks force-push and rm -rf until I approve on my
phone. Send a test notification and don't stop until I confirm I received it.
```

[`llms.txt`](./llms.txt) is a dense, verified command/config reference written
for that use. Everything below is the same information for humans.

---

## Quickstart (2 minutes)

**1. Make a Telegram bot** (the v0 channel — free, two-way buttons, no phone-number/10DLC hassle):
- Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **token**.
- Message [@userinfobot](https://t.me/userinfobot) → copy your numeric **chat id**.
- Send your new bot any message once, so it's allowed to DM you.

**2. Configure:**
```bash
git clone https://github.com/morganchristian/godozo.git && cd godozo
cp .env.example .env       # paste your token + chat id
node bin/godozo.js doctor  # → ✅ primary=telegram bot=@yourbot target=...
```

**3. Use it:**
```bash
# fire-and-forget notification
node bin/godozo.js notify "the nightly job finished"

# blocking approval — exit code IS the decision
node bin/godozo.js gate --title "deploy to prod?" --detail "docker compose up -d" \
  && ./deploy.sh
```
(Install globally with `npm link` or `npm i -g .` to just type `godozo`. The
rest of this README assumes you did.)

A runnable version of both verbs is in
[`examples/notify-and-gate.sh`](./examples/notify-and-gate.sh).

---

## CLI

```
godozo notify <message> [--title T] [--label L]
godozo gate --title T [--detail D] [--timeout SECONDS] [--label L]
godozo gate-hook [--match "substr,substr"] [--title T] [--timeout SECONDS]
godozo listen --exec "<command>" [--timeout SECONDS] | --echo
godozo log [--tail N]
godozo doctor
godozo --help | --version
```

`gate`'s exit code is the decision, so it composes with `&&` / `||`:

| Exit | Meaning |
|------|---------|
| `0`  | approved |
| `10` | denied |
| `20` | timed out |
| `1`  | error |

```bash
godozo gate --title "prod deploy" --detail "$CMD" && eval "$CMD"
```

---

## Use it from an AI agent (MCP)

`godozo` ships an MCP server exposing two tools — `notify` and
`request_approval` — so **any** MCP client can reach you.

```bash
npm install   # MCP server needs @modelcontextprotocol/sdk + zod
```

**Claude Code:**
```bash
claude mcp add godozo -- node /absolute/path/to/godozo/mcp/server.js
```

The two tools:
- `notify({ message, title? })` — one-way ping, returns immediately.
- `request_approval({ title, detail?, timeout_seconds? })` — **blocks** until you
  answer, then returns `{ verdict: "APPROVED" | "DENIED" | "TIMED_OUT", by, at }`.

Other clients (Cursor `.cursor/mcp.json`, Claude Desktop, Codex, Gemini CLI,
VS Code `.vscode/mcp.json`, …) use the same idea — point them at
`node .../mcp/server.js`. See [`DESIGN.md`](./DESIGN.md#registering-across-clients).

Then tell the agent *when* to use it — the paste-ready block is in
[`examples/CLAUDE-md-snippet.md`](./examples/CLAUDE-md-snippet.md):
```markdown
- When a long task finishes or errors, call godozo `notify`.
- Before any prod deploy or destructive action, call godozo `request_approval`
  and WAIT for the answer.
```

### The prompt is the policy; the hook is the seatbelt

Telling the agent to ask is **cooperative** — the same model decides what counts
as "a decision," so it can skip it. For the handful of actions that must *never*
slip, add a deterministic Claude Code `PreToolUse` hook. It fires outside the
model's control and blocks the tool until you approve.

Add this to `.claude/settings.json`:
```json
{ "hooks": { "PreToolUse": [
  { "matcher": "Bash",
    "hooks": [{ "type": "command",
      "command": "godozo gate-hook --match \"push --force,push -f,reset --hard,rm -rf\" --title \"Destructive command\"" }] }
]}}
```

How it works — and why it's safe:
- `matcher` is a **tool name** (`"Bash"`), not a command pattern. It selects
  *which tool* to inspect; `gate-hook --match` narrows to *which commands* prompt.
- `gate-hook` reads the tool payload from **stdin**, so your phone shows the
  exact command being run.
- It speaks Claude Code's hook protocol: **Approve → exit 0** (the command runs);
  **Deny → exit 2** (Claude Code blocks the command). It **fails closed** — a
  denial, a timeout, or even a missing bot token all block rather than slip.

> A hook using plain `godozo gate` would *not* be safe: `gate` exits `10` on
> deny, which Claude Code treats as a non-blocking error and runs the command
> anyway. Use `gate-hook` for hooks; use `gate` for shell `&&`/`||`.

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

## Slack (notifications)

Add Slack and your notifications **fan out to it automatically** — every
`godozo notify` lands on Telegram *and* Slack, no code change. (Interactive
approvals stay on Telegram in v0; Slack yes/no via Socket Mode is on the roadmap,
so `gate`/`gate-hook` use the primary channel.)

**1. Create a Slack app + bot token:**
- Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
  **From scratch** → name it, pick your workspace.
- **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** → add `chat:write`.
- **Install to Workspace** (top of the same page) → **Allow**.
- Copy the **Bot User OAuth Token** — it starts with `xoxb-`.

**2. Get the channel id + invite the bot:**
- In Slack, open the target channel → **View channel details** → scroll to the
  bottom → copy the **Channel ID** (starts with `C…`).
- Invite the bot to that channel: type `/invite @your-bot-name` in it. (A bot
  can only post to channels it's a member of.)

**3. Configure and verify:**
```bash
# add to .env
GODOZO_SLACK_BOT_TOKEN=xoxb-your-bot-token
GODOZO_SLACK_CHANNEL=C0123456789

node bin/godozo.js doctor
# → ✅ primary=telegram bot=@yourbot ...
#    notify → telegram, slack        ← Slack is now in the fan-out
node bin/godozo.js notify "hello from godozo"   # lands on both channels
```

Notes:
- **Fan-out is automatic** once both channels have creds. To pin it explicitly,
  set `GODOZO_NOTIFY_CHANNELS="telegram,slack"`.
- **Slack-only** (no Telegram): set `GODOZO_CHANNEL=slack`. `notify` + `doctor`
  work; `gate`/`gate-hook`/`listen` will error, because interactive approvals
  need Telegram (or Slack Socket Mode, not in this build). Keep Telegram as the
  primary if you want approvals.

## Configuration

Config is read from the environment or a `.env` file in the working directory.

| Env | Meaning | Default |
|-----|---------|---------|
| `GODOZO_TELEGRAM_TOKEN`   | bot token from @BotFather | — (required) |
| `GODOZO_TELEGRAM_CHAT_ID` | your chat id from @userinfobot | — (required) |
| `GODOZO_TELEGRAM_ALLOW`   | comma-sep Telegram user ids allowed to answer/drive | your chat id |
| `GODOZO_LABEL`            | source name shown in messages | `godozo` |
| `GODOZO_DEFAULT_TIMEOUT`  | approval wait, seconds | `600` |
| `GODOZO_CHANNEL`          | primary channel (for approvals / listen) | `telegram` |
| `GODOZO_SLACK_BOT_TOKEN`  | Slack bot token (`xoxb-…`) | — |
| `GODOZO_SLACK_CHANNEL`    | Slack channel id (`C…`) | — |
| `GODOZO_NOTIFY_CHANNELS`  | pin notify fan-out list (default: all configured) | — |
| `GODOZO_AUDIT`            | audit log on/off (`off` disables) | on |
| `GODOZO_AUDIT_FILE`       | audit log path | `~/.godozo/audit.jsonl` |

**Multi-channel:** notifications fan out to *every* configured channel — add
Slack creds and your Telegram alerts also land in Slack. Interactive *approvals*
stay on the primary channel (`GODOZO_CHANNEL`, Telegram in v0).

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

- **Channels:** notifications fan out to every configured channel (Telegram +
  Slack shipped; email + SMS/WhatsApp next). Interactive *approvals* stay on the
  primary channel — Slack yes/no via Socket Mode is on the roadmap. Escalation
  ("no answer in N min → escalate") planned.
- **Hooks:** `gate-hook` ships today (fail-closed PreToolUse gate); first-class
  helpers for `Stop`/`Notification` → notify are next.
- **SDK:** thin Python/TS clients for custom agents.
- **Audit:** local JSONL ships today (`godozo log`); hosted, queryable, retention
  + export is the roadmap.

## License

Apache License 2.0 © 2026 MC375 Ventures — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
