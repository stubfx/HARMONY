// ─── Backend Server — Socket.IO relay + n8n bridge ───────────────────────────
// The server no longer calls OpenAI directly.
// ALL AI/parameter logic is delegated to n8n via webhook.

import express     from 'express';
import { createServer } from 'node:http';
import { Server }  from 'socket.io';
import dotenv      from 'dotenv';
import cors        from 'cors';
import { randomUUID } from 'node:crypto';
import * as Utils  from './server-utils.js';
import { forwardToN8n } from './n8n-proxy.js';

dotenv.config();

const ORIGINS = [
    'https://stubfx.io',
    'https://localhost',
    'https://192.168.1.12',
    // Allow any local IP during dev
    ...(process.env.EXTRA_ORIGINS ?? '').split(',').filter(Boolean),
];

const app    = express();
const server = createServer(app);
const port   = process.env.PORT ?? 3000;

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
    path: '/socket.io',
    cors: {
        origin:      ORIGINS,
        methods:     ['GET', 'POST'],
        credentials: true,
    },
});

app.use(express.json());
app.set('trust proxy', true);

// host socket-id registry: { [UUID]: socketId }
const hostList = {};

io.on('connection', (socket) => {
    console.log('[socket] connected', socket.id);

    // Host registers its session UUID
    socket.on('register-host', ({ room }) => {
        console.log('[socket] register-host', room);
        hostList[room] = socket.id;
    });

    // ── Mobile → Host relay events ─────────────────────────────────────────

    // Raw colour override (bypasses n8n, instant)
    socket.on('color', ({ room, color }) => {
        io.to(hostList[room]).emit('color', color);
    });

    // Device motion intensity (bypasses n8n, instant)
    socket.on('motion', ({ room, motion }) => {
        io.to(hostList[room]).emit('motion', motion);
    });

    // ── Text prompt: forward to n8n, relay params back to host ───────────────
    socket.on('text-input', async ({ room, data }) => {
        // Immediately echo the text to the host so it can show loading state
        io.to(hostList[room]).emit('text-input', data);

        // Forward to n8n workflow
        const result = await forwardToN8n('simulation', { text: data, room });

        if (result) {
            // n8n returns the full response: { name, feelings, simulation, image_prompt, image_data? }
            io.to(hostList[room]).emit('sim-params', result);
        }
    });

    socket.on('disconnect', () => {
        // Clean up host registry if the host disconnects
        for (const [room, id] of Object.entries(hostList)) {
            if (id === socket.id) delete hostList[room];
        }
    });
});

// ── HTTP endpoints ────────────────────────────────────────────────────────────
app.use(cors({ origin: ORIGINS, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));

// Session UUID
app.post('/uuid', (_req, res) => {
    res.json(randomUUID());
});

// Serve a random cached image (for placeholder media trail)
app.post('/rndImage', async (_req, res) => {
    try {
        const { fileName, data } = await Utils.randomPrevImage();
        res.json({ name: fileName, data: 'data:image/png;base64,' + data.toString('base64') });
    } catch (e) {
        res.status(404).json(null);
    }
});

server.listen(port, () => console.log(`[server] :${port}`));
