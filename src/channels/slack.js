// Slack channel adapter — notify + health (outbound Slack Web API, zero deps).
//
// Sends alerts to a channel via chat.postMessage. Interactive APPROVALS need
// Slack Socket Mode (an outbound WebSocket to receive button clicks) — that's a
// follow-up; requestApproval throws a clear error for now so `gate` fails loud
// rather than silently. notify + health are fully functional.

async function slackApi(token, method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`slack ${method}: ${json.error || res.status}`);
  return json;
}

export function createSlackChannel(cfg) {
  const { botToken, channel } = cfg.slack;

  function requireCreds() {
    if (!botToken) throw new Error('GODOZO_SLACK_BOT_TOKEN is not set');
    if (!channel) throw new Error('GODOZO_SLACK_CHANNEL is not set');
  }

  async function notify({ message, title, label }) {
    requireCreds();
    const text = [`*${label || cfg.label}*`, title ? `*${title}*` : '', message || '']
      .filter(Boolean).join('\n');
    const r = await slackApi(botToken, 'chat.postMessage', { channel, text });
    return { messageId: r.ts };
  }

  async function requestApproval() {
    throw new Error('Slack approvals need Socket Mode (not in this build yet) — notify + health only');
  }

  async function health() {
    requireCreds();
    const r = await slackApi(botToken, 'auth.test', {});
    return { ok: true, bot: r.user, target: channel, team: r.team };
  }

  return { name: 'slack', notify, requestApproval, health };
}
