# Example: wiring godozo into an autonomous job loop

A common use case — an unattended job runner (a build/deploy loop, a batch
pipeline, a nightly cron) on a server. godozo gives it a voice (tell me when a
job finishes or fails) and a brake (get my OK before a production deploy), all
outbound-only so it runs fine behind NAT.

## Notify on milestones and failures

After a job finishes:

```bash
godozo notify --title "pipeline" "✅ $JOB done ($COUNT processed)"
```

On failure or a pause:

```bash
godozo notify --title "pipeline ⚠️" "$JOB failed: $ERR — paused"
```

## Gate a production deploy

Before an irreversible step, block on approval — the exit code is the decision,
so it composes with `&&`:

```bash
if godozo gate --title "prod deploy: $JOB" \
     --detail "$DEPLOY_CMD" \
     --timeout 900; then
  eval "$DEPLOY_CMD"
else
  echo "deploy not approved — parking job"
  requeue "$JOB"
fi
```

## Deterministic seatbelt (belt-and-suspenders)

If the loop is itself driven by an AI agent, also add a Claude Code `PreToolUse`
hook so a prod deploy can't slip past a human even if the model forgets to ask.
The `matcher` is a tool NAME (`"Bash"`); `gate-hook --match` narrows to the
commands you care about and blocks (exit 2) unless you Approve on your phone:

```json
{ "hooks": { "PreToolUse": [
  { "matcher": "Bash",
    "hooks": [{ "type": "command",
      "command": "godozo gate-hook --match \"docker compose\" --title \"prod deploy\"" }] }
]}}
```

`gate-hook` reads the tool payload from stdin, so your phone shows the exact
command, and it fails CLOSED — denial, timeout, or a lost connection all block.

That's the whole integration: a couple of `notify` calls, one `gate` before the
irreversible step, and (optionally) one hook matcher for the crown jewel.
