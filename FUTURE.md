# Possible future implementations

---

## Two independent GPU textures for trace content

### Context

The current trace system composites all content (QR code, user images, text) onto a single
full-screen CPU canvas (`traceCanvas`) before uploading it as one GPU texture. Each element
has its own position and size, but they share a single texture and a single set of magnet
parameters (`magnetStr`, `alphaThreshold`, etc.).

### What this would enable

- Independent magnet strength per element (e.g. QR attracts weakly, user image attracts strongly)
- Independent alpha threshold, vignette edge, and proximity fade per element
- Precise `qrFadeZone` by passing the QR rect directly to the shader (currently a no-op)
- Agents could be explicitly assigned to one attractor or the other

### Architecture

Two separate GPU texture bindings in the compute shader:

```
binding 2  — content texture  (user image + text, at imageX/imageY)
binding 6  — qr texture       (QR code, at qrX/qrY)
```

Two corresponding `imageRegion` structs in the uniform buffer:

```
contentRegion: vec4f  (x0, y0, x1, y1 in screen pixels)
qrRegion:      vec4f
```

The compute shader checks both regions independently. Each homing agent is assigned to
whichever region claims its home pixel. Agents within both regions pick the brighter one.

### Complexity

- Uniform buffer layout change (new fields)
- `compute.wgsl` homing logic rewrite
- `render.wgsl` colour-sampling needs two texture lookups
- Two separate CPU canvases, two `copyExternalImageToTexture` calls per frame
- Two bind group entries, two `rebuildSimBG()` code paths

### When to implement

When independent per-element magnet parameters become necessary for the installation's
artistic direction. The current single-canvas approach is equivalent in most cases.

---

## Trace canvas item array

### Context

The current trace canvas draws two fixed items: one QR (Layer 0) and one user content
block (Layer 1). Both have hardcoded layer roles.

### What this would enable

Multiple simultaneous attractors at arbitrary positions — e.g. different spectators'
words appearing at different screen locations, or a sequence of images placed spatially.

### Architecture

Replace `imageBitmap` / `qrBitmap` with an array of items:

```js
const traceItems = [
  { type: 'qr',    bitmap, x: 0.88, y: 0.88, size: 0.18, opacity: 1.0 },
  { type: 'image', bitmap, x: 0.5,  y: 0.5,  size: 0.32, opacity: 1.0 },
  { type: 'text',  text,   x: 0.3,  y: 0.6,  size: 0.10, opacity: 0.8 },
];
```

`renderTraceCanvas()` iterates the array and draws each item in order. Opacity is applied
via `ctx.globalAlpha`. n8n can manipulate the array by sending add/remove/update commands
via `applySimParams()`.

### Complexity

Moderate — all changes are in JS/CPU land. The GPU side is unchanged (still one flat texture).
The main work is defining the item schema and the n8n API for managing the array.

### When to implement

When the installation needs multiple simultaneous spatial attractors driven by audience
participation (e.g. each spectator's word appears at a different screen position).
