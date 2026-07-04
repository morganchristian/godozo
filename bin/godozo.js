#!/usr/bin/env node
// godozo CLI — notify + gate from any shell script.
//
//   godozo notify "nightly build passed"
//   godozo gate --title "deploy prod?" --detail "$CMD" && ./deploy.sh
//
// gate's exit code IS the decision, so it composes with && / || in scripts.
import { createGodozo } from '../src/core.js';

const EXIT = { OK: 0, DENIED: 10, TIMEOUT: 20, ERROR: 1 };

const HELP = `godozo — notify + get approvals from your agents, on your phone

Usage:
  godozo notify <message> [--title T] [--label L]
  godozo gate --title T [--detail D] [--timeout SECONDS] [--label L]
  godozo doctor
  godozo --help | --version

gate exit codes:  0 approved · 10 denied · 20 timed out · 1 error
  e.g.  godozo gate --title "deploy prod?" && ./deploy.sh

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

  if (cmd === 'doctor') {
    try {
      const h = await gd.health();
      const chat = gd.config.telegram.chatId || '(unset!)';
      console.log(`✅ channel=${gd.channel} bot=@${h.bot} chat=${chat}`);
      return gd.config.telegram.chatId ? EXIT.OK : EXIT.ERROR;
    } catch (e) { console.error(`✗ ${e.message}`); return EXIT.ERROR; }
  }

  console.error(`unknown command: ${cmd}\n\n${HELP}`);
  return EXIT.ERROR;
}

// A bare `--flag` parses to `true`; coerce that back to undefined for value opts.
function str(v) { return typeof v === 'string' ? v : undefined; }

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(`godozo error: ${e.message}`); process.exit(EXIT.ERROR); });
