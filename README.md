# Wind Particles

A real-time GPU particle simulation for an art-direction thesis. Up to 1.2 million
independent agents move through two invisible mathematical fields — a *direction
field* and a *wind field* — both defined live by typed formulas compiled directly
into WGSL compute shaders at runtime.

---

## What This Is Meant to Feel Like

### Wind as an invisible presence

The wind formula does not animate particles directly. It exerts a *force* — a
vector that accumulates into each particle's velocity. When you change the wind
formula, you do not see the formula. You see its consequence: particles tilting,
accelerating, curling. The mathematics is the weather.

The wind is felt before it is understood. This is intentional.

### Particles as autonomous yet subject

Each particle follows its own *direction formula* — a heading it wants to
maintain. But the wind keeps pulling it off course. The tension between intention
and circumstance is what produces the visible motion: not chaos, not rigidity,
but something that breathes.

Particles do not know about each other. There is no communication, no collective
signal. Pattern emerges purely from the shared mathematical space they inhabit.
Like birds that flock without a leader, or dust that spirals without being
instructed.

### Speed as vitality

A slow particle renders dim. A fast particle glows at full brightness toward the
chosen *fast color*. Brightness is not decoration — it is a direct readout of
kinetic energy. The simulation makes speed visible as light.

### The trail as memory

Nothing persists. Trails fade within a second. But for that second you can see
where energy has been — the ghost of a gust, the after-image of a wave.
Impermanence is part of the aesthetic.

### The formula as a way of touching the world

Typing `sin(x * 0.008 + t) * PI` creates a weather pattern.
Typing `atan2(y - cy, x - cx)` creates gravity.
The formula is not a technical parameter — it is the act of deciding what kind
of force exists in this space. Mathematical expressiveness becomes physical
intuition.

### The image as a hidden attractor

A black-and-white image can be loaded as a magnet layer. Bright areas exert a
pull — particles drift toward light, dark areas repel or are ignored. The image
is never rendered directly. It is felt through collective density.

---

## Architecture

The simulation is the key visual and the session owner. It connects to the server
on startup, receives a UUID session token, and displays a QR code that spectators
scan to join. All communication flows through the server via Socket.IO.

```
Host browser — simulation display (WebGPU)
    │  Socket.IO  'register-host'   →  server assigns session UUID
    │  Socket.IO  'session-id'      ←  server emits UUID back
    │  QR code generated: /remote/?s=<uuid>
    │
    │  'spectator-joined'  ←─── server (fires on each new spectator join)
    │                            → brief directional gust in the particle field
    │
    │  'collective-state'  ←─── server ticker every 300 ms
    │                            { avgPitch, avgRoll, avgTemp, avgCoherence, userCount }
    │                            → wind bias, turnRate scale, speed-color tint
    │
    │                     ┌─────────────────────────────────────────────┐
    │                     │  RELAY_MODE=direct (default)                │
    │  'remote-event'  ←──┤  server forwards touch/text events here     │
    │                     └─────────────────────────────────────────────┘
    │                     ┌─────────────────────────────────────────────┐
    │  'sim-params'   ←───┤  RELAY_MODE=n8n                            │
    │                     │  server → n8n → /n8n-sim-update → sim       │
    │                     └─────────────────────────────────────────────┘
    ▼
Display / projection

Spectators  (/remote/?s=<uuid>)
    │  Socket.IO  'join-session'  →  server
    │  Socket.IO  'user-event'    →  server routes per RELAY_MODE
    │                                 tilt events: aggregated only, not forwarded
    │  Socket.IO  'peer-joined'  ←─  server (brief aura pulse when another spectator joins)
    ▼
Node.js server  (:3000)
    │  direct mode: io.to(room).emit('remote-event', ...)
    │  n8n mode:    HTTP POST → n8n webhook
    │  always:      updates room state (pitch, roll, temperature, coherence per user)
    │  ticker:      emits 'collective-state' to host every 300 ms
    ▼
[n8n workflow  (:5678)]      ← only in RELAY_MODE=n8n
    │  AI processing → parameter generation
    │  HTTP POST /n8n-sim-update
    ▼
Server → Socket.IO 'sim-params' → simulation
```

### Session lifecycle

1. Simulation connects via Socket.IO and emits `'register-host'`
2. Server generates a UUID, puts the socket in room `<uuid>`, emits `'session-id'` back
3. Simulation logs the remote URL to the console and displays a QR code:
   - **Small scannable overlay** in the bottom-left UI panel (click to open)
   - **Large trace image** in the canvas centre — the particle field writes the QR pattern
4. Spectators scan the QR, open `/remote/?s=<uuid>`, connect via Socket.IO
5. Server emits `spectator-joined` to the host — a brief gust fires in the particle field
6. Server emits `peer-joined` to all other spectators — their aura briefly dims and recovers
7. Every 300 ms the server aggregates all spectators' state and emits `collective-state` to the host
8. Spectator touch/text events are also routed per `RELAY_MODE`

### RELAY_MODE

Set `RELAY_MODE` in `.env` to control how spectator touch/text events are processed:

| Value | Path | Use when |
|-------|------|----------|
| `direct` | remote → server → simulation | Testing, no AI processing needed |
| `n8n` | remote → server → n8n → simulation | Full performance with AI parameter generation |

Tilt events are **always** consumed server-side for aggregation regardless of `RELAY_MODE` — they are never forwarded individually to the simulation.

### Collective state aggregation

The server maintains a per-room user table. Every 300 ms it averages all active spectators' values and emits `collective-state` to the host simulation:

| Field | Source | Effect in simulation |
|-------|--------|----------------------|
| `avgPitch` | phone tilt (Y axis) | wind bias Y — field tilts forward/back |
| `avgRoll` | phone tilt (X axis) | wind bias X — field tilts left/right |
| `avgTemp` | touch Y position | speed-color hue: blue (top/cold) → amber (bottom/warm), 65% blend |
| `avgCoherence` | touch X position | turnRate multiplier: 0.08× (left/chaos) → 3.0× (right/order) |
| `userCount` | active connections | logged; future use for presence-driven parameter scaling |

All collective values are smoothed with an exponential moving average (~0.8 s time constant) in the simulation before being written to the GPU, preventing jarring jumps when spectators join or leave.

---

## Simulation Pipeline (raw WebGPU)

All computation runs on the GPU. No Three.js. No WebGL.

| Pass | Type | Description |
|------|------|-------------|
| **Compute** | Compute | Agent physics: formula steering, wind force + collective tilt bias, drag, speed clamping, edge wrap |
| **Fade** | Render | Black fullscreen quad with alpha blend — exponential trail decay each frame |
| **Particles** | Render | Per-agent quads drawn into offscreen texture; attenuated additive blend; speed-color tinted by collective temperature |
| **Blit** | Render | Copy offscreen texture → canvas swap-chain; applies `bgBlackCutoff` to clamp near-zero trail residual to pure black |

Agents are stored as `array<Agent>` (pos.xy, vel.xy, home.xy, weight, _pad — 32 bytes each)
in a persistent GPU storage buffer. The buffer is always allocated at
`MAX_AGENTS × 32` bytes; `params.agentCount` drives actual dispatch and draw counts
without reallocation.

The compute uniform buffer (`SoloParams`, 96 bytes) carries two extra fields beyond
the base physics params: `windBiasX` and `windBiasY` — the smoothed collective tilt
vector added directly to the formula wind each frame. The coherence multiplier is
applied to `turnRate` in JavaScript before writing the buffer, so no shader change
is needed for coherence.

---

## Intro Sequence

On load, agents spawn from screen centre pointing radially outward. For the first
`introDelay` seconds (default 5 s) the simulation runs in free-drift mode:
`followFormula` and `windEnabled` are silently suppressed without mutating the
GUI values. After the intro window, the active direction and wind formulas engage.

The intro delay is tunable via the GUI (Motion → intro delay).

---

## Remote Spectator Interactions

Spectators open the `/remote/` page on their phones. The page is intentionally minimal — a dark full-screen surface with no labels or visible controls. Three interaction channels feed the simulation collectively:

| Channel | Phone gesture | Aggregation | Simulation effect |
|---------|--------------|-------------|-------------------|
| **Tilt** | Hold and tilt phone in any direction | Server averages all pitch/roll vectors | Collective wind bias — the whole field leans with the crowd |
| **Temperature** | Touch anywhere — Y position matters | Server averages all touch Y values | Speed-color hue: cold blue (finger at top) → warm amber (finger at bottom) |
| **Coherence** | Touch anywhere — X position matters | Server averages all touch X values | turnRate multiplier: left = agents drift chaotically, right = agents snap to formula |
| **Text** | Type in the bottom input | Forwarded directly to simulation | Trace attractor — particle field writes the word |

No single person steers the simulation. The field responds to the *average* of everyone's input. Individual gestures dissolve into the collective.

### Feedback loops

- **On the big screen**: every new spectator join fires a brief directional gust in the particle field — a visible pulse that confirms the join without any text or notification
- **On the phone**: the aura behind the screen reflects all three axes simultaneously (hue = temperature, tightness = coherence, anchor point = tilt). When another spectator joins, all phones feel a brief aura dimming pulse.
- **Tilt indicator**: after motion permission is granted, a small bubble appears at the center of the phone screen and moves with the physical phone orientation.

See [behavior.md](behavior.md) for the full art-direction intent behind these interactions.

---

## Trace Text

An amber-styled text field sits above the direction formula input in the bottom-left panel. Whatever is typed there is rendered as a particle attractor — agents whose home positions fall inside the text glyphs steer toward them, making the particle field collectively write the text.

The text is rendered as **white glyphs on a transparent canvas** using the browser's Canvas 2D API, then composited with any loaded trace image, and uploaded to the GPU as a single `rgba8unorm` texture. From the shader's perspective it is identical to a loaded image: the same alpha threshold, black cutoff, and edge fade controls all apply.

**Key behaviours:**

- Texture rebuilds 300 ms after the last keystroke — no Enter needed
- When combined with a loaded image, text is drawn on top in white
- Clearing the image leaves text active; clearing the text field leaves the image active
- Font is bold sans-serif, auto-fitted to the canvas width

See [PARAMETERS.md](PARAMETERS.md) for full details on how sizing and layering work.

---

## Formula System

Both fields are WGSL expressions evaluated per-agent per-frame. The return value
is an **angle in radians** that the agent steers toward (direction) or is pushed
by (wind).

**Available variables:**

| Variable | Meaning |
|----------|---------|
| `x`, `y` | Agent canvas-pixel position |
| `cx`, `cy` | Canvas centre (pixels) |
| `t` | Time in seconds |
| `idx` | Agent index |
| `PI`, `TWO_PI` | Constants |

**Example formulas:**

```
atan2(cy - y, cx - x)                          // inward pointing
sin(x * 0.006 + t) * PI                        // horizontal sine wave
atan2(y - cy, x - cx) + t * 0.5               // slow spiral outward
sin(x * 0.004) * cos(y * 0.004) * TWO_PI      // grid interference
```

Formulas are compiled into WGSL at runtime. A syntax error shows a red message
below the input; the previous valid pipeline stays active.

### Auto-cycle

Every ~30 seconds a scheduler randomly picks a new formula from each of two
20-formula built-in libraries. Guards:
- Direction auto-cycle only fires when `follow formula` and `auto-cycle formula` are both on
- Wind auto-cycle only fires when wind is `enabled` and its `auto-cycle formula` is on
- Both are suppressed while `idle` mode is active

### Idle mode

When the `⌂ idle` toggle is on, both fields lock to fixed formulas and auto-cycle
is suspended:

```
Direction: atan2(cy - y, cx - x)
Wind:      atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t
```

This creates a calm inward-pull state — useful as a neutral resting state between
performances.

**Formula changes never reseed agents.** Particle positions are preserved across
any formula switch. Only the `↺ Restart` button reseeds.

---

## GUI

The HUD is **hidden by default**. Toggle it with:

| Method | Effect |
|--------|--------|
| `?gui=true` URL parameter | Open with GUI visible |
| `Ctrl` key | Toggle all panels on/off at runtime |

The GUI has four folders. See [PARAMETERS.md](PARAMETERS.md) for a full description of every control.

### Motion

| Control | Description |
|---------|-------------|
| agents | Active agent count (1 000 – 1 200 000) |
| base speed | Step length per frame |
| turn rate | How sharply agents steer toward the direction formula |
| max speed | Speed cap; also sets the slow/fast colour blend breakpoint |
| min speed | Floor speed |
| weight spread | Per-agent weight variation (0 = uniform, 1 = wide spread) |
| follow formula | Enable/disable direction formula steering |
| auto-cycle formula | Randomly switch direction formula every ~30 s |
| intro delay (s) | Free-drift seconds at startup before formulas engage |

### Wind

| Control | Description |
|---------|-------------|
| enabled | Master wind toggle |
| strength | Wind force multiplier |
| auto-cycle formula | Randomly switch wind formula every ~30 s |
| show arrows | Debug overlay showing wind direction as coloured arrows |

### Visual

| Control | Description |
|---------|-------------|
| render scale | Canvas resolution multiplier (reduce on HiDPI screens for performance) |
| trail decay | How fast trails fade (higher = shorter trails) |
| agent size | Quad size in canvas pixels |
| base color | Colour of slow/stationary agents |
| fast color | Colour approached at max speed |
| brightness | Per-particle alpha; controls additive accumulation — prevents saturation to white |

### Trace

The trace layer loads an image onto the GPU and uses it to redirect agents.
The image is never rendered directly — it is felt through collective agent density and colour.

| Control | Description |
|---------|-------------|
| homing speed | px/frame agents move toward their home when homing is active |
| alpha threshold | Min image alpha required at an agent's home to activate homing |
| black cutoff | Luminance below which pixels are treated as fully transparent |
| edge fade | Width of smooth rectangular fade applied to all four image edges |
| size | Image footprint as fraction of `min(canvasW, canvasH)`; aspect ratio preserved |
| show image | Grayscale debug overlay of the loaded image |
| Load image… | File picker (any browser-supported image format) |
| Clear image | Remove trace image; return to formula-only mode |

---

## Monitor (top-left)

When the GUI is visible, a compact overlay shows:

```
1920 × 1080  @1.00x
60.0 fps
1 200 000 agents
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Install n8n globally

```bash
npm install -g n8n
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env: PORT, EXTRA_ORIGINS, SERVER_ASSETS_DIR
```

### 4. Development

```bash
npm run dev
```

Starts three processes concurrently:

| Process | Port | Description |
|---------|------|-------------|
| Vite | 5173 | Dev server with HMR; proxies `/rndImage` and `/n8n-sim-update` to Express |
| Express | 3000 | Socket.IO session assignment, n8n relay, static assets; HTML page requests redirect to Vite |
| n8n | 5678 | Workflow automation |

Socket.IO clients connect **directly** to Express in dev (bypassing Vite) because Vite's HTTP proxy can't reliably handle Socket.IO's polling handshake. The socket URL is controlled by `VITE_SERVER_PORT`.

### 5. Production

Set all `VITE_*` variables in `.env` **before** building — Vite bakes them into
the bundle at compile time. Changing them later requires a rebuild.

```bash
# .env (production values)
VITE_USER_URL=https://api.stubfx.io
VITE_SOCKET_URL=https://api.stubfx.io

npm run build          # bakes VITE_* into dist/
npm run start          # starts Express (no n8n unless you need it)
```

Verify the socket URL was baked in:
```bash
grep -r "api.stubfx.io" dist/assets/*.js
```

Caddy serves `dist/` at `stubfx.io` and proxies `api.stubfx.io` to Express.
See the `Caddyfile` for the full configuration.

### 6. HTTPS with Caddy (required for iOS spectators)

**Development (local CA):**
```bash
caddy trust   # once — installs local CA
caddy run     # reads Caddyfile from current directory
```

**Production:**
Caddy obtains Let's Encrypt certificates automatically when the DNS A records
for `stubfx.io` and `api.stubfx.io` point to the server. Just run:
```bash
caddy run
```

### 7. Import the n8n workflow

1. Open `http://localhost:5678`
2. New workflow → Import from file → `n8n-workflow.json`
3. Activate the workflow

---

## n8n Workflow Contract

Only relevant when `RELAY_MODE=n8n`. The server POSTs user events to `N8N_WEBHOOK_URL`:

```json
{ "type": "text", "room": "session-UUID", "spectatorId": "socket-id", "data": { "text": "user prompt" }, "timestamp": 1234567890 }
```

n8n processes the event and must POST back to `SERVER_CALLBACK_URL` (default `http://localhost:3000/n8n-sim-update`):

```json
{
  "room": "session-UUID",
  "simulation": {
    "stepLen":      2.0,
    "turnRate":     0.04,
    "maxSpeed":     5.0,
    "windStr":      0.3,
    "trailDecay":   0.055,
    "pointSize":    2.0,
    "color":        "#0000ff",
    "speedColor":   "#ff4400",
    "brightness":   0.08,
    "dirFormula":   "atan2(cy - y, cx - x)",
    "windFormula":  "sin(x * 0.004 + t) * PI"
  }
}
```

The server emits `'sim-params'` to the simulation socket. Only the fields you include are applied; unrecognised keys are ignored.

---

## Environment Variables

`VITE_*` variables are **baked into the bundle at build time** by Vite. Changing them requires a rebuild (`npm run build`).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express server port |
| `VITE_PORT` | `5173` | Vite dev server port — Express redirects HTML requests here in dev |
| `VITE_SERVER_PORT` | `3000` | Express port exposed to browser clients for direct Socket.IO connection in dev |
| `RELAY_MODE` | `direct` | `direct` or `n8n` — controls spectator event routing |
| `N8N_WEBHOOK_URL` | `http://localhost:5678/webhook/user-event` | n8n webhook (RELAY_MODE=n8n only) |
| `SERVER_CALLBACK_URL` | `http://localhost:3000/n8n-sim-update` | URL n8n POSTs results back to |
| `VITE_USER_URL` | `http://localhost:3000` | Origin used to build the QR code URL (`$VITE_USER_URL/remote/?s=<uuid>`) |
| `VITE_SOCKET_URL` | — | Socket.IO server origin used by browser clients **in production**. Set to your public API domain (e.g. `https://api.stubfx.io`). In dev this is ignored — clients always connect directly to Express. Falls back to `'/'` (page origin) if unset. |
| `SERVER_ASSETS_DIR` | `prev-images` | Directory for cached random images |
| `EXTRA_ORIGINS` | — | Comma-separated extra CORS origins |

### Split-domain production setup

The production deployment uses two domains:

| Domain | Role | Points to |
|--------|------|-----------|
| `stubfx.io` | Static site — simulation page + `/remote` | Caddy → `dist/` (file server) |
| `api.stubfx.io` | API + Socket.IO | Caddy → Express `:3000` |

Because the page (`stubfx.io`) and the API (`api.stubfx.io`) are different origins, `VITE_SOCKET_URL` **must** be set explicitly so browser clients connect to the right origin. Express's CORS allowlist must include `https://stubfx.io` (already the default).

Caddy handles TLS automatically via Let's Encrypt and proxies WebSocket upgrade handshakes without extra configuration.

---

## URL Parameters

| Parameter | Effect |
|-----------|--------|
| `?gui=true` | Start with GUI, monitor, and formula panel visible |

---

## Project Structure

```
thesis-sim/
├── src/
│   ├── sim.js               Main entry point: GPU setup, frame loop, GUI, formula system,
│   │                        Socket.IO host, collective-state handler, join burst
│   └── shaders/
│       ├── compute.wgsl     Agent physics compute shader (SoloParams 96 bytes,
│       │                    includes windBiasX/Y for collective tilt)
│       └── render.wgsl      Per-agent quad rendering (speed→colour blend)
│
├── remote/
│   ├── index.html           Spectator page (served at /remote/?s=<uuid>)
│   ├── main.js              Socket.IO client — tilt, touch (temp+coherence), text events;
│   │                        aura reflects all three axes; peer-joined pulse
│   ├── style.css            Dark atmospheric design, ripple animation, tilt indicator
│   ├── gyro.js              Device orientation helpers (pitch, roll, motion magnitude)
│   └── motion.js            Motion smoothing
│
├── server/
│   ├── server.js            Socket.IO host/remote routing; room state aggregation;
│   │                        collective-state ticker (300 ms); spectator-joined/peer-joined
│   └── server-utils.js      File I/O for cached images
│
├── index.html
├── Caddyfile                Reverse proxy config (dev + production blocks)
├── README.md                Project overview and architecture
├── PARAMETERS.md            Full parameter reference with detailed explanations
├── behavior.md              Art-direction intent — the experience from the inside
├── n8n-workflow.json        Importable n8n workflow template
├── package.json
├── vite.config.js
└── .env.example
```

Caddy reverse proxy config is in `Caddyfile` at the project root (dev + production `stubfx.io` / `api.stubfx.io` blocks).

---

## Browser Requirements

WebGPU is required. No WebGL fallback.

| Browser | Min version | Notes |
|---------|-------------|-------|
| Chrome / Edge | 113+ | Full support |
| Safari | 18+ (macOS / iOS) | Default on |
| Firefox | Nightly | `dom.webgpu.enabled` in `about:config` |

HTTPS is required on iOS (handled by Caddy).
