// ─── HTTP API client ──────────────────────────────────────────────────────────
// All AI processing is now handled by n8n.
// The server still exposes /uuid and /rndImage for session management.

const url = import.meta.env.VITE_API_HOSTNAME;

async function post(endpoint, body = null) {
    try {
        const res = await fetch(url + endpoint, {
            method:  'POST',
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body:    body ? JSON.stringify(body) : null,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error(`[api] ${endpoint}:`, err.message);
        return null;
    }
}

export async function uuid() {
    return post('uuid');
}

export async function rndImage() {
    return post('rndImage');
}
