// ─── Backend Server ───────────────────────────────────────────────────────────
// Responsibilities (intentionally minimal):
//   1. Serve production build (dist/)
//   2. Socket.IO — two socket roles:
//        host  : the simulation display; gets a UUID session room on 'register-host'
//        remote: spectator devices; join with a room ID and emit user events
//   3. Event routing — controlled by RELAY_MODE env var:
//        direct (default) : server forwards 'user-event' straight to the sim room
//        n8n              : server POSTs to N8N_WEBHOOK_URL; n8n calls /n8n-sim-update
//   4. /n8n-sim-update — n8n POSTs processed params here; server emits via Socket.IO
//
// Signal path:
//   remote → socket → server → [n8n →] socket → simulation

import express           from 'express';
import { createServer }  from 'node:http';
import { Server as SocketIO } from 'socket.io';
import dotenv            from 'dotenv';
import cors              from 'cors';
import path              from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID }    from 'node:crypto';
import * as Utils        from './server-utils.js';

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const app         = express();
const server      = createServer(app);
const io          = new SocketIO(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const port        = process.env.PORT ?? 3000;
const isDev       = process.env.NODE_ENV === 'development';
const VITE_PORT   = process.env.VITE_PORT ?? 5173;

// RELAY_MODE controls how user events from remote devices are forwarded.
//   'direct' — event goes straight to the sim socket in the same room (default)
//   'n8n'    — event is POSTed to N8N_WEBHOOK_URL; n8n processes and calls /n8n-sim-update
const RELAY_MODE    = process.env.RELAY_MODE    ?? 'direct';
const N8N_HOOK_URL  = process.env.N8N_WEBHOOK_URL ?? 'http://localhost:5678/webhook/user-event';

console.log(`[server] relay mode: ${RELAY_MODE}`);

const ORIGINS = [
    'https://stubfx.io',
    'https://localhost',
    'https://192.168.1.12',
    ...(process.env.EXTRA_ORIGINS ?? '').split(',').filter(Boolean),
];

app.use(express.json());
app.set('trust proxy', true);
app.use(cors({ origin: ORIGINS, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));

// Serve the Vite production build (sim + remote page)
app.use(express.static(path.join(__dirname, '../dist')));

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    let assignedRoom = null;

    // ── Host (simulation display) ─────────────────────────────────────────────
    // The sim emits 'register-host' immediately on connect.
    // The server generates a UUID session room and emits it back.
    socket.on('register-host', () => {
        const sessionId = randomUUID();
        assignedRoom    = sessionId;
        socket.join(sessionId);
        socket.emit('session-id', sessionId);
        console.log('[socket] host registered   room:', sessionId);
    });

    // ── Remote device (spectator) ─────────────────────────────────────────────
    // The remote emits 'join-session' with the room UUID from the QR code URL.
    socket.on('join-session', ({ room, spectatorId }) => {
        assignedRoom = room;
        console.log('[socket] remote joined     room:', room, '| spectator:', spectatorId ?? '—');
        socket.emit('joined', { room });
    });

    // ── User event from remote ────────────────────────────────────────────────
    // Route based on RELAY_MODE.
    socket.on('user-event', ({ type, data }) => {
        const room        = assignedRoom;
        const spectatorId = socket.id;
        if (!room) return console.warn('[socket] user-event without room — ignoring');

        if (RELAY_MODE === 'n8n') {
            // Relay through n8n: POST the event; n8n calls /n8n-sim-update when done.
            fetch(N8N_HOOK_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ type, room, spectatorId, data, timestamp: Date.now() }),
            }).catch(err => console.error('[n8n relay]', err.message));
        } else {
            // Direct: forward straight to the simulation in that room.
            io.to(room).emit('remote-event', { type, spectatorId, data, timestamp: Date.now() });
            console.log('[socket] direct →', room, '|', type, JSON.stringify(data));
        }
    });

    socket.on('disconnect', () => {
        if (assignedRoom) console.log('[socket] disconnected      room:', assignedRoom);
    });
});

// ── n8n callback ──────────────────────────────────────────────────────────────
// n8n ends its workflow with an HTTP Request node POSTing here.
// Expected body: { "room": "<session-id>", "simulation": { ...params } }
app.post('/n8n-sim-update', (req, res) => {
    const { room, ...result } = req.body;
    const sockets = io.sockets.adapter.rooms.get(room);
    if (!sockets?.size) { console.warn('[socket] no client for room', room); return res.sendStatus(404); }
    io.to(room).emit('sim-params', result);
    res.sendStatus(200);
});

// ── Utility endpoints ─────────────────────────────────────────────────────────
app.post('/rndImage', async (_req, res) => {
    try {
        const { fileName, data } = await Utils.randomPrevImage();
        res.json({ name: fileName, data: 'data:image/png;base64,' + data.toString('base64') });
    } catch {
        res.status(404).json(null);
    }
});

// ── Page fallbacks ────────────────────────────────────────────────────────────
// Two Vite entry points, each routed to its own HTML file.
// In dev: redirect to the Vite dev server (which handles HMR and module imports).
// In prod: express.static handles /assets/* and exact file matches; these
// catch-alls cover client-side navigation (query strings, unknown sub-paths, etc.).
function sendPage(distFile, req, res) {
    // In dev, redirect to the Vite dev server preserving the full URL (path + query).
    if (isDev) return res.redirect(`http://localhost:${VITE_PORT}${req.originalUrl}`);
    res.sendFile(path.join(__dirname, '../dist', distFile), (err) => {
        if (err) res.status(503).send('Build not found — run `npm run build` first.');
    });
}
app.get('/remote/{*path}', (req, res) => sendPage('remote/index.html', req, res));
app.get('/{*path}',        (req, res) => sendPage('index.html',        req, res));

server.listen(port, () => console.log(`[server] :${port}`));
