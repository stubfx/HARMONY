# n8n Control Reference

Two webhook paths receive data from the simulation system. Both return a JSON object that is applied directly as sim params via `applySimParams()`.

---

## `/webhook/spectator` — Spectator presence (server → n8n)

Called by the **server** (not the sim) whenever a spectator socket connects or disconnects. This is the authoritative source for user counts — the sim never tracks them itself.

### Payload

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"spectator-joined"` \| `"spectator-left"` | Event type |
| `room` | `string` | Session room UUID |
| `spectatorId` | `string` | Persistent UUID from the remote device (survives page refresh within the same browser session) |
| `userCount` | `number` | Total connected spectators after this event |

### Example

```json
{ "type": "spectator-joined", "room": "uuid", "spectatorId": "uuid", "userCount": 2 }
{ "type": "spectator-left",   "room": "uuid", "spectatorId": "uuid", "userCount": 1 }
```

### Response

Return any sim params to push to the host immediately. The server forwards the response as a `sim-params` socket event. Typical use: show/hide QR, adjust params when the room fills or empties.

```json
{ "showQR": false, "status": "NORMAL" }
```

---

## `/webhook/heartbeat` — Periodic sim snapshot (sim → n8n)

The sim sends this every `heartbeatInterval` seconds (default: 5 s). Use it to keep n8n in sync with the current state and to push changes back proactively.

### Payload

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"heartbeat"` | Always `"heartbeat"` |
| `room` | `string` | Session room UUID |
| `status` | `"NORMAL"` \| `"IDLE"` | Current simulation state |
| `qrStatus` | `"SHOW"` \| `"HIDE"` | Whether the QR code is the active magnet image |
| `params` | `object` | Full snapshot of all current sim params (see below) |

### Response

Same as `/spectator` — any JSON keys are applied via `applySimParams()`.

---

## Named action flags (response only)

These keys trigger immediate side-effects and are **not** stored in `params`.

| Key | Type | Effect |
|-----|------|--------|
| `status` | `"NORMAL"` \| `"IDLE"` | Switches the simulation state. `IDLE` suppresses mouse/touch input and agent magnetism. |
| `showQR` | `true` \| `false` | `true` — displays the pre-generated QR code as the active magnet image. `false` — clears the magnet image entirely. |
| `restart` | `true` | Re-seeds all agents at random positions with fresh velocities. |
| `clearTrace` | `true` | Clears the magnet image AND the text trace layer. |
| `clearText` | `true` | Clears only the text trace layer, leaving any QR/image untouched. |
| `traceText` | `string` | Renders a text string onto the trace canvas and makes it the active magnet image. Replaces QR if one was visible. |
| `traceImage` | `string` (URL) | Fetches an image from the given URL and uses it as the magnet image. Replaces QR or text if visible. Supports any format the browser can decode (PNG, JPEG, WebP, etc.). |
| `dir` | `string` | Sets the direction formula (WGSL math expression in `x, y, t, cx, cy, PI, TWO_PI`). Applied immediately. |
| `wind` | `string` | Sets the wind formula (same variable set as `dir`). Applied immediately. |
| `avoidMap` | `string` \| `null` | URL of an image to use as the avoidance map. `null` clears the current map. |

---

## Params overrides (response only)

Any key matching a property in the `params` object is written directly and takes effect on the next frame.

### Motion

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `agentCount` | `1 200 000` | `1 000 – 1 200 000` | Number of active agents. Change triggers a full re-seed. |
| `stepLen` | `2.0` | `0.1 – 8` | Base movement speed in canvas px / frame. |
| `turnRate` | `0.04` | `0.005 – 0.3` | Maximum angular change per frame (radians). |
| `maxSpeed` | `5.0` | `1 – 15` | Speed cap in px / frame. Also sets the colour-blend ceiling. |
| `minSpeed` | `0.2` | `0 – 2` | Floor speed; agents that slow below this are nudged back up. |
| `weightSpread` | `0.8` | `0 – 1` | Spread of per-agent weight multipliers. `0` = all identical, `1` = range [0.05 – 1.95]. |
| `followFormula` | `true` | bool | `false` disables the dir formula — agents drift on wind + magnet only. |
| `autoDir` | `true` | bool | Randomly cycles through the built-in dir formula list every ~30 s. |
| `bounceEdges` | `false` | bool | Reflect agents at canvas edges instead of wrapping. |
| `useDeltaTime` | `true` | bool | `false` fixes the timestep at 1/60 s (disables frame-spike compensation). |

### Wind

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `windEnabled` | `true` | bool | Enables or disables wind force entirely. |
| `windStr` | `0.2` | `0 – 2` | Wind force multiplier applied on top of the formula result. |
| `autoWind` | `true` | bool | Cycles through the built-in wind formula list every 10 s. |
| `showWindVis` | `false` | bool | Overlays an arrow grid visualising the current wind field. |

### Visual

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `renderScale` | `1.0` | `0.1 – 1.0` | Multiplied with DPR; reduces canvas resolution for performance. |
| `pointSize` | `2.0` | px | Side length of each agent quad in canvas pixels. |
| `color` | `"#1a0099"` | hex | Base particle colour (applied when speed = 0). |
| `speedColor` | `"#ff4400"` | hex | Colour blended in as speed approaches `maxSpeed`. |
| `brightness` | `0.06` | `0 – 1` | Per-particle alpha for free agents. Prevents additive over-saturation. |
| `trailDecay` | `0.04` | `0 – 1` | Fade rate of the trail texture per frame. Higher = shorter trails. |
| `bgBlackCutoff` | `0.05` | `0 – 1` | Luminance below which trail pixels are clamped to black at display time. |

### Magnet image

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `magnetStr` | `5.0` | px/frame | Pull speed: how many canvas px per frame a homing agent advances toward its home position. |
| `imageSize` | `0.316` | `0 – 1` | Image size as a fraction of `min(canvasW, canvasH)`. |
| `alphaThreshold` | `0.1` | `0 – 1` | Minimum vignette-weighted alpha a pixel must have for an agent to home to it. |
| `blackThreshold` | `0.05` | `0 – 1` | Luminance below which a pixel is treated as transparent even if alpha is high. |
| `vignetteEdge` | `0.08` | `0 – 0.5` | UV-space width of the soft edge fade applied to the magnet image. `0` = no fade. |
| `showImage` | `false` | bool | Renders a debug overlay of the raw magnet image. |

### Agent shadow & proximity fade

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `agentShadowStr` | `0.20` | `0 – 1` | Peak opacity of each homing-agent shadow splat. |
| `agentShadowRadius` | `10` | px | Splat half-radius in canvas pixels. Larger = softer, wider shadow. |
| `homingProximityRange` | `300` | px | Distance over which a homing agent fades from `homingMinAlpha` to full visibility. Set to `0` to disable. |
| `homingMinAlpha` | `0.1` | `0 – 1` | Minimum alpha for a homing agent at max distance. Applies to both particle and shadow. `1` disables the fade. |

### Mouse eraser (contamination)

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `contamMouse` | `false` | bool | Enables the mouse cursor as a live contamination (eraser) point. |
| `contamPush` | `false` | bool | When true, agents near the eraser circle are pushed outward. When false, the eraser only clears the trace alpha without disturbing velocities. |
| `contamRadius` | `150` | px | Radius of each contamination circle in canvas pixels. |

### Agent probe

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `probeLen` | `150.0` | px | How far ahead a free agent probes for shadow density. |
| `probeForceStr` | `100.0` | multiplier | Base steering force; scaled continuously by sampled shadow density (stronger overlap = stronger avoidance). |
| `respawnOnCollide` | `false` | bool | When true, high-density probe hits (density > 0.3) teleport the agent to a random edge instead of steering. |

### Avoidance map

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `avoidForceStr` | `1.0` | multiplier | Scales the repulsion force generated by the avoid map. |
| `avoidMapScale` | `1.0` | `0 – 1` | Coverage of the avoid map as a fraction of the canvas. |

### Session / QR

| Key | Default | Description |
|-----|---------|-------------|
| `qrFadeZone` | `false` | Fades free agents near the QR rect to keep it scannable. |
| `remoteTimeout` | `0` | Seconds of silence from all remotes before the QR is restored. `0` = disabled. |
| `clearDelay` | `0` | Seconds before auto-clearing user-submitted trace content. `0` = disabled. |
| `heartbeatInterval` | `5` | Seconds between heartbeat calls. `0` = off. |
| `n8nTestMode` | `false` | Routes all n8n calls (sim and server) to `/webhook-test/` endpoints. Server follows automatically via socket sync. |

---

## Test mode

Toggle `n8n test mode` in the Session GUI panel. The sim immediately emits `set-n8n-test-mode` to the server so both the sim's own HTTP calls and the server's spectator calls switch endpoints in sync.

| Production | Test |
|-----------|------|
| `/webhook/heartbeat` | `/webhook-test/heartbeat` |
| `/webhook/spectator` | `/webhook-test/spectator` |
| `/webhook/sim-event` | `/webhook-test/sim-event` |
