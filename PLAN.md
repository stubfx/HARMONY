# BREATH — Hold-to-Burst Remote Interface

## Problem

The current remote sends continuous `note` events while a finger is held down.
With many spectators this floods the sim with redundant events and makes
collective musical behaviour chaotic — everyone is always "on", nothing
ever resolves, the harmony system thrashes.
The server-side `note-debounce` (10 ms × user count) only reduces frequency,
it does not introduce musical phrasing or anti-spam with teeth.

## The mechanic — "breathing"

Replace continuous streaming with a **hold-to-charge, release-to-burst** model.
One inhale, one exhale, one event, one rest.

```
touch-down ──► charging ──► release ──► burst fires ──► cooldown ──► idle
                  │                                          │
               (slide to                              (visible ring
             tune note/color)                          depletes)
```

### Step-by-step UX

| Step | What the user does | What happens |
|---|---|---|
| 1 | Touch down | Charge arc begins. Device oscillator plays note softly. |
| 2 | Slide while holding | Note (X) and color (Y) update live on device. No server events. |
| 3a | Release after > 200 ms | `note-burst` fires. Visual ring burst. Audio pluck. Cooldown starts. |
| 3b | Release before 200 ms | Accidental tap guard — nothing fires, no cooldown. |
| 4 | Cooldown | Canvas dims, thin depletion arc at screen edge. Cannot charge. |
| 5 | Blip target appears | Tap it instantly, as before. No charge needed. |

### Charge visual

A radial arc (clockwise pie-slice) expands around the finger as charge builds:
- 0 % → no arc
- 50 % → half circle, color mixing white → pushedColor
- 100 % → full ring glowing in pushedColor; pool particles orbit the finger

On release: ring bursts outward (expanding fading circle).

### Cooldown visual

- Canvas opacity drops to 60 %
- A thin white arc at the screen edge depletes clockwise over the cooldown period
- `cooldownMs = 500 + charge × 2000` (0.5 s at minimum tap → 2.5 s at full charge)

### Collective behaviour

With 50 people each on a 2–3 s breath cycle:
- Server receives 50 clean bursts per exhale wave, not thousands of streaming ticks
- Bursts cluster naturally around musical moments (people feel the groove together)
- Harmony images appear during "exhale waves" when many people release together
- Between waves: silence — the sim breathes with the crowd

## Implementation

### remote/main.js  (main change)

New state:
```js
let _chargeStart   = 0;     // performance.now() at touch-down
let _chargeLevel   = 0;     // 0–1, computed at release
let _coolingDown   = false;
let _cooldownEnd   = 0;     // performance.now() target
```

Pointer handler changes:
```js
pointerdown  → record _chargeStart; start oscillator; DO NOT sendEvent
pointermove  → update note/color locally only; no sendEvent
pointerup    → compute charge; if > threshold fire note-burst; start cooldown
```

Burst event:
```js
sendEvent('note-burst', { index: noteIdx, freq, color: pushedColor, charge: _chargeLevel });
```

Burst audio (Web Audio, no new deps):
```js
// One-shot attack-decay at selected freq using existing _audioCtx
function _playBurstPluck(freq, charge) {
    const ctx = _ensureAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.3 + charge * 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + charge * 0.4);
    osc.start(t); osc.stop(t + 0.7);
}
```

Drawing additions to RAF loop:
- Charge arc: `ctx2d.arc` clockwise from top, fill fraction = `_chargeLevel`
- Cooldown arc: thin stroke at screen perimeter, fraction = remaining/total cooldown
- Canvas alpha: `ctx2d.globalAlpha = _coolingDown ? 0.6 : 1` before each frame

Bot autopilot: emit `note-burst` at each "lift" point with `charge = 0.5 + Math.random() * 0.5`.

Remove `note-debounce` socket listener (obsolete).

### src/sim.js  (harmony system)

Add per-spectator burst expiry timers alongside `_activeNotesBySpectator`:
```js
const _burstExpiry = new Map(); // spectatorId → timeoutId
```

New handler in the `remote-event` block:
```js
if (event.type === 'note-burst' && typeof event.data?.index === 'number') {
    const { index, freq, charge = 0.5 } = event.data;
    // Cancel any pending expiry for this spectator
    clearTimeout(_burstExpiry.get(event.spectatorId));
    // Register the note (same path as existing 'note' handler)
    _activeNotesBySpectator.set(event.spectatorId, index);
    addArpInfluence(freq);
    _checkHarmony();
    // Auto-expire after burst window
    _burstExpiry.set(event.spectatorId, setTimeout(() => {
        _activeNotesBySpectator.delete(event.spectatorId);
        _burstExpiry.delete(event.spectatorId);
        _checkHarmony();
    }, 1500 + charge * 3000));
}
```

Keep existing `note` and `note-off` handlers for backwards compat with old clients.

### server/server.js

**No changes.** `note-burst` flows through the existing `user-event → remote-event`
pass-through unchanged.

## What does NOT change

- Left/right = note, up/down = color (same axes, same KEYS array)
- Pixel pool visual (only enhanced during charge/burst)
- Blip mechanic (instant tap, no charge required)
- Aura background color
- `_emitSound` / story step gating
- Bot iframe system in simremotes
- Harmony detection logic in sim.js (`_checkHarmony`, `_enterHarmony`)

## Anti-spam guarantee

| Scenario | Events/min (old) | Events/min (new) |
|---|---|---|
| 1 user, continuous hold | ~300 (every move) | ~20 (one per breath) |
| 50 users, continuous | ~15 000 | ~1 000 |
| 50 users, rush spam | ~15 000 | max ~2 400 (cooldown floors it) |

## Edge cases

| Case | Handled by |
|---|---|
| User releases instantly (< 200 ms) | Threshold guard — no event, no cooldown |
| User holds forever (> 2 s) | Charge caps at 1.0 — arc stays full, no extra cooldown |
| Page regains focus mid-cooldown | `_cooldownEnd` is an absolute timestamp — resumes correctly |
| Old remote client (no burst support) | Existing `note`/`note-off` handlers still work |
| Bot tiles | Emit `note-burst` at each Lissajous lift point |
| Many simultaneous bursts | Server forwards all; sim processes sequentially |
