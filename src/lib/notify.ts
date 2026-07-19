/** Fire-and-forget outbound notifications (LINE / webhook) via the server. */

export async function notify(text: string): Promise<void> {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    /* non-critical — never block the UI on a notification */
  }
}

export interface NotifyStatus {
  configured: boolean
  channel: 'line' | 'webhook' | null
}

export async function notifyStatus(): Promise<NotifyStatus> {
  try {
    const res = await fetch('/api/notify/status')
    if (!res.ok) return { configured: false, channel: null }
    return (await res.json()) as NotifyStatus
  } catch {
    return { configured: false, channel: null }
  }
}
