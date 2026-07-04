import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Local, append-only audit log. Every notify / approval / inbound message is
// recorded as one JSON line — a durable, greppable record of who approved what
// and when. On by default (it's the point); disable with GODOZO_AUDIT=off, or
// relocate with GODOZO_AUDIT_FILE. Writing NEVER throws into the caller — an
// audit failure must not break the action it's recording.

export function auditPath(config) {
  if (config.audit === false) return null;
  return config.auditFile || path.join(os.homedir(), '.godozo', 'audit.jsonl');
}

export function audit(config, event) {
  try {
    const file = auditPath(config);
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch { /* audit must never break the action */ }
}
