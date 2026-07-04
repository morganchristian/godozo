# godozo — design

The one idea: an agent should be able to **reach a human and wait** — to say
"I'm done" or "should I?" — without you babysitting a terminal. `godozo` is the
small relay that makes that a one-liner from anywhere.

## Two verbs

- **`notify(message)`** — fire-and-forget. The agent (or a script) tells you
  something happened. Never blocks.
- **`requestApproval({ title, detail })`** — blocks until a human taps Approve
  or Deny (or it times out). The return value *is* the decision.

Everything else is delivery.

## Architecture: a channel-agnostic core + adapters

```
  agent / script / MCP client / hook
              │
        ┌─────┴─────┐
        │   core    │   notify() · requestApproval()
        └─────┬─────┘
        ┌─────┴──────────────────────┐
        │ channel adapter            │   v0: telegram
        │  send message + collect    │   next: slack, email, sms
        │  the human's answer        │
        └────────────────────────────┘
```

The core (`src/core.js`) knows only the two verbs. A **channel adapter** knows
how to send a message and how the answer comes back. Adding Slack/email/SMS
means writing one adapter — the core, CLI, and MCP server don't change.

## Why Telegram first, and why long-polling matters

The hard part of any approval relay is **receiving the answer**. Slack buttons,
Twilio SMS replies, and email replies all need a **public, always-on webhook
endpoint** — real infrastructure. Telegram's Bot API can be **long-polled**
(`getUpdates`), so v0 needs **no public URL and no inbound port**: it runs
behind NAT, on a laptop, or next to a build on a box that only makes *outbound*
connections. That makes self-hosting genuinely one-minute, which is the whole
point of the OSS core.

Trade-off: long-polling means **one poller per bot token** at a time. Fine for a
single operator; a multi-user hosted deployment would switch to webhooks + a
shared pending-approval store (see below).

## The pending-approval model

`requestApproval` sends a message with a unique id embedded in each button
(`gd:<id>:<action>`), then polls for a button press matching that id, ACKs it,
edits the message to show the outcome, and returns. Timeout edits the message
to "timed out" and returns `{ timedOut: true }`. A hosted, multi-channel
version generalizes this to a durable **pending-approval store** that any
channel's callback can resolve — but the local single-operator version needs no
database at all.

## Two-way bridge (`listen`)

`notify` / `requestApproval` are godozo talking *to* you. `listen` is the
reverse: a long-poll loop reads incoming messages from allowlisted users, hands
each to a handler, and sends the reply back. The CLI's `--exec` handler runs a
shell command per message (message on stdin + `$GODOZO_MESSAGE`, never
interpolated), so you can bridge to any agent — `claude -p "$GODOZO_MESSAGE"`, a
REPL, a script.

Because Telegram permits only one `getUpdates` poller per bot token, `listen`
and `gate` can't share a token simultaneously. The clean long-term answer is a
single **unified daemon** that owns the one poll loop and dispatches each update
to the right consumer (approval vs chat) — that also becomes the natural home
for escalation and multi-channel. For now: separate tokens, or one mode at a
time. (Outbound `notify` never polls, so it always coexists fine.)

## MCP and hooks: the agent's voice vs the harness's reflexes

Two integration surfaces, on purpose:

- **MCP** = *the agent's voice.* The model **chooses** to call `notify` /
  `request_approval`. Rich and cross-tool (any MCP client), and a blocking tool
  call is a natural fit for approval — it just doesn't return until you answer.
  But it is **cooperative, not enforced**: the same model decides whether to
  ask, so it can skip it. Great for notifications and judgment-call checkpoints.
- **Hooks** = *the harness's reflexes.* A Claude Code `PreToolUse` hook fires
  **deterministically, outside the model's control**, and can block a specific
  action (a prod deploy, an `rm -rf`) until `godozo gate` returns 0. This is the
  enforcement path — use it for the handful of one-way doors.

> **The prompt is the policy; the hook is the seatbelt.** Write a natural-language
> policy for the broad, fuzzy stuff; add two or three hook matchers for the
> actions that must never slip. Don't gate everything — just the crown jewels.
>
> Corollary: **MCP is not a security boundary.** If an action must be gated, use
> a hook (or SDK middleware), not just an instruction to the model.

## Registering across clients

MCP is an open standard — "registering the server" is the same idea everywhere,
just a different file:

| Client | Where |
|--------|-------|
| Claude Code | `claude mcp add godozo -- node .../mcp/server.js` |
| Cursor | `.cursor/mcp.json` |
| Claude Desktop | `claude_desktop_config.json` |
| VS Code / Copilot | `.vscode/mcp.json` (uses a `servers` key) |
| Codex CLI | `~/.codex/config.toml` |
| Gemini CLI | `~/.gemini/settings.json` |

A future hosted build would offer a **remote** MCP server (a URL + OAuth) so
there's nothing to run locally at all; the OSS build is stdio/self-hosted.

## Non-goals (for the OSS core)

- Not a workflow engine — it's one relay primitive you compose into your own agents/scripts.
- Not an auth/policy platform — it gates *by asking a human*, not by evaluating RBAC.
- The local core has no database and no public endpoint on purpose. Durability,
  multi-user, escalation, and audit are where a managed layer would add value.

## Layout

```
src/core.js              two verbs, channel selection
src/config.js            env / .env loading (zero-dep)
src/channels/telegram.js the v0 adapter (fetch + long-poll)
bin/godozo.js            CLI: notify · gate · doctor
mcp/server.js            MCP stdio server (notify + request_approval)
```
