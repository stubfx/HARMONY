// ─── Backend Server ───────────────────────────────────────────────────────────
// Responsibilities (intentionally minimal):
//   1. Serve production build (dist/)
//   2. Socket.IO — three socket roles:
//        host  : the simulation display; gets a UUID session room on 'register-host'
//        remote: spectator devices; join with a room ID and emit user events
//        admin : authenticated controller; sends sim-params to the host
//   3. Event routing — server always forwards 'user-event' straight to the sim as
//        'remote-event'. The sim calls n8n directly if VITE_N8N_WEBHOOK_URL is set.
//   4. Collective state — aggregates all spectators' tilt + temperature per room
//        and emits 'collective-state' to the host simulation every 300 ms
//
// Signal path:
//   remote → socket → server → socket → simulation [→ n8n → simulation]
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

const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? '';

if (!ADMIN_PASS) console.warn('[server] ADMIN_PASSWORD not set — /admin will be inaccessible');

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

// ── Admin tokens ─────────────────────────────────────────────────────────────
// Short-lived UUIDs issued by /admin-auth. Stored in memory; expire after 24 h.
// Each authenticated admin socket has its token stored in the closure so it
// doesn't need to re-send it with every event.
const adminTokens = new Map(); // token → expiry (ms timestamp)

// Prune expired tokens hourly
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of adminTokens) if (now > exp) adminTokens.delete(t);
}, 60 * 60 * 1000);

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
        user = { pitch: 0.5, roll: 0.5, temperature: 0.5, coherence: 0.5, lastSeen: Date.now() };
        room.users.set(socketId, user);
    }
    user.lastSeen = Date.now();
    if (type === 'tilt') {
        user.pitch     = data.pitch ?? 0.5;
        user.roll      = data.roll  ?? 0.5;
    }
    if (type === 'touch') {
        user.temperature = data.temp ?? 0.5;
        user.coherence   = data.x   ?? 0.5; // X axis → coherence (left=chaos, right=order)
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

        let sp = 0, sr = 0, st = 0, sc = 0;
        for (const u of room.users.values()) { sp += u.pitch; sr += u.roll; st += u.temperature; sc += u.coherence; }
        const n = room.users.size;

        io.to(room.hostSocketId).emit('collective-state', {
            avgPitch:     sp / n,
            avgRoll:      sr / n,
            avgTemp:      st / n,
            avgCoherence: sc / n,
            userCount:    n,
        });
    }
}, 300);

// ── Admin auth endpoint ───────────────────────────────────────────────────────
app.post('/admin-auth', (req, res) => {
    const { password } = req.body ?? {};
    if (!ADMIN_PASS || password !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = randomUUID();
    adminTokens.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24 h
    console.log('[admin] token issued');
    res.json({ token });
});

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

    // ── Admin controller ──────────────────────────────────────────────────────
    // Admin sockets join a room without counting as spectators and can push
    // sim-params directly to the host.
    let adminAuthorized = false;
    let adminToken      = null;

    socket.on('register-admin', ({ room: targetRoom, token }) => {
        const expiry = adminTokens.get(token);
        if (!expiry || Date.now() > expiry) {
            socket.emit('admin-auth-error', { error: 'Invalid or expired token' });
            console.warn('[admin] rejected — bad token');
            return;
        }
        adminAuthorized = true;
        adminToken      = token;
        assignedRoom    = targetRoom;
        socket.join(targetRoom);
        socket.emit('admin-registered', { room: targetRoom });
        console.log('[socket] admin registered  room:', targetRoom);
    });

    socket.on('admin-sim-params', (params) => {
        if (!adminAuthorized) return;
        // Re-validate token hasn't expired
        const expiry = adminTokens.get(adminToken);
        if (!expiry || Date.now() > expiry) {
            adminAuthorized = false;
            socket.emit('admin-auth-error', { error: 'Token expired' });
            return;
        }
        const roomData = rooms.get(assignedRoom);
        if (!roomData?.hostSocketId) return;
        io.to(roomData.hostSocketId).emit('sim-params', params);
    });

    // ── Remote device (spectator) ─────────────────────────────────────────────
    // The remote emits 'join-session' with the room UUID from the QR code URL.
    socket.on('join-session', ({ room, spectatorId }) => {
        assignedRoom = room;
        const roomData = getOrCreateRoom(room);
        roomData.users.set(socket.id, { pitch: 0.5, roll: 0.5, temperature: 0.5, coherence: 0.5, lastSeen: Date.now() });
        // Join a spectator sub-room so peers can be notified of each other's presence
        socket.join(`${room}:spectators`);
        console.log('[socket] remote joined     room:', room, '| spectator:', spectatorId ?? '—');
        socket.emit('joined', { room, userCount: roomData.users.size });
        // Notify the host simulation — triggers the join burst on the big screen
        if (roomData.hostSocketId) {
            io.to(roomData.hostSocketId).emit('spectator-joined', { userCount: roomData.users.size });
        }
        // Notify all other spectators in the room — brief pulse + updated count
        socket.to(`${room}:spectators`).emit('peer-joined', { userCount: roomData.users.size });
    });

    // ── User event from remote ────────────────────────────────────────────────
    // Always update aggregate room state first.
    // Tilt events are aggregated only (not forwarded individually — the ticker handles that).
    // All other events are forwarded straight to the simulation as 'remote-event'.
    // If VITE_N8N_WEBHOOK_URL is set the sim will call n8n directly on receipt.
    socket.on('user-event', ({ type, data }) => {
        const room        = assignedRoom;
        const spectatorId = socket.id;
        if (!room) return console.warn('[socket] user-event without room — ignoring');

        updateUserState(room, socket.id, type, data);

        // Tilt is consumed server-side for aggregation; no individual forwarding needed.
        if (type === 'tilt') return;

        io.to(room).emit('remote-event', { type, spectatorId, data, timestamp: Date.now() });
    });

    socket.on('disconnect', () => {
        if (!assignedRoom) return;
        console.log('[socket] disconnected      room:', assignedRoom);
        const room = rooms.get(assignedRoom);
        if (room) {
            const isHost = room.hostSocketId === socket.id;
            room.users.delete(socket.id);
            if (isHost) {
                room.hostSocketId = null;
            } else {
                const remaining = room.users.size;
                // Notify the host simulation — used to restore QR when room empties.
                if (room.hostSocketId) {
                    io.to(room.hostSocketId).emit('spectator-left', { userCount: remaining });
                }
                // Notify remaining spectators — used to show QR again if count drops below threshold.
                io.to(`${assignedRoom}:spectators`).emit('peer-left', { userCount: remaining });
                console.log('[socket] spectator left    room:', assignedRoom, '| remaining:', remaining);
            }
            // Clean up fully empty rooms
            if (!room.hostSocketId && !room.users.size) rooms.delete(assignedRoom);
        }
    });
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
app.get('/admin/{*path}',  (req, res) => sendPage('admin/index.html',  req, res));
app.get('/{*path}',        (req, res) => sendPage('index.html',        req, res));

server.listen(port, () => console.log(`[server] :${port}`));
