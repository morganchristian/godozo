// godozo core — a tiny, channel-agnostic human-in-the-loop relay.
//
//   const gd = createGodozo();
//   await gd.notify('the nightly job finished');
//   const r = await gd.requestApproval({ title: 'deploy to prod?', detail: cmd });
//   if (r.approved) deploy();
//
// The core knows two verbs — notify (fire-and-forget) and requestApproval
// (blocks until a human answers). Everything channel-specific (how the message
// is sent, how the answer comes back) lives in a channel adapter. v0 ships
// Telegram; Slack / email / SMS are the roadmap (see DESIGN.md).

import { loadConfig } from './config.js';
import { audit } from './audit.js';
import { createTelegramChannel } from './channels/telegram.js';

const CHANNELS = {
  telegram: createTelegramChannel,
};

export function createGodozo(overrides = {}) {
  const config = loadConfig(overrides);
  const factory = CHANNELS[config.channel];
  if (!factory) {
    throw new Error(`unknown channel: ${config.channel} (have: ${Object.keys(CHANNELS).join(', ')})`);
  }
  const channel = factory(config);
  return {
    config,
    channel: channel.name,
    notify: async (opts) => {
      const o = normalizeNotify(opts);
      const r = await channel.notify(o);
      audit(config, { type: 'notify', channel: channel.name, title: o.title, message: o.message });
      return r;
    },
    requestApproval: async (opts) => {
      const o = normalizeApproval(opts, config);
      const started = Date.now();
      const r = await channel.requestApproval(o);
      audit(config, {
        type: 'approval', channel: channel.name, title: o.title, detail: o.detail,
        decision: r.decision, approved: r.approved, timedOut: r.timedOut, by: r.by,
        durationMs: Date.now() - started,
      });
      return r;
    },
    health: () => channel.health(),
    // Two-way: block, long-polling incoming messages → handler → reply. Each
    // message + reply length is audited.
    listen: (handler, opts) => {
      if (!channel.listen) throw new Error(`channel ${channel.name} does not support listen`);
      const wrapped = async (msg) => {
        const reply = await handler(msg);
        audit(config, { type: 'message', channel: channel.name, from: msg.from, text: msg.text, replyChars: String(reply ?? '').length });
        return reply;
      };
      return channel.listen(wrapped, opts);
    },
  };
}

function normalizeNotify(opts) {
  return typeof opts === 'string' ? { message: opts } : (opts || {});
}

function normalizeApproval(opts, config) {
  const o = typeof opts === 'string' ? { title: opts } : { ...(opts || {}) };
  if (o.timeoutSeconds && !o.timeoutMs) o.timeoutMs = o.timeoutSeconds * 1000;
  if (!o.timeoutMs) o.timeoutMs = config.defaultTimeoutMs;
  return o;
}
