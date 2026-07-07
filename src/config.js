import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency). Reads GODOZO_ENV or ./.env and injects
// any KEY=VALUE pairs that aren't already set in the environment.
function loadDotEnv() {
  const file = process.env.GODOZO_ENV || path.resolve(process.cwd(), '.env');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function loadConfig(overrides = {}) {
  loadDotEnv();
  return {
    channel: process.env.GODOZO_CHANNEL || 'telegram',
    // Which channels NOTIFICATIONS fan out to. Default (empty) = every channel
    // with creds present (so adding Slack creds auto-mirrors Telegram alerts).
    // Set GODOZO_NOTIFY_CHANNELS="telegram,slack" to pin the list explicitly.
    notifyChannels: (process.env.GODOZO_NOTIFY_CHANNELS || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
    label: process.env.GODOZO_LABEL || 'godozo',
    defaultTimeoutMs: (Number(process.env.GODOZO_DEFAULT_TIMEOUT) || 600) * 1000,
    // Audit log: on by default, disable with GODOZO_AUDIT=off, relocate with GODOZO_AUDIT_FILE.
    audit: (process.env.GODOZO_AUDIT || '').toLowerCase() !== 'off',
    auditFile: process.env.GODOZO_AUDIT_FILE || '',
    slack: {
      botToken: process.env.GODOZO_SLACK_BOT_TOKEN || '',
      channel: process.env.GODOZO_SLACK_CHANNEL || '',
    },
    telegram: {
      token: process.env.GODOZO_TELEGRAM_TOKEN || '',
      chatId: process.env.GODOZO_TELEGRAM_CHAT_ID || '',
      // Who may answer approvals. Defaults to the configured chat id, so only
      // YOU can resolve a gate even though anyone can message the bot. Override
      // with a comma-separated list of Telegram user ids for a team.
      allow: (process.env.GODOZO_TELEGRAM_ALLOW || process.env.GODOZO_TELEGRAM_CHAT_ID || '')
        .split(',').map((s) => s.trim()).filter(Boolean),
    },
    ...overrides,
  };
}
