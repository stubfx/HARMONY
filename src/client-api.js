// ─── HTTP API client ──────────────────────────────────────────────────────────
// Production-only: frontend and backend share the same origin (Express serves
// the Vite build). All endpoints are relative so no env config is needed.

async function post(endpoint, body = null) {
    try {
        const res = await fetch('/' + endpoint, {
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
