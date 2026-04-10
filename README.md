# thesis-sim

An interactive GPU-accelerated particle simulation system developed as an art direction thesis project. It combines real-time WebGL-based swarm intelligence with AI-driven parameter generation and a dual-interface architecture for live performance and installation contexts.

---

## Concept

The simulation models thousands of autonomous agents that move across a 2D canvas by sensing and depositing pheromone-like trail gradients — behavior inspired by ant colonies and slime molds. This produces emergent, organic patterns that evolve continuously over time.

The system is designed for live interaction: a desktop display (host) runs the full simulation while remote users connect via a mobile web app (spectator) to influence it in real time through text prompts, color selections, and device motion data. AI integration allows natural language prompts to reshape simulation parameters and trigger image generation, blending generative computation with directed art control.

---

## Architecture

```
┌─────────────────────────────────┐     ┌──────────────────────────────┐
│         Host (Desktop)          │     │     Spectator (Mobile)        │
│  Three.js WebGL simulation      │     │  Motion, color, text input    │
│  src/                           │     │  m_src/                       │
└────────────┬────────────────────┘     └───────────────┬──────────────┘
             │                                          │
             └────────────────┬─────────────────────────┘
                              │ Socket.IO (WSS)
                   ┌──────────▼──────────┐
                   │   Node.js Server    │
                   │   server/           │
                   │   Express + OpenAI  │
                   └─────────────────────┘
```

- **Host app** (`src/`) — WebGL simulation rendered via Three.js, served by Vite
- **Spectator app** (`m_src/`) — Mobile web interface for remote control
- **Server** (`server/`) — Express + Socket.IO backend, handles AI API calls and real-time messaging

---

## Project Structure

```
thesis-sim/
├── src/                          # Host (desktop) application
│   ├── main.js                   # Three.js simulation engine
│   ├── client-api.js             # API client for server communication
│   ├── tunables.js               # Simulation parameters and lil-gui panel
│   ├── audio.js                  # Audio volume capture
│   ├── utils.js                  # Utility functions
│   ├── loader.js                 # Loading state UI
│   ├── style.css
│   ├── index.html
│   └── shaders/
│       ├── sim.vert / sim.frag           # Agent physics (position/velocity)
│       ├── point.vert / point.frag       # Particle rendering
│       ├── trailDeposit.vert / .frag     # Pheromone deposition
│       ├── trailDecay.vert / .frag       # Trail decay/fade
│       └── lastPass.vert / .frag         # Final composition
│
├── m_src/                        # Spectator (mobile) application
│   ├── main.js                   # Mobile control logic
│   ├── motion.js                 # Motion sensor processing
│   ├── gyro.js                   # Gyroscope/accelerometer API
│   ├── style.css
│   └── index.html
│
├── server/                       # Backend
│   ├── server.js                 # Express + Socket.IO server
│   ├── openai-api.js             # OpenAI chat and image generation
│   ├── openai-chat-json-schema.json
│   ├── server-utils.js           # File I/O helpers
│   ├── localhost.pem             # SSL certificate (self-signed)
│   └── localhost-key.pem         # SSL private key
│
├── runware/
│   └── runware.js                # Runware SDK integration (alt. image gen)
│
├── stub/                         # Sample data for development
├── prev-images/                  # Cache of AI-generated images
├── vite.config.js
└── package.json
```

---

## Features

### GPU Particle Simulation
Hundreds of thousands of agents run in parallel on the GPU via WebGL2 render targets. Each agent senses trail gradients at three angles (forward, left, right) and steers accordingly, producing emergent swarm behavior. State is ping-ponged between render targets each frame.

### Trail System
A two-layer trail architecture creates visual persistence:
- **Trail Deposit** — agents leave gaussian splats on a texture
- **Trail Decay** — exponential fade over time creates dynamic, flowing trails

### AI-Driven Control
Sending a text prompt from the spectator app triggers an OpenAI API call. The response (structured as JSON) includes:
- Updated simulation parameters
- An image generation prompt
- A configuration name

The generated image is processed by ColorThief to extract a color palette, which updates the simulation's color scheme in real time.

### Dual Interface
- **Host display** — full WebGL simulation with bloom post-processing, a lil-gui parameter panel, and a QR code for spectator access
- **Spectator app** — mobile web page with text input, color picker, and motion sensor streaming (gyroscope + accelerometer)

### Real-Time Communication
Socket.IO events over WSS:
| Event | Direction | Description |
|---|---|---|
| `register-host` | Host → Server | Display app connects |
| `text-input` | Spectator → Server | AI chat prompt |
| `color` | Spectator → Host | Color selection |
| `motion` | Spectator → Host | Device tilt data (yaw/pitch/roll) |

---

## Setup

### Prerequisites

- Node.js (v18+)
- `mkcert` for local SSL (required for mobile sensor access over HTTPS)

### 1. SSL Certificates

Mobile browsers require HTTPS to access device sensors. Generate local certificates:

```bash
# Arch/Manjaro
pacman -S mkcert nss

# macOS
brew install mkcert nss

mkcert -install
mkcert localhost 127.0.0.1 ::1
```

Move the generated `localhost.pem` and `localhost-key.pem` into the `server/` directory.

### 2. Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
OPENAI_API_KEY=sk-...
OPENAI_VSTORE_ID=vs-...          # Optional: OpenAI vector store ID for config persistence
RUNWARE_API_KEY=...               # Optional: Runware API key for alternative image generation
ENV=DEV                           # Set to PROD to disable config saving
SERVER_ASSETS_DIR=prev-images
VITE_API_HOSTNAME=https://localhost:3000/
VITE_USER_URL=https://localhost:5173/m_src/
```

### 3. Install and Run

```bash
npm install

# Development (auto-reload)
npm start
```

The Vite dev server starts on `https://localhost:5173` (host app) and `https://localhost:5173/m_src/` (spectator app). The Node.js server runs on the configured `PORT`.

---

## Simulation Parameters

Parameters are exposed via a lil-gui panel (toggle with `?panel=1` URL param) and can also be set by AI prompts at runtime.

| Parameter | Description |
|---|---|
| `STEP_LEN` | Agent movement speed per frame |
| `DRAG` | Velocity damping factor |
| `TURN_JITTER` | Random angular noise added to steering |
| `SENSE_DIST` | Distance agents look ahead to sample trails |
| `SENSE_ANGLE` | Angle offset for left/right sensing probes |
| `TURN_RATE` | How sharply agents steer toward trail gradients |
| `POINT_SIZE` | Rendered size of each particle |
| `DEPOSIT_SIZE` | Radius of pheromone splat |
| `DEPOSIT_STRENGTH` | Intensity of trail deposition |
| `DEPOSIT_EDGE_SOFT` | Softness of splat edge |
| `TRAIL_DECAY` | Exponential decay rate of trail texture |
| `RENDER_QUALITY` | Trail texture resolution multiplier |
| `TEX_SIDE` | Square root of agent count (e.g. 1024 = ~1M agents) |

**URL parameters for quick config:**

```
?n=1200        # Set agent grid size
?r=1           # Set render quality
?panel=1       # Show GUI panel
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Rendering | Three.js, WebGL2, GLSL 3.0 |
| Frontend build | Vite 7, Tailwind CSS 4 |
| Backend | Node.js, Express 5, Socket.IO 4 |
| AI | OpenAI API (GPT + image generation) |
| Alt. image gen | Runware SDK |
| Color extraction | ColorThief |
| UI controls | lil-gui |
| QR code | qrcode |

---

## Development Notes

- The simulation runs entirely on the GPU; CPU-side code only manages uniforms and render pipeline orchestration.
- ColorThief is used server-side to extract dominant colors from generated images, which are then broadcast to the host app.
- The spectator app uses a heartbeat channel for high-frequency motion data (separate from the main Socket.IO channel).
- CORS is configured for `localhost` and `192.168.1.x` ranges for LAN use. Update `server/server.js` for deployment.
- Setting `ENV=DEV` skips saving configurations to the OpenAI vector store.
