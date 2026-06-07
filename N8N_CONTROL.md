# n8n Control Reference

Two webhook paths receive data from the simulation system (sim → n8n). Both return a JSON object that is applied directly as sim params via `applySimParams()`: `/webhook/heartbeat` for periodic snapshots and `/webhook/sim-event` for real-time interaction events.

n8n can also push data **back to individual remote devices** using the server's `/spectator-push` endpoint (n8n → server → remote).

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

The sim sends this every `heartbeatInterval` seconds (default: 10 s). Use it to keep n8n in sync with the current state and to push changes back proactively.

### Payload

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"heartbeat"` | Always `"heartbeat"` |
| `room` | `string` | Session room UUID |
| `mode` | `"STORY"` \| `"SHOWCASE"` | Current top-level session mode |
| `colorMode` | `"NORMAL"` \| `"GRAYSCALE"` \| `"GRAYSCALE_INVERTED"` | Current final-stage color treatment applied in the blit pass |
| `status` | `"NORMAL"` \| `"FREEROAM"` \| `"DOT"` | Current simulation state |
| `qrStatus` | `"SHOW"` \| `"HIDE"` | Whether the QR code is the active magnet image |
| `step` | `number` \| `null` | Current story step ID, or `null` if none |
| `stepStatus` | `"IDLE"` \| `"DRAW"` \| `"VOTE"` \| `"TEXT"` \| `"RAISE"` \| `"PULSE"` \| `"WAVE"` | Current step phase |
| `optionA` | `string` \| `null` | Text of vote option A — dirty, holds last known value even outside a vote |
| `optionB` | `string` \| `null` | Text of vote option B — dirty, holds last known value even outside a vote |
| `votesA` | `number` | Raw vote count for option A — dirty, never auto-reset |
| `votesB` | `number` | Raw vote count for option B — dirty, never auto-reset |
| `storyVoteResult` | `string` \| `null` | Current leading option label, or `null` if tied / no vote |
| `userCount` | `number` | Live connected spectator count |
| `params` | `object` | Full snapshot of all current sim params (see below) |
| *(server echo fields)* | any | Any fields the server returned in its previous heartbeat response are spread at the root of the next payload. This lets n8n detect stale clients: send a `stateToken` (or any identifier) in the response, and if the next heartbeat echoes a different value the client missed an update. Media fields (`audio`, `audiobg`, `traceImage`, `avoidMap`, etc.) are never echoed. Echo is session-only — cleared on page reload. |

### Response

Same as `/spectator` — any JSON keys are applied via `applySimParams()`.

---

## Named action flags (response only)

These keys trigger immediate side-effects and are **not** stored in `params`.

| Key | Type | Effect |
|-----|------|--------|
| `mode` | `"STORY"` \| `"SHOWCASE"` | Top-level session mode. `STORY` — narrative-driven; n8n sequences steps, votes, and content. `SHOWCASE` — ambient / exhibition; no story sequencing. Default: `STORY`. |
| `colorMode` | `"NORMAL"` \| `"GRAYSCALE"` \| `"GRAYSCALE_INVERTED"` | Final-stage color treatment applied in the blit pass (after tone-map + shadow boost, before the canvas write). `NORMAL` — RGB unchanged. `GRAYSCALE` — RGB collapsed to luminance. `GRAYSCALE_INVERTED` — luminance inverted (`1 − luma`); the background also flips to white. Inversion runs at the blit stage rather than per-particle so the offscreen's additive HDR accumulation isn't broken. Default: `NORMAL`. |
| `status` | `"NORMAL"` \| `"FREEROAM"` \| `"DOT"` | Switches the simulation state. `FREEROAM` suspends formula steering and wind; `DOT` applies a fixed inward-spiral attractor. |
| `showQR` | `true` \| `false` | `true` — enables the QR layer on the trace canvas (drawn on top of any user content). `false` — hides the QR layer; user content remains unaffected. |
| `restart` | `true` | Re-seeds all agents at random positions with fresh velocities. |
| `clearTrace` | `true` | Clears the magnet image, the text trace layer, and the caption. |
| `clearText` | `true` | Clears the text trace layer and the caption, leaving any QR/image untouched. |
| `traceText` | `string` | Renders a text string onto the trace canvas. QR remains visible on top if `qrStatus` is `SHOW`. |
| `traceImage` | `string` (URL) | Fetches an image from the given URL and composites it onto the trace canvas. QR remains visible on top if `qrStatus` is `SHOW`. Supports any format the browser can decode (PNG, JPEG, WebP, etc.). |
| `dir` | `string` | Sets the direction formula (WGSL math expression in `x, y, t, cx, cy, PI, TWO_PI`). Applied immediately. |
| `wind` | `string` | Sets the wind formula (same variable set as `dir`). Applied immediately. |
| `avoidMap` | `string` \| `null` | URL of an image to use as the avoidance map. `null` clears the current map. |
| `step` | `string` \| `null` | Advances the story to a new step. Setting this resets `stepStatus` to `"IDLE"` (or the value provided), clears `optionA`/`optionB`, and emits `remote-ui` to all spectators. `null` clears the current step — when no step is active the remote always shows the joystick regardless of `stepStatus`. Always send as a top-level key, not inside `params`. |
| `stepStatus` | `"IDLE"` \| `"DRAW"` \| `"VOTE"` \| `"TEXT"` \| `"RAISE"` \| `"PULSE"` \| `"WAVE"` | Updates the current step phase mid-step without resetting other story state. Only meaningful while a step is active — if no step is set, the remote ignores this and keeps the joystick visible. Emitted to spectators via `remote-ui`: `"DRAW"` — joystick active; `"VOTE"` — binary vote panel shown; `"TEXT"` — text input panel shown; `"IDLE"` — no interaction, joystick hidden; `"RAISE"` — swipe-up gesture panel; `"PULSE"` — full-screen tap surface; `"WAVE"` — shake gesture panel. Ignored if identical to the current phase (no-op emit suppressed). |
| `optionA` | `string` \| `null` | Label for the first vote option. Shown on the left half of the spectator vote panel when `stepStatus` is `"VOTE"`. |
| `optionB` | `string` \| `null` | Label for the second vote option. Shown on the right half of the spectator vote panel when `stepStatus` is `"VOTE"`. |
| `caption` | `string` \| `null` | Text drawn as a subtitle at the bottom of the trace canvas (story mode captions, voiceover subtitles, etc.). Empty string or `null` clears it. |
| `triggerHeartbeat` | `true` | Fires an immediate out-of-cycle heartbeat call to n8n (`/webhook/heartbeat`). Useful for manually re-syncing n8n state from the admin panel without waiting for the next scheduled tick. |
| `vote-result` event | — | **Sent by the sim** (not a response key). When the `voteDuration` timer expires, the sim POSTs to `/webhook/sim-event` with `{ "type": "vote-result", "room": "...", "winner": "A" \| "B" \| null, "winning_option": "option text" \| null }`. `winner` is `null` on a tie. Use this in n8n to advance the story step. |
| `audio` | `string` \| `null` | Base64-encoded audio for the **voiceover track** (plays once, then stops). Decoded and routed through the Web Audio analyser — drives particle brightness via RMS. `null` or `""` stops any running voiceover immediately. Absent key = no-op. |
| `audiobg` | `string` \| `null` | Base64-encoded audio for the **background music track**. `null` or `""` stops and clears it immediately. Absent key = no-op. |
| `audiobgLoop` | `true` | When `true` (default) the track loops forever. Set to `false` to play once and stop at the end. |
| `audioFormat` | `string` | MIME type for the `audio` payload. Defaults to `"audio/webm;codecs=opus"` when omitted. |
| `audiobgFormat` | `string` | MIME type for the `audiobg` payload. Defaults to `"audio/webm;codecs=opus"` when omitted. |

---

## Params overrides (response only)

Any key matching a property in the `params` object is written directly and takes effect on the next frame.

### Motion

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `agentCount` | `100 000` | `1 000 – 5 000 000` | Number of active agents. Change triggers a full re-seed. Higher counts increase GPU load significantly; test before pushing above 2 M in a live installation. |
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
| `color1` | `"#1a0099"` | hex | First palette colour. Each particle is assigned a colour by its index (`agentId % N`). |
| `color2` | `"#ff4400"` | hex | Second palette colour. No velocity interpolation — colours are flat per particle. |
| `brightness` | `0.06` | `0 – 1` | Per-particle alpha for free agents. Prevents additive over-saturation. |
| `trailDecay` | `0.04` | `0 – 1` | Fade rate of the trail texture per frame. Higher = shorter trails. |
| `bgBlackCutoff` | `0.05` | `0 – 1` | Luminance below which trail pixels are clamped to black at display time. |
| `golEnabled` | `false` | bool | Game of Life mode on/off. When on, free particles are attracted toward the live cells of a Conway automaton running on a grid. |
| `golStrength` | `0.5` | `0 – 2` | How strongly particles are pulled toward live cells. |
| `golStepInterval` | `4` | frames | Frames between Game-of-Life generations. Higher = slower evolution. |
| `golSpark` | `0.001` | `0 – 0.1` | Random births injected each generation so the automaton never freezes into still lifes (0 = pure Conway). |
| `freeroamLock` | `true` | bool | When on, the status auto-reverts from FREEROAM to NORMAL after `freeroamLockDelay` seconds. Sending `status: "FREEROAM"` again (from anywhere, including this API) resets the timer. |
| `freeroamLockDelay` | `10` | seconds | Delay in FREEROAM before the lock reverts to NORMAL. |

### Magnet image

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `magnetStr` | `5.0` | px/frame | Pull speed: how many canvas px per frame a homing agent advances toward its home position. |
| `homingChance` | `0.2` | `0 – 1` | Per-frame probability that a newly-eligible agent commits to homing. Already-homing agents are unaffected and keep going. Lower values stagger the formation of the image over time. |
| `homingInfluence` | `1.0` | `0 – 1` | Maximum homing blend weight, applied at zero distance from home. Scales linearly to 0 at one canvas-width away — agents far from home follow formula and wind almost freely. |
| `alphaThreshold` | `0.1` | `0 – 1` | Minimum vignette-weighted alpha a pixel must have for an agent to home to it. |
| `blackThreshold` | `0.05` | `0 – 1` | Luminance below which a pixel is treated as transparent even if alpha is high. |
| `vignetteEdge` | `0.08` | `0 – 0.5` | UV-space width of the soft edge fade applied to the screen edges. `0` = no fade. |
| `showImage` | `false` | bool | Renders a debug overlay of the raw trace texture. |

### Trace canvas

The trace canvas is always full-screen (scaled by `traceScale`). QR and user content are composited as independent layers at their own position and size.

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `traceScale` | `0.5` | `0.1 – 1.0` | Trace canvas resolution relative to the main canvas. Lower = cheaper upload, less detail. |
| `imageSize` | `0.316` | `0 – 1` | User content size as a fraction of `min(traceW, traceH)`. |
| `imageX` | `0.5` | `0 – 1` | User content center X in screen-space (0 = left, 1 = right). |
| `imageY` | `0.5` | `0 – 1` | User content center Y in screen-space (0 = top, 1 = bottom). |
| `qrSize` | `0.25` | `0 – 1` | QR size as a fraction of `min(traceW, traceH)`. |
| `qrMargin` | `0.02` | `0 – 0.1` | Uniform margin from the aligned edge, as a fraction of `min(traceW, traceH)`. Applied equally on both axes. |
| `qrAlignX` | `"center"` | `"left"` \| `"center"` \| `"right"` | Horizontal position of the QR code. |
| `qrAlignY` | `"center"` | `"top"` \| `"center"` \| `"bottom"` | Vertical position of the QR code. |
| `qrOverlay` | `false` | bool | When `true`, the QR is rendered on a separate 2D canvas overlay instead of being baked into the trace texture. Agents no longer home to the QR pattern; the overlay sits above the particle layer at full resolution. Use when you want a crisp, scannable code that doesn't interfere with swarm formation. |
| `qrQuietZone` | `0` | `0 – 8` | White border around the QR in modules. `0` = none (tightest), `4` = spec minimum (most scannable). Triggers QR regeneration. |
| `qrInvert` | `false` | bool | Swap dark/light channels: transparent modules on white background instead of white modules on transparent. Triggers QR regeneration. |

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
| `probeLen` | `150.0` | px | Cast distance for all three Physarum sensors. |
| `probeForceStr` | `100.0` | multiplier | Lateral steering force; scales with density asymmetry between left and right sensors. |
| `probeSensorAngle` | `0.785` | radians | Half-angle between the forward and each side sensor (π/4 = 45°). Wider = earlier turns, narrower = tighter lane-following. |
| `respawnOnCollide` | `false` | bool | When true, high-density probe hits (max sensor density > 0.3) teleport the agent to a random edge instead of steering. |

### Avoidance map

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| `avoidForceStr` | `1.0` | multiplier | Scales the repulsion force generated by the avoid map. |
| `avoidMapScale` | `1.0` | `0 – 1` | Coverage of the avoid map as a fraction of the canvas. |
| `avoidMapInvert` | `false` | bool | When `true`, the avoid map is read as `1 − r` / `vec3(1 − rgb)` at every sample site (avoidance force *and* the per-particle colour sample), flipping which areas repel and which are transparent. |
| `avoidMapSampleColor` | `false` | bool | When `true`, non-homing particles take their base colour from the avoid-map pixel directly under them. Homing agents and active-spectator particles are unaffected. |
| `avoidMapFixedColor` | `false` | bool | Legacy modifier on `sampleColor`. With the flat two-colour palette the sampled pixel is used directly, so this flag no longer changes the result. |

### Session / QR

| Key | Default | Description |
|-----|---------|-------------|
| `maxSpectators` | `1` | Connected spectator count at which the QR is hidden. Used by n8n logic to decide when to call `showQR: false`. The sim does not act on this directly — n8n reads it from the heartbeat and acts accordingly. |
| `spectatorAgentShare` | `100` | Percentage of agents (by index) that are assigned to spectators (0–100). The top `(100 − share)%` of agents always behave as pure sim agents — default color, formula/global wind, no joystick spawner — leaving them free to form trace images undisturbed. Changes take effect on the next frame with no re-seeding. |
| `spectatorSpawnChance` | `0.01` | Per-frame probability that an agent in a spectator's partition teleports to that spectator's touch position (0–1). Only fires while the spectator is actively touching; homing agents are exempt. |
| `respawnOnQR` | `true` | When `true`, free agents that wander into the QR bounding box are stochastically respawned to a random canvas edge, keeping the code scannable. Homing agents (those forming the QR pattern) are exempt. |
| `qrRespawnChance` | `0.01` | Per-frame probability `[0–1]` that a free agent inside the QR rect is respawned. Only active when `respawnOnQR` is `true`. |
| `remoteTimeout` | `0` | Seconds of silence from all remotes before the QR is restored. `0` = disabled. |
| `clearDelay` | `0` | Seconds before auto-clearing user-submitted trace content. `0` = disabled. |
| `heartbeatInterval` | `10` | Seconds between heartbeat calls. `0` = off. |
| `heartbeatTimeout` | `60` | Seconds before a heartbeat fetch is aborted. If a heartbeat is still in flight when the next tick fires, the tick is skipped and logged to the console. Increase this when n8n workflows take a long time to respond. |
| `voteDuration` | `30` | Seconds the vote panel stays open. When the timer expires the sim fires a `vote-result` event to `/webhook/sim-event` and the remote reverts to the rest state (joystick). Both displays show a live countdown during the vote. |
| `n8nEnabled` | `true` | Runtime kill-switch for all n8n traffic (heartbeat + sim-event). Set to `false` to silence outgoing calls without unsetting `VITE_N8N_BASE_URL` or reloading. Equivalent to the `?n8n=off` URL flag set at boot. |
| `n8nTestMode` | `false` | Routes all n8n calls (sim and server) to `/webhook-test/` endpoints. Server follows automatically via socket sync. |

---

## `/spectator-push` — Push to remote device (n8n → server)

Called by **n8n** (not the sim) to push a `device-message` socket event to one or all spectators in a room. This is the correct path for showing device-specific UI — prompts, feedback, per-user instructions — without polling.

### Authentication

Set `N8N_SECRET` in the server's `.env`. The request must include:

```
Authorization: Bearer <N8N_SECRET>
```

If `N8N_SECRET` is unset the endpoint is unauthenticated (development only).

### Request

```
POST https://<your-domain>/spectator-push
Content-Type: application/json
Authorization: Bearer <N8N_SECRET>
```

| Field | Type | Description |
|-------|------|-------------|
| `room` | `string` | Room UUID (required) |
| `spectatorId` | `string` | Target spectator UUID. **Omit to broadcast to all spectators in the room.** |
| `data` | `object` | Payload forwarded verbatim as the socket event (see below) |

### `data` fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Text shown as a top notification on the remote device. Slides in, auto-dismisses after 5 s. |
| `color` | `string` \| `null` | CSS color string (hex, hsl, etc.) that overrides the aura base color on the device. Persists across messages until overridden. Send `null` or `""` to reset to the temperature-driven color. |

Fields are independent — you can send `color` without `text` (silent aura shift), `text` without `color` (notification only), or both together. Additional fields are passed through for future interface types.

### Examples

**Push a prompt to one spectator:**

```json
{
  "room": "uuid",
  "spectatorId": "uuid",
  "data": { "text": "you are the attractor" }
}
```

**Broadcast to all spectators in the room:**

```json
{
  "room": "uuid",
  "data": { "text": "the swarm is listening" }
}
```

### Response

```json
{ "delivered": true, "target": "specific", "spectatorId": "uuid" }
{ "delivered": true, "target": "broadcast", "count": 4 }
```

Error responses: `400` missing room, `401` bad token, `404` room or spectator not found.

### Remote device behaviour

The `device-message` socket event is received by the spectator's browser.

- **`data.text`** — rendered in a pill-shaped notification anchored to the top of the screen. Slides in from above, auto-dismisses after 5 s. Consecutive messages restart the timer. Does not block touch interaction.
- **`data.color`** — immediately updates the aura background color, overriding the temperature-driven hue. The tilt anchor and coherence shape still respond to the device. Persists until the next push. Send `null` to restore temperature-driven color.

The text input panel on the remote is hidden by default. It appears automatically when `stepStatus` is set to `"TEXT"` via the `remote-ui` socket event and collapses after the spectator submits their input. It cannot be opened manually — it is driven entirely by n8n via the `stepStatus` action flag.

---

## Agentic story flow

The `agents/` directory contains system prompts and JSON schemas for a three-agent pipeline that drives STORY mode. Two language versions exist: `agents/italian/` and `agents/english/`. Both share the same architecture; the active sub-folder in each is `vogler_12/` (12 Vogler stages). The root-level files in `agents/italian/` are an older 17-stage draft.

### Story skeleton: generated vs. static

The story skeleton can be produced in two ways:

1. **Generated** — call the **Architect** agent once at session start. It outputs the full 12-step skeleton from scratch. Use for generative, session-unique narratives.
2. **Static** — load a pre-written skeleton JSON directly into n8n static data (e.g. `stories/segnale.json`). Skips the Architect entirely. The Step Generator and Memory Extractor work identically regardless of which approach was used.

`stories/segnale.json` is a fully authored skeleton for the story *Una storia per Tav* (an entity from Sistema RT-7 searches for her lost cat through the swarm). Its `narrative_seeds` contain near-verbatim example lines in the entity's voice, so the Step Generator has a concrete model to follow without any additional prompt engineering.

### The three agents

| Agent | File | Runs |
|-------|------|------|
| **Architect** | `vogler_12/01_architect.md` | Once per session (skip if using a static skeleton) |
| **Step Generator** | `vogler_12/02_step_generator.md` | Once per step |
| **Memory Extractor** | `03_memory_extractor.md` | Once per step, after the generator |

**Architect** — given no input, outputs the complete immutable story skeleton: 12 steps each with a `dramatic_function`, `emotional_tone`, `narrative_seeds`, plus protagonist, world, central conflict, and `initial_memory_state`. Store this in n8n static data — it never changes for that session.

**Step Generator** — given `step_number`, `vote_detail` (null at step 1), `story_skeleton`, and `memory_state`, outputs one step's content: `narrative_text`, `caption`, `primary_color`, `secondary_color`, `image_prompt`, `vote_question`, `option_a`, `option_b`, `next_interaction_type`. Reads `protagonist_description` and `protagonist.traits` from the skeleton as mandatory style rules.

**Memory Extractor** — given `step_number`, `step_text` (the `narrative_text` string from the generator output), `winning_vote_detail`, and `previous_memory_state`, outputs an updated memory state. Pass only `narrative_text`, not the full generator JSON.

### n8n static data to persist across calls

| Key | Set when | Updated when |
|-----|----------|--------------|
| `story_skeleton` | Session start (Architect) | Never |
| `memory_state` | Session start (initial from Architect) | After every Memory Extractor call |
| `current_step_number` | Session start (`1`) | After every vote-result |
| `last_narrative_text` | After every Step Generator call | After every Step Generator call |

### Session start workflow

Triggered by a heartbeat where `step === null` and `mode === "STORY"`:

1. Call **Architect** → store `story_skeleton` and extract `initial_memory_state`
2. Call **Step Generator** with `step_number: 1`, `vote_detail: null`, skeleton, initial memory → store `narrative_text`
3. Generate image from `image_prompt` (DALL-E or equivalent)
4. Respond to heartbeat:

```json
{
  "step": 0,
  "caption": "...",
  "traceImage": "<image url>",
  "stepStatus": "VOTE",
  "optionA": "...",
  "optionB": "..."
}
```

On subsequent heartbeats where `step` is already set, respond `{}`.

### Per-step cycle (vote-result event)

Triggered by `/webhook/sim-event` with `type: "vote-result"`:

1. Call **Memory Extractor** with `step_number: current`, `step_text: last_narrative_text`, `winning_vote_detail: winning_option`, `previous_memory_state` → store updated memory
2. Increment `current_step_number`
3. Call **Step Generator** with `step_number: current`, `vote_detail: winning_option`, skeleton, updated memory → store new `narrative_text`
4. Generate image
5. Respond:

```json
{
  "step": <current_step_number - 1>,
  "caption": "...",
  "traceImage": "<image url>",
  "stepStatus": "VOTE",
  "optionA": "...",
  "optionB": "..."
}
```

At step 12, `next_interaction_type` from the generator will be `"IDLE"` — send `stepStatus: "IDLE"` with no options.

### Step index mapping

The sim uses a 0-based `step` index; Vogler stages are 1-based. The mapping is: `sim_step = vogler_step_number − 1`. Access the skeleton array as `steps[sim_step]` (0-indexed).

### Timeout note

The `/webhook/sim-event` path (vote-result) has a **15-second hardcoded timeout** in the sim (`N8N_USER_TIMEOUT_MS`). If image generation takes longer, the response will be aborted and the next step content won't load. Consider pre-generating the next step's image during the vote countdown, or separating image generation from the vote-result response and delivering it on the next heartbeat.

---

## Test mode

Toggle `n8n test mode` in the Session GUI panel. The sim immediately emits `set-n8n-test-mode` to the server so both the sim's own HTTP calls and the server's spectator calls switch endpoints in sync.

| Production | Test |
|-----------|------|
| `/webhook/heartbeat` | `/webhook-test/heartbeat` |
| `/webhook/spectator` | `/webhook-test/spectator` |
| `/webhook/sim-event` | `/webhook-test/sim-event` |
