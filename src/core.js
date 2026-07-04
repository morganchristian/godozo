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
    notify: (opts) => channel.notify(normalizeNotify(opts)),
    requestApproval: (opts) => channel.requestApproval(normalizeApproval(opts, config)),
    health: () => channel.health(),
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
