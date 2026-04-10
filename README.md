# Wind Particles

A real-time GPU particle simulation for an art-direction thesis. Tens of
thousands of independent particles move through two invisible mathematical
fields — a *direction field* and a *wind field* — both defined live by the
user through typed formulas.

---

## What This Simulation Is Meant to Feel Like

### Wind as an invisible presence

The wind formula does not animate particles directly. It exerts a *force* —
a vector that accumulates into each particle's velocity. When you change the
wind formula, you do not see the formula. You see its consequence: particles
tilting, accelerating, curling. The mathematics is the weather.

The wind is felt before it is understood. This is intentional.

### Particles as autonomous yet subject

Each particle follows its own *direction formula* — a heading it wants to
maintain. But the wind keeps pulling it off course. The tension between
intention and circumstance is what produces the visible motion: not chaos,
not rigidity, but something that breathes.

Particles do not know about each other. There is no communication, no
pheromone, no collective signal. Pattern emerges purely from the shared
mathematical space they inhabit. Like birds that flock without a leader,
or dust that spirals without being instructed.

### Speed as vitality

A particle standing still is nearly invisible. A particle caught in the
full force of the wind glows at full brightness. Brightness is not
decoration — it is a direct readout of kinetic energy. The simulation
makes speed visible as light.

### The trail as memory

Nothing persists. Trails fade within a second. But for that second, you
can see where energy has been — the ghost of a gust, the after-image of a
wave. Impermanence is part of the aesthetic: the field is always now, and
the trail is already the past.

### The formula as a way of touching the world

Typing `sin(x * 0.008 + t) * PI` creates a weather pattern. Typing
`atan2(y - cy, x - cx)` creates gravity. The formula is not a technical
parameter — it is the act of deciding what kind of force exists in this
space. Mathematical expressiveness becomes physical intuition.

The simulation is meant to convey that physics is written, not given.

---

---

## Architecture

```
Mobile phones (spectators)
    │  text prompts, colour picks, device tilt
    │  Socket.IO
    ▼
Node.js server  (:3000)
    │  text-input → POST
    ▼
n8n workflow   (:5678)
    │  (AI processing, parameter generation)
    │  JSON response: { name, feelings, simulation, image_prompt }
    ▼
Node.js server  → Socket.IO `sim-params`
    │
    ▼
Host browser (WebGPU simulation)
    │  applies new parameters in real-time
    ▼
Display / projection
```

---

## Simulation Pipeline (raw WebGPU)

All computation runs on the GPU. No Three.js. No WebGL.

| Pass | Type | Description |
|------|------|-------------|
| **Sim** | Compute | Agent physics: tri-sensor pheromone sampling, steering, drag, toroidal wrap |
| **Deposit** | Compute | Atomic gaussian splat accumulation into integer buffer |
| **Normalize** | Compute | Integer → float trail texture; resets accumulator |
| **Decay** | Compute | Exponential fade + optional B&W image/video overlay |
| **Scene** | Render | Trail background (optional) + agent quads (additive blend) |
| **Bloom** | Compute | Downsample → H-blur → V-blur (separable Gaussian) |
| **Blit** | Render | Composite scene + bloom → canvas |

Agents are stored as `array<vec4<f32>>` (pos.xy, vel.xy) in a GPU storage
buffer — no textures used for simulation state.

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
# Edit .env: set PORT, VITE_API_HOSTNAME, VITE_USER_URL
```

### 4. Start everything

```bash
npm run dev
```

This runs three processes concurrently:
- **Vite** dev server on `:5173`
- **Node.js** server on `:3000`
- **n8n** on `:5678`

### 5. Set up HTTPS with Caddy (required for iOS)

```bash
cd ../caddy-proxy
caddy trust   # once — installs local CA
caddy run
```

See `../caddy-proxy/README.md` for full Caddy setup.

### 6. Import the n8n workflow

1. Open `http://localhost:5678` in your browser
2. Create a new workflow → Import from file
3. Select `n8n-workflow.json` from this repo
4. Activate the workflow

The default workflow is a passthrough that returns fixed parameters. Replace
the **Respond to Webhook** node with an AI agent (OpenAI, Claude, etc.) to
generate dynamic parameters from user prompts.

---

## n8n Workflow Contract

The server POSTs to `http://localhost:5678/webhook/simulation`:

```json
{ "text": "the user's message", "room": "session-UUID" }
```

n8n must respond with:

```json
{
  "name": "Three-word emotion label",
  "feelings": {
    "arousal": 0.5, "valence": 0.5, "dominance": 0.5,
    "cohesion": 0.5, "novelty": 0.5, "focus": 0.5, "tension": 0.5
  },
  "simulation": {
    "STEP_LEN": 70,   "DRAG": 0.5,   "TURN_JITTER": 0.1,
    "SENSE_DIST": 20, "SENSE_ANGLE": 0.2, "TURN_RATE": 20,
    "POINT_SIZE": 1.0,
    "DEPOSIT_SIZE": 0.05, "DEPOSIT_STRENGTH": 10, "DEPOSIT_EDGE_SOFT": 0.5,
    "CHAMP_SAMPLE_INTERVAL": 50000, "CHAMP_IMP_MULTIPLIER": 2,
    "TRAIL_DECAY": 0.89, "SPAWN_RADIUS": 20,
    "COLOR": {
      "POINT_COLOR":           { "r": 1.0, "g": 1.0, "b": 1.0 },
      "SECONDARY_AMOUNT":      10,
      "POINT_SECONDARY_COLOR": { "r": 1.0, "g": 1.0, "b": 1.0 },
      "TERTIARY_AMOUNT":       11,
      "POINT_TERTIARY_COLOR":  { "r": 1.0, "g": 1.0, "b": 1.0 }
    }
  },
  "image_prompt": "optional description for image generation",
  "image_data":   "optional base64 data URL for media trail"
}
```

---

## Media Trail (B&W Image / Video)

The decay shader overlays any B&W image or video onto the pheromone trail.
Bright pixels become strong attractors — agents swarm toward light areas.

**Temporary test controls** (bottom-left corner of the simulation window):

- **Load B&W Image** — picks a local image file and uses it as trail
- **Load B&W Video** — picks a local video file; frames are uploaded each tick
- **Clear Media** — removes the media overlay

In production, n8n can return `image_data` (a base64 data URL) and the
frontend loads it automatically.

---

## Environment Variables

```
# .env
PORT=3000
N8N_WEBHOOK_URL=http://localhost:5678/webhook   # override if n8n is remote
VITE_API_HOSTNAME=https://localhost/            # served through Caddy
VITE_USER_URL=https://localhost/m_src/          # mobile spectator URL
SERVER_ASSETS_DIR=prev-images                  # cached images directory
```

---

## URL Parameters

| Param | Effect |
|-------|--------|
| `?n=N` | Set agent grid side (total agents = N²) |
| `?panel=1` | Show lil-gui parameter panel |
| `?s=UUID` | Mobile spectator session ID (set automatically via QR) |

---

## Project Structure

```
thesis-sim/
├── src/
│   ├── main.js              Entry point, render loop, event wiring
│   ├── simulation.js        Raw WebGPU engine (all GPU resources)
│   ├── tunables.js          Parameter definitions + lil-gui panel
│   ├── client-api.js        HTTP client (uuid, rndImage)
│   ├── utils.js             Utilities (deepReplace, colour helpers)
│   └── shaders/
│       ├── sim.wgsl          Agent physics compute
│       ├── deposit.wgsl      Pheromone deposit (atomic accumulation)
│       ├── normalize.wgsl    Accumulator → float texture + clear
│       ├── decay.wgsl        Trail decay + media overlay
│       ├── render.wgsl       Trail + agent quad rendering
│       ├── bloom.wgsl        Bloom: downsample + separable blur
│       └── blit.wgsl         Final composite to canvas
│
├── m_src/                   Mobile spectator app (Socket.IO + gyro)
│
├── server/
│   ├── server.js            Socket.IO relay + HTTP endpoints
│   ├── n8n-proxy.js         n8n webhook client
│   └── server-utils.js      File I/O for cached images
│
├── n8n-workflow.json        Importable n8n workflow template
├── package.json
├── vite.config.js
└── .env.example
```

Caddy lives in a **separate project** at `../caddy-proxy/`.

---

## Browser Requirements

WebGPU is required. No WebGL fallback.

| Browser | Min version | Notes |
|---------|-------------|-------|
| Chrome / Edge | 113+ | Full support |
| Safari | 18+ (macOS/iOS) | Default on |
| Firefox | nightly | `dom.webgpu.enabled` in `about:config` |

HTTPS is mandatory on iOS (handled by Caddy).
