// Telegram channel adapter. Talks to the Bot API over plain HTTPS (global
// fetch, zero dependencies) and — the important part — receives button presses
// by long-polling getUpdates. That means godozo needs NO public webhook and no
// inbound port to self-host: it works fine behind NAT, on a laptop, or on the
// Mini next to a build. (Downside: one poller per bot token — see DESIGN.md.)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description || res.status}`);
  return json.result;
}

export function createTelegramChannel(cfg) {
  const { token, chatId } = cfg.telegram;

  function requireCreds() {
    if (!token) throw new Error('GODOZO_TELEGRAM_TOKEN is not set');
    if (!chatId) throw new Error('GODOZO_TELEGRAM_CHAT_ID is not set');
  }

  async function notify({ message, title, label }) {
    requireCreds();
    const text = [`${label || cfg.label}`, title ? `📣 ${title}` : '', message || '']
      .filter(Boolean).join('\n');
    const msg = await tg(token, 'sendMessage', { chat_id: chatId, text });
    return { messageId: msg.message_id };
  }

  async function requestApproval({ title, detail, actions, timeoutMs, label }) {
    requireCreds();
    const acts = actions && actions.length ? actions : ['Approve', 'Deny'];
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const text = [`${label || cfg.label}`, `🚦 ${title}`, detail ? `\n${detail}` : '']
      .filter(Boolean).join('\n');
    const keyboard = [acts.map((a, i) => ({
      text: i === 0 ? `✅ ${a}` : (i === acts.length - 1 ? `🚫 ${a}` : a),
      callback_data: `gd:${id}:${i}`,
    }))];
    const sent = await tg(token, 'sendMessage', {
      chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard },
    });

    // Baseline the update offset so we only react to presses AFTER this prompt.
    let offset = 0;
    try {
      const seed = await tg(token, 'getUpdates', { timeout: 0, allowed_updates: ['callback_query'] });
      if (seed.length) offset = seed[seed.length - 1].update_id + 1;
    } catch { /* non-fatal */ }

    const deadline = Date.now() + (timeoutMs || cfg.defaultTimeoutMs);
    while (Date.now() < deadline) {
      const remaining = Math.max(1, Math.floor((deadline - Date.now()) / 1000));
      let updates = [];
      try {
        updates = await tg(token, 'getUpdates', {
          offset, timeout: Math.min(30, remaining), allowed_updates: ['callback_query'],
        });
      } catch { await sleep(1000); continue; }

      for (const u of updates) {
        offset = u.update_id + 1;
        const cq = u.callback_query;
        if (!cq || !cq.data || !cq.data.startsWith(`gd:${id}:`)) continue;
        // Only an allowlisted user may resolve the approval — reject anyone else.
        if (cfg.telegram.allow.length && !cfg.telegram.allow.includes(String(cq.from?.id))) {
          await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Not authorized' }).catch(() => {});
          continue;
        }
        const idx = Number(cq.data.split(':')[2]);
        const decision = acts[idx];
        const approved = idx === 0;
        const by = cq.from?.username ? `@${cq.from.username}` : (cq.from?.first_name || 'someone');
        await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: `${decision} ✓` }).catch(() => {});
        await tg(token, 'editMessageText', {
          chat_id: chatId, message_id: sent.message_id,
          text: `${text}\n\n${approved ? '✅' : '🚫'} ${decision} by ${by}`,
        }).catch(() => {});
        return { approved, decision, by, at: new Date().toISOString(), timedOut: false, messageId: sent.message_id };
      }
    }

    await tg(token, 'editMessageText', {
      chat_id: chatId, message_id: sent.message_id, text: `${text}\n\n⌛ timed out (no response)`,
    }).catch(() => {});
    return { approved: false, decision: null, by: null, at: new Date().toISOString(), timedOut: true, messageId: sent.message_id };
  }

  async function health() {
    requireCreds();
    const me = await tg(token, 'getMe', {});
    return { ok: true, bot: me.username };
  }

  return { name: 'telegram', notify, requestApproval, health };
}
