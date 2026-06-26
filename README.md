# Wind Particles

> This project was built entirely through vibe coding, deliberately. The subject is visual AI and the experience of collaborating with it — coding by feel, without always knowing why something works, *is* the research.
>
> That said: vibe coding can be genuinely useful for experimentation, but it demands that you stay sharp about what you are actually doing at every step. Knowing your tools, your domain, and your intentions is what separates productive exploration from drift. Delivering a good product requires that rigour — which is not necessarily what this experiment was optimising for.

---


A real-time GPU particle simulation for an art-direction thesis. Up to 5 million
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
    │  'spectator-left'   ←─── server (fires when a spectator disconnects)
    │                            → restores QR when room reaches 0
    │
    │  'collective-state'  ←─── server ticker every 300 ms
    │                            { avgTemp, avgCoherence, avgChaos, userCount }
    │                            → turnRate scale, speed-color tint, chaos level
    │
    │  'remote-event'  ←──── server (always direct — chaos aggregated only)
    │
    │  HTTPS POST /webhook/sim-event  ──→  n8n  (on every remote-event, if VITE_N8N_BASE_URL set)
    │  ←── JSON response ─────────────────────  applySimParams()
    │
    │  HTTPS POST /webhook/heartbeat  ──→  n8n  (every heartbeatInterval seconds)
    │  ←── JSON response ─────────────────────  applySimParams()
    ▼
Display / projection

Spectators  (/remote/?s=<uuid>)
    │  Socket.IO  'join-session'   →  server
    │  Socket.IO  'user-event'     →  server → 'remote-event' → simulation (tilt aggregated only)
    │  Socket.IO  'peer-joined'   ←─  server  { userCount }  — aura pulse + QR threshold check
    │  Socket.IO  'peer-left'     ←─  server  { userCount }  — QR reappears if count drops below max
    ▼
Node.js server  (:3000)
    │  always: io.to(room).emit('remote-event', ...)  — chaos aggregated, other events forwarded directly
    │  always: updates room state (temperature, coherence, chaos per user)
    │  ticker: emits 'collective-state' + 'note-debounce' to spectators every 300 ms
```

### Session lifecycle

1. Simulation connects via Socket.IO and emits `'register-host'`
2. Server generates a UUID, puts the socket in room `<uuid>` **and** the `:hosts` sub-room, emits `'session-id'` back
3. Simulation builds the remote URL (`/remote/?s=<uuid>`) and displays a QR code:
   - **Small scannable overlay** in the bottom-left UI panel (click to open)
   - **Large trace image** in the canvas centre — the particle field writes the QR pattern after the intro delay
4. Spectators scan the QR, open `/remote/?s=<uuid>`, connect via Socket.IO
5. Server emits `spectator-joined` to the host — a brief gust fires in the particle field
6. Server emits `peer-joined` (with updated `userCount`) to all other spectators — aura pulse; remote QR hides if `userCount ≥ maxSpectators` (configured in Session GUI)
7. Every 300 ms the server aggregates all spectators' state and emits `collective-state` to the host
8. Spectator touch/text events are forwarded directly as `remote-event`; `lastRemoteActivity` timestamp is updated on every event
9. When a spectator disconnects, server emits `spectator-left` (with `userCount`) to host and `peer-left` to remaining spectators
10. Simulation restores the QR trace in three ways (whichever fires first):
    - `spectator-left` arrives with `userCount === 0`
    - Internal `simSpectatorCount` counter drops to 0 (fallback if server event is missed)
    - No remote events received for `remoteTimeout` seconds (Session → idle restore QR)

### Multi-host sessions

If two browser windows open with the **same session UUID** (set manually in the URL as `?s=<uuid>`), both register as hosts for that room. The server tracks all host sockets in a `Set` and uses a `${sessionId}:hosts` Socket.IO room for all host-directed emits — both windows receive every event (spectator joins, collective state, n8n responses) identically. This is intended for multi-display installations where the same simulation runs on several screens simultaneously.

### Collective state aggregation

The server maintains a per-room user table. Every 300 ms it averages all active spectators' values and emits `collective-state` to the host simulation:

| Field | Source | Effect in simulation | Effect in synth |
|-------|--------|----------------------|-----------------|
| `avgTemp` | touch Y position | speed-color hue: blue (top/cold) → amber (bottom/warm), 65% blend | arp BPM (80–140) |
| `avgCoherence` | touch X position | turnRate multiplier: 0.08× (left/chaos) → 3.0× (right/order) | — |
| `avgChaos` | device motion magnitude | noise magnitude in agent compute; chaos color fraction on all agents; avoidMap suppressed above threshold | all synth layers + radio chain; pad LFO frequency (0.05→2 Hz as chaos→0) |
| `userCount` | active connections | DOT→NORMAL at first join; chaos reset when all leave | synth at chaos=1 when empty; simAss music fades in on first join, out on last leave |

All collective values are smoothed with an exponential moving average (~0.8 s time constant) in the simulation before being written to the GPU, preventing jarring jumps when spectators join or leave.

---

## Simulation Pipeline (raw WebGPU)

All computation runs on the GPU. No Three.js. No WebGL.

| Pass | Shader | Type | Description |
|------|--------|------|-------------|
| **Compute** | `compute.wgsl` | Compute | Agent physics: formula steering, wind force, image-trace avoidance (gradient + lookahead), contamination circle avoidance, avoidance map (binding 4, suppressed above `chaosAvoidMapThreshold`), note-wind formula injection, edge bounce/wrap |
| **Agent shadow density** | `agentShadow.wgsl` | Render | Greyscale splat texture — one soft disk per homing agent; used as a density probe by the compute shader. Champions are excluded so they don't repel the swarm |
| **Agent shadow visual** | `agentShadow.wgsl` | Render | Dark soft splats blended onto the offscreen accumulation texture to create depth under homing agents. Also drives **champion** trails — every Nth agent (Champions folder: `enabled` toggle + `1 in N`) drops a constant shadow under itself even while free, with no change to its movement. Free champions also render slightly larger (`champion size`, applied in `render.wgsl` only while not homing) |
| **Fade** | `fade.wgsl` | Render | Black fullscreen quad with alpha blend — exponential trail decay each frame |
| **Particles** | `render.wgsl` | Render | Per-agent quads drawn into `rgba16float` offscreen texture; additive **or** max blend selectable; spectator slot colors; chaos color override; avoidmap color sampling |
| **Blit** | `blit.wgsl` | Render | Tone-map offscreen → canvas swap-chain (blitUB 32 bytes): `bgBlackCutoff` clamp, tone-black/white/gamma curve, shadow boost, color mode (NORMAL / GRAYSCALE / GRAYSCALE_INVERTED) |
| **Wind vis** *(debug)* | `wind-vis.wgsl` | Render | Arrow grid overlay — `evalWindFormula` prepended at pipeline build time, same pattern as `compute.wgsl` |
| **Image debug** *(debug)* | `image-debug.wgsl` | Render | Grayscale overlay of the loaded image at its current size and position |

Agents are stored as `array<Agent>` (pos.xy, vel.xy, home.xy, weight, primed — 32 bytes each)
in a persistent GPU storage buffer. The buffer is always allocated at
`MAX_AGENTS × 32` bytes; `params.agentCount` drives actual dispatch and draw counts
without reallocation.

The offscreen accumulation texture is `rgba16float`, allowing HDR values beyond [0,1] without clipping. The blit pass tone-maps the result to the display range.

The compute uniform buffer (`soloUB`) carries physics params including `avoidForceStr` (image-trace avoidance multiplier), `avoidMapActive` (0/1 gate suppressing the avoidance map when `smoothChaos > chaosAvoidMapThreshold`), and `noteWindStr` (injected note-wind formula strength).

The render uniform buffer (`renderUB`, 176 bytes — 44 fields) carries visual params, including `additiveBlend` (field 24) which selects between additive and max-blend render pipelines; `spectatorCount` / `spectatorAgentShare` (fields 23/25) which assign the first N% of agents to spectator slots with per-slot colors; `avoidMapSampleChaos` (field 39) which drives the avoidmap color sampling probability (30%→100% as chaos→1); and `chaosColorR/G/B` / `chaosColorFraction` (fields 40–43) which force a configurable fraction of all agents — spectator-controlled or free — to a single "chaos color", scaling linearly with chaos so at harmony=0 no agents are affected.

The blit uniform buffer (`blitUB`, 32 bytes) carries 5 × f32 + 1 × u32: `cutoff`, `toneBlack`, `toneWhite`, `toneGamma`, `shadowBoost`, `colorMode` (0 = NORMAL, 1 = GRAYSCALE, 2 = GRAYSCALE_INVERTED). Grayscale and inversion both run post-tone-map so the additive HDR accumulation in the offscreen target isn't affected — applying inversion per particle would map bright particles to ~zero and additive blending of zeros would collapse the image.

The coherence multiplier is applied to `turnRate` in JavaScript before writing the compute buffer, so no shader change is needed for coherence.

---

## Intro Sequence

On load, agents are split evenly across the four canvas corners, all pointing inward
toward the centre (with slightly varied speeds) so the four streams converge. For the
first `introDelay` seconds (default 10 s) the simulation runs in free-drift mode:
`followFormula` and `windEnabled` are silently suppressed without mutating the
GUI values. After the intro window, the active direction and wind formulas engage.

The QR trace image is also held back until the intro ends — loading it immediately
would trap agents in the QR pattern during the radial spread-out phase.

The intro delay is tunable via the GUI (Motion → intro delay).

---

## QR Code as Idle State

The QR trace acts as a **screensaver**: it is the default state of the canvas and
returns whenever the room is empty or goes quiet.

### When the QR is shown

- At startup, after the intro delay
- When the last spectator disconnects (`spectator-left` with `userCount === 0`)
- When `simSpectatorCount` drops to 0 — an internal fallback counter maintained in case
  the server `spectator-left` event is lost
- When no remote events (touch, text) have been received for `remoteTimeout` seconds
  (configurable in Session GUI; 0 = disabled)

### When the QR is replaced

- A user loads a trace image or types trace text locally
- A remote spectator sends a text event — the QR is cleared first, then the text trace rendered

The QR bitmap is kept permanently in memory (`qrBitmap`) and restored by `restoreQR()`
without any network round-trip. The auto-clear timer never applies to the QR.

### Remote page persistent QR

The spectator page (`/remote/`) renders a small always-visible QR in its bottom-right
corner. This encodes the full page URL (including `?s=` and `?max=`) so another person
can scan from the phone of someone already connected — useful when the big screen is not
visible.

The remote QR **fades out automatically** when either condition is met:
- The user interacts for the first time (touch, tilt, or text submit) — no need to share once you're in
- `userCount` reported by the server reaches the `maxSpectators` threshold (Session GUI → QR hides at N users)

It **reappears** if `userCount` drops back below the threshold (and the user has not yet interacted).

### Content auto-clear

Any user-loaded content (trace image or trace text) that is not the QR is automatically
cleared after `clearDelay` seconds (Trace GUI → auto clear, default 20 s, 0 = disabled).
The timer restarts whenever content changes. The QR is immune to auto-clear.

---

## Remote Spectator Interactions

Spectators open the `/remote/` page on their phones. The page has a virtual joystick centered on screen, a color picker and text input always visible at the top, and tilt support. The join button reads "swarm". A star field canvas (65 stars drifting counter to joystick direction, streaking on fast moves) is visible only in DRAW mode.

| Channel | Phone gesture | Aggregation | Simulation effect |
|---------|--------------|-------------|-------------------|
| **Joystick** | Use the virtual joystick | Forwarded directly as `remote-event` | Moves the spectator's spawner across the canvas; agents teleport to spawner at scaled spawn chance |
| **Color** | Color picker at top of page | Forwarded directly to simulation | Assigned color for that spectator's agents |
| **Shake** | Shake the phone | Forwarded as `color-pick` + `shake` | Bursts the spectator's agents outward AND picks a new random color from the local palette |
| **Tilt / Motion** | Move phone in any direction | Server aggregates motion magnitude into `avgChaos` | Chaos level — device motion increases chaos; stillness decays it toward harmony |
| **Note (HARMONY)** | Touch the HARMONY canvas on the remote page | `note` event debounced server-side before forwarding | Drives formula injection into the compute shader (note wind) and triggers harmony avoidMap on `sum % 4 === 0` |
| **Text** | Type in the text input at top | Forwarded directly to simulation | Trace attractor — particle field writes the word |

### Note send debounce

To prevent server flooding when users slide across notes rapidly, the `note` socket event is debounced on each spectator's device. The oscillator and aura visuals update immediately on every note change; only the server send is delayed. The debounce duration is broadcast by the server as `note-debounce: { ms }` and equals `userCount × 10 ms` — so at 1 user the delay is 10 ms; at 10 users it is 100 ms. The server re-broadcasts this value to all spectators on join, on disconnect, and every 300 ms in the collective-state ticker.

### Feedback loops

- **On the big screen**: every new spectator join fires a brief directional gust in the particle field — a visible pulse that confirms the join without any text or notification
- **On the phone**: the aura behind the screen reflects the selected color (center hue) and motion chaos (vignette intensity). When another spectator joins, all phones feel a brief aura dimming pulse.

See [behavior.md](behavior.md) for the full art-direction intent behind these interactions.

---

## Trace Text

An amber-styled text field sits above the direction formula input in the bottom-left panel. Whatever is typed there is rendered as a particle attractor — agents whose home positions fall inside the text glyphs steer toward them, making the particle field collectively write the text.

The text is rendered as **white glyphs on a transparent canvas** using the browser's Canvas 2D API, then composited with any loaded trace image, and uploaded to the GPU as a single `rgba8unorm` texture. From the shader's perspective it is identical to a loaded image: the same alpha threshold, black cutoff, and edge fade controls all apply.

**Key behaviours:**

- Texture rebuilds 300 ms after the last keystroke — no Enter needed
- When combined with a loaded image, text is drawn on top in white
- Clearing the image leaves text active; clearing the text field leaves the image active
- Glyphs are drawn bold and auto-fitted to the canvas width, in the active font (see **Font** below)

See [PARAMETERS.md](PARAMETERS.md) for full details on how sizing and layering work.

---

## Font

The typeface used for both the trace text and the story caption is loaded **straight from Google Fonts at runtime**, so the machine running the simulation needs nothing installed locally. The default is **Bellefair**.

A **font** field sits in the bottom-left panel, directly under the trace text input. Paste anything you can grab from [fonts.google.com](https://fonts.google.com) and press **Enter** (or blur the field). The parser accepts several shapes:

| You paste | Example |
|-----------|---------|
| a bare family name | `Playfair Display` |
| a css2 family spec | `Bebas+Neue:wght@700` |
| the `family=` query part | `family=Inter:wght@700` |
| a full embed URL | `https://fonts.googleapis.com/css2?family=Lora…` |

The family name is extracted for the Canvas 2D `ctx.font`; the rest builds the `<link>` injected into `<head>`. If no weight axis is given, `wght@400;700` is requested so bold renders correctly.

**How it works:** `loadFontSpec()` (in `src/sim.js`) injects/updates a `<link rel="stylesheet">` to Google Fonts, waits for the stylesheet to parse **and** for the glyphs to download via the CSS Font Loading API (`document.fonts.load`) — Canvas 2D will not paint with a webfont until it is ready — then re-renders the trace canvas. The font string carries a `sans-serif` fallback, so a bad name or a network failure degrades gracefully instead of breaking.

The GUI mirrors this with a **font preset** dropdown (Trace folder) listing a handful of common Google Fonts; choosing one fills the input and applies it.

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

### Keyboard shortcuts

| Key | Effect |
|-----|--------|
| `Ctrl` | Toggle the HUD on/off |
| `s` | Capture the current frame and download it at canvas backing-store resolution. Default is an opaque PNG; the **Export** folder flags switch this to a transparent PNG and/or a CMYK TIFF (see below). Plain `s` only — `Ctrl+S` / `Cmd+S` still trigger the browser's "Save Page". Ignored while focus is on an input or contenteditable element. For maximum resolution, set `render scale` to `1.0` before pressing. |

### Fullscreen

A **⛶ toggle fullscreen** button sits at the very top of the lil-gui panel, above the state dropdowns. It toggles the browser Fullscreen API on `document.documentElement` (enter on first click, exit on the next). `Esc` also exits. The click counts as the user gesture the API requires.

### Top-level state controls

Four dropdowns sit below the fullscreen button, above all folders. They mirror the set the n8n heartbeat exchanges:

| Control | Values | Description |
|---------|--------|-------------|
| mode | `STORY` / `SHOWCASE` | Top-level session mode |
| color mode | `NORMAL` / `GRAYSCALE` / `GRAYSCALE_INVERTED` | Final-stage color treatment applied in the blit pass. Grayscale collapses RGB to luma; inverted flips black ↔ white (the empty canvas reads as white paper rather than tar). Runs post-tone-map so additive accumulation stays intact. |
| status | `NORMAL` / `FREEROAM` / `DOT` | Simulation state |
| qr | `SHOW` / `HIDE` | Whether the QR layer is drawn on the trace canvas |

The GUI has five folders below these dropdowns. See [PARAMETERS.md](PARAMETERS.md) for a full description of every control.

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
| bounce edges | Reflect agents off canvas edges instead of wrapping; default off |
| delta time | When on, each frame uses the actual elapsed time (frame-rate independent speed but sensitive to browser spikes). When off, uses a fixed 1/60 s step (perfectly smooth but slower than real-time below 60 fps). Default on. |

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
| color 1 | Colour assigned to even-indexed agents |
| color 2 | Colour assigned to odd-indexed agents |
| chaos color | Colour forced onto `chaos color %` of all agents at full chaos; scales linearly with chaos so at harmony nothing changes |
| chaos color % | Fraction (0–1) of all agents that switch to the chaos color at chaos=1 (default 0.5) |
| brightness | Per-particle alpha; controls additive accumulation — prevents saturation to white |
| additive blend | On = additive glow (can blow out); Off = max blend (no over-brightness) |
| tone black | Input level mapped to black in the blit tone curve |
| tone white | Input level mapped to white — compress HDR above 1.0 |
| tone gamma | Power curve: < 1 boosts darks, > 1 crushes darks |
| shadow boost | Inverse-brightness lift peaking at ~12% luminance; makes faint trails pop |

### Export

Options for the `s` screenshot. Both **off by default** (default capture = opaque PNG, black background included, QR composited if visible).

| Control | Description |
|---------|-------------|
| transparent bg | Drop the black background to transparency. The scene is additive light on true black, so per-pixel brightness (`max(r,g,b)`) is used as alpha and the RGB is un-premultiplied to keep the glow at full intensity. The QR overlay is **not** composited in this mode (its black modules would punch holes). Saved as RGBA PNG, or as a CMYK TIFF with a 5th alpha channel if CMYK is also on. |
| CMYK (TIFF) | Convert to CMYK and save an uncompressed baseline **TIFF** (`.tif`) instead of PNG — PNG cannot hold CMYK. Conversion is a naive, device-independent RGB→CMYK with **no ICC profile** (final print conversion is expected in pro software). |

The four combinations: opaque PNG (default) · transparent RGBA PNG · opaque CMYK TIFF · CMYK TIFF + unassociated alpha.

### Trace

The trace layer loads an image onto the GPU and uses it to redirect agents.
The image is never rendered directly — it is felt through collective agent density and colour.

| Control | Description |
|---------|-------------|
| homing speed | px/frame agents move toward their home when homing is active (0–50, default 30) |
| alpha threshold | Min image alpha required at an agent's home to activate homing |
| black cutoff | Luminance below which pixels are treated as fully transparent |
| edge fade | Width of smooth rectangular fade applied to all four image edges |
| caption size | Story caption font size, as a fraction of `min(canvasW, canvasH)` |
| font preset | Quick-pick of common Google Fonts; fills the **font** input and loads it (see [Font](#font)) |
| size | Controls trace text overlay positioning; the trace image is always drawn fullscreen cover-fit (centered, aspect-ratio-preserving crop) |
| show image | Grayscale debug overlay of the loaded image |
| mouse eraser | Treat the mouse cursor as a live contamination point (toggle, default on) |
| eraser radius | Radius in canvas pixels of each contamination circle |
| avoid force | Multiplier on all image-trace avoidance forces (0 = no avoidance, higher = stronger push) |
| auto clear (s) | Seconds before user trace content is automatically cleared; 0 = disabled |
| Load image… | File picker (any browser-supported image format) |
| Clear image | Remove trace image; return to formula-only mode |
| Clear text | Clear the trace text field |

### Avoidance map

An invisible grayscale mask that repels free agents. White areas push agents away; black areas are transparent to them. The mask has its own scale independent of the trace image.

At startup, and whenever the room is empty, the simulation fetches `/simAss-image` as the avoidance map. This endpoint serves a pre-generated widescreen (`1536×1024`) image from `simAss/images/` (up to 10 files cached on disk, 1-day lifespan — expired files are deleted automatically on each request; auto-generated by the server via OpenAI if the folder is empty or all files have expired).

Each generated image is an **antique star atlas illustration** in XVIII-century engraving style: bright star dots connected by fine lines forming a constellation in the shape of a randomly chosen epic/mythic object (submarine, grandfather clock, zeppelin, lighthouse, gothic cathedral, etc. — 26 subjects in the pool). Style reference: Bode's Uranographia / Flamsteed's Atlas Coelestis.

The map is refreshed every 30 seconds — if the hash changes, the old map is cleared and the new one loads after a 5–10 s random delay.

**Chaos threshold:** when `smoothChaos` exceeds `chaosAvoidMapThreshold` (default 0.6), the avoidance map is temporarily suppressed — agents ignore it without unloading the texture. It reactivates immediately when chaos drops back below the threshold.

**Harmony mode:** when active spectators' note indices sum to a multiple of 4 (`sum % 4 === 0`), `_enterHarmony(sum)` is called. The simulation fetches a flat-color AI-generated image from the server (prompt: subject from the pool, pure black background, minimal flat shapes, `gpt-image-1-mini`) and loads it as the avoidance map, replacing the background star atlas for the duration of the harmony state. Each unique `sum` value gets its own cached image stored in **IndexedDB** (`thesis-sim-harmony` database, `images` store, key = `sum`) as raw binary (`Uint8Array`) — no size limit, no base64 conversion. Subsequent entries into the same harmony state load instantly from cache. The map reverts to the star atlas when the note combination is released or changes to a non-harmonic sum.

| Control | Description |
|---------|-------------|
| scale | Coverage as a fraction of the canvas (1.0 = full canvas); the map is always centered |
| chaos threshold (hide above) | `chaosAvoidMapThreshold` — avoidMap is suppressed when `smoothChaos` exceeds this value (texture stays loaded; default 0.6) |
| QR margin | Extra padding around QR avoid zone, as fraction of `min(canvasW, canvasH)`; default 0.01 |
| QR fade | Blur radius of QR avoid zone edge, as fraction of `min(canvasW, canvasH)`; default 0.01 |
| Load map… | File picker — any browser-supported image (grayscale PNG recommended) |
| Clear map | Remove the active avoidance map |

### Content (inside Trace folder)

| Control | Description |
|---------|-------------|
| QR overlay | When on (default), QR is shown on a separate 2D canvas; agents are freed from the QR area and a repulsion zone is built automatically |

### Session

| Control | Description |
|---------|-------------|
| spawn chance (base) | Base per-frame teleport probability, scaled by `users × spawn multiplier` |
| spawn multiplier | Scales spawn chance by active user count (default 3) |
| spawner speed | Canvas fractions/sec the spawner moves at full joystick deflection |
| spawner velocity boost | Extra speed when joystick is flicked fast |
| spawner steering | Direction change rate (1/s); lower = wider curves |
| spawner timeout (s) | Seconds of joystick silence before spawner deactivates |
| release burst (fireworks) | Scatter speed for a spectator's agents the moment they stop controlling (joystick released or timed out); 0 = off |
| idle restore QR (s) | Seconds of silence from all remotes before QR trace is restored; 0 = disabled |
| QR hides at N users | Remote page QR fades when `userCount` reaches this threshold |
| n8n test mode | When on, calls `/webhook-test/` paths instead of `/webhook/`; no rebuild needed |
| heartbeat (s) | Seconds between periodic full-params snapshots sent to n8n `/webhook/heartbeat`; 0 = disabled |

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

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env: PORT, EXTRA_ORIGINS, OPENAI_API_KEY, ELEVENLABS_API_KEY, etc.
```

### 3. Pre-populate simAss assets (optional)

The `simAss/images/` and `simAss/music/` directories hold up to 10 pre-generated files each (1-day lifespan). Drop files in manually, or leave them empty — the server auto-generates them on first request (requires `OPENAI_API_KEY` for images and `ELEVENLABS_API_KEY` for music). Generated files are named `simAss_<timestamp>.webp/.mp3`.

```
simAss/
  images/   ← 1536×1024 WebP — antique constellation chart, random epic subject
  music/    ← MP3 ~2 min — played through Tone.js radio chain when users connected
```

### 4. Development

```bash
npm run dev
```

Starts two processes concurrently:

| Process | Port | Description |
|---------|------|-------------|
| Vite | 5173 | Dev server with HMR; proxies `/rndImage` and `/admin-auth` to Express |
| Express | 3000 | Socket.IO session assignment, static assets; HTML page requests redirect to Vite |

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

---

## Audio System

Two independent channels mix into the Web Audio destination simultaneously.

### Channel 1 — Tone.js generative synth (`src/synth.js`)

Four procedural layers driven entirely by the collective spectator state (updated every 200 ms). Always active once the page is tapped.

| Layer | Sound | Driver |
|-------|-------|--------|
| Drone | Sine sub-bass A1 — always on | chaos → volume (-18 to -24 dB) |
| Noise | Pink noise bandpass 900 Hz | chaos → gain (silent at harmony) |
| Pad | Sawtooth [A2 E3 A3 C4 E4 G4] + reverb/chorus | chaos → filter cutoff + volume; tilt → LFO amplitude |
| Arp | A minor scale, Tone.Sequence + delay | chaos → volume; temperature → BPM (80–140) |

The **pad LFO** (filter sweep) speed is driven by `(1 − chaos)`: nearly still at full chaos, oscillating at ~2 Hz when the room converges to harmony.

Independent volume control: **ch1: synth vol** slider in the GUI Audio folder (−30 to +6 dB).

### Channel 2 — simAss radio chain

Activated when the **first spectator joins**; fades out when the **last spectator leaves**. Silence when the room is empty (only the Tone.js synth plays).

Signal path: `Tone.Player → lowpass filter → distortion → tremolo → reverb → chaos vol → fade gain → music bus → destination` — plus a white noise layer (bandpass at 2 kHz) mixed into the same fade gain.

All parameters are driven by `chaos` in real time via `setIdleChaos()`, called every 200 ms alongside `setSynthState()`:

| Parameter | At chaos = 0 (harmony) | At chaos = 1 (full chaos) |
|-----------|------------------------|--------------------------|
| Lowpass cutoff | 4000 Hz | 400 Hz (very muffled) |
| Reverb wet | 0.15 | 0.85 (washed out) |
| Distortion | 0 | 0.65 (clipping) |
| Tremolo depth | 0 | 0.85 (heavy dropout) |
| Tremolo rate | 2 Hz | 8 Hz |
| Static noise gain | 0 | 0.04 (subtle) |
| Volume | −3 dB | −15 dB |

**Fade behaviour:** both music and noise fade together through `_idleFadeGain`. Fade uses `setTargetAtTime` (exponential curve). Time constant: 0.7 s at chaos=1, 2.5 s at chaos=0 — total fade duration ≈ TC × 3.5 s.

**Track chaining:** each audio file plays once (no loop). `onstop` immediately fetches and starts the next track from `/simAss-audio`. Generation counter `_idleAudioGen` prevents stale callbacks after a spectator leaves mid-fade.

**Asset source:** `simAss/music/` — up to 10 MP3 files (1-day lifespan). The server picks at random and auto-generates new ones in the background when below the cap.

Independent volume control: **ch2: music vol** slider in the GUI Audio folder (−30 to +6 dB).

---

## n8n Integration

The simulation calls n8n directly from the browser via HTTPS fetch. No server relay is involved. Set `VITE_N8N_BASE_URL` in `.env` to your n8n origin (baked into the bundle at build time).

### Endpoints

| Event | Path | Trigger |
|-------|------|---------|
| User event | `/webhook/sim-event` (or `/webhook-test/sim-event` in test mode) | Every `remote-event` received from a spectator |
| Heartbeat | `/webhook/heartbeat` (or `/webhook-test/heartbeat` in test mode) | Every `heartbeatInterval` seconds (default 20 s) |

The **n8n test mode** toggle in the GUI switches between production and test paths without requiring a rebuild.

### sim-event payload

```json
{
  "type": "text",
  "room": "session-UUID",
  "spectatorId": "socket-id",
  "data": { "text": "user prompt" },
  "timestamp": 1234567890
}
```

### heartbeat payload

```json
{
  "type":            "heartbeat",
  "room":            "session-UUID",
  "mode":            "STORY",
  "colorMode":       "NORMAL",
  "status":          "NORMAL",
  "qrStatus":        "HIDE",
  "step":            2,
  "stepStatus":      "IDLE",
  "optionA":         null,
  "optionB":         null,
  "votesA":          0,
  "votesB":          0,
  "storyVoteResult": null,
  "userCount":       3,
  "params": {
    "agentCount": 1200000,
    "stepLen": 2.0,
    "turnRate": 0.04,
    "windStr": 0.2,
    "...": "all current simulation params"
  },
  "...serverEchoFields": "any fields the server returned in its last heartbeat response are spread here at the root"
}
```

When a story step completes (`storyStepComplete` flips to `true`), an **out-of-cycle heartbeat** fires immediately so n8n does not have to wait for the next scheduled tick.

### Response format (`applySimParams`)

Both endpoints consume the same response format. Return a JSON object with any combination of the following keys — unrecognised keys are ignored:

| Key | Type | Effect |
|-----|------|--------|
| `traceText` | `string` | Render this string as the particle trace attractor (replaces QR if active) |
| `clearText` | `bool` | Clear the current trace text |
| `clearTrace` | `bool` | Clear trace image and text |
| `showQR` | `bool` | `true` = restore QR; `false` = clear trace image |
| `avoidMap` | `string \| null` | Load a new avoidance map from a base64 data URL or HTTPS URL; `null` clears it |
| `restart` | `bool` | Re-seed all agents |
| `status` | `"NORMAL" \| "FREEROAM" \| "DOT"` | Set simulation state (`FREEROAM` suspends formula steering and wind; `DOT` applies a fixed inward-spiral attractor) |
| `colorMode` | `"NORMAL" \| "GRAYSCALE" \| "GRAYSCALE_INVERTED"` | Final-stage color treatment applied in the blit pass (post-tone-map so additive accumulation isn't broken) |
| `dir` | `string` | New direction formula (WGSL expression returning radians) |
| `wind` | `string` | New wind formula (WGSL expression returning radians) |
| `step` | any | Story step ID — resets `storyStepComplete`, `storyVoteResult`, and `stepStatus` for a new step |
| `stepDuration` | number | Seconds until the step auto-completes and an out-of-cycle heartbeat fires |
| `stepStatus` | `"IDLE" \| "DRAW" \| "VOTE" \| "TEXT" \| "RAISE" \| "PULSE" \| "WAVE"` | Spectator interaction mode — relayed to all remote devices via Socket.IO |
| `optionA` | string | First vote option label (required with `VOTE` steps) |
| `optionB` | string | Second vote option label (required with `VOTE` steps) |
| `caption` | `string \| null` | Subtitle text drawn at the bottom of the canvas as a particle attractor; `null` clears it |
| any `params` key | number/bool | Overwrite the matching simulation parameter live |

Example story step response:

```json
{
  "step": 3,
  "stepDuration": 25,
  "stepStatus": "VOTE",
  "optionA": "House",
  "optionB": "Garden",
  "caption": "Where do we look?",
  "status": "FREEROAM"
}
```

---

## Environment Variables

`VITE_*` variables are **baked into the bundle at build time** by Vite. Changing them requires a rebuild (`npm run build`).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express server port |
| `ADMIN_PASSWORD` | — | Password for the `/admin` panel; leave blank to disable |
| `VITE_PORT` | `5173` | Vite dev server port — Express redirects HTML requests here in dev |
| `VITE_SERVER_PORT` | `3000` | Express port exposed to browser clients for direct Socket.IO connection in dev |
| `VITE_N8N_BASE_URL` | — | Base URL of your n8n instance (no trailing slash). The sim appends `/webhook/sim-event` or `/webhook/heartbeat`. Leave blank to disable n8n. Baked at build time — requires rebuild to change. |
| `VITE_USER_URL` | `http://localhost:3000` | Origin used to build the QR code URL (`$VITE_USER_URL/remote/?s=<uuid>`) |
| `VITE_SOCKET_URL` | — | Socket.IO server origin used by browser clients **in production**. Set to your public API domain (e.g. `https://api.stubfx.io`). In dev this is ignored — clients always connect directly to Express. Falls back to `'/'` (page origin) if unset. |
| `OPENAI_API_KEY` | — | OpenAI key — used for image generation (`gpt-image-1-mini`) and narration (`gpt-4o-mini`) |
| `ELEVENLABS_API_KEY` | — | ElevenLabs key — used for audio generation and narration TTS |
| `ELEVENLABS_VOICE_ID` | — | ElevenLabs voice ID |
| `ELEVENLABS_MODEL` | `eleven_multilingual_v2` | ElevenLabs TTS model. Voice settings: stability 0.75, similarity 1.0, style 0.5, speed 1.0 |
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

**Simulation page (`/`)**

| Parameter | Effect |
|-----------|--------|
| `?gui=true` | Start with GUI, monitor, and formula panel visible |
| `?resolution=<0-1>` | Initial render scale (clamped to 0.1–1.0). Sets the `render scale` GUI slider at boot; lower = fewer pixels, higher frame rate |

**Remote page (`/remote/`)**

| Parameter | Effect |
|-----------|--------|
| `?s=<uuid>` | Session room UUID — required to join a simulation session |
| `?max=<n>` | Spectator threshold above which the persistent QR on the remote page hides (default 10 if absent; controlled via Session → QR hides at N users in the sim GUI — not included in the scanned QR) |

---

## Project Structure

```
thesis-sim/
├── src/
│   ├── sim.js               Main entry point: GPU setup, frame loop, GUI, formula system,
│   │                        Socket.IO host, collective-state handler, QR screensaver,
│   │                        QR overlay canvas, join burst, contamination tracking,
│   │                        avoid map, auto-clear timer
│   └── shaders/
│       ├── compute.wgsl     Agent physics (soloUB 144 bytes): formula steering,
│       │                    wind + collective tilt bias, image-trace avoidance (gradient
│       │                    + lookahead), avoidance map, contamination circle avoidance
│       ├── render.wgsl      Per-agent quad rendering (renderUB 112 bytes, 26 fields):
│       │                    additive or max blend; speed→colour blend; image-coloured
│       │                    homing agents; proximity fade
│       ├── agentShadow.wgsl Homing-agent shadow pass: soft dark splat per agent
│       │                    (visual pass) + density probe texture (density pass)
│       ├── fade.wgsl        Trail decay — black fullscreen quad with alpha blend
│       ├── blit.wgsl        Offscreen→canvas tone mapping (blitUB 32 bytes):
│       │                    cutoff clamp, tone curve, shadow boost, color mode
│       ├── wind-vis.wgsl    Wind arrow debug overlay (evalWindFormula prepended at runtime)
│       └── image-debug.wgsl Grayscale image region debug overlay
│
├── remote/
│   ├── index.html           Spectator page (served at /remote/?s=<uuid>);
│   │                        includes persistent #session-qr canvas (bottom-right corner)
│   ├── main.js              Socket.IO client — joystick (spawner direction + velocity),
│   │                        tilt (personal wind), color picker, text events; star field
│   │                        canvas drifts counter to joystick; aura reflects tilt and
│   │                        selected color; peer-joined/peer-left for QR visibility;
│   │                        QR auto-hides on first interaction or full room
│   ├── style.css            Dark atmospheric design, ripple animation, tilt indicator,
│   │                        session-qr fade transition
│   ├── gyro.js              Device orientation helpers (pitch, roll, motion magnitude)
│   └── motion.js            Motion smoothing
│
├── admin/
│   ├── index.html           Admin controller panel (password-protected; URL: /admin/?s=<uuid>)
│   ├── main.js              Show operator panel: live spectator count, restart + full reset,
│   │                        mute audio, mode (STORY/SHOWCASE), step status (IDLE/DRAW/VOTE),
│   │                        QR show/hide (two independent buttons), QR location 3×3 grid,
│   │                        clear trace, n8n heartbeat trigger, speed slider, formula presets
│   └── style.css
│
├── server/
│   ├── server.js            Socket.IO host/remote/admin routing; room state aggregation;
│   │                        collective-state ticker (300 ms); always-direct remote-event relay (no n8n relay);
│   │                        spectator-joined/left to host; peer-joined/peer-left to spectators
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
