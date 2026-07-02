// ─── Backend Server ───────────────────────────────────────────────────────────
// Responsibilities (intentionally minimal):
//   1. Serve production build (dist/)
//   2. Socket.IO — three socket roles:
//        host  : the simulation display; gets a UUID session room on 'register-host'
//        remote: spectator devices; join with a room ID and emit user events
//        admin : authenticated controller; sends sim-params to the host
//   3. Event routing — forwards 'user-event' straight to the sim as 'remote-event'
//   4. Collective state — aggregates all spectators' tilt + temperature per room
//        and emits 'collective-state' to the host simulation every 300 ms
//   5. Device push — POST /spectator-push lets external callers send a 'device-message'
//        event to a specific spectator (by spectatorId) or broadcast to all in a room.
//        Authenticated via Bearer token (N8N_SECRET env var).

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
import { readdir, readFile, writeFile } from 'node:fs/promises';

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const app         = express();
const server      = createServer(app);
const io          = new SocketIO(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const port        = process.env.PORT ?? 3000;
const isDev       = process.env.NODE_ENV === 'development';
const VITE_PORT   = process.env.VITE_PORT ?? 5173;

const ADMIN_PASS  = (process.env.ADMIN_PASSWORD ?? '').trim();
const CONFIG_PASS = (process.env.PASSWORD ?? '').trim();
const N8N_SECRET  = process.env.N8N_SECRET ?? '';

if (!ADMIN_PASS)  console.warn('[server] ADMIN_PASSWORD not set — /admin will be inaccessible');
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
const rooms = new Map();

const USER_TIMEOUT_MS = 15_000;

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            hostSockets:  new Set(), // all host socketIds sharing this session
            connections:  new Map(), // socketId  → spectatorId
            spectators:   new Map(), // spectatorId → socketId  (reverse index for push)
            users:        new Map(), // socketId  → UserState
            votes:        new Map(), // socketId  → choice string (one vote per spectator)
            audioLocked:  null,      // null = unknown; true/false reported by sim
            storyStep:    -1,        // current story step index; -1 = not started
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
    if (type === 'touch') {
        user.temperature = data.temp ?? 0.5;
        user.coherence   = data.x   ?? 0.5;
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

        let st = 0, sc = 0;
        const activeUsers = [...room.users.values()];
        const n = activeUsers.length;
        if (n > 0) {
            for (const u of activeUsers) {
                st += u.temperature;
                sc += u.coherence;
            }
        }

        const totalUsers = room.connections.size;
        io.to(`${roomId}:hosts`).emit('collective-state', {
            avgTemp:      n > 0 ? st / n : 0.5,
            avgCoherence: n > 0 ? sc / n : 0.5,
            userCount:    totalUsers,
        });
        io.to(`${roomId}:spectators`).emit('note-debounce', { ms: totalUsers * 10 });
    }
}, 300);

// ── Story step broadcast — 1 s tick ──────────────────────────────────────────
setInterval(() => {
    for (const [roomId, room] of rooms) {
        if (!room.connections.size) continue;
        io.to(`${roomId}:spectators`).emit('story-step', { step: room.storyStep });
    }
}, 1000);

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
    socket.on('register-host', ({ sessionId: preferredId } = {}) => {
        const sessionId = preferredId || randomUUID();
        assignedRoom    = sessionId;
        socket.join(sessionId);
        socket.join(`${sessionId}:hosts`);
        socket.emit('session-id', sessionId);
        const room = getOrCreateRoom(sessionId);
        room.hostSockets.add(socket.id);
        console.log('[socket] host registered   room:', sessionId, '| hosts:', room.hostSockets.size);
        // Tell existing spectators the host is live so they can re-handshake.
        if (room.connections.size) io.to(`${sessionId}:spectators`).emit('host-reconnected');
    });



    // Sim reports the current story step index.
    socket.on('story-step', ({ step }) => {
        const room = assignedRoom ? rooms.get(assignedRoom) : null;
        if (!room?.hostSockets.has(socket.id)) return;
        room.storyStep = typeof step === 'number' ? step : -1;
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
        io.to(`${assignedRoom}:spectators`).emit('remote-ui', data);
        console.log('[socket] remote-ui         room:', assignedRoom, '| status:', data?.stepStatus);
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
                chaos:       typeof chaos === 'number' ? chaos : 0.5,
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

            }

            if (!room.hostSockets.size && !room.connections.size) rooms.delete(assignedRoom);
        }
    });
});

// ── Device push endpoint ──────────────────────────────────────────────────────
// POST /spectator-push — push a 'device-message' event to one spectator or all
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
const _IMAGE_MIME    = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SIM_ASS_MAX = 10;

const _generating = { image: false, audio: false };

async function _simAssFiles(dir) {
    const names = await readdir(dir).catch(() => []);
    return names.filter(n => !n.startsWith('.'));
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
        console.log('[simAss-image] no files in simAss/images — nothing to serve');
        return res.status(404).json({ error: 'no images available' });
    }
    const chosen = files[Math.floor(Math.random() * files.length)];
    const file   = path.join(dir, chosen);
    const mime   = _IMAGE_MIME[path.extname(file).toLowerCase()] ?? 'image/webp';
    console.log(`[simAss-image] serving ${chosen}`);
    res.type(mime).send(await readFile(file));
});

app.get('/simAss-config', async (_req, res) => {
    const dir = path.join(_SIM_ASS_DIR, 'config');
    try {
        const all   = await readdir(dir);
        const files = all.filter(f => f.endsWith('.json'));
        if (files.length === 0) return res.status(404).json({ error: 'no configs' });
        const chosen = files[Math.floor(Math.random() * files.length)];
        console.log(`[simAss-config] serving ${chosen}`);
        const text = await readFile(path.join(dir, chosen), 'utf8');
        res.json(JSON.parse(text));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/simAss-config', express.json({ limit: '512kb' }), async (req, res) => {
    const { password } = req.query;
    if (!CONFIG_PASS || password !== CONFIG_PASS)
        return res.status(401).json({ error: 'unauthorized' });
    const { name, config } = req.body ?? {};
    if (!name || typeof name !== 'string' || !config || typeof config !== 'object')
        return res.status(400).json({ error: 'body must be { name, config }' });
    const safe     = name.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'config';
    const filename = `${safe}.json`;
    const filepath = path.join(_SIM_ASS_DIR, 'config', filename);
    await writeFile(filepath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`[simAss-config] saved ${filename}`);
    res.json({ ok: true, filename });
});

app.get('/simAss-audio', async (_req, res) => {
    const dir   = path.join(_SIM_ASS_DIR, 'music');
    const files = await _simAssFiles(dir);
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

// ── Static assets — serves a specific file by name from simAss/static/ ──────
app.get('/simAss-static/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const file     = path.join(_SIM_ASS_DIR, 'static', filename);
    try {
        const buf  = await readFile(file);
        const ext  = path.extname(filename).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
        console.log(`[simAss-static] serving ${filename}`);
        res.type(mime).send(buf);
    } catch (e) {
        console.warn(`[simAss-static] not found: ${filename}`);
        res.status(404).json({ error: `not found: ${filename}` });
    }
});

// ── Narrator audio — serves a specific file by name from simAss/narrator/ ────
app.get('/simAss-narrator/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const file     = path.join(_SIM_ASS_DIR, 'narrator', filename);
    try {
        const buf  = await readFile(file);
        const ext  = path.extname(filename).toLowerCase();
        const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'audio/wav';
        console.log(`[simAss-narrator] serving ${filename}`);
        res.type(mime).send(buf);
    } catch (e) {
        console.warn(`[simAss-narrator] not found: ${filename}`);
        res.status(404).json({ error: `not found: ${filename}` });
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
