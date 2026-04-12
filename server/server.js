// ─── Backend Server ───────────────────────────────────────────────────────────
// Responsibilities (intentionally minimal):
//   1. Serve production build (dist/)
//   2. /uuid          — generates a session ID for the simulation's QR + SSE room
//   3. /n8n-sim-update — n8n POSTs processed params here; server pushes via SSE
//   4. /simulation-events — SSE stream the host simulation listens on
//
// m_src clients call n8n directly. This server is not in that path.

import express           from 'express';
import { createServer }  from 'node:http';
import dotenv            from 'dotenv';
import cors              from 'cors';
import path              from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID }    from 'node:crypto';
import * as Utils        from './server-utils.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app    = express();
const server = createServer(app);
const port   = process.env.PORT ?? 3000;

const ORIGINS = [
    'https://stubfx.io',
    'https://localhost',
    'https://192.168.1.12',
    ...(process.env.EXTRA_ORIGINS ?? '').split(',').filter(Boolean),
];

app.use(express.json());
app.set('trust proxy', true);
app.use(cors({ origin: ORIGINS, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));

// Serve the Vite production build (main sim + m_src)
app.use(express.static(path.join(__dirname, '../dist')));

// ── SSE — one persistent stream per host simulation session ───────────────────
const sseClients = {};   // { [room]: express.Response }

app.get('/simulation-events', (req, res) => {
    const { room } = req.query;
    if (!room) return res.status(400).end('room required');

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    sseClients[room] = res;
    console.log('[sse] connected  room:', room);

    // Keepalive comment every 25 s (prevents proxy / load-balancer timeouts)
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
        clearInterval(ping);
        delete sseClients[room];
        console.log('[sse] disconnected room:', room);
    });
});

function pushToSim(room, event, data) {
    const client = sseClients[room];
    if (!client) { console.warn('[sse] no client for room', room); return false; }
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
}

// ── n8n callback ──────────────────────────────────────────────────────────────
// n8n ends its workflow with an HTTP Request node POSTing here.
// Expected body: { "room": "<session-id>", "simulation": { ...params } }
app.post('/n8n-sim-update', (req, res) => {
    const { room, ...result } = req.body;
    res.sendStatus(pushToSim(room, 'sim-params', result) ? 200 : 404);
});

// ── Utility endpoints ─────────────────────────────────────────────────────────
app.post('/uuid', (_req, res) => res.json(randomUUID()));

app.post('/rndImage', async (_req, res) => {
    try {
        const { fileName, data } = await Utils.randomPrevImage();
        res.json({ name: fileName, data: 'data:image/png;base64,' + data.toString('base64') });
    } catch {
        res.status(404).json(null);
    }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
// express.static handles /assets/*, /m_src/*, etc.
// This catch-all ensures / (and any unmatched GET) always returns index.html.
app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'), (err) => {
        if (err) res.status(503).send('Build not found — run `npm run build` first.');
    });
});

server.listen(port, () => console.log(`[server] :${port}`));
