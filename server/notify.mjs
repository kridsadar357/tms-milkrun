/**
 * Outbound notifications — LINE Messaging API push, or a generic webhook.
 * Credentials live in env (never in the synced app state):
 *   LINE_CHANNEL_TOKEN + LINE_TO   → LINE Messaging API push
 *   NOTIFY_WEBHOOK_URL             → generic JSON webhook { text } (LINE relay,
 *                                    Slack/Discord-compatible, or custom)
 * If neither is set, notifications are a no-op (the app still works).
 */

export function notifyChannel() {
  if (process.env.LINE_CHANNEL_TOKEN && process.env.LINE_TO) return 'line'
  if (process.env.NOTIFY_WEBHOOK_URL) return 'webhook'
  return null
}

export async function sendNotification(text) {
  const msg = String(text ?? '').slice(0, 4900)
  if (!msg) return false
  const channel = notifyChannel()
  try {
    if (channel === 'line') {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
        },
        body: JSON.stringify({ to: process.env.LINE_TO, messages: [{ type: 'text', text: msg }] }),
      })
      return res.ok
    }
    if (channel === 'webhook') {
      const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: msg }),
      })
      return res.ok
    }
  } catch (e) {
    console.warn('notify failed:', e.message)
  }
  return false
}
