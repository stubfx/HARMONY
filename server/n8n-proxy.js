// ─── n8n Webhook Proxy ────────────────────────────────────────────────────────
// Forwards simulation requests from Socket.IO clients to the local n8n instance
// and returns the response JSON (simulation parameters).

const N8N_BASE = process.env.N8N_WEBHOOK_URL ?? 'http://localhost:5678/webhook';

export async function forwardToN8n(path, payload) {
    const url = `${N8N_BASE}/${path}`;
    try {
        const res = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        if (!res.ok) {
            console.warn(`[n8n] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        console.error(`[n8n] Could not reach ${url}:`, err.message);
        return null;
    }
}
