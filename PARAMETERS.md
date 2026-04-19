# Parameter Reference

A thorough explanation of every tunable parameter in the simulation, grouped by section. All values are editable live through the GUI (toggle with `Ctrl` or `?gui=true`).

The formula panel at the bottom-left of the screen also contains a **trace text** input (described below) that is separate from the GUI.

On startup the simulation connects to the server via Socket.IO, receives a session UUID, and automatically displays a **QR code** as the initial trace image — see the QR / Session section below.

---

## Trace Text (formula panel)

A text field displayed above the direction formula input, styled in amber to distinguish it from the formula fields. Whatever is typed here is rendered as a trace attractor: agents whose home positions fall inside the text glyphs will home to those positions, making the particle field collectively "write" the text.

### How it works

The text is rendered on the CPU using the browser's Canvas 2D API (white glyphs on a transparent background), then composited with any loaded trace image, and uploaded to the GPU as a single `rgba8unorm` texture — the exact same path as a loaded image. From the shader's perspective there is no difference: text and image feed the same texture slot and obey the same alpha threshold, black cutoff, and edge fade rules.

The texture is rebuilt 300 ms after the last keystroke (debounced). There is no need to press Enter.

### Sizing and font

- **Text only** (no image loaded): the canvas width is fixed to the screen width (capped at the GPU's `maxTextureDimension2D` limit). Text is word-wrapped across multiple lines; font size is approximately 6% of the canvas width. Canvas height grows with the number of lines. This prevents arbitrarily wide textures when long strings are received (e.g. from n8n).
- **Text + image**: the canvas is the same pixel dimensions as the loaded image. The text is drawn on top at auto-fitted size (starting at 72% of the image height, scaled down if the text would overflow 92% of the image width).

The font is always **bold sans-serif**. The fill is always **white** (RGB 1,1,1), so agents homing to text glyphs are rendered bright white — unless a loaded image provides color underneath, in which case the image RGB shows through.

### Layering with a loaded image

When both text and an image are loaded:
1. The image is drawn first onto the composite canvas
2. The text glyphs are drawn on top in white
3. The combined result is uploaded as one texture

This means text appears as bright white regions overlaid on top of the image. Agents home to whichever pixels are sufficiently opaque (per alpha threshold and black cutoff), whether those are image pixels or text glyphs.

### Clearing

Clear the text by selecting all and deleting in the input field. If an image is also loaded, the image remains active. If no image is loaded, the trace layer is completely removed and agents return to formula-only mode.

---

## Motion

### agents
**Range:** 1 000 – 1 200 000 | **Default:** 1 200 000

Total number of active particles. Changing this re-seeds all agents (positions and home coordinates are reassigned). The GPU buffer is always allocated at maximum size; this parameter only changes how many agents the compute dispatch and draw calls actually process.

### base speed (`stepLen`)
**Range:** 0.1 – 8 | **Default:** 2.0

The nominal step length an agent wants to travel each frame, in canvas pixels. Acts as the magnitude of the direction vector before it is blended with the current velocity. Heavier agents (high weight) travel faster; lighter agents travel slower. Think of this as the intended cruising speed when following the direction formula at full weight.

### turn rate
**Range:** 0.005 – 0.3 | **Default:** 0.04

How sharply each agent steers toward the direction formula each frame. This is a `mix` factor: `vel = mix(vel, desired, turnRate)`. At 0 the agent ignores the formula entirely and coasts on inertia. At 1 the agent snaps to the desired direction immediately. Low values produce long, sweeping curves; high values produce tight, reactive motion.

> **Collective coherence modulation**: this value is scaled every frame by the smoothed average of all spectators' horizontal touch position (left = chaos multiplier 0.08×, right = order multiplier 3.0×, neutral = 1.0×). The GUI value sets the baseline; the crowd scales it. See *Remote / Swarm Inputs* below.

### max speed
**Range:** 1 – 15 | **Default:** 5.0

Hard speed cap in canvas pixels per frame (before dt scaling). Velocity is clamped to this magnitude every frame. This is also the reference value for the slow/fast color blend: an agent at `maxSpeed` renders at full fast-color intensity.

### min speed
**Range:** 0 – 2 | **Default:** 0.2

Speed floor. If an agent's velocity falls below this magnitude (and is non-zero), it is rescaled up to this value. Prevents agents from becoming fully stationary due to opposing forces cancelling out.

### weight spread
**Range:** 0 – 1 | **Default:** 0.8

Controls per-agent weight variation. At 0, every agent has an identical weight of 1.0 — they all respond to the direction formula equally. At 1, weights are distributed across a wide range (approximately 0.05 – 1.95), so some agents are near-stationary while others race. The weight is baked at seed time and stored permanently in the GPU buffer; changing this control re-seeds all agents.

### follow formula
**Default:** on

When on, agents steer toward the direction formula output each frame. When off, agents are in free drift: they keep their momentum, are still pushed by wind, and still home to the trace image if one is loaded, but the direction formula has no effect.

### auto-cycle formula
**Default:** on

When on (and `follow formula` is also on), a scheduler randomly picks a new formula from the built-in direction library every ~30 seconds. The formula changes smoothly — agents steer toward the new direction without any discontinuity.

### bounce edges
**Default:** off

When on, agents reflect off the canvas edges (velocity component perpendicular to the edge is reversed). When off (default), agents wrap to the opposite edge. Bouncing can reduce visual clumping at edges but creates distinct reflection patterns that look different from wrap-around motion.

### delta time (`useDeltaTime`)
**Default:** on

Controls whether each frame uses the actual elapsed wall-clock time as the physics timestep.

- **On**: `dt` = real elapsed time (clamped between 1 ms and 50 ms). Agents maintain consistent average speed regardless of frame rate, but a browser scheduling spike (GC, texture upload, tab switching) produces one enlarged step that looks like a brief lurch.
- **Off**: `dt` = fixed 1/60 s every frame. Motion is perfectly smooth but agents run slower than real-time when the frame rate drops below 60 fps.

Toggle off to diagnose whether visual twitching is caused by frame-spike compensation.

---

## Wind

### enabled
**Default:** on

Master wind toggle. When off, the wind formula has no effect and the strength slider is disabled. The formula and auto-cycle settings are preserved.

### strength (`windStr`)
**Range:** 0 – 2 | **Default:** 0.2

Scales the wind force vector before it is added to each agent's velocity. At 0 the wind formula runs but has no effect. At high values the wind dominates over the direction formula.

### show arrows
**Default:** off

Debug overlay. Draws a grid of short coloured arrows across the canvas, showing the wind direction at each grid point at the current moment. Colour indicates direction. Useful for understanding what a new wind formula is doing before committing to it.

### auto-cycle formula
**Default:** on

When on (and wind is enabled), a scheduler randomly picks a new formula from the built-in wind library every ~30 seconds.

---

## Visual

### render scale
**Range:** 0.1 – 1.0 | **Default:** 1.0

Canvas resolution multiplier applied on top of the device pixel ratio (DPR). At 1.0 on a 2x HiDPI screen the offscreen texture is rendered at 2× native — sharp but expensive. Reducing this to 0.5 halves the texture in each dimension (¼ the pixels), significantly improving frame rate on high-resolution displays. Changing this re-seeds agents.

### trail decay
**Range:** 0.005 – 0.4 | **Default:** 0.055

Controls how quickly particle trails fade. Each frame a black fullscreen quad is blended over the offscreen texture at this alpha — higher values erase trails faster, lower values leave longer ghosts. At the minimum, trails persist for many seconds; at the maximum they vanish almost instantly.

### black cutoff (`bgBlackCutoff`)
**Range:** 0 – 0.05 | **Default:** 0.012

Trail decay is exponential — each frame multiplies the remaining brightness by `(1 − trailDecay)`. This approaches zero asymptotically and never actually reaches it, leaving a faint "dirty" residual on the background between particles.

This control clamps that residual away at display time. During the final blit from the offscreen buffer to the canvas, any pixel whose luminance falls below this threshold is clamped to pure black. The offscreen buffer itself is unaffected — it continues to decay normally — so this is purely a cosmetic fix applied at the output stage.

At the default of 0.012 the residual is invisible in practice while the fix is imperceptible on real trail content (which is always well above this level). Raising it above ~0.02 may clip the very tail end of long trails; lowering to 0 disables the cutoff entirely.

### agent size (`pointSize`)
**Range:** 1 – 6 | **Default:** 2.0

The side length of each agent's rendered quad, in canvas pixels. Larger agents overlap more, producing a denser, painterly look. Smaller agents are sharp and precise.

### base color
**Default:** `#0000ff`

The color of slow or stationary agents. This is the low end of the speed-to-color gradient.

### fast color (`speedColor`)
**Default:** `#ff4400`

The color agents approach as their speed reaches `max speed`. The two colors are blended linearly using `speed / maxSpeed` as the interpolation factor.

> **Collective temperature tint**: before the color is written to the GPU each frame, it is blended up to 65% toward a temperature target driven by the average spectator touch Y position. Cold (top of phone screen) tints toward deep blue `#0d26e6`; warm (bottom) tints toward amber `#ff6600`. At neutral (no spectators touching) the GUI color is used unchanged.

### brightness
**Range:** 0.01 – 0.5 | **Default:** 0.08

The alpha of each rendered particle quad. Because particle blending is additive (`src-alpha / one`), lower values allow many particles to overlap without saturating to white — the accumulation is gradual. Raising this makes individual particles more visible but causes bright spots to blow out quickly in dense areas. This is the primary control for managing visual density vs. saturation.

> **Homing agents are unaffected by this slider.** Agents whose home pixel is primed always render at the full alpha of the image pixel they're assigned to (multiplied only by the edge vignette). This ensures the collective image they form reads at full intended intensity regardless of how dim free agents are set.

---

## Trace

The trace layer loads a static image onto the GPU and uses it to redirect agents. The image is never rendered directly — it is only felt through collective agent density and color.

### homing speed (`magnetStr`)
**Range:** 0 – 20 | **Default:** 5.0

When an agent's home position falls on a sufficiently opaque image pixel, the agent abandons its direction formula and steers straight toward home. This parameter sets that homing velocity in canvas pixels per frame (before dt scaling). Higher values make agents snap back to their home positions quickly; lower values produce a slow, drifting attraction.

### alpha threshold (`alphaThreshold`)
**Range:** 0 – 1 | **Default:** 0.1

The minimum image alpha required at an agent's home position to activate homing for that agent. This is a per-agent binary gate:

- If `image_alpha(home) >= alphaThreshold` → the agent **homes**: ignores all formulas and steers toward its home position at `homing speed`
- If `image_alpha(home) < alphaThreshold` → the agent is **free**: follows direction/wind formulas normally, and is repelled if it wanders into opaque areas

The threshold exists to prevent agents from homing to nearly-invisible edge pixels. At 0, any non-zero alpha activates homing. At 1, only fully opaque pixels do. For most images, 0.05–0.15 is a good range.

> Note: the `black cutoff` check runs before this — a pixel can pass the alpha threshold but still be skipped if its luminance is below the black cutoff.

> Note: the effective alpha used for this check is `imgSample.a × vignetteEdgeFactor`. Edge pixels whose raw alpha meets the threshold but whose vignette-weighted alpha does not are treated as free agents consistently in the compute shader, the render shader, and the agent shadow shader. Without this alignment they would enter a "limbo" state — free in physics but displayed with image colour and casting shadows.

> **QR mode and the sampler mismatch:** the compute shader samples the trace texture with `textureLoad` (exact nearest-neighbour lookup). The render shader normally uses a bilinear sampler. On a 512 px QR stretched to a large canvas, this causes a disagreement at module boundaries: an agent whose home lands in a transparent gap between two white modules may get `alpha = 0` from the nearest-neighbour lookup (free in compute), but `alpha ≈ 0.3–0.5` from bilinear interpolation (renders white in the fragment shader). The result is phantom white dots that move freely and never home. In QR mode the render shader is switched to the same `textureLoad` path so both shaders agree on the exact pixel value. Adjusting `alphaThreshold` changes the width of this disagreement zone.

### black cutoff (`blackThreshold`)
**Range:** 0 – 0.5 | **Default:** 0.05

Converts dark pixels to fully transparent, regardless of their alpha channel value. Before the alpha threshold check, the shader computes the luminance of the pixel (`0.299×R + 0.587×G + 0.114×B`). If that luminance is below this value, the pixel is treated as alpha 0 — it does not attract agents and does not receive image color in the render.

This is primarily useful for images without a proper alpha channel (JPEGs, photos) where the background is black rather than transparent. Setting this to 0 disables the check. Setting it above ~0.2 will start to affect mid-tone areas.

### edge fade (`vignetteEdge`)
**Range:** 0 – 0.5 | **Default:** 0.08

Fades the outer edges of the image rect with a smooth rectangular vignette. The value is the width of the fade band in UV units (0–1 across the image). At 0, no fade is applied and the image has a hard edge. At 0.1, the outermost 10% of each edge fades to transparent. At 0.5, the fade extends to the centre from all sides.

The fade factor is `vig = smoothstep(0, vignetteEdge, distanceFromNearestEdge)` and is applied in the compute shader's `imgAlphaAt()` function: it returns `px.a × vig`, and the homing gate is `effAlpha >= alphaThreshold`.

#### Single source of truth for homing status

The compute shader writes `agent.primed = 1.0` (homing) or `0.0` (free) into each agent's buffer slot every frame after evaluating the full primed check (luma, vignette-weighted alpha, contamination). Both the render shader and the agent shadow shader read this flag directly rather than independently re-sampling the texture. This guarantees perfect consistency across all three passes:

- No bilinear vs. nearest-neighbour mismatch (the sampler type difference no longer affects the homing decision)
- Edge-zone agents cannot end up in a "limbo" state (physically free in compute but rendering as homing in the visual passes)
- The primed check runs exactly once per agent per frame regardless of how many visual passes are active

### avoid force (`avoidForceStr`)
**Range:** 0 – 5 | **Default:** 1.0

Multiplier applied to all image-trace avoidance forces that act on free agents. Two avoidance mechanisms share this value:

- **Inside an opaque area**: the agent is pushed along the negative alpha gradient (toward the nearest transparent gap). Force = `maxSpeed × posAlpha × avoidForceStr`.
- **Near an opaque boundary**: the inward velocity component is stripped proportionally when a lookahead detects opacity ahead. Strip strength = `avoidForceStr`.

The avoidance map uses the same multiplier. At 0, avoidance is disabled and free agents pass freely through trace content. At 5, avoidance is very aggressive and agents barely enter opaque regions.

### size (`imageSize`)
**Range:** 0.05 – 1.0 | **Default:** 0.316

The image footprint as a fraction of `min(canvasWidth, canvasHeight)`. The image is always centered on the canvas. Aspect ratio is preserved: the reference dimension (the shorter side of the image) is set to `size × min(canvasW, canvasH)`, and the other dimension scales proportionally. At 1.0 the shorter image dimension spans the full shorter canvas dimension.

### show image
**Default:** off

Renders a grayscale debug overlay of the loaded image at its current size and position. Useful for checking the image placement and seeing how the black cutoff and edge fade are affecting the effective signal.

### Load image…
Opens a file picker. Any browser-supported image format (PNG, JPEG, WebP, etc.) works. The image is uploaded directly to the GPU as an `rgba8unorm` texture. Alpha-channel images (PNG) use the actual alpha; images without alpha (JPEG) have alpha = 1.0 everywhere — use `black cutoff` to make dark areas transparent.

### Clear image
Removes the loaded image. If trace text is currently entered, the text trace remains active (the composite is re-rendered with text only). If no text is present, agents return to formula-only mode immediately.

### probe distance (`probeLen`)
**Range:** 5 – 300 | **Default:** 150

Distance in canvas pixels that free agents cast a probe ahead of themselves along their current velocity. If the probe lands on a **primed** pixel — any trace pixel with alpha ≥ `alphaThreshold`, meaning an agent is homing there — a steering force redirects the free agent away before it reaches that area. Shorter values give less reaction time; longer values cause earlier, wider detours.

### probe force (`probeForceStr`)
**Range:** 0 – 200 | **Default:** 100

Strength of the steering force when a probe hits a primed pixel. The force direction is the negative alpha gradient at the probe point — pushing the agent toward the nearest gap in the trace. At 0 the probe is disabled. Higher values cause sharper detours; lower values produce gentle course corrections. Has no effect when `respawn on collide` is enabled (the agent teleports instead of steering).

### respawn on collide (`respawnOnCollide`)
**Default:** off

When enabled, a free agent whose probe hits a primed pixel is immediately **teleported to a random position on the canvas perimeter** rather than receiving a steering force. The agent's velocity is reset to zero at the new position; normal formula and wind forces resume on the next frame, so it re-enters the field from the edge.

#### How the respawn position is chosen

The entire canvas border — top, right, bottom, left edges, in that order — is treated as a single unwrapped line of length `2 × (canvasW + canvasH)`. A pseudo-random scalar in `[0, perimeter)` is computed each collision using a fast integer hash (Murmur3 finalizer) seeded by the agent's index XOR-ed with a quantised timestamp (`floor(time × 137)`). The timestamp component ensures the same agent lands at a different position on each successive collision rather than cycling back to a fixed spot.

The four edges map to contiguous segments of this line:

| Segment | Edge | Position |
|---------|------|----------|
| `[0, canvasW)` | Top | `(t, 0)` |
| `[canvasW, canvasW + canvasH)` | Right | `(canvasW, t − canvasW)` |
| `[canvasW + canvasH, 2·canvasW + canvasH)` | Bottom | `(t − canvasW − canvasH, canvasH)` |
| `[2·canvasW + canvasH, perimeter)` | Left | `(0, t − 2·canvasW − canvasH)` |

Each edge receives collision traffic proportional to its pixel length, so on a 16:9 canvas the top and bottom edges each receive roughly twice as many respawns as the left and right edges.

#### Interaction with other parameters

- **`probe distance`** still controls how far ahead the agent looks. A longer probe increases the chance of a collision hit and therefore the respawn rate.
- **`probe force`** has no effect while respawn is on — the steering path is never taken.
- **`bounceEdges`** affects what happens after the respawn: with wrapping (default) an agent placed exactly on the right edge (`x = canvasW`) wraps to `x = 0` on the next step. This is visually imperceptible since the velocity is zero at respawn.
- **Homing agents are unaffected** — the probe and respawn only run in the free-agent branch.

---

### shadow strength (`agentShadowStr`)
**Range:** 0 – 1 | **Default:** 0.20 | **Step:** 0.005

Peak opacity of the dark splat each homing agent casts beneath itself every frame. The splat is a radial gradient — fully black at the agent's centre, fading smoothly to transparent at the edge (`shadow radius`). This value sets the maximum alpha at the centre. At 0 no shadow is cast. Because many homing agents overlap in the same regions, their splats accumulate — use low values (0.05–0.30) to avoid over-darkening the field.

### shadow radius (`agentShadowRadius`)
**Range:** 0 – 300 | **Default:** 10 | **Step:** 0.5

Half-radius of each homing agent's shadow splat in canvas pixels. Each homing agent renders a quad of side `2 × radius` centred on its current position. The fragment shader applies `1 − smoothstep(0, radius, dist)` so the darkness falls off from full at the centre to zero at `radius` pixels away. Small values (5–20) produce tight, precise shadows that closely follow individual particles; large values (80–200) spread a broad dark haze across the entire trace area.

> **Performance note:** shadow rendering dispatches `agentCount × 6` vertices (one quad per agent). Non-homing agents are culled at the vertex stage (degenerate point placed outside clip space, generating zero fragments), so fragment work scales only with the number of homing agents and their covered area. Very large radii on dense simulations will still increase fragment throughput — reduce radius or agent count if frame rate drops.

#### How the shadow pass works

Shadow rendering is a dedicated render sub-pass inside the offscreen render pass, positioned between the trail fade and the particle draw. The pipeline:

1. **Vertex shader** reads `agents[agentId].primed` — the flag written by the compute shader each frame. No texture sampling is needed; the homing decision is already made. If `primed = 1.0`, the vertex places the quad centred on `agents[agentId].pos`; if `primed = 0.0`, all 6 vertices degenerate to a single out-of-clip-space point generating zero fragments.

2. **Fragment shader** computes the canvas-pixel distance from the fragment to the agent centre (using `@builtin(position).xy` against the agent's stored canvas position) and outputs `vec4(0, 0, 0, falloff × shadowStr)`.

3. **Blend mode** is standard alpha compositing (`src-alpha / one-minus-src-alpha`) so the shadow physically darkens the trail texture underneath, unlike the additive particle blend.

Because homing agents are drawn on top of the trail (with additive blend) in the subsequent particle pass, their rendered quads always appear above the shadow, giving the trace a sense of depth: dark halo behind, bright particle on top.

---

### auto clear (s) (`clearDelay`)
**Range:** 0 – 120 | **Default:** 0 (disabled)

Seconds after which user-added trace content (text or loaded image) is automatically removed. The timer starts whenever new content appears and resets whenever new content arrives. Set to 0 to disable. All content lifecycle — show, hide, QR, trace — is intended to be driven by the n8n backend via heartbeat responses. The session QR code is considered system content and is never auto-cleared.

---

## Mouse Eraser

A circular contamination zone that follows the cursor and actively clears the trace layer in real time.

### mouse eraser (`contamMouse`)
**Default:** off

When on, the mouse cursor acts as a live eraser centred on the cursor position each frame. Three effects fire simultaneously inside the circle:

1. **Trace alpha zeroed** — any homing agent whose home position falls inside the circle has its effective home alpha forced to zero, temporarily releasing it from homing. It becomes a free agent following formula and wind until the cursor moves away (the underlying GPU texture is not modified — this is a per-frame override in the compute shader).
2. **Shadow suppressed** — homing agents whose *current position* is inside the circle are culled from the shadow pass that frame, so the dark splat doesn't linger under the cursor.
3. **Free agents pushed outward** (when `eraser push` is on) — see below.

### eraser push (`contamPush`)
**Default:** on

When on and the mouse eraser is active, free agents within 1.5× the eraser radius are pushed away from the cursor with a linear force falloff (full at the cursor centre, zero at the influence boundary). When off the cursor only erases trace alpha and shadows — agent velocities are untouched, so free agents drift through the erased zone normally.

### eraser radius (`contamRadius`)
**Range:** 10 – 600 | **Default:** 150

Radius of the cursor eraser circle in canvas pixels. The erase zone matches this value exactly; the push influence zone extends to 1.5× this radius when `eraser push` is on.

---

## Avoidance map

An invisible grayscale mask uploaded from the GUI (Avoidance map → Load map…) or delivered via n8n. White areas repel free agents; black areas are transparent. Homing agents (those whose home is on an opaque trace pixel) are unaffected.

### How it works

The avoidance map is uploaded as an `rgba8unorm` GPU texture at shader binding 4. Each frame the compute shader samples the red channel at each free agent's canvas position. A 4-sample central-difference gradient is computed:

- **Inside a white zone** (sample > 0.05): push along the negative gradient (toward lower values / toward the nearest black area). Mirrors the image-trace avoidance logic.
- **Near an edge** (transparent position but gradient > 0): if the agent is heading toward a white zone, the inward velocity component is stripped proportionally (lookahead check 4 steps ahead).

The force magnitude uses the same `avoid force` multiplier as image-trace avoidance.

### scale (`avoidMapScale`)
**Range:** 0.05 – 1.0 | **Default:** 1.0

The map is always centered on the canvas. This value controls what fraction of the canvas it covers. At 1.0 the map spans the full canvas. At 0.5 it occupies the central half.

### Delivering via n8n

The `applySimParams` response accepts an `avoidMap` key:

```json
{ "avoidMap": "data:image/png;base64,iVBORw0KGgo..." }
```

Supported formats:
- **Base64 data URL** (`data:image/...;base64,...`) — self-contained in the JSON
- **HTTPS URL** (`https://...`) — sim fetches the image directly
- **`null`** — clears the active avoidance map

---

## Formula System

Both the direction and wind fields are WGSL expressions entered as text. They are compiled into the compute shader at runtime. The return value must be an **angle in radians**.

**Available variables:**

| Variable | Meaning |
|----------|---------|
| `x`, `y` | Agent canvas-pixel position |
| `cx`, `cy` | Canvas centre in pixels |
| `t` | Time in seconds (monotonically increasing) |
| `idx` | Agent index (integer, cast to float) |
| `PI` | 3.14159… |
| `TWO_PI` | 6.28318… |

A syntax error shows a red message below the input. The previous valid pipeline remains active until a valid formula is submitted.

### Direction formula

The heading angle each agent *wants* to maintain. Every frame, the agent's velocity is blended toward `vec2(cos(angle), sin(angle)) × stepLen × weight` at the `turnRate` rate. The direction formula is the agent's intention — the wind and trace layer act against it.

### Wind formula

The angle of a force vector applied to every agent every frame. The resulting force is `vec2(cos(angle), sin(angle)) × windStr`. Unlike the direction formula, wind accumulates directly into velocity (not steered toward) — it can override the direction formula given enough strength.

### idle mode (`⌂ idle`)
When on, both fields lock to fixed formulas and auto-cycle is suspended:

```
Direction: atan2(cy - y, cx - x)
Wind:      atan2(y - cy, x - cx) + sin(length(vec2(x-cx,y-cy)) * 0.008) * PI + t
```

This creates a calm inward-pull state — useful as a neutral resting state between performances.

### Auto-cycle guards

- Direction auto-cycle only fires when both `follow formula` and `auto-cycle formula` are on
- Wind auto-cycle only fires when both `enabled` and `auto-cycle formula` are on
- Both are fully suppressed while `idle` mode is active
- Neither is suppressed during QR mode — the formula keeps rotating every 30 s while the QR is showing

---

## Restart (`↺ Restart`)

Re-seeds all agents: positions are randomised from screen centre, home coordinates are reassigned, and weights are redistributed according to `weight spread`. The formula, wind state, and all other parameters are preserved. This is the only operation that resets agent positions.

---

## Remote / Swarm Inputs

Spectators open `/remote/?s=<uuid>` on their phones. The page is a dark, minimal gesture surface — no labels, no buttons at rest. Three channels feed the simulation collectively through the server's aggregation layer. No single person controls the outcome; the simulation responds to the *average* of all inputs.

The server maintains a per-room state table (one entry per connected spectator, pruned after 15 s of inactivity). Every 300 ms it computes averages and emits `collective-state` to the host simulation, where all values are smoothed with an exponential moving average (~0.8 s time constant) before being applied.

---

### Tilt — collective wind bias

**Phone gesture:** hold the phone and tilt it in any direction.
**Data sent:** `pitch` (0–1, from vertical axis) and `roll` (0–1, from lateral axis), 0.5 = neutral/flat.
**Aggregation:** server averages all active spectators' pitch and roll.
**Effect:** the averaged tilt vector is converted to a wind bias — a constant velocity contribution added directly to the formula wind each frame:

```
windBiasX = (avgRoll  − 0.5) × 2 × windStr
windBiasY = (avgPitch − 0.5) × 2 × windStr
```

When everyone tilts the same way, the field bends coherently in that direction. When tilts cancel out, the bias is zero and only the formula wind remains. The bias scales with the current `windStr` GUI value so it always feels proportional to the existing wind.

This value is written to the GPU as `windBiasX` / `windBiasY` in the `SoloParams` uniform buffer (bytes [80] and [84]).

---

### Temperature — collective color mood

**Phone gesture:** touch anywhere on the screen; the **vertical position** of your finger determines temperature.
**Data sent:** `temp` value derived from touch Y — `0` (finger at top, cold) to `1` (finger at bottom, warm).
**Aggregation:** server averages all active spectators' temperature values.
**Effect:** the smoothed average temperature tints the `fast color` (speed color) every frame by up to 65%:

| avgTemp | Color shift |
|---------|-------------|
| 0.0 | Deep blue `#0d26e6` |
| 0.5 | Your GUI `fast color` unchanged |
| 1.0 | Amber `#ff6600` |

The blend is nonlinear: the GUI color is always the neutral anchor at 0.5, fading toward cold or warm as the crowd drifts toward either extreme. This affects the fast-color only; the `base color` is unchanged.

---

### Coherence — collective order vs chaos

**Phone gesture:** touch anywhere on the screen; the **horizontal position** of your finger determines coherence.
**Data sent:** `x` value from touch position — `0` (left edge) to `1` (right edge).
**Aggregation:** server averages all active spectators' X positions.
**Effect:** the smoothed average coherence is applied as a multiplier on `turnRate` every frame:

| avgCoherence | Multiplier | Field character |
|---|---|---|
| 0.0 (all left) | 0.08× | Agents barely steer — each follows its own momentum, field dissolves into texture |
| 0.5 (centre) | 1.0× | GUI `turn rate` unchanged |
| 1.0 (all right) | 3.0× | Agents snap instantly to formula — field becomes crystalline, almost rigid |

The transition is smooth. A crowd touching left and right simultaneously averages to neutral. The effect is most visible when many spectators coordinate.

---

### Text — trace attractor

**Phone gesture:** type in the bottom input field and submit.
**Data sent:** `text` string, forwarded directly to the simulation as a `remote-event`.
**Effect:** if `VITE_N8N_BASE_URL` is set, the text is forwarded to n8n via `callN8n()` — n8n processes it and responds with what to apply (e.g. `traceText`, formulas, `status`). If n8n is not configured, the text is applied directly as the trace attractor. The last received text wins.

---

### Join burst — presence signal on the big screen

When a spectator connects, the server emits `spectator-joined` to the host simulation. This triggers a brief directional gust in the particle field:
- A random angle is chosen (so each join looks different)
- The burst vector starts at strength 2.0 and decays by 0.88× per frame
- At 60 fps the gust is fully dissipated in ~0.5 s
- No text, no notification — the field simply bends and recovers

When the same event fires, all other connected phones receive `peer-joined` and their aura dims briefly (80 ms) before fading back in.

---

### Remote page aura — per-user feedback

The atmospheric glow behind the phone screen reflects all three interaction axes simultaneously:

| Axis | Visual effect |
|------|--------------|
| Temperature (touch Y) | Hue: deep blue (top) → warm amber (bottom) |
| Coherence (touch X) | Gradient tightness: wide/diffuse (left) → narrow/focused (right) |
| Tilt | Anchor point of the gradient follows the phone's physical lean |

This gives each spectator private, immediate feedback on what they are sending — without showing them what the collective result looks like.

---

## QR Code / Session

On startup the simulation connects to the server via Socket.IO and emits `'register-host'`. The server generates a UUID, assigns the socket to that room, and emits `'session-id'` back. The URL is logged to the browser console (`[session] remote URL: ...`), then two QR codes are generated **asynchronously** — the simulation continues its intro unaffected while the bitmaps are prepared in the background.

### Small scannable QR (bottom-left UI panel)
A 120×120 px standard black-on-white QR code rendered in the formula panel (visible when the GUI is shown). Links to `/remote/?s=<uuid>`. Clicking it opens the spectator page in a new tab. This is the physically scannable one.

### Large trace QR (canvas centre)

A 512×512 QR code generated with **white modules on a transparent background**:
- `dark = #ffffffff` — QR modules are white (alpha = 1, luminance = 1)
- `light = #00000000` — quiet zone and inter-module gaps are transparent (alpha = 0)

The bitmap is stored internally as `qrBitmap` but **not loaded into the trace layer** until the intro delay has elapsed. This prevents the QR from interfering with the startup spread. Once the intro ends, the bitmap is assigned to `imageBitmap`, `isQRBitmap` is set, and the trace canvas is rendered — at that point QR mode activates.

### QR mode

QR mode is a rendering state, not a physics state. It is active only while the QR is the current trace image (`isQRBitmap = true`). It does not reseed agents and does not change any movement logic — agents continue exactly where they are.

**What changes in QR mode:**

1. **Homing** works through the standard alpha pipeline — agents whose home falls on a white QR module (`alpha ≥ alphaThreshold`) converge there at `homing speed`. Agents assigned to transparent gaps are free.

2. **Fade zone** *(optional, controlled by `QR fade zone` in Session)* — the render shader computes the signed distance from each free agent's *current position* to the QR bounding rectangle. Agents are faded to invisible over an 80 px falloff inward from the rect edge, clearing visual noise around the QR so it remains scannable. Disabled by default.

3. **No edge vignette** — the normal `vignetteEdge` smoothstep is bypassed in QR mode so the finder-pattern squares in the corners render at full brightness (they would otherwise be faded out at the image boundary and the QR would fail to decode).

4. **Nearest-neighbour sampling** — the render shader switches from bilinear (`textureSampleLevel`) to exact nearest-neighbour (`textureLoad`) for the home-pixel lookup. This matches the compute shader's `imgAlphaAt` function exactly, eliminating a sampler mismatch that would otherwise produce phantom white dots (see the `alphaThreshold` note above).

5. **Formula rotation continues** — the 30-second auto-cycle keeps firing during QR mode; a new random formula is also chosen when QR mode first activates. This keeps the swarm in motion rather than locking into a fixed attractor.

### Stuck pixels in the QR area

A visible side-effect: some particles appear to become stuck inside the transparent gaps of the QR pattern. These are **free agents trapped by the avoidance gradient**, not homing agents. The mechanism:

1. A free agent drifts into a white QR module (posAlpha > 0). The 4-sample alpha gradient points toward lower alpha — toward the nearest transparent gap. The avoidance force pushes the agent into that gap.
2. Once inside the gap, the agent is surrounded by white modules on multiple sides. The Case B edge avoidance (transparent position, gradient toward opacity) strips the inward velocity component in every direction the formula tries to steer.
3. The combined formula, wind, and avoidance forces cancel nearly to zero. If `length(vel)` drops below `0.00001`, neither the minSpeed floor nor the maxSpeed clamp applies, and the agent sits still.

This is intentional and left as-is — the trapped pixels contribute to the visual texture of the QR area.

### QR restoration

When all spectators leave or `idle restore QR (s)` seconds pass with no remote activity, `restoreQR()` is called. It re-assigns `qrBitmap` to `imageBitmap`, sets `isQRBitmap`, re-renders the trace canvas, and picks a new random formula. It is a no-op if the QR is already showing or was never generated.

### Signal routing
Spectators connect via Socket.IO and emit `user-event` messages. The server always forwards touch/text events directly to the simulation as `'remote-event'`. Tilt events are consumed server-side for aggregation and never forwarded individually.

If `VITE_N8N_BASE_URL` is set, the simulation calls n8n directly (browser HTTPS fetch) on every `remote-event`. The server is not involved in the n8n round-trip. Text events are only applied locally (without n8n) when `VITE_N8N_BASE_URL` is blank.

Each new spectator connection fires a `spectator-joined` event to the host, producing a brief visible gust in the particle field. See *Remote / Swarm Inputs — Join burst* above.

The session UUID is stable for the lifetime of the page. A socket disconnect/reconnect generates a new UUID and a new QR.

---

## Session

### QR fade zone (`qrFadeZone`)
**Default:** off

When on and QR mode is active, free agents near the QR rectangle are faded toward invisible over an 80 canvas-pixel falloff from the rect edge. This suppresses visual noise around the code to help phone cameras get a clean scan. When off, free agents render at full brightness everywhere — the QR modules are still formed correctly by homing agents, but the surrounding particle field is not cleared. Has no effect outside QR mode.

### idle restore QR (s) (`remoteTimeout`)
**Range:** 0 – 180 | **Default:** 0 (disabled)

Seconds of silence from all remote devices before the QR trace is automatically restored. Resets whenever any `remote-event` is received. Set to 0 to disable. QR show/hide is intended to be orchestrated by n8n via heartbeat responses (`showQR: true/false`).

### QR hides at N users (`maxSpectators`)
**Range:** 1 – 50 | **Default:** 1

The remote page's persistent QR code fades when the connected spectator count reaches this threshold. This value is baked into the QR URL at generation time — changing it mid-session requires the QR to be regenerated (restart the simulation).

### n8n test mode (`n8nTestMode`)
**Default:** off

When on, all n8n calls use `/webhook-test/` paths instead of `/webhook/`. This lets you use the n8n test-trigger for a workflow without activating it in production. Does not require a rebuild — toggled live in the GUI.

### heartbeat (s) (`heartbeatInterval`)
**Range:** 0 – 120 | **Default:** 5

Seconds between periodic snapshots sent to n8n at `/webhook/heartbeat` (or `/webhook-test/heartbeat` in test mode). Set to 0 to disable.

**Payload:**
```json
{
  "type":       "heartbeat",
  "room":       "<session-uuid>",
  "spectators": 3,
  "status":     "NORMAL",
  "qrStatus":   "HIDE",
  "params":     { ...all current tunable params... }
}
```

| Field | Description |
|-------|-------------|
| `room` | Session UUID assigned at socket connect — stable for the page lifetime |
| `spectators` | Live connected-device count synced from the server |
| `status` | Simulation state machine: `"NORMAL"` or `"IDLE"` |
| `qrStatus` | QR visibility: `"SHOW"` or `"HIDE"` |
| `params` | Full snapshot of every tunable parameter in the GUI |

The response is handled identically to `sim-event` — any recognised keys are applied via `applySimParams`. This is the primary channel through which n8n drives all content lifecycle: QR show/hide, trace images, formula changes, and parameter adjustments.

---

## Monitor (top-left, when GUI is visible)

```
1920 × 1080  @1.00x
60.0 fps
1 200 000 agents
```

Shows canvas resolution (physical pixels), the effective render scale, current frame rate, and active agent count.
