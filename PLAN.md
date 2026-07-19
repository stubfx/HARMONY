# BIRDS — Atmospheric Tap-to-Chirp Remote Interface

## Concept

Each spectator is a bird in a forest. They chirp when they feel like it.
The room fills with overlapping melodic calls — organic, sporadic, atmospheric.
No sustained tones. No keyboard. No held fingers. Just taps.

The sound of each chirp is the existing `speakBinary` melodic glide, played
locally on the phone. The note index (derived from tap X position) determines
how many bits the call has — low notes are short chirps, high notes are longer
songs. Collectively the room breathes like a living forest canopy.

```
tap anywhere → chirp fires instantly → 800ms rest → tap again
```

## Interaction model

| Input | What happens |
|---|---|
| Single tap | Immediate chirp at that position. Aura flashes. 800ms cooldown. |
| Tap during cooldown | Ignored — the bird is still singing. |
| Blip target tap | Unchanged — still instant, no cooldown. |
| No input | Silence. This is intentional and correct. |

### Position encoding

- **X axis** → note index 0–8 (9 equal zones). Determines the bit pattern:
  - Note 0: value 1 → `"1"` (1 bit, 200ms glide) — short tweet
  - Note 4: value 5 → `"101"` (3 bits, 600ms) — medium call
  - Note 8: value 9 → `"1001"` (4 bits, 800ms) — longer phrase
- **Y axis** → color hue (same mapping as before: top → warm, bottom → cool)
- Color updates the aura and is sent to the sim on each chirp.

### Chirp sound (local, on the phone)

A local `speakBinary` replicated with raw Web Audio API:
- Sine oscillator gliding between 1245 Hz (bit=1) and 623 Hz (bit=0)
- 200ms per bit, exponential ramp between frequencies
- Short attack, fast decay — sounds like a bird call, not a beep
- Reverb send (existing `_reverbNode`) for warmth

This is the SAME sound as the sim's `speakBinary` — phones and sim speak the
same language. The user literally plays the melody they'll hear on stage.

## Visual feedback (remote canvas)

| Moment | Visual |
|---|---|
| Tap | Expanding ring burst at the tap point (white → pushedColor) |
| Chirp playing | Aura pulses at full brightness then fades back |
| Cooldown | Nothing — just the ambient particle drift |

The particle pool continues drifting. No charge arc, no cooldown overlay.
The interface is silent and dark between chirps — the rest is part of the music.

## Story fix — Phase 2 fallback timer

Phase 2 currently waits indefinitely for `onNote` before advancing. With the
new chirp model sending `chirp` events instead of `note` events, this would
stall the show forever. Fix: after notes are enabled, start a 30s fallback
timer that advances to Phase 3 regardless of user input.

```js
// In Phase 2 enter(), after the existing _enableTimer:
this._fallbackTimer = setTimeout(() => {
    if (!this._noteTimerStarted) {
        this._noteTimerStarted = true;
        log('30s senza note — avanzamento automatico a PHASE 3.');
        sim.setParam('windEnabled', true);
        setTimeout(() => sim.next(), 20_000);
    }
}, 10_000 + PHASE_CUE_HOLD_MS + 30_000); // wait for cue + gate + 30s
```

Also clear `this._fallbackTimer` in `exit()`.

## Sim changes — chirp event handling

The `chirp` event replaces `note`/`note-off` as the primary spectator signal.
It registers a time-limited note contribution (same as burst expiry model)
and triggers a blinker on the slot.

```js
// In the remote-event handler in sim.js:
if (event.type === 'chirp' && typeof event.data?.index === 'number') {
    const { index, freq, color } = event.data;
    // Visual: blinker on this spectator's slot
    const slot = activeSlots.find(s => s.spectatorId === event.spectatorId);
    if (slot) {
        triggerReleaseBurst(slot);
        slot.formulaIdx = index;
        if (color) { const [r,g,b] = hexToF(color); slot.colorR=r; slot.colorG=g; slot.colorB=b; }
        uploadSpectatorSlots();
    }
    // Note contribution: registers for harmony, auto-expires after 4s
    clearTimeout(_burstExpiry.get(event.spectatorId));
    if (freq) addArpInfluence(freq);
    _activeNotesBySpectator.set(event.spectatorId, index);
    _recalcNoteFormulas();
    storyEngine.onNote(index);
    _burstExpiry.set(event.spectatorId, setTimeout(() => {
        _activeNotesBySpectator.delete(event.spectatorId);
        _burstExpiry.delete(event.spectatorId);
        _recalcNoteFormulas();
    }, 4000));
}
```

Keep `note`/`note-off` handlers for backwards compat. Keep `_burstExpiry` map.

## File changes

| File | Change |
|---|---|
| `remote/main.js` | Rewrite interaction: remove oscillator hold, add tap-chirp + local speakBinary |
| `src/story.js` | Phase 2: add 30s fallback timer after notes are enabled |
| `src/sim.js` | Add `chirp` event handler (note contribution + blinker + color) |
| `server/server.js` | No changes — `chirp` routes through existing user-event pass-through |

## What does NOT change

- Existing `speakBinary` sounds (not touched)
- Synth/audio pipeline on the sim
- Harmony system (`_checkHarmony`, `_enterHarmony`)
- Bot system (bots send `chirp` events at lift points)
- Blip mechanic (still instant tap, overlaps fine with chirp cooldown)
- Color/aura system (Y → hue, same mapping)
- KEYS array (still used for freq lookup, just not displayed as a keyboard)

## Anti-spam

800ms cooldown per device, enforced client-side.
With 50 users each chirping max ~75 times/minute:
→ 3,750 events/min vs. thousands of continuous `note` events previously.
Each event is meaningful, not a stream artifact.

## Collective forest behaviour

- 2 people chirping → occasional overlapping contributions → mild harmony
- 10+ people chirping → notes accumulate, harmony images trigger naturally
- 50 people chirping in rhythm → forest canopy, dense texture
- Silence between chirps is organic — no one is "always on"
