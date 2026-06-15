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

The glyphs are always drawn **bold**, in the active font (see **Font** below; default **Bellefair**, with a `sans-serif` fallback). The fill is always **white** (RGB 1,1,1), so agents homing to text glyphs are rendered bright white — unless a loaded image provides color underneath, in which case the image RGB shows through.

### Font (`fontFamily`)

The typeface for both the trace text and the story caption is loaded **from Google Fonts at runtime** — nothing is installed on the host machine. Default: **Bellefair**.

A **font** input sits directly below the trace text field in the formula panel. Paste anything you can copy from [fonts.google.com](https://fonts.google.com) and press **Enter** (or blur the field):

| Form | Example |
|------|---------|
| bare family name | `Playfair Display` |
| css2 family spec | `Bebas+Neue:wght@700` |
| `family=` query part | `family=Inter:wght@700` |
| full embed URL | `https://fonts.googleapis.com/css2?family=Lora…` |

`parseFontSpec()` extracts the family name (used for `ctx.font`) and builds the Google Fonts `<link>` href; if no weight axis is supplied, `wght@400;700` is added so bold renders. `loadFontSpec()` injects/updates the `<link>`, waits for the stylesheet to parse and for the glyphs to download (`document.fonts.load` — Canvas 2D will not paint with a webfont before it is ready), then re-renders the trace canvas. A bad name or network failure falls back to `sans-serif` silently.

The GUI's **font preset** dropdown (Trace folder) lists a few common Google Fonts; picking one fills the input and applies it.

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
**Range:** 1 000 – 5 000 000 | **Default:** 3 000 000

Total number of active particles. Changing this re-seeds all agents (positions and home coordinates are reassigned). The GPU buffer is always allocated at maximum size; this parameter only changes how many agents the compute dispatch and draw calls actually process.

### base speed (`stepLen`)
**Range:** 0.1 – 8 | **Default:** 2.0

The nominal step length an agent wants to travel each frame, in canvas pixels. Acts as the magnitude of the direction vector before it is blended with the current velocity. Heavier agents (high weight) travel faster; lighter agents travel slower. Think of this as the intended cruising speed when following the direction formula at full weight.

### turn rate
**Range:** 0.005 – 0.3 | **Default:** 0.04

How sharply each agent steers toward the direction formula each frame. This is a `mix` factor: `vel = mix(vel, desired, turnRate)`. At 0 the agent ignores the formula entirely and coasts on inertia. At 1 the agent snaps to the desired direction immediately. Low values produce long, sweeping curves; high values produce tight, reactive motion.


### max speed
**Range:** 1 – 15 | **Default:** 5.0

Hard speed cap in canvas pixels per frame (before dt scaling). Velocity is clamped to this magnitude every frame.

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

Can be set at boot via the `?resolution=<0-1>` URL parameter (clamped to the 0.1–1.0 range), which initialises this slider before the first frame.

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

### color 1 (`color1`)
**Default:** `#00ff00`

The first palette colour. Each particle is assigned a colour by its index (`agentId % N`, currently two colours), with no velocity interpolation.

### color 2 (`color2`)
**Default:** `#0000ff`

The second palette colour. Odd-index particles take this colour, even-index particles take `color1`.

### Game of Life

A Conway cellular automaton runs on a coarse grid. When `golEnabled` is on (it is off by default), free particles are pulled toward the live cells, so the swarm gathers on and follows the evolving patterns.

- **`golEnabled`** — mode on/off.
- **`golStrength`** (0–2) — attraction strength toward live cells.
- **`golStepInterval`** (frames) — frames between generations; higher is slower.
- **`golSpark`** (0–0.1) — random births injected each generation so the automaton never freezes into still lifes and oscillators. `0` is pure Conway.

### Freeroam lock

When `freeroamLock` is on, entering FREEROAM starts a timer, and after `freeroamLockDelay` seconds (default 30) the status reverts automatically to NORMAL. Re-entering FREEROAM, whether from the GUI or the n8n API, resets the timer. On by default.

### brightness
**Range:** 0.01 – 0.5 | **Default:** 0.08

The alpha of each rendered particle quad. Because particle blending is additive (`src-alpha / one`), lower values allow many particles to overlap without saturating to white — the accumulation is gradual. Raising this makes individual particles more visible but causes bright spots to blow out quickly in dense areas. This is the primary control for managing visual density vs. saturation.

> **Homing agents are unaffected by this slider.** Agents whose home pixel is primed always render at the full alpha of the image pixel they're assigned to (multiplied only by the edge vignette). This ensures the collective image they form reads at full intended intensity regardless of how dim free agents are set.

### additive blend (`additiveBlend`)
**Default:** off

Selects the particle blend equation:

- **On (additive):** `dst + src` — particles accumulate, bright spots can blow out to white in dense areas. Creates a glowing, luminous look.
- **Off (max blend):** `max(dst, src)` — each pixel takes the brighter of the incoming and existing value. Dense clusters never blow out; brightness saturates at the image's peak value. WebGPU max blend ignores alpha by specification; the shader pre-multiplies RGB × alpha before output to keep proximity fade working for homing agents.

### blend amount (`blendAmount`)
**Range:** 0 – 1 | **Default:** 1.0

Multiplier applied inside the fragment shader to the per-particle output, working in both blend modes. At `1.0` every particle contributes at full strength (current behaviour); at `0.0` particles render as black and disappear into the canvas.

- In **additive blend** the multiplier scales the alpha (and thus the additive contribution): lowering it reduces how strongly overlapping particles accumulate, so dense areas glow less and bright spots take more particles to reach saturation.
- In **max blend** the multiplier scales RGB before the per-channel max comparison: lowering it dims the source so the max picks a fainter colour, useful for softening the otherwise hard cap of max blend without falling back to additive accumulation.

This is the easiest single knob to dial in "how much overlapping particles blend with each other" once the blend mode is chosen.

### pixel grid (`pixelGrid`)
**Default:** off

Renders particles directly into a low-resolution `gridTex` (sized `pixelGridCells × derived height`) instead of the full-resolution offscreen accumulator. The vertex shader snaps each agent's continuous position to the centre of the cell it falls in and draws a quad that covers exactly one cell, so each particle becomes a single hard pixel; the final blit uses a nearest sampler to upscale the small texture across the canvas.

- Produces an 8-bit, chessboard-style look where motion appears as discrete cell-to-cell jumps.
- The agent shadow pass is skipped while pixel grid is on (the soft splat is incoherent with hard cells).
- Significantly cheaper than rendering full-res: the fragment shader runs on the cell grid (~90 K pixels at 700 cells, 16:9 aspect) instead of the full canvas, and the previous downsample pass is no longer needed.

### grid cells (`pixelGridCells`)
**Range:** 20 – 1000 | **Default:** 700

Number of cells along the X axis of `gridTex` when pixel grid is on. The Y-axis count is derived from the canvas aspect ratio. Higher counts give finer cells (more like a normal render), lower counts give chunkier ones. Changing this triggers a `gridTex` rebuild.

### tone black (`toneBlack`)
**Range:** 0 – 0.5 | **Default:** 0.0

Input level mapped to black in the final blit tone-mapping curve. Raising this lifts the visibility of lone particles that would otherwise sit near the `bgBlackCutoff` clamp. Values above ~0.1 visibly brighten the background noise floor.

### tone white (`toneWhite`)
**Range:** 0.1 – 4.0 | **Default:** 1.0

Input level mapped to white in the final blit tone-mapping curve. Values above 1.0 allow HDR accumulation to be compressed into the display range without hard clipping — useful with additive blend when dense clusters exceed 1.0 in the `rgba16float` offscreen buffer. Values below 1.0 boost overall brightness.

### tone gamma (`toneGamma`)
**Range:** 0.2 – 2.0 | **Default:** 1.0

Power curve applied after the tone-black/white remap. Values below 1.0 boost dark areas (mid-tone lift, more visible sparse agents). Values above 1.0 crush darks (stronger contrast, trails appear crisper). At exactly 1.0 the curve is linear.

### shadow boost (`shadowBoost`)
**Range:** 0 – 8.0 | **Default:** 0.0

Inverse-brightness boost applied during the blit pass: `mapped × (1 − mapped)^6 × shadowBoost`. This function peaks near 12% luminance and is negligible above ~60%, so it preferentially brightens the dark edge of trails and mid-tone halos without affecting bright particle cores. Useful for making faint trail structure visible without raising overall brightness.

---

## Color mode (`colorMode`)
**Values:** `NORMAL` (default) | `GRAYSCALE` | `GRAYSCALE_INVERTED`

A dropdown at the top of the GUI (between `mode` and `status`, above all folders) that selects a final-stage color treatment applied in the blit pass — after tone mapping and shadow boost, just before writing to the canvas.

| Value | Behaviour |
|-------|-----------|
| `NORMAL` | Final RGB written as tone-mapped (existing behaviour) |
| `GRAYSCALE` | RGB collapsed to luminance via Rec. 601 weights (`0.299 R + 0.587 G + 0.114 B`); output as `(luma, luma, luma)` |
| `GRAYSCALE_INVERTED` | Same luma, output as `(1 − luma, 1 − luma, 1 − luma)`. The `bgBlackCutoff` branch outputs **white** in this mode so the empty canvas reads as paper rather than tar |

**Why the blit pass and not the particle render?** The offscreen accumulation target is `rgba16float` and accumulates HDR contributions through additive blend. Inverting per particle in `render.wgsl` would map bright particles to near-zero, and additive blending of zeros produces nothing — the inverted image would collapse to background. Running the inversion in the blit pass, after the HDR has been compressed into `[0, 1]`, keeps `1 − v` well-defined regardless of how many particles overlapped.

The mode is carried over the existing `blitUB` (32-byte buffer was already only 20 bytes used; adding a `u32 colorMode` at byte offset 20 doesn't require a resize) and is mirrored to n8n via the `colorMode` field in the heartbeat. It's also accepted as a top-level `applySimParams` key, so n8n workflows can switch palettes alongside story steps.

---

## Export (screenshot)

Two flags in the **Export** GUI folder, both **off by default**, that change what the `s` key writes. They are pure CPU post-processing in `finalizeCapture()` — the live render is untouched.

### transparent bg (`exportTransparent`)

Removes the black background from the saved image. The scene is additive light on true black (and `bgBlackCutoff` floors residual trail noise to zero), so the background is genuinely `(0,0,0)` and brightness is an exact alpha mask. Per pixel, `alpha = max(r,g,b)` and the RGB is **un-premultiplied** (`rgb / alpha`) so the glow keeps its full intensity over a transparent or dark background. The QR overlay is **not** composited when this is on, since its black modules would become holes in the alpha. Output is an RGBA PNG (or a CMYK TIFF with an alpha channel when CMYK is also on).

### CMYK (TIFF) (`exportCMYK`)

PNG cannot store CMYK, so this switches the export to an uncompressed baseline **TIFF** (`.tif`, PhotometricInterpretation = Separated, InkSet = CMYK), built by `encodeCmykTiff()`. The RGB→CMYK conversion is the naive device-independent formula (`k = 1 − max(r,g,b)`; `c,m,y = (1 − channel − k)/(1 − k)`) with **no ICC profile** — a deliberate choice; the file is meant to be refined in pro print software. When `exportTransparent` is also on, a 5th sample (unassociated alpha, `ExtraSamples = 2`, `SamplesPerPixel = 5`) carries the transparency.

**Four combinations:** opaque PNG (default) · transparent RGBA PNG · opaque CMYK TIFF · CMYK TIFF + alpha.

---

## Trace

The trace layer loads a static image onto the GPU and uses it to redirect agents. The image is never rendered directly — it is only felt through collective agent density and color.

### homing speed (`magnetStr`)
**Range:** 0 – 50 | **Default:** 30.0

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

The uploaded trace image is always drawn with CSS `object-fit: cover` behaviour — centered and aspect-ratio-preserving, cropped to fill the full trace canvas. The `imageSize`, `imageX`, and `imageY` parameters no longer control image placement; they control the positioning of the **trace text overlay** on top of the image.

### show image
**Default:** off

Renders a grayscale debug overlay of the loaded image at its current size and position. Useful for checking the image placement and seeing how the black cutoff and edge fade are affecting the effective signal.

### Load image…
Opens a file picker. Any browser-supported image format (PNG, JPEG, WebP, etc.) works. The image is uploaded directly to the GPU as an `rgba8unorm` texture. Alpha-channel images (PNG) use the actual alpha; images without alpha (JPEG) have alpha = 1.0 everywhere — use `black cutoff` to make dark areas transparent.

### Clear image
Removes the loaded image. If trace text is currently entered, the text trace remains active (the composite is re-rendered with text only). If no text is present, agents return to formula-only mode immediately.

### probe distance (`probeLen`)
**Range:** 5 – 300 | **Default:** 15

Distance in canvas pixels that free agents cast a probe ahead of themselves along their current velocity. The probe samples the **shadow density texture** — a separate greyscale texture filled each frame with additive shadow splats from all homing agents. Brighter pixels mean more homing agents are converging there. Free agents steer away from the detected density. Shorter values give less reaction time; longer values cause earlier, wider detours.

### probe force (`probeForceStr`)
**Range:** 0 – 200 | **Default:** 100

Base strength of the steering force when a probe detects shadow density. The actual force applied is `probeForceStr × probeDensity`, so a lone agent barely deflects a passing free agent while a packed cluster causes a strong avoidance response. The steering direction follows the negative shadow density gradient — pushing the free agent toward the nearest gap. At 0 the probe is effectively disabled.

### respawn on collide (`respawnOnCollide`)
**Default:** off

When enabled, a free agent whose probe detects shadow density above 0.3 is immediately **teleported to a random position on the canvas perimeter** rather than receiving a steering force. The agent's velocity is reset to zero at the new position; normal formula and wind forces resume on the next frame, so it re-enters the field from the edge.

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

2. **Fragment shader** computes the canvas-pixel distance from the fragment to the agent centre (using `@builtin(position).xy` against the agent's stored canvas position) and outputs `vec4(0, 0, 0, falloff × shadowStr × proximityT)`.

3. **Blend mode** is standard alpha compositing (`src-alpha / one-minus-src-alpha`) so the shadow physically darkens the trail texture underneath, unlike the additive particle blend.

Because homing agents are drawn on top of the trail (with additive blend) in the subsequent particle pass, their rendered quads always appear above the shadow, giving the trace a sense of depth: dark halo behind, bright particle on top.

---

### champions (`championsEnabled`, `champions`)
**enabled:** on by default · **1 in N:** 1 – 1500, default 700, step 1

The **Champions** GUI folder gathers the whole feature. `enabled` is the master on/off; while off, champions are fully inert (the UBs receive `champions = 0`). `1 in N` selects champion agents by modulo on the agent index: every agent where `agentId % N == 0` becomes a champion. So `2` makes one in every two a champion, `10` one in ten, `1` makes every agent a champion.

A champion **moves exactly like any other agent** — there is no change to the compute/movement step. The only difference is in the agent-shadow pass: a champion casts the same dark splat described above **constantly, even while free**, at constant full strength (`proximityT = 1.0`), so it leaves a persistent shadow trail under itself regardless of homing. When a champion happens to be homing, it behaves like every other homing agent.

Implementation notes:
- Driven entirely from the shadow shader (`agentShadow.wgsl`) via the `champions` field in `AgentShadowParams` (the former `_p2` slot — no buffer resize). The `&&` short-circuit avoids a modulo-by-zero when disabled.
- The **visual** shadow pass now runs when an image is loaded **or** champions are active, so champion trails appear even with no trace image.
- Champions are **excluded from the deterrent density pass** (`densityEmit`), so they leave a visible trail but do not repel the rest of the swarm. They share the **shadow strength** and **shadow radius** controls with homing shadows.

### champion size (`championSize`)
**Range:** 0.1 – 40 | **Default:** 15 | **Step:** 0.1

Point size for a champion **while it is free**, set in the render shader (`render.wgsl`) — much larger than the normal `agent size` (1.3) by default (15) so champions read as bold, distinct dots. It applies only when the champion is not homing: a homing champion renders at the normal `agent size` like every other homing agent, so the collective image it helps form stays clean. Carried in `SoloRenderParams` (`champions` u32 + `championSize` f32 appended at bytes 144/148; the render UB grew 144 → 160). Has no effect in pixel-grid mode, where every particle is one cell.

---

### proximity range (`homingProximityRange`)
**Range:** 0 – 2000 | **Default:** 300 | **Step:** 10

Canvas pixel distance over which a homing agent fades from `proximity min alpha` to fully visible. An agent that just became homing and is 300+ px from its home position renders at minimum alpha; as it closes in, both its rendered color and its shadow increase in opacity, reaching full strength at distance 0 (exactly at home). This makes the image form gradually and visually from the arriving swarm rather than popping in at full brightness.

Set to 0 to disable the fade entirely (all homing agents render at full opacity immediately).

### proximity min alpha (`homingMinAlpha`)
**Range:** 0 – 1 | **Default:** 0.1 | **Step:** 0.01

The minimum alpha applied to a homing agent that is at or beyond `proximity range` from its home. At 0 agents are invisible when they start homing and gradually appear as they arrive. At 1 all homing agents are always fully visible regardless of distance (equivalent to disabling the proximity fade). Values around 0.05–0.15 give a natural emergence effect without agents fully disappearing when the image changes.

This multiplier applies to both the rendered particle alpha and the shadow alpha, keeping the two visually consistent.

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

### chaos threshold — hide above (`chaosAvoidMapThreshold`)
**Range:** 0 – 1 | **Default:** 0.6

When `smoothChaos` exceeds this value, the avoidance map is suppressed: the compute shader receives `avoidMapActive = 0` and agents ignore it, as if no map were loaded. The texture itself stays resident on the GPU — when chaos drops back below the threshold the map resumes instantly without any network round-trip. This prevents the map from appearing at exactly the moment when chaos is peaking and the field looks most turbulent.

### scale (`avoidMapScale`)
**Range:** 0.05 – 1.0 | **Default:** 1.0

The map is always centered on the canvas. This value controls what fraction of the canvas it covers. At 1.0 the map spans the full canvas. At 0.5 it occupies the central half.

### invert colors (`avoidMapInvert`)
**Default:** off

When on, the avoidance map is read inverted at the sample site — `1.0 − r` for the compute shader's avoidance signal, and `vec3(1 − r, 1 − g, 1 − b)` for the per-particle color sample (see below). This flips the meaning of the source image: areas that were white (strong avoid / bright color) become weak / dark, and vice versa.

The flip is applied once, at each read site, so every downstream consumer (the gradient, the lookahead deflection, the force scaling, the per-particle color) sees the inverted signal without separate branches.

### sample color (`avoidMapSampleColor`)
**Default:** off

When on, **non-homing** particles take their base color from the avoid-map pixel directly underneath them, using the same cover-fit + scale mapping as the avoidance force. The render shader samples `avoidMapTex` at the agent's canvas position (binding 5, mirrored from the compute shader's binding 4) and uses the RGB value as the base.

- The sample is performed in the vertex shader (one read per particle) and respects `invert colors`.
- Homing agents are skipped — they don't react to the avoid map at all, so colour-by-avoid-map wouldn't be coherent for them; the fragment shader also overrides with the trace image. Spectator-assigned particles whose slot is *active* keep their explicit per-spectator colour; the sample only replaces the default "speed-blended base" path.
- If the agent's position falls outside the avoid map's visible area (or no map is loaded), the sample is ignored and the default base/speed mix is used.

### fixed color (`avoidMapFixedColor`)
**Default:** off

Modifier on top of `sample color`. When off, the sampled RGB is used as the *base* and is then mixed with the speed colour (just like the global base colour normally would be), so faster particles still drift toward the speed colour. When on, the sampled pixel becomes the particle's final colour with no speed blend — the swarm reads as a direct, frozen copy of the avoid map's colours wherever it overlaps with the map.

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

Spectators open `/remote/?s=<uuid>` on their phones. The page features a virtual joystick centered on screen and a color picker always visible at the top. A star field canvas (65 stars drifting counter to joystick direction, streaking on fast moves) is visible only in DRAW step status. The join button reads "swarm" and the device message is shown large and centered.

The server maintains a per-room state table (one entry per connected spectator, pruned after 15 s of inactivity).

---

### Motion / Shake

**Phone gesture:** move or shake the phone.
**Data sent:** `chaos` (0–1), derived from `devicemotion` acceleration magnitude, decaying over time at rest.
**Routing:** forwarded to the sim as `remote-event`; the server aggregates all spectators' chaos values into `avgChaos` in the `collective-state` broadcast.
**Effect:** two simultaneous effects.
1. **Aura feedback** — chaos level modulates the vignette intensity of the atmospheric gradient on the spectator's own phone screen. More motion = darker, more intense aura edge.
2. **Collective chaos** — the server averages all active spectators' chaos and emits `avgChaos`. The simulation smooths this and uses it to drive noise magnitude, avoidMap suppression (above `chaosAvoidMapThreshold`), chaos color fraction, and all synth parameters.

**Shake detection** (used only for color reset): acceleration magnitude above 22 m/s² with a 1.2 s cooldown. Triggers `color-pick` + `shake` events — resets the spectator's color to the simulation base palette.

---

### Joystick — personal spawner

**Phone gesture:** use the virtual joystick centered on the remote page.
**Data sent:** `dx`, `dy`, `magnitude` (0–1), `velocity` (0–1, normalized finger speed). Throttled to 300 ms; velocity is computed from finger speed.
**Routing:** forwarded directly as `remote-event` (not aggregated server-side).
**Effect:** moves the spectator's personal spawner position across the canvas each frame. Each frame the spawner advances along the smoothed joystick direction at `spawnerSpeed × magnitude × (1 + velocity × spawnerVelocityBoost)`. Direction lerps toward the joystick target at `spawnerSteering` (1/s). Spawner position wraps toroidally. After `spawnerInactiveTimeout` seconds of no joystick input the spawner deactivates; on re-activation it receives a new random canvas position. Agents from that spectator's partition teleport to the spawner position at scaled spawn chance each frame.

---

### Text — story input

**Phone gesture:** a centered text input panel appears on the phone screen.
**When shown:** only when `stepStatus` is `"TEXT"` (sent by n8n via the `remote-ui` socket event). Hidden at all other times — spectators cannot open it manually.
**Data sent:** `text` string via `story-text` socket event. Forwarded to n8n as a `sim-event` of type `"text-input"`.
**After submit:** the panel collapses automatically and the phone returns to its rest state.

### Shake — color reset

**Phone gesture:** shake the phone sharply.
**Detection:** acceleration magnitude > 22 m/s² with a 1.2 s cooldown. Only active in DRAW step status.
**Effect:** resets the spectator's particle color to the simulation's current base color, temporarily blending their slice of the field back into the swarm. The personal color is restored the next time the spectator touches the joystick.
**Feedback:** 60 ms haptic vibration.

---

### Individual identity — personal swarm

#### The slot system

When a spectator joins, the server emits `spectator-joined` with their persistent UUID. The simulation creates an entry in `activeSlots[]` — a JavaScript array, one object per connected spectator (max 16). Each entry holds all per-spectator state: color, joystick-driven spawner position, joystick input, and tilt-derived wind vector.

```js
{
  spectatorId: "uuid",
  colorR, colorG, colorB,           // assigned palette color
  spawnerX, spawnerY,                // joystick-driven spawner position (0–1 each axis)
  spawnerLocationActive,             // 1 while joystick is active (not timed out)
  dx, dy, magnitude,                 // last joystick direction + magnitude
  velocity,                          // normalized finger speed (0–1)
  _smoothDx, _smoothDy,              // sim-side smoothed direction (not uploaded to GPU)
  lastInputTime                      // timestamp of last joystick event (ms)
}
```

Every time any field changes (join, leave, joystick, tilt), `uploadSpectatorSlots()` serializes the entire array into a flat 768-byte `ArrayBuffer` and writes it to `spectatorSlotsBuf` — a GPU storage buffer bound at `@binding(6)` in the compute shader and `@binding(4)` in the render shader. The GPU always sees the full current state.

The buffer holds 16 fixed slots of 48 bytes each:

```
slot 0: bytes   0–47   (first spectator)
slot 1: bytes  48–95   (second spectator)
…
slot 15: bytes 720–767
```

#### Agent partitioning

Each agent's slot assignment is computed on the GPU at every frame with a single modulo:

```wgsl
let slot = spectatorSlots[agentIndex % spectatorCount]
```

With 2 spectators and 2 000 000 agents:
- agent 0 → slot 0, agent 1 → slot 1, agent 2 → slot 0, agent 3 → slot 1 …

Each spectator owns exactly `agentCount / spectatorCount` agents. The assignment is **interleaved by index, not by canvas position** — each spectator's agents are spread uniformly across the entire canvas, not grouped into a region. Every spectator's color is visible everywhere in the field at all times.

When spectators join or leave, `spectatorCount` changes and the modulo re-partitions all agents instantly — no re-seeding required.

The GPU SpectatorSlot struct now has `spawnerX`, `spawnerY`, `spawnerLocationActive` instead of `touchX`, `touchY`, `isTouching`.

#### What each shader does with the slot

- **compute.wgsl** — reads `spawnerX`/`spawnerY`/`spawnerLocationActive` to probabilistically teleport the agent to the spawner position. Homing agents (primed = 1) are exempt from teleport.
- **render.wgsl** — reads `colorR`/`colorG`/`colorB` to replace the base color for that agent. The color blends toward the global `fast color` at high speed, exactly as the base color would.

#### Per-spectator interactions

**Color**: assigned from a fixed 16-color palette on join. Immediately pushed to the spectator's phone via `device-message`, overriding the aura color — a private visual confirmation of which slice is theirs.

**Joystick-spawn**: while a spectator's spawner is active (joystick in use and not timed out), a fraction of their assigned agents teleport to the spawner position each frame. The effective spawn chance is `spectatorSpawnChance × activeUsers × spectatorSpawnMultiplier` (capped at 1.0). When the joystick is idle for `spawnerInactiveTimeout` seconds the spawner deactivates and spawning stops.

**Shake-color**: when a spectator shakes the phone, their assigned agents' color is temporarily reset to the simulation's base color. The personal color is restored when the spectator next uses the joystick.

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

The atmospheric glow behind the phone screen reflects the spectator's color selection and tilt:

| Axis | Visual effect |
|------|--------------|
| Color (swatch or n8n push) | Center hue of the radial gradient |
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

### QR overlay mode (`qrOverlay`)
**Default:** on

When on (default), the QR is displayed on a **separate 2D canvas overlay** (`position:fixed; inset:0; z-index:10`) rather than being baked into the trace texture. This has two key benefits:

1. **Agents are freed from the QR area.** Because the QR is not in the trace texture, no agents home to QR pixels. The whole canvas is available to the simulation; agents fill the space naturally.
2. **The QR is sharp and always scannable.** The overlay canvas is drawn at full device resolution with `image-rendering: pixelated`, independent of the simulation render scale.

The overlay fades in and out with a 0.6 s CSS `opacity` transition. When the QR is hidden, the overlay is transparent and the simulation runs unaffected.

When `respawnOnQR` is on (default), free agents that stray into the QR bounding box are stochastically teleported to a random canvas edge each frame, keeping the code area clear of visual noise. Homing agents are exempt. See `respawnOnQR` and `qrRespawnChance` in the Session section.

When `QR overlay` is **off**, the original behaviour is restored: the QR is baked into the trace texture and agents home to the white modules, forming the QR pattern collectively.

### QR mode

QR mode is a rendering state, not a physics state. It is active only while the QR is the current trace image (`isQRBitmap = true`). It does not reseed agents and does not change any movement logic — agents continue exactly where they are.

**What changes in QR mode:**

1. **Homing** works through the standard alpha pipeline — agents whose home falls on a white QR module (`alpha ≥ alphaThreshold`) converge there at `homing speed`. Agents assigned to transparent gaps are free.

2. **No edge vignette** — the normal `vignetteEdge` smoothstep is bypassed in QR mode so the finder-pattern squares in the corners render at full brightness (they would otherwise be faded out at the image boundary and the QR would fail to decode).

4. **Nearest-neighbour sampling** — the render shader switches from bilinear (`textureSampleLevel`) to exact nearest-neighbour (`textureLoad`) for the home-pixel lookup. This matches the compute shader's `imgAlphaAt` function exactly, eliminating a sampler mismatch that would otherwise produce phantom white dots (see the `alphaThreshold` note above).

5. **Formula rotation continues** — the 30-second auto-cycle keeps firing during QR mode; a new random formula is also chosen when QR mode first activates. This keeps the swarm in motion rather than locking into a fixed attractor.

### Stuck pixels in the QR area

*(Only relevant when `QR overlay` is off — in overlay mode agents are not homing to the QR.)*

A visible side-effect: some particles appear to become stuck inside the transparent gaps of the QR pattern. These are **free agents trapped by the avoidance gradient**, not homing agents. The mechanism:

1. A free agent drifts into a white QR module (posAlpha > 0). The 4-sample alpha gradient points toward lower alpha — toward the nearest transparent gap. The avoidance force pushes the agent into that gap.
2. Once inside the gap, the agent is surrounded by white modules on multiple sides. The Case B edge avoidance (transparent position, gradient toward opacity) strips the inward velocity component in every direction the formula tries to steer.
3. The combined formula, wind, and avoidance forces cancel nearly to zero. If `length(vel)` drops below `0.00001`, neither the minSpeed floor nor the maxSpeed clamp applies, and the agent sits still.

This is intentional and left as-is — the trapped pixels contribute to the visual texture of the QR area.

### QR restoration

When all spectators leave or `idle restore QR (s)` seconds pass with no remote activity, `restoreQR()` is called. It re-assigns `qrBitmap` to `imageBitmap`, sets `isQRBitmap`, re-renders the trace canvas, and picks a new random formula. It is a no-op if the QR is already showing or was never generated.

### Signal routing
Spectators connect via Socket.IO and emit `user-event` messages. The server always forwards joystick/text events directly to the simulation as `'remote-event'`. Tilt events are consumed server-side for aggregation and never forwarded individually.

If `VITE_N8N_BASE_URL` is set, the simulation calls n8n directly (browser HTTPS fetch) on every `remote-event`. The server is not involved in the n8n round-trip. Text events are only applied locally (without n8n) when `VITE_N8N_BASE_URL` is blank.

Each new spectator connection fires a `spectator-joined` event to the host, producing a brief visible gust in the particle field. See *Remote / Swarm Inputs — Join burst* above.

The session UUID is stable for the lifetime of the page. A socket disconnect/reconnect generates a new UUID and a new QR.

If two browser windows open with the same UUID (set manually via `?s=<uuid>`), both are registered as hosts for that room. All host-directed events are broadcast to both. This is intended for multi-display installations.

---

## Session

### agent share (%) (`spectatorAgentShare`)
**Range:** 0 – 100 | **Default:** 100

Percentage of agents (by index, starting from 0) that are assigned to spectators. The remaining agents at the top of the index range always behave as pure simulation agents — they use the global base color, follow formula and global wind, and are never interrupted by the joystick spawner.

- `100` — all agents follow spectators (previous behaviour)
- `50` — the lower half of the index space is spectator-controlled; the upper half is free to form trace images undisturbed
- `0` — spectators are still connected and their input is received, but zero agents respond to it

The boundary is applied every frame with no re-seeding. All three spectator mechanics are gated: tilt wind, joystick spawner, and per-spectator color.

---

### spawn chance (base) (`spectatorSpawnChance`)
**Range:** 0 – 1 | **Default:** 0.01

Base per-frame probability used to compute the effective spawn chance. The actual probability applied each frame is:

```
effectiveSpawnChance = spectatorSpawnChance × activeUsers × spectatorSpawnMultiplier
```

(capped at 1.0). The check runs independently per agent every frame. Only fires while the spectator's spawner is active (`spawnerLocationActive`). Homing agents (those currently converging on a trace pixel) are **never interrupted** by this mechanic — they continue homing regardless of their spectator assignment.

Raise to 0.05–0.1 for a more explosive, immediately-visible effect; lower to 0.005 for a slow, cumulative drift.

---

### spawn multiplier (`spectatorSpawnMultiplier`)
**Range:** 0 – 10 | **Default:** 3

Scales the effective spawn chance by the number of active users. Combined with `spectatorSpawnChance` and the live `activeUsers` count in the formula above, this ensures the spawner effect remains perceptible even when only one user is connected while preventing over-saturation at high user counts (the product is capped at 1.0).

---

### spawner speed (`spawnerSpeed`)
**Range:** 0 – 2 | **Default:** 0.3

Canvas fractions per second the spawner position moves at full joystick deflection (magnitude = 1). The actual speed each frame is `spawnerSpeed × magnitude × (1 + velocity × spawnerVelocityBoost)`.

---

### spawner velocity boost (`spawnerVelocityBoost`)
**Range:** 0 – 5 | **Default:** 2.0

Extra speed multiplier applied when the joystick is moved fast. At 2.0, a fast flick (velocity ≈ 1) triples the effective speed relative to a slow drag (velocity ≈ 0). Allows precise slow positioning and sweeping fast throws from the same joystick.

---

### spawner steering (`spawnerSteering`)
**Range:** 1 – 20 | **Default:** 6

Direction lerp rate in 1/s. Lower values produce wide, sweeping arcs as the spawner takes time to turn; higher values allow tighter, more responsive turns. Prevents sharp angle reversals that would look like teleportation.

---

### spawner timeout (s) (`spawnerInactiveTimeout`)
**Range:** 1 – 30 | **Default:** 5

Seconds of joystick silence before the spawner deactivates. On re-activation after a timeout, the spawner is assigned a new random canvas position.

### release burst / fireworks (`releaseBurstSpeed`)
**Range:** 0 – 100 | **Default:** 30 | **Step:** 1

The moment a spectator **stops** controlling (joystick released, or gone silent past `spawner timeout`), all of that spectator's free agents are flung outward in random directions — a fireworks burst — then the normal max-speed clamp and steering rein them back into the flow over the next fraction of a second. This value is the initial scatter speed (canvas px/frame); `0` disables the effect.

Implementation: the release transition (both the explicit "joystick up" event and the inactivity timeout) sets a one-shot `burst` flag + random seed on the spectator's slot (the slot's former `_p1`/`_p2` padding). The compute shader, for that slot's assigned free agents, overrides velocity with `randomDir × releaseBurstSpeed`. The flag is cleared the frame after the compute consumes it, so it fires exactly once per release. Homing agents (those forming a loaded image) are not affected.

---

### random teleport chance (`randomTeleportChance`)
**Range:** 0 – 0.02 | **Default:** 0.003

Per-frame probability that any free agent jumps to a completely random canvas position, independent of the spectator spawner system. Creates a slow, background redistribution that prevents dead zones accumulating during long steady-state periods. Has no effect on homing agents.

### random teleport on avoidMap only (`randomTeleportOnAvoidMap`)
**Default:** on

When on, `randomTeleportChance` is active only while an avoidance map is loaded. This ties the redistribution behaviour to the presence of the map — the random jumps help agents explore the map's repulsion structure. When off, random teleport fires regardless of map state.

### respawn on QR (`respawnOnQR`)
**Default:** on

When on, free agents that wander into the QR code bounding box are stochastically teleported to a random canvas edge each frame, keeping the code area clear of drifting particles. Homing agents (those forming the QR pattern when `qrOverlay` is off) are exempt. Has no visible effect when `qrOverlay` is on and the QR is hidden.

### QR respawn chance (`qrRespawnChance`)
**Range:** 0 – 0.1 | **Default:** 0.01

Per-frame probability that a free agent inside the QR bounding box is respawned. Only active when `respawnOnQR` is on.

### vote duration (s) (`voteDuration`)
**Range:** 5 – 120 | **Default:** 30

Seconds the vote panel stays open on spectator phones. Both the remote devices and the simulation's main display show a live countdown. When the timer expires the sim fires a `vote-result` event to n8n (`/webhook/sim-event`) containing the winning option label and whether it was A or B, then the remote devices automatically revert to their rest state (joystick).

### idle restore QR (s) (`remoteTimeout`)
**Range:** 0 – 180 | **Default:** 0 (disabled)

Seconds of silence from all remote devices before the QR trace is automatically restored. Resets whenever any `remote-event` is received. Set to 0 to disable. QR show/hide is intended to be orchestrated by n8n via heartbeat responses (`showQR: true/false`).

### QR hides at N users (`maxSpectators`)
**Range:** 1 – 50 | **Default:** 1

The remote page's persistent QR code fades when the connected spectator count reaches this threshold. This value is baked into the QR URL at generation time — changing it mid-session requires the QR to be regenerated (restart the simulation).

### n8n enabled (`n8nEnabled`)
**Default:** on

Runtime kill-switch for all n8n traffic — the periodic heartbeat, the per-event `sim-event` fetches, and the text-event fallback path that uses n8n presence to decide whether to show submitted text locally. Toggling it off stops sending without unsetting `VITE_N8N_BASE_URL` or reloading; toggling it back on restarts the heartbeat timer (the GUI handler calls `restartHeartbeat()`).

The `?n8n=off` URL parameter (and its aliases `false`, `0`, `disabled`) flips this flag to `false` at boot. Setting it via URL is equivalent to toggling it off in the GUI immediately after load.

### n8n test mode (`n8nTestMode`)
**Default:** off

When on, all n8n calls use `/webhook-test/` paths instead of `/webhook/`. This lets you use the n8n test-trigger for a workflow without activating it in production. Does not require a rebuild — toggled live in the GUI.

### heartbeat (s) (`heartbeatInterval`)
**Range:** 0 – 120 | **Default:** 20

Seconds between periodic snapshots sent to n8n at `/webhook/heartbeat` (or `/webhook-test/heartbeat` in test mode). Set to 0 to disable.

The fetch timeout for each heartbeat request scales automatically with this value: **90% of the interval, minimum 5 s**. At the default interval of 5 s the timeout is 5 s (unchanged); at 20 s it becomes 18 s; at 60 s it becomes 54 s. This prevents heavy n8n responses (e.g. audio payloads loaded from disk) from being aborted when the interval is set longer than 5 s.

**Payload:**
```json
{
  "type":            "heartbeat",
  "room":            "<session-uuid>",
  "mode":            "STORY",
  "colorMode":       "NORMAL",
  "status":          "NORMAL",
  "qrStatus":        "HIDE",
  "step":            2,
  "stepStatus":      "VOTE",
  "optionA":         "Casa",
  "optionB":         "Giardino",
  "votesA":          3,
  "votesB":          1,
  "storyVoteResult": "Casa",
  "userCount":       4,
  "params":          { "...": "all current tunable params" },
  "...serverEchoFields": "any lightweight fields from the last heartbeat response are spread here"
}
```

| Field | Description |
|-------|-------------|
| `room` | Session UUID assigned at socket connect — stable for the page lifetime |
| `mode` | Top-level session mode: `"STORY"` or `"SHOWCASE"` |
| `colorMode` | Final-stage color treatment: `"NORMAL"`, `"GRAYSCALE"`, or `"GRAYSCALE_INVERTED"` (applied in the blit pass) |
| `status` | Simulation state: `"NORMAL"`, `"FREEROAM"`, or `"DOT"` |
| `qrStatus` | QR visibility: `"SHOW"` or `"HIDE"` |
| `step` | Current story step ID as sent by n8n; `null` when not in story mode |
| `stepStatus` | Current spectator interaction mode: `"IDLE"`, `"DRAW"`, `"VOTE"`, `"TEXT"`, `"RAISE"`, `"PULSE"`, or `"WAVE"` |
| `optionA` / `optionB` | Vote option labels; dirty — hold last known value even outside a vote |
| `votesA` / `votesB` | Raw vote counts; dirty, never auto-reset |
| `storyVoteResult` | Winning option label while a vote is running; `null` if tied or no vote active |
| `userCount` | Live connected spectator count |
| `params` | Full snapshot of every tunable parameter in the GUI |
| *(echo fields)* | Lightweight fields from the server's last heartbeat response spread at root. Media fields excluded. Cleared on page reload. |

The response is handled identically to `sim-event` — any recognised keys are applied via `applySimParams`. This is the primary channel through which n8n drives all content lifecycle: QR show/hide, trace images, formula changes, parameter adjustments, and story step delivery.

---

## Story Mode

Story mode layers a scripted, sequential narrative on top of the simulation. The sim has no built-in story state machine — n8n owns sequencing and branching; the sim just plays the current step and reports back when interactions complete.

n8n drives story progression entirely through heartbeat responses and `sim-event` reactions. The heartbeat payload includes `mode` and `step`, so n8n can detect when the sim is in story mode and when a step has or hasn't started, and respond accordingly. Event-driven moments (vote results) arrive via `/webhook/sim-event` and n8n responds with the next step.

### Step fields (sent by n8n in any `applySimParams` response)

| Field | Type | Description |
|-------|------|-------------|
| `step` | any | Step identifier — echoed back in every heartbeat so n8n can correlate. Receiving a new `step` resets vote state and sets `stepStatus` to `"IDLE"` unless overridden. When no step is active (`null`), the remote always shows the joystick regardless of `stepStatus` |
| `stepStatus` | `"IDLE"` \| `"DRAW"` \| `"VOTE"` \| `"TEXT"` | Spectator interaction mode for this step. Only meaningful while a step is active — if no step is set, the remote keeps the joystick visible. Defaults to `"IDLE"` when a new step arrives without an explicit value |
| `optionA` | string | Label for the first vote option — required when `stepStatus` is `"VOTE"` |
| `optionB` | string | Label for the second vote option — required when `stepStatus` is `"VOTE"` |
| `caption` | string \| null | Subtitle text drawn at the bottom of the simulation canvas as a particle attractor (white glyphs, same pipeline as `traceText`). Word-wrapped to 80 % canvas width. `null` or `""` clears it |

A minimal narration step:
```json
{ "step": 1, "stepStatus": "IDLE", "caption": "I am a voice from the future.", "status": "FREEROAM" }
```

A vote step:
```json
{ "step": 2, "stepStatus": "VOTE", "optionA": "House", "optionB": "Garden", "caption": "Where do we look?" }
```

A text input step:
```json
{ "step": 3, "stepStatus": "TEXT", "caption": "Scrivi una parola." }
```

### `stepStatus` — spectator interaction modes

| Value | Remote UI | Gesture surface |
|-------|-----------|-----------------|
| `"IDLE"` | Atmospheric surface, no interaction | All gestures passive |
| `"DRAW"` | Atmospheric surface, full interaction | Joystick, color picker, shake all active |
| `"VOTE"` | Two full-screen buttons labelled `optionA` / `optionB` with live countdown | Joystick hidden; vote buttons active |
| `"TEXT"` | Centered text input panel | Keyboard active; joystick and vote panel hidden |
| `"RAISE"` | Swipe-up panel with ring animation | Swipe upward on the panel to trigger (one-shot) |
| `"PULSE"` | Full-screen tap surface with pulsing ring | Tap anywhere to send pulse energy to the swarm |
| `"WAVE"` | Shake panel with ring animation | Shake the phone to trigger (magnitude > 22 m/s²) |

When `stepStatus` changes, the sim broadcasts a `remote-ui` Socket.IO event to all spectators. The remote page switches its interface immediately.

### Vote mechanics

- Each spectator can vote once per step; subsequent taps overwrite their previous vote
- Server counts A vs B votes and emits a running `story-vote-update` tally to the host sim after every change
- The sim tracks the current leader in `storyVoteResult`
- Both the simulation display and each remote phone show a live countdown (`voteDuration` seconds)
- When the timer expires, the sim POSTs `{ "type": "vote-result", "winner": "A"|"B"|null, "winning_option": "..." }` to `/webhook/sim-event`. n8n uses this to advance the story to the next step
- Remote phones revert to rest state automatically when the timer ends
- Votes are cleared when a new `step` is received

### Caption

The `caption` field draws text at the bottom of the simulation canvas using the same white-glyph-on-transparent-background technique as `traceText`. Agents home to the letterforms, making the caption feel like part of the particle field rather than a DOM overlay. It is rendered as a separate layer below the QR (if visible) and persists until explicitly cleared.

**`captionSize`** controls the font size as a fraction of the canvas height. **Default:** `0.035`. Higher values produce larger, coarser glyphs; lower values produce finer text that may be harder to form at low agent counts.

---

## Audio

### Generative synth (Tone.js)

A procedural audio engine (`src/synth.js`) activates when the user first interacts with the page (same gesture that unlocks the Web Audio API). It runs four layered voices driven entirely by the collective state of connected spectators — updated every 200 ms from EMA-smoothed versions of the server's `collective-state` broadcast.

| Layer | Sound | Collective parameter | Range |
|-------|-------|---------------------|-------|
| Drone | Sine sub-bass A1, always on | chaos → volume | -18 to -24 dB |
| Noise | Pink noise bandpass 900 Hz | chaos → gain | silent at harmony, loud at chaos |
| Pad | Sawtooth chord [A2 E3 A3 C4 E4 G4] + reverb/chorus | chaos → filter cutoff + volume; tilt → LFO amplitude | emerges below chaos 0.6 |
| Arp | Random A minor scale, Tone.Sequence + delay | chaos → volume; temperature → BPM | emerges below chaos 0.35; 80–140 BPM |

The **pad LFO** (filter cutoff sweep) frequency is driven by `(1 − chaos)`: nearly motionless at full chaos, oscillating at ~2 Hz at harmony. LFO amplitude is also suppressed at high chaos and deepens with physical phone tilt.

At full chaos (no spectators) the noise layer dominates. As the room converges (low chaos) the pad and arp emerge and the noise recedes. When all spectators disconnect the synth resets to chaos=1.

The engine uses `setTargetAtTime` rather than `rampTo` for all parameter transitions — `rampTo` triggers a Tone.js internal `setRampPoint` call that injects `EPS = 1e-7` into the AudioParam timeline, crashing on certain AudioParam configurations. `setTargetAtTime` avoids this entirely.

---

### Web Audio analyser

The simulation uses the Web Audio API to route sound through an `AnalyserNode`. Every frame, `getVolume()` reads a smoothed RMS value (0–1) from the analyser. This value **leans the base palette toward `color2`** in the render shader — louder audio = more color2-dominant swarm — scaled by `audio → color2` (`color2AudioStr`). Three sources share the same analyser simultaneously: the microphone (when enabled), the voiceover track, and the background track.

### audio → color2 (`color2AudioStr`)
**Range:** 0 – 1 | **Default:** 1.0 | **Step:** 0.01

How strongly room audio pushes the palette toward `color2`. The render shader mixes each free agent's base color (`color1`/`color2` by index) toward `color2` by `getVolume() × color2AudioStr`: at silence nothing changes (the normal `color1`/`color2` split shows), at peak volume the whole palette reaches `color2` (at strength 1.0). Set to 0 to disable the audio→color reaction entirely. Spectator-assigned colors and avoid-map sampled colors are not affected. (Audio no longer modulates brightness.)

### ch1: synth vol (`synthBusVol`)
**Range:** −30 – +6 dB | **Default:** 0 dB

Master volume for the Tone.js generative synth channel (drone + noise + pad + arp). Adjusting this does not affect the simAss radio chain. Change takes effect immediately without interrupting the synthesis.

### ch2: music vol (`musicBusVol`)
**Range:** −30 – +6 dB | **Default:** 0 dB

Master volume for the simAss radio chain (fetched ambient music + static noise). Independent of ch1. Useful for balancing the two channels in the room. Change takes effect immediately even during fade transitions.

---

### simAss radio chain

A second audio stream that plays only while spectators are connected. Fetches MP3 tracks from `/simAss-audio` (served from `simAss/music/`) and routes them through a chaos-driven degradation chain before reaching the speaker, creating a "radio with no reception" effect at high chaos.

**Signal path:**
```
Tone.Player
  → lowpass filter     (4000 Hz → 400 Hz as chaos rises)
  → Tone.Distortion    (0 → 0.65)
  → Tone.Tremolo       (depth 0 → 0.85; rate 2 → 8 Hz)
  → Tone.Reverb        (wet 0.15 → 0.85)
  → chaos volume       (−3 dB → −15 dB)
  → fade gain          (0 = off, 1 = present — used for in/out transitions)
  → music bus (ch2)
  → destination

white noise → bandpass 2 kHz → static gain (0 → 0.04) → fade gain
```

**Fade behaviour on user join/leave:**
- First spectator joins: music starts with a fade-in (exponential, `setTargetAtTime`).
- Last spectator leaves: music fades out then stops — only the Tone.js synth remains.
- Fade time constant: 0.7 s at chaos=1, 2.5 s at chaos=0 (total audible fade ≈ TC × 3.5 s).
- Both music and static noise route through the same `_idleFadeGain`, so they fade together.

**Track chaining:** each track plays once. When it ends, the next track is fetched immediately from `/simAss-audio`. A generation counter (`_idleAudioGen`) prevents stale chains after a spectator leaves mid-fade.

---

### Audio unlock button

Browser autoplay policy prevents `AudioContext` from starting without a prior user gesture. A subtle dark bar fixed to the bottom of the screen reads "tap to enable audio". Any interaction anywhere on the page (pointer down) also counts — the bar is simply a visible affordance in case no other interaction has occurred. Once the `AudioContext` is confirmed running the bar fades out automatically. If the context is already running on page load, the bar never appears.

### Voiceover track (`audio`)

Delivered via n8n as a base64-encoded audio blob. Plays once and stops. A new `audio` payload stops any currently playing voiceover before starting the new one. Sending `null` or `""` stops the track without starting another. If the `audio` key is absent from the response, no change is made. Default format: `audio/webm;codecs=opus`.

### Background music track (`audiobg`)

Same delivery mechanism as `audio`, but loops continuously until stopped. Sending a new `audiobg` payload replaces any running loop. Sending `null` or `""` stops it. Absent key = no-op. Default format: `audio/webm;codecs=opus`.

### Microphone

Enabled via `startMic()` (not controllable from the GUI or n8n). When active, the microphone signal drives the same color2-lean pipeline as the audio tracks. The mic source is connected only to the analyser (not to `destination`) — no feedback loop.

---

## Monitor (top-left, when GUI is visible)

```
1920 × 1080  @1.00x
60.0 fps
1 200 000 agents
```

Shows canvas resolution (physical pixels), the effective render scale, current frame rate, and active agent count.

---

## Keyboard shortcuts

| Key | Effect |
|-----|--------|
| `Ctrl` | Toggle the HUD (lil-gui panels, formula UI, monitor) on/off |
| `s` | Capture the current frame and download it as a PNG at canvas backing-store resolution. Plain `s` only — `Ctrl+S` / `Cmd+S` / `Alt+S` are ignored so the browser's "Save Page" still works. Ignored when focus is on an `INPUT`, `TEXTAREA`, or contenteditable element. Filename is `thesis-sim-<ISO timestamp>.png`. |

### Screenshot capture path

The `s` keypress just sets a flag (`_captureRequested`). The actual copy happens inside the existing render frame, in the same command encoder as the blit pass — after the swap-chain texture has been written, `copyTextureToBuffer` reads it back into a `MAP_READ` staging buffer. The canvas is configured with the extra usage flag `GPUTextureUsage.COPY_SRC` so this read-back is allowed.

After submit, the buffer maps asynchronously; rows are unpadded from the 256-byte alignment requirement, channels are swapped from BGRA to RGBA if the canvas's preferred format is `bgra8unorm`, and alpha is forced to `255`. The result is drawn into a 2D canvas, the QR overlay (separate DOM canvas) is composited on top if visible, and `toBlob` + `<a download>` triggers the file download.

To maximise resolution before pressing `s`, set the `render scale` slider in the GUI to `1.0` — the captured image has exactly `canvas.width × canvas.height` pixels, which equals `window.innerWidth × devicePixelRatio × renderScale`.
