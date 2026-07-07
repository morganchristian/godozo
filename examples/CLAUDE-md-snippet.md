# godozo convention block

Paste the block below into your project's `CLAUDE.md` (or `AGENTS.md`) to make
godozo ambient — the agent reports in and asks permission on its own. Assumes
`godozo` is on PATH (`npm link`) or swap in `node /path/to/godozo/bin/godozo.js`.

```markdown
## Human-in-the-loop (godozo)

- Before any destructive or irreversible action — force push, branch/history
  rewrite, deleting files outside the working dir, a DB migration, or
  publishing/deploying — request approval and WAIT for the answer:
  `godozo gate --title "<what>" --detail "<exact command>"`
  Exit 0 = approved (proceed); non-zero = do NOT proceed.
- When any task that ran longer than ~5 minutes finishes (or fails), send a
  one-line summary: `godozo notify --title "<task>" "<result>"`.
```

> The prompt above is cooperative — the model decides what counts. For the
> handful of actions that must never slip, add the deterministic PreToolUse
> hook (see README → "the seatbelt"); it blocks regardless of what the model does.
