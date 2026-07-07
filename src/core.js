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
import { createSlackChannel } from './channels/slack.js';

// Each channel: how to build it + whether its creds are present ("ready").
const CHANNELS = {
  telegram: { create: createTelegramChannel, ready: (c) => !!(c.telegram.token && c.telegram.chatId) },
  slack: { create: createSlackChannel, ready: (c) => !!(c.slack.botToken && c.slack.channel) },
};

export function createGodozo(overrides = {}) {
  const config = loadConfig(overrides);

  // PRIMARY channel — used for interactive requestApproval / listen, which need
  // ONE place to answer. Defaults to GODOZO_CHANNEL (telegram).
  const primaryDef = CHANNELS[config.channel];
  if (!primaryDef) {
    throw new Error(`unknown channel: ${config.channel} (have: ${Object.keys(CHANNELS).join(', ')})`);
  }
  const primary = primaryDef.create(config);

  // NOTIFY fan-out — send notifications to EVERY configured channel (Telegram
  // AND Slack), so alerts land everywhere. Default = all channels with creds;
  // GODOZO_NOTIFY_CHANNELS pins the list. (Approvals do NOT fan out — Slack
  // has no interactive yes/no yet — so they stay on the primary channel.)
  const wanted = config.notifyChannels.length
    ? config.notifyChannels.filter((n) => CHANNELS[n])
    : Object.keys(CHANNELS).filter((n) => CHANNELS[n].ready(config));
  const seen = new Set();
  const notifyChans = wanted.filter((n) => !seen.has(n) && seen.add(n))
    .map((n) => (n === config.channel ? primary : CHANNELS[n].create(config)));
  if (!notifyChans.length) notifyChans.push(primary); // never send to nothing

  return {
    config,
    channel: primary.name,
    notifyChannels: notifyChans.map((c) => c.name),
    notify: async (opts) => {
      const o = normalizeNotify(opts);
      // Best-effort fan-out — one channel failing must not block the others.
      const results = await Promise.allSettled(notifyChans.map((c) => c.notify(o)));
      const okNames = notifyChans.filter((_, i) => results[i].status === 'fulfilled').map((c) => c.name);
      audit(config, { type: 'notify', channels: okNames, title: o.title, message: o.message });
      if (!okNames.length) {
        throw new Error(`notify failed on all channels: ${results.map((r) => r.reason?.message).filter(Boolean).join('; ')}`);
      }
      return { sent: okNames.length, channels: okNames };
    },
    requestApproval: async (opts) => {
      const o = normalizeApproval(opts, config);
      const started = Date.now();
      const r = await primary.requestApproval(o);
      audit(config, {
        type: 'approval', channel: primary.name, title: o.title, detail: o.detail,
        decision: r.decision, approved: r.approved, timedOut: r.timedOut, by: r.by,
        durationMs: Date.now() - started,
      });
      return r;
    },
    health: () => primary.health(),
    // Two-way: block, long-polling incoming messages → handler → reply (primary
    // channel only). Each message + reply length is audited.
    listen: (handler, opts) => {
      if (!primary.listen) throw new Error(`channel ${primary.name} does not support listen`);
      const wrapped = async (msg) => {
        const reply = await handler(msg);
        audit(config, { type: 'message', channel: primary.name, from: msg.from, text: msg.text, replyChars: String(reply ?? '').length });
        return reply;
      };
      return primary.listen(wrapped, opts);
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
