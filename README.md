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

```
Mobile phones (spectators)
    │  text prompts
    │  HTTP POST
    ▼
n8n workflow  (:5678)
    │  AI processing → parameter generation
    │  HTTP POST /n8n-sim-update
    ▼
Node.js server  (:3000)
    │  SSE push  /simulation-events
    ▼
Host browser (WebGPU simulation)
    │  applies new parameters in real-time
    ▼
Display / projection
```

The server is intentionally thin: it generates session IDs, relays n8n results
to the simulation via Server-Sent Events, and serves the production build. Mobile
spectator pages POST directly to n8n. No Socket.IO.

---

## Simulation Pipeline (raw WebGPU)

All computation runs on the GPU. No Three.js. No WebGL.

| Pass | Type | Description |
|------|------|-------------|
| **Compute** | Compute | Agent physics: formula steering, wind force, drag, speed clamping, edge wrap |
| **Fade** | Render | Black fullscreen quad with alpha blend — exponential trail decay each frame |
| **Particles** | Render | Per-agent quads drawn into offscreen texture; attenuated additive blend |
| **Blit** | Render | Copy offscreen texture → canvas swap-chain |

Agents are stored as `array<Agent>` (pos.xy, vel.xy, weight, _pad — 24 bytes each)
in a persistent GPU storage buffer. The buffer is always allocated at
`MAX_AGENTS × 24` bytes; `params.agentCount` drives actual dispatch and draw counts
without reallocation.

---

## Intro Sequence

On load, agents spawn from screen centre pointing radially outward. For the first
`introDelay` seconds (default 5 s) the simulation runs in free-drift mode:
`followFormula` and `windEnabled` are silently suppressed without mutating the
GUI values. After the intro window, the start formulas engage:

- **Direction:** `atan2(cy - y, cx - x)` — pure inward pull
- **Wind:** `atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t`

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

Every 30 seconds a scheduler randomly picks a new formula from each of two
20-formula libraries. Guards:
- Direction auto-cycle only fires when `autoDir` and `followFormula` are both on
- Wind auto-cycle only fires when `autoWind` and `windEnabled` are both on
- Both are suppressed when `restFormula` is active

### REST position

When the `⌂ rest position` toggle is on, both fields lock to fixed "resting"
formulas and auto-cycle is suspended:

```
Direction: atan2(y - cy, x - cx) + sin(t * 1.2) * PI * 0.5
Wind:      atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t
```

**Formula changes never reseed agents.** Particle positions are preserved across
any formula switch. Only the `↺ Restart` button reseeds.

---

## GUI

The HUD is **hidden by default**. Toggle it with:

| Method | Effect |
|--------|--------|
| `?gui=true` URL parameter | Open with GUI visible |
| `Ctrl` key | Toggle all panels on/off at runtime |

The GUI has four folders:

### Motion

| Control | Description |
|---------|-------------|
| agents | Active agent count (1 000 – 1 200 000) |
| base speed | Step length per frame |
| turn rate | How sharply agents steer toward the direction formula |
| max speed | Speed cap; also sets the slow/fast colour blend breakpoint |
| min speed | Floor speed |
| weight spread | Per-agent weight variation (0 = uniform, 1 = wide spread) |

### Wind

| Control | Description |
|---------|-------------|
| enabled | Master wind toggle |
| strength | Wind force multiplier |
| auto cycle | Randomly switch wind formula every 30 s |
| show wind vis | Debug overlay showing wind direction as coloured lines |

### Visual

| Control | Description |
|---------|-------------|
| render scale | Canvas resolution multiplier (reduce on HiDPI screens for performance) |
| trail decay | How fast trails fade (higher = shorter trails) |
| agent size | Quad size in canvas pixels |
| base color | Colour of slow/stationary agents |
| fast color | Colour approached at max speed |
| brightness | Per-particle alpha; controls additive accumulation — prevents saturation to white |

### Magnet Image

| Control | Description |
|---------|-------------|
| strength | Attractor force multiplier |
| size | Image footprint as fraction of screen |
| show image | Grayscale debug overlay |
| Load image… | File picker (any browser-supported image) |
| Clear image | Remove magnet; return to formula-only fields |

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
| Vite | 5173 | Dev server with HMR; proxies `/uuid`, `/rndImage`, `/simulation-events`, `/n8n-sim-update` to Express |
| Express | 3000 | Session IDs, SSE relay, static assets |
| n8n | 5678 | Workflow automation |

### 5. Production

```bash
npm run build
npm run start
```

Builds with Vite, then serves everything from Express on `:3000`.

### 6. HTTPS with Caddy (required for iOS spectators)

```bash
cd ../caddy-proxy
caddy trust   # once — installs local CA
caddy run
```

### 7. Import the n8n workflow

1. Open `http://localhost:5678`
2. New workflow → Import from file → `n8n-workflow.json`
3. Activate the workflow

---

## n8n Workflow Contract

n8n receives a POST from a spectator's browser:

```json
{ "text": "user prompt", "room": "session-UUID" }
```

It must POST back to `http://localhost:3000/n8n-sim-update`:

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

The server pushes the payload to the host simulation via SSE. Only the fields
you include are applied; unrecognised keys are ignored.

---

## Environment Variables

```
PORT=3000
EXTRA_ORIGINS=                  # comma-separated extra allowed CORS origins
SERVER_ASSETS_DIR=prev-images   # directory for cached/random images
```

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
│   ├── sim.js               Main entry point: GPU setup, frame loop, GUI, formula system
│   └── shaders/
│       ├── compute.wgsl     Agent physics compute shader
│       └── render.wgsl      Per-agent quad rendering (speed→colour blend)
│
├── m_src/
│   └── main.js              Mobile spectator page (POSTs prompts to n8n)
│
├── server/
│   ├── server.js            Express: SSE relay, /uuid, /rndImage, SPA fallback
│   └── server-utils.js      File I/O for cached images
│
├── index.html
├── n8n-workflow.json        Importable n8n workflow template
├── package.json
├── vite.config.js
└── .env.example
```

Caddy reverse proxy lives in a separate project at `../caddy-proxy/`.

---

## Browser Requirements

WebGPU is required. No WebGL fallback.

| Browser | Min version | Notes |
|---------|-------------|-------|
| Chrome / Edge | 113+ | Full support |
| Safari | 18+ (macOS / iOS) | Default on |
| Firefox | Nightly | `dom.webgpu.enabled` in `about:config` |

HTTPS is required on iOS (handled by Caddy).
