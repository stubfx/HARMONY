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
//   5. Collective state — aggregates all spectators' tilt + temperature per room
//        and emits 'collective-state' to the host simulation every 300 ms
//
// Signal path:
//   remote → socket → server → [n8n →] socket → simulation
//   server (ticker) → 'collective-state' → simulation

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

// ── Room state ────────────────────────────────────────────────────────────────
// Tracks per-room spectator data for collective-state aggregation.
// Structure: Map<roomId, { hostSocketId, users: Map<socketId, UserState> }>
// UserState: { pitch, roll, temperature, lastSeen }
const rooms = new Map();

const USER_TIMEOUT_MS = 15_000; // remove users not seen for 15 s

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, { hostSocketId: null, users: new Map() });
    return rooms.get(roomId);
}

function updateUserState(roomId, socketId, type, data) {
    const room = rooms.get(roomId);
    if (!room) return;
    let user = room.users.get(socketId);
    if (!user) {
        user = { pitch: 0.5, roll: 0.5, temperature: 0.5, lastSeen: Date.now() };
        room.users.set(socketId, user);
    }
    user.lastSeen = Date.now();
    if (type === 'tilt') {
        user.pitch       = data.pitch ?? 0.5;
        user.roll        = data.roll  ?? 0.5;
    }
    if (type === 'touch') {
        user.temperature = data.temp  ?? 0.5;
    }
}

// ── Collective-state ticker ───────────────────────────────────────────────────
// Every 300 ms: prune stale users, compute averages, emit to host simulation.
setInterval(() => {
    const now = Date.now();
    for (const [, room] of rooms) {
        // Prune users not seen recently
        for (const [uid, u] of room.users) {
            if (now - u.lastSeen > USER_TIMEOUT_MS) room.users.delete(uid);
        }
        if (!room.hostSocketId || !room.users.size) continue;

        let sp = 0, sr = 0, st = 0;
        for (const u of room.users.values()) { sp += u.pitch; sr += u.roll; st += u.temperature; }
        const n = room.users.size;

        io.to(room.hostSocketId).emit('collective-state', {
            avgPitch:  sp / n,
            avgRoll:   sr / n,
            avgTemp:   st / n,
            userCount: n,
        });
    }
}, 300);

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
        const room = getOrCreateRoom(sessionId);
        room.hostSocketId = socket.id;
        console.log('[socket] host registered   room:', sessionId);
    });

    // ── Remote device (spectator) ─────────────────────────────────────────────
    // The remote emits 'join-session' with the room UUID from the QR code URL.
    socket.on('join-session', ({ room, spectatorId }) => {
        assignedRoom = room;
        const roomData = getOrCreateRoom(room);
        roomData.users.set(socket.id, { pitch: 0.5, roll: 0.5, temperature: 0.5, lastSeen: Date.now() });
        console.log('[socket] remote joined     room:', room, '| spectator:', spectatorId ?? '—');
        socket.emit('joined', { room });
    });

    // ── User event from remote ────────────────────────────────────────────────
    // Always update aggregate room state first.
    // Tilt events are aggregated only (not forwarded individually — the ticker handles that).
    // All other events are routed per RELAY_MODE.
    socket.on('user-event', ({ type, data }) => {
        const room        = assignedRoom;
        const spectatorId = socket.id;
        if (!room) return console.warn('[socket] user-event without room — ignoring');

        updateUserState(room, socket.id, type, data);

        // Tilt is consumed server-side for aggregation; no individual forwarding needed.
        if (type === 'tilt') return;

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
        if (!assignedRoom) return;
        console.log('[socket] disconnected      room:', assignedRoom);
        const room = rooms.get(assignedRoom);
        if (room) {
            room.users.delete(socket.id);
            if (room.hostSocketId === socket.id) room.hostSocketId = null;
            // Clean up fully empty rooms
            if (!room.hostSocketId && !room.users.size) rooms.delete(assignedRoom);
        }
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
