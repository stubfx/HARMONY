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
//   5. Spectator presence — calls n8n /webhook/spectator on every join and leave,
//        forwarding the response as 'sim-params' to the host. The server is the
//        authoritative source for connection counts; the sim never tracks them.
//   6. Device push — POST /spectator-push lets n8n send a 'device-message' event
//        to a specific spectator (by spectatorId) or broadcast to all in a room.
//        Authenticated via Bearer token (N8N_SECRET env var).
//
// Signal path:
//   remote → socket → server → socket → simulation [→ n8n → simulation]
//   server (ticker) → 'collective-state' → simulation
//   server (join/leave) → n8n /spectator → 'sim-params' → simulation
//   n8n → POST /spectator-push → server → socket → remote device

import express           from 'express';
import { createServer }  from 'node:http';
import { Server as SocketIO } from 'socket.io';
import dotenv            from 'dotenv';
import cors              from 'cors';
import path              from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID }    from 'node:crypto';
import * as Utils        from './server-utils.js';
import { narrate, generateIdleImage, generateIdleAudio } from './openai-api.js';
import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const app         = express();
const server      = createServer(app);
const io          = new SocketIO(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const port        = process.env.PORT ?? 3000;
const isDev       = process.env.NODE_ENV === 'development';
const VITE_PORT   = process.env.VITE_PORT ?? 5173;

const ADMIN_PASS = (process.env.ADMIN_PASSWORD ?? '').trim();
const N8N_BASE   = (process.env.VITE_N8N_BASE_URL ?? '').replace(/\/$/, '');
const N8N_SECRET = process.env.N8N_SECRET ?? '';

if (!ADMIN_PASS)  console.warn('[server] ADMIN_PASSWORD not set — /admin will be inaccessible');
if (!N8N_BASE)    console.warn('[server] N8N_BASE_URL not set — spectator presence will not call n8n');
if (!N8N_SECRET)  console.warn('[server] N8N_SECRET not set — /spectator-push is unauthenticated');

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
const adminTokens = new Map(); // token → expiry (ms timestamp)

setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of adminTokens) if (now > exp) adminTokens.delete(t);
}, 60 * 60 * 1000);

// ── Room state ────────────────────────────────────────────────────────────────
// connections: Map<socketId, spectatorId> — authoritative connected-user count,
//              never pruned; entries removed only on socket disconnect.
// spectators:  Map<spectatorId, socketId> — reverse index for O(1) push by spectatorId.
// users:       Map<socketId, UserState>   — tilt/touch aggregation; pruned on inactivity.
// n8nTestMode: mirrors the host sim's n8nTestMode param so server calls the right endpoint.
const rooms = new Map();

const USER_TIMEOUT_MS = 15_000;

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            hostSockets:  new Set(), // all host socketIds sharing this session
            connections:  new Map(), // socketId  → spectatorId
            spectators:   new Map(), // spectatorId → socketId  (reverse index for push)
            users:        new Map(), // socketId  → UserState
            n8nTestMode:  false,
            votes:        new Map(), // socketId  → choice string (one vote per spectator)
            storyOptions: { a: null, b: null }, // current VOTE step options
            audioLocked:  null,      // null = unknown; true/false reported by sim
        });
    }
    return rooms.get(roomId);
}

function updateUserState(roomId, socketId, type, data) {
    const room = rooms.get(roomId);
    if (!room) return;
    let user = room.users.get(socketId);
    if (!user) {
        user = { temperature: 0.5, coherence: 0.5, lastSeen: Date.now() };
        room.users.set(socketId, user);
    }
    user.lastSeen = Date.now();
    if (type === 'tilt') {
        user.chaos = data.chaos ?? 0;
    }
    if (type === 'touch') {
        user.temperature = data.temp ?? 0.5;
        user.coherence   = data.x   ?? 0.5;
    }
}

// ── n8n spectator presence ────────────────────────────────────────────────────
// Called on every join and leave. Response is forwarded as 'sim-params' to the
// host so n8n can react (show/hide QR, adjust params, etc.) with full context.
const N8N_TIMEOUT_MS = 5_000;

async function callN8nSpectator(roomId, type, spectatorId, userCount, testMode) {
    if (!N8N_BASE) return;
    const endpoint = testMode ? '/webhook-test/spectator' : '/webhook/spectator';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
    try {
        const res = await fetch(N8N_BASE + endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type, room: roomId, spectatorId, userCount, avgChaos: rooms.get(roomId)?.lastAvgChaos ?? 1 }),
            signal:  controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                const room = rooms.get(roomId);
                if (room?.hostSockets.size) io.to(`${roomId}:hosts`).emit('sim-params', data);
            }
        }
    } catch (err) {
        clearTimeout(timer);
        if (err.name !== 'AbortError') console.warn('[n8n spectator]', err.message);
    }
}

// ── Collective-state ticker ───────────────────────────────────────────────────
// Every 300 ms: prune stale users, compute averages, emit to host simulation.
// userCount reflects actual socket connections (room.connections), not active tilt senders.
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
        for (const [uid, u] of room.users) {
            if (now - u.lastSeen > USER_TIMEOUT_MS) room.users.delete(uid);
        }
        if (!room.hostSockets.size || !room.connections.size) continue;

        let st = 0, sc = 0, sChaos = 0;
        const activeUsers = [...room.users.values()];
        const n = activeUsers.length;
        if (n > 0) {
            for (const u of activeUsers) {
                st += u.temperature;
                sc += u.coherence;
                sChaos += u.chaos ?? 0;
            }
        }

        const avgChaos = n > 0 ? sChaos / n : 1;
        room.lastAvgChaos = avgChaos;

        const totalUsers = room.connections.size;
        io.to(`${roomId}:hosts`).emit('collective-state', {
            avgTemp:      n > 0 ? st / n : 0.5,
            avgCoherence: n > 0 ? sc / n : 0.5,
            avgChaos,
            userCount:    totalUsers,
        });
        io.to(`${roomId}:spectators`).emit('note-debounce', { ms: totalUsers * 10 });
    }
}, 300);

// ── Admin auth endpoint ───────────────────────────────────────────────────────
app.post('/admin-auth', (req, res) => {
    const { password } = req.body ?? {};
    if (!ADMIN_PASS || password !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = randomUUID();
    adminTokens.set(token, Date.now() + 24 * 60 * 60 * 1000);
    console.log('[admin] token issued');
    res.json({ token });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    let assignedRoom = null;

    // ── Host (simulation display) ─────────────────────────────────────────────
    socket.on('register-host', ({ testMode, sessionId: preferredId } = {}) => {
        const sessionId = preferredId || randomUUID();
        assignedRoom    = sessionId;
        socket.join(sessionId);
        socket.join(`${sessionId}:hosts`);
        socket.emit('session-id', sessionId);
        const room = getOrCreateRoom(sessionId);
        room.hostSockets.add(socket.id);
        room.n8nTestMode  = !!testMode;
        console.log('[socket] host registered   room:', sessionId, '| hosts:', room.hostSockets.size, '| testMode:', !!testMode);
        // Tell existing spectators the host is live so they can re-handshake.
        if (room.connections.size) io.to(`${sessionId}:spectators`).emit('host-reconnected');
    });

    // Syncs the host sim's n8nTestMode toggle so the server calls the right endpoint.
    socket.on('set-n8n-test-mode', (testMode) => {
        const room = assignedRoom ? rooms.get(assignedRoom) : null;
        if (room && room.hostSockets.has(socket.id)) {
            room.n8nTestMode = !!testMode;
            console.log('[socket] n8nTestMode →', !!testMode, '  room:', assignedRoom);
        }
    });

    // Sim reports its AudioContext lock state so the admin panel can show a warning.
    socket.on('audio-state', ({ locked }) => {
        const room = assignedRoom ? rooms.get(assignedRoom) : null;
        if (!room?.hostSockets.has(socket.id)) return;
        room.audioLocked = !!locked;
        io.to(`${assignedRoom}:admin`).emit('audio-state', { locked: room.audioLocked });
    });


    // ── Admin controller ──────────────────────────────────────────────────────
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
        socket.join(`${targetRoom}:admin`);
        socket.emit('admin-registered', { room: targetRoom });
        const existingRoom = rooms.get(targetRoom);
        socket.emit('spectator-count', { count: existingRoom?.connections.size ?? 0 });
        if (existingRoom?.audioLocked != null) socket.emit('audio-state', { locked: existingRoom.audioLocked });
        console.log('[socket] admin registered  room:', targetRoom);
    });

    socket.on('admin-sim-params', (params) => {
        if (!adminAuthorized) return;
        const expiry = adminTokens.get(adminToken);
        if (!expiry || Date.now() > expiry) {
            adminAuthorized = false;
            socket.emit('admin-auth-error', { error: 'Token expired' });
            return;
        }
        const roomData = rooms.get(assignedRoom);
        if (!roomData?.hostSockets.size) return;
        io.to(`${assignedRoom}:hosts`).emit('sim-params', params);
    });

    // ── Remote device (spectator) ─────────────────────────────────────────────
    socket.on('join-session', ({ room, spectatorId }) => {
        assignedRoom    = room;
        const roomData  = getOrCreateRoom(room);
        const sid       = spectatorId ?? socket.id;

        roomData.users.set(socket.id, { temperature: 0.5, coherence: 0.5, lastSeen: Date.now() });
        roomData.connections.set(socket.id, sid);
        roomData.spectators.set(sid, socket.id);
        socket.join(`${room}:spectators`);

        const userCount = roomData.connections.size;
        console.log('[socket] remote joined     room:', room, '| spectator:', sid, '| total:', userCount);

        socket.emit('joined', { room, userCount });
        if (roomData.hostSockets.size) {
            io.to(`${room}:hosts`).emit('spectator-joined', { userCount, spectatorId: sid });
        }
        io.to(`${room}:spectators`).emit('note-debounce', { ms: userCount * 10 });
        socket.to(`${room}:spectators`).emit('peer-joined', { userCount });
        io.to(`${room}:admin`).emit('spectator-count', { count: userCount });

        callN8nSpectator(room, 'spectator-joined', sid, userCount, roomData.n8nTestMode);
    });

    // ── User event from remote ────────────────────────────────────────────────
    socket.on('user-event', ({ type, data }) => {
        const room = assignedRoom;
        if (!room) return console.warn('[socket] user-event without room — ignoring');

        updateUserState(room, socket.id, type, data);

        const roomData    = rooms.get(room);
        const spectatorId = roomData?.connections.get(socket.id) ?? socket.id;
        io.to(room).emit('remote-event', { type, spectatorId, data, timestamp: Date.now() });
    });

    // ── Remote UI — host broadcasts step status to all spectators ────────────────
    socket.on('remote-ui', (data) => {
        const room = rooms.get(assignedRoom);
        if (!room?.hostSockets.has(socket.id)) return;
        room.votes.clear();
        room.storyOptions.a = data?.optionA ?? null;
        room.storyOptions.b = data?.optionB ?? null;
        io.to(`${assignedRoom}:spectators`).emit('remote-ui', data);
        console.log('[socket] remote-ui         room:', assignedRoom, '| status:', data?.stepStatus);
    });

    // ── Story vote — spectator casts one vote; host gets running tally ───────────
    socket.on('story-vote', ({ choice } = {}) => {
        const room = rooms.get(assignedRoom);
        if (!room || !choice) return;
        room.votes.set(socket.id, choice);
        const { a, b } = room.storyOptions;
        let votesA = 0, votesB = 0;
        for (const v of room.votes.values()) {
            if (v === a) votesA++;
            else if (v === b) votesB++;
        }
        if (room.hostSockets.size) {
            io.to(`${assignedRoom}:hosts`).emit('story-vote-update', {
                optionA: a, votesA,
                optionB: b, votesB,
                total:   room.votes.size,
            });
        }
        console.log('[socket] story-vote        room:', assignedRoom, '|', a, votesA, 'vs', b, votesB);
    });

    // ── Host push to a specific spectator ────────────────────────────────────────
    socket.on('push-to-spectator', ({ spectatorId, data }) => {
        const room = rooms.get(assignedRoom);
        if (!room) return;
        const targetSocketId = room.spectators.get(spectatorId);
        if (targetSocketId) io.to(targetSocketId).emit('device-message', data);
    });

    // ── OpenAI narration (keypress 'f' on host) ───────────────────────────────
    socket.on('openai-narrate', async ({ chaos, image } = {}) => {
        if (!assignedRoom) return;
        try {
            const room  = rooms.get(assignedRoom);
            let sp = 0, sr = 0, st = 0, sc = 0, n = 0;
            for (const u of (room?.users?.values() ?? [])) {
                sp += u.pitch ?? 0.5; sr += u.roll ?? 0.5;
                st += u.temperature ?? 0.5; sc += u.coherence ?? 0.5;
                n++;
            }
            const snapshot = {
                chaos:       typeof chaos === 'number' ? chaos : (room?.lastAvgChaos ?? 1),
                users:       room?.connections.size ?? 0,
                temperature: n > 0 ? st / n : 0.5,
                coherence:   n > 0 ? sc / n : 0.5,
                imageBase64: typeof image === 'string' && image.length > 0 ? image : null,
            };
            const { base64, text } = await narrate(assignedRoom, snapshot);
            socket.emit('openai-audio', { base64, mimeType: 'audio/mpeg', text });
            console.log('[openai] narrated — chaos:', snapshot.chaos.toFixed(3), '| users:', snapshot.users, '| chars:', text.length);
        } catch (err) {
            console.error('[openai] narrate error:', err.message);
        }
    });

    socket.on('disconnect', () => {
        if (!assignedRoom) return;
        console.log('[socket] disconnected      room:', assignedRoom);
        const room = rooms.get(assignedRoom);
        if (room) {
            const isHost      = room.hostSockets.has(socket.id);
            const spectatorId = room.connections.get(socket.id);
            room.users.delete(socket.id);
            room.votes.delete(socket.id);
            room.connections.delete(socket.id);
            // Only remove from spectators map if this socket is still the active one —
            // guards against a late disconnect event wiping a freshly reconnected entry.
            if (spectatorId !== undefined && room.spectators.get(spectatorId) === socket.id) {
                room.spectators.delete(spectatorId);
            }

            if (isHost) {
                room.hostSockets.delete(socket.id);
                console.log('[socket] host left         room:', assignedRoom, '| hosts remaining:', room.hostSockets.size);
            } else {
                const remaining = room.connections.size;
                if (room.hostSockets.size) {
                    io.to(`${assignedRoom}:hosts`).emit('spectator-left', { userCount: remaining, spectatorId });
                }
                io.to(`${assignedRoom}:spectators`).emit('peer-left', { userCount: remaining });
                io.to(`${assignedRoom}:spectators`).emit('note-debounce', { ms: remaining * 10 });
                io.to(`${assignedRoom}:admin`).emit('spectator-count', { count: remaining });
                console.log('[socket] spectator left    room:', assignedRoom, '| remaining:', remaining);

                if (spectatorId !== undefined) {
                    callN8nSpectator(assignedRoom, 'spectator-left', spectatorId, remaining, room.n8nTestMode);
                }
            }

            if (!room.hostSockets.size && !room.connections.size) rooms.delete(assignedRoom);
        }
    });
});

// ── Device push endpoint ──────────────────────────────────────────────────────
// Called by n8n to push a 'device-message' event to one spectator or all
// spectators in a room. Authenticated with Bearer token (N8N_SECRET env var).
//
// POST /spectator-push
// Authorization: Bearer <N8N_SECRET>
// Body:
//   room        string  — target room UUID (required)
//   spectatorId string  — target spectator UUID; omit to broadcast to all in room
//   data        object  — arbitrary payload forwarded verbatim as the socket event
//
// Response:
//   { delivered: true, target: "specific", spectatorId }  — sent to one socket
//   { delivered: true, target: "broadcast", count: N }    — sent to whole room
//   404  { error: "room not found" }
//   404  { error: "spectator not connected" }
//   401  { error: "Unauthorized" }
app.post('/spectator-push', (req, res) => {
    if (N8N_SECRET) {
        const [scheme, token] = (req.headers.authorization ?? '').split(' ');
        if (scheme !== 'Bearer' || token !== N8N_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    const { room: roomId, spectatorId, data } = req.body ?? {};
    if (!roomId) return res.status(400).json({ error: 'room is required' });

    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'room not found' });

    const payload = data ?? {};

    if (spectatorId) {
        const socketId = room.spectators.get(spectatorId);
        if (!socketId) return res.status(404).json({ error: 'spectator not connected' });
        io.to(socketId).emit('device-message', payload);
        console.log('[push] → spectator', spectatorId.slice(0, 8), '  room:', roomId);
        return res.json({ delivered: true, target: 'specific', spectatorId });
    }

    io.to(`${roomId}:spectators`).emit('device-message', payload);
    console.log('[push] → all spectators  room:', roomId, '| count:', room.connections.size);
    return res.json({ delivered: true, target: 'broadcast', count: room.connections.size });
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

// ── simAss assets — ./simAss/{images,music}/, max 10, 1-day lifespan ─────────
const _SIM_ASS_DIR   = path.join(__dirname, '..', 'simAss');
const _IMAGE_MIME    = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const SIM_ASS_MAX    = 10;
const _FILE_LIFESPAN = 24 * 60 * 60 * 1000; // 1 day in ms

const _generating = { image: false, audio: false };

async function _simAssFiles(dir, { checkExpiry = true } = {}) {
    const now   = Date.now();
    const names = await readdir(dir).catch(() => []);
    const valid = [];
    for (const name of names) {
        if (name.startsWith('.')) continue;
        const full = path.join(dir, name);
        try {
            const s = await stat(full);
            if (checkExpiry && now - s.mtimeMs > _FILE_LIFESPAN) {
                await unlink(full);
                console.log(`[simAss] expired and deleted: ${name}`);
            } else {
                valid.push(name);
            }
        } catch { /* file disappeared between readdir and stat — ignore */ }
    }
    return valid;
}

async function _genAndSaveImage(dir) {
    if (_generating.image) { console.log('[simAss-image] generation already in progress — skipping'); return; }
    _generating.image = true;
    console.log('[simAss-image] starting generation…');
    try {
        const base64   = await generateIdleImage();
        const buf      = Buffer.from(base64, 'base64');
        const filename = `simAss_${Date.now()}.webp`;
        await writeFile(path.join(dir, filename), buf);
        console.log(`[simAss-image] saved ${filename}  size=${buf.length}B`);
        return { buf, mime: 'image/webp' };
    } finally { _generating.image = false; }
}

async function _genAndSaveAudio(dir) {
    if (_generating.audio) { console.log('[simAss-audio] generation already in progress — skipping'); return; }
    _generating.audio = true;
    console.log('[simAss-audio] starting generation…');
    try {
        const buf      = await generateIdleAudio();
        const filename = `simAss_${Date.now()}.mp3`;
        await writeFile(path.join(dir, filename), buf);
        console.log(`[simAss-audio] saved ${filename}  size=${buf.length}B`);
        return { buf, mime: 'audio/mpeg' };
    } finally { _generating.audio = false; }
}

app.get('/simAss-image', async (_req, res) => {
    const dir   = path.join(_SIM_ASS_DIR, 'images');
    const files = await _simAssFiles(dir);
    console.log(`[simAss-image] request — ${files.length} file(s) available: [${files.join(', ')}]`);
    if (files.length === 0) {
        console.log('[simAss-image] no files — generating synchronously…');
        try {
            const { buf, mime } = await _genAndSaveImage(dir);
            return res.type(mime).send(buf);
        } catch (err) {
            console.error('[simAss-image] generation failed:', err.message);
            return res.status(500).json({ error: err.message });
        }
    }
    const chosen = files[Math.floor(Math.random() * files.length)];
    const file   = path.join(dir, chosen);
    const mime   = _IMAGE_MIME[path.extname(file).toLowerCase()] ?? 'image/webp';
    console.log(`[simAss-image] serving ${chosen}  (${files.length}/${SIM_ASS_MAX})`);
    res.type(mime).send(await readFile(file));
    if (files.length < SIM_ASS_MAX) {
        console.log(`[simAss-image] below cap (${files.length}/${SIM_ASS_MAX}) — triggering background generation`);
        _genAndSaveImage(dir).catch(e => console.error('[simAss-image] bg gen failed:', e.message));
    }
});

app.get('/simAss-audio', async (_req, res) => {
    const dir   = path.join(_SIM_ASS_DIR, 'music');
    const files = await _simAssFiles(dir, { checkExpiry: false });
    console.log(`[simAss-audio] request — ${files.length} file(s) available: [${files.join(', ')}]`);
    if (files.length === 0) {
        console.log('[simAss-audio] no files — generating synchronously…');
        try {
            const { buf, mime } = await _genAndSaveAudio(dir);
            return res.type(mime).send(buf);
        } catch (err) {
            console.error('[simAss-audio] generation failed:', err.message);
            return res.status(500).json({ error: err.message });
        }
    }
    const chosen = files[Math.floor(Math.random() * files.length)];
    const file   = path.join(dir, chosen);
    console.log(`[simAss-audio] serving ${chosen}  (${files.length}/${SIM_ASS_MAX})`);
    res.type('audio/mpeg').send(await readFile(file));
    if (files.length < SIM_ASS_MAX) {
        console.log(`[simAss-audio] below cap (${files.length}/${SIM_ASS_MAX}) — triggering background generation`);
        _genAndSaveAudio(dir).catch(e => console.error('[simAss-audio] bg gen failed:', e.message));
    }
});

// ── Page fallbacks ────────────────────────────────────────────────────────────
function sendPage(distFile, req, res) {
    if (isDev) return res.redirect(`http://localhost:${VITE_PORT}${req.originalUrl}`);
    res.sendFile(path.join(__dirname, '../dist', distFile), (err) => {
        if (err) res.status(503).send('Build not found — run `npm run build` first.');
    });
}
app.get('/remote/{*path}', (req, res) => sendPage('remote/index.html', req, res));
app.get('/admin/{*path}',  (req, res) => sendPage('admin/index.html',  req, res));
app.get('/{*path}',        (req, res) => sendPage('index.html',        req, res));

server.listen(port, () => console.log(`[server] :${port}`));
