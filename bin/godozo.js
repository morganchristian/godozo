#!/usr/bin/env node
// godozo CLI — notify + gate from any shell script.
//
//   godozo notify "nightly build passed"
//   godozo gate --title "deploy prod?" --detail "$CMD" && ./deploy.sh
//
// gate's exit code IS the decision, so it composes with && / || in scripts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createGodozo } from '../src/core.js';
import { auditPath } from '../src/audit.js';

// gate exit codes compose with && / || in a shell. gate-hook instead speaks
// Claude Code's hook protocol, where ONLY exit code 2 blocks a tool call.
const EXIT = { OK: 0, BLOCK: 2, DENIED: 10, TIMEOUT: 20, ERROR: 1 };

const HELP = `godozo — notify + get approvals from your agents, on your phone

Usage:
  godozo notify <message> [--title T] [--label L]
  godozo gate --title T [--detail D] [--timeout SECONDS] [--label L]
  godozo gate-hook [--match "substr,substr"] [--title T] [--timeout SECONDS]
  godozo listen --exec "<command>" [--timeout SECONDS]
  godozo log [--tail N]
  godozo doctor
  godozo --help | --version

listen (two-way): text your bot → each message runs <command> → stdout is the
reply. The message is passed on stdin and as $GODOZO_MESSAGE (never spliced into
the command, so message text can't inject shell). Only allowlisted users can drive it.
  e.g.  godozo listen --exec 'claude -p "$GODOZO_MESSAGE"'
        godozo listen --echo     # test loop (replies with your text)

gate exit codes:  0 approved · 10 denied · 20 timed out · 1 error
  e.g.  godozo gate --title "deploy prod?" && ./deploy.sh

gate-hook: a Claude Code PreToolUse hook. Reads the tool payload as JSON on
stdin, and BLOCKS the tool (exit 2) unless you Approve on your phone. Fails
CLOSED — denial, timeout, or any error blocks. --match narrows to commands
containing any of the given substrings (else it prompts on every matched tool).
  e.g.  hooks → PreToolUse → matcher "Bash":
        godozo gate-hook --match "push --force,reset --hard,rm -rf"

Config (env or .env in the working dir):
  GODOZO_TELEGRAM_TOKEN     bot token from @BotFather
  GODOZO_TELEGRAM_CHAT_ID   your chat id from @userinfobot
  GODOZO_LABEL              source name shown in messages (default: godozo)
  GODOZO_DEFAULT_TIMEOUT    approval timeout seconds (default: 600)
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.version) { console.log('godozo 0.1.0'); return EXIT.OK; }
  if (!cmd || args.help || cmd === 'help') { console.log(HELP); return EXIT.OK; }

  const gd = createGodozo();

  if (cmd === 'notify') {
    const message = args._.slice(1).join(' ');
    if (!message && !args.title) { console.error('notify: need a message'); return EXIT.ERROR; }
    await gd.notify({ message, title: str(args.title), label: str(args.label) });
    return EXIT.OK;
  }

  if (cmd === 'gate' || cmd === 'approve') {
    const title = str(args.title) || args._.slice(1).join(' ');
    if (!title) { console.error('gate: --title is required'); return EXIT.ERROR; }
    const timeoutMs = args.timeout ? Number(args.timeout) * 1000 : undefined;
    const r = await gd.requestApproval({ title, detail: str(args.detail), label: str(args.label), timeoutMs });
    if (r.timedOut) { console.error('⌛ timed out — no response'); return EXIT.TIMEOUT; }
    console.error(`${r.approved ? '✅ approved' : '🚫 denied'} by ${r.by}`);
    return r.approved ? EXIT.OK : EXIT.DENIED;
  }

  // Claude Code PreToolUse hook. The harness pipes the tool payload as JSON on
  // stdin; we approve-or-block it via the human. Contract: exit 0 = allow the
  // tool, exit 2 = BLOCK it (the only code Claude Code treats as a block). We
  // fail CLOSED — deny, timeout, or any error blocks — because a seatbelt that
  // fails open is worse than no seatbelt.
  if (cmd === 'gate-hook' || cmd === 'hook') {
    const payload = await readHookPayload();
    const { action, tool, haystack } = describeTool(payload);

    // --match narrows which commands prompt. If given and nothing matches, this
    // isn't a guarded action — let it run untouched (silent allow).
    if (args.match) {
      const needles = String(args.match).split(',').map((s) => s.trim()).filter(Boolean);
      if (!needles.some((n) => haystack.includes(n))) return EXIT.OK;
    }

    const title = str(args.title) || `Approve ${tool}?`;
    const timeoutMs = args.timeout ? Number(args.timeout) * 1000 : undefined;
    try {
      const r = await gd.requestApproval({ title, detail: action, label: str(args.label), timeoutMs });
      if (r.approved) {
        // Phone approval is authoritative — tell Claude Code to allow it through.
        console.log(JSON.stringify({ hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'allow',
          permissionDecisionReason: `Approved via godozo by ${r.by}`,
        } }));
        return EXIT.OK;
      }
      console.error(r.timedOut
        ? `godozo: no response — blocking ${tool} (approval timed out)`
        : `godozo: denied by ${r.by} — blocking ${tool}`);
      return EXIT.BLOCK;
    } catch (e) {
      console.error(`godozo hook error: ${e.message} — blocking ${tool} (fail-safe)`);
      return EXIT.BLOCK;
    }
  }

  if (cmd === 'listen') {
    const exec = str(args.exec);
    const echo = args.echo === true;
    if (!exec && !echo) { console.error('listen: pass --exec "<command>" (or --echo to test)'); return EXIT.ERROR; }
    const timeoutMs = args.timeout ? Number(args.timeout) * 1000 : 120000;
    const handler = echo
      ? async ({ text }) => `you said: ${text}`
      : async ({ text, from }) => runExec(exec, text, { timeoutMs, from });
    console.error(`godozo listening (${echo ? 'echo' : 'exec'} mode) — text your bot; Ctrl-C to stop`);
    await gd.listen(handler);
    return EXIT.OK;
  }

  if (cmd === 'log') {
    const file = auditPath(gd.config);
    if (!file) { console.log('audit is disabled (GODOZO_AUDIT=off)'); return EXIT.OK; }
    if (!fs.existsSync(file)) { console.log(`(no audit log yet at ${file})`); return EXIT.OK; }
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const n = args.tail ? Number(args.tail) : 20;
    for (const line of lines.slice(-n)) {
      try {
        const e = JSON.parse(line);
        let d = '';
        if (e.type === 'approval') d = `${e.title} → ${e.timedOut ? 'TIMED_OUT' : (e.approved ? 'APPROVED' : 'DENIED')}${e.by ? ' by ' + e.by : ''}`;
        else if (e.type === 'notify') d = e.title ? `${e.title}: ${e.message ?? ''}` : (e.message ?? '');
        else if (e.type === 'message') d = `${e.from}: ${e.text}`;
        console.log(`${e.ts}  ${String(e.type).padEnd(8)} ${d}`);
      } catch { console.log(line); }
    }
    return EXIT.OK;
  }

  if (cmd === 'doctor') {
    try {
      const h = await gd.health();
      console.log(`✅ primary=${gd.channel} bot=${h.bot ? '@' + h.bot : '(ok)'}${h.target ? ` target=${h.target}` : ''}`);
      console.log(`   notify → ${gd.notifyChannels.join(', ')}`);
      console.log(`   audit: ${auditPath(gd.config) || 'disabled'}`);
      return EXIT.OK;
    } catch (e) { console.error(`✗ ${e.message}`); return EXIT.ERROR; }
  }

  console.error(`unknown command: ${cmd}\n\n${HELP}`);
  return EXIT.ERROR;
}

// A bare `--flag` parses to `true`; coerce that back to undefined for value opts.
function str(v) { return typeof v === 'string' ? v : undefined; }

// Read the Claude Code hook payload (tool_name + tool_input) from stdin JSON.
// Returns {} if there's nothing on stdin (e.g. run by hand to smoke-test).
function readHookPayload() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    process.stdin.on('error', () => resolve({}));
  });
}

// Turn a hook payload into a human-readable action line (shown on your phone)
// and a haystack string for --match filtering.
function describeTool(payload) {
  const tool = payload?.tool_name || 'tool';
  const ti = payload?.tool_input || {};
  const raw = JSON.stringify(ti);
  let action;
  if (typeof ti.command === 'string') action = ti.command;          // Bash
  else if (ti.file_path) action = `${tool} ${ti.file_path}`;         // Write/Edit
  else action = raw === '{}' ? tool : raw;                           // anything else
  if (action.length > 800) action = action.slice(0, 800) + '…';
  return { tool, action, haystack: `${ti.command || ''}\n${raw}` };
}

// Run a shell command per incoming message. The message is passed via stdin AND
// $GODOZO_MESSAGE — never interpolated into the command string, so message
// content can't inject shell. stdout is the reply.
function runExec(cmd, message, { timeoutMs, from }) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], {
      env: { ...process.env, GODOZO_MESSAGE: message, GODOZO_FROM: from || '' },
    });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve(`⚠️ ${e.message}`); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim() || '(no output)');
      else resolve(`⚠️ exited ${code}${err ? `: ${err.trim().slice(0, 500)}` : ''}`);
    });
    child.stdin.end(message);
  });
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(`godozo error: ${e.message}`); process.exit(EXIT.ERROR); });
