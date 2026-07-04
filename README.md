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
- 🪶 **Tiny & MIT** — core + CLI are zero-dependency (just Node ≥ 18)

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

## Configuration

| Env | Meaning | Default |
|-----|---------|---------|
| `GODOZO_TELEGRAM_TOKEN`   | bot token from @BotFather | — (required) |
| `GODOZO_TELEGRAM_CHAT_ID` | your chat id from @userinfobot | — (required) |
| `GODOZO_LABEL`            | source name shown in messages | `godozo` |
| `GODOZO_DEFAULT_TIMEOUT`  | approval wait, seconds | `600` |
| `GODOZO_CHANNEL`          | which channel to use | `telegram` |

Config is read from the environment or a `.env` file in the working directory.

---

## Roadmap

- **Channels:** Slack (interactive buttons), email, SMS/WhatsApp, plus escalation ("no answer in N min → escalate").
- **Hooks:** first-class Claude Code hook helpers (`Stop`/`Notification` → notify, `PreToolUse` → gate).
- **SDK:** thin Python/TS clients for custom agents.
- **Audit:** a durable log of every approval — who, when, what.

## License

MIT © 2026 Morgan Christian
