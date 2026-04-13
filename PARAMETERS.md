# Parameter Reference

A thorough explanation of every tunable parameter in the simulation, grouped by section. All values are editable live through the GUI (toggle with `Ctrl` or `?gui=true`).

The formula panel at the bottom-left of the screen also contains a **trace text** input (described below) that is separate from the GUI.

---

## Trace Text (formula panel)

A text field displayed above the direction formula input, styled in amber to distinguish it from the formula fields. Whatever is typed here is rendered as a trace attractor: agents whose home positions fall inside the text glyphs will home to those positions, making the particle field collectively "write" the text.

### How it works

The text is rendered on the CPU using the browser's Canvas 2D API (white glyphs on a transparent background), then composited with any loaded trace image, and uploaded to the GPU as a single `rgba8unorm` texture — the exact same path as a loaded image. From the shader's perspective there is no difference: text and image feed the same texture slot and obey the same alpha threshold, black cutoff, and edge fade rules.

The texture is rebuilt 300 ms after the last keystroke (debounced). There is no need to press Enter.

### Sizing and font

- **Text only** (no image loaded): the canvas is auto-sized to fit the text. A reference height of 256 px is used; the font is set to 72% of that height, and the canvas width is derived from the measured text width with 14% padding. The aspect ratio is then preserved by the normal `size` control in the Trace GUI folder.
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

### intro delay (s)
**Range:** 0 – 30 | **Default:** 5.0

At startup, agents spawn from screen centre pointing radially outward. For this many seconds, `follow formula` and wind are silently suppressed (without changing the GUI toggles), letting agents spread across the canvas. After the delay, the active direction and wind formulas engage. Setting this to 0 disables the intro.

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

### brightness
**Range:** 0.01 – 0.5 | **Default:** 0.08

The alpha of each rendered particle quad. Because particle blending is additive (`src-alpha / one`), lower values allow many particles to overlap without saturating to white — the accumulation is gradual. Raising this makes individual particles more visible but causes bright spots to blow out quickly in dense areas. This is the primary control for managing visual density vs. saturation.

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

### black cutoff (`blackThreshold`)
**Range:** 0 – 0.5 | **Default:** 0.05

Converts dark pixels to fully transparent, regardless of their alpha channel value. Before the alpha threshold check, the shader computes the luminance of the pixel (`0.299×R + 0.587×G + 0.114×B`). If that luminance is below this value, the pixel is treated as alpha 0 — it does not attract agents and does not receive image color in the render.

This is primarily useful for images without a proper alpha channel (JPEGs, photos) where the background is black rather than transparent. Setting this to 0 disables the check. Setting it above ~0.2 will start to affect mid-tone areas.

### edge fade (`vignetteEdge`)
**Range:** 0 – 0.5 | **Default:** 0.08

Fades the outer edges of the image rect with a smooth rectangular vignette. The value is the width of the fade band in UV units (0–1 across the image). At 0, no fade is applied and the image has a hard edge. At 0.1, the outermost 10% of each edge fades to transparent. At 0.5, the fade extends to the centre from all sides.

The fade is computed as `smoothstep(0, vignetteEdge, distanceFromNearestEdge)` and affects both the rendered image color (alpha is multiplied by the fade factor) and the homing signal (effective alpha used by the compute shader is also multiplied).

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

---

## Restart (`↺ Restart`)

Re-seeds all agents: positions are randomised from screen centre, home coordinates are reassigned, and weights are redistributed according to `weight spread`. The formula, wind state, and all other parameters are preserved. This is the only operation that resets agent positions.

---

## Monitor (top-left, when GUI is visible)

```
1920 × 1080  @1.00x
60.0 fps
1 200 000 agents
```

Shows canvas resolution (physical pixels), the effective render scale, current frame rate, and active agent count.
