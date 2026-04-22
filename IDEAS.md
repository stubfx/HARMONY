# Interaction Ideas

---

## 1. Individual identity within the collective

**The gap:** every user pushes the same shared force. You cannot see your own effect — it dissolves into the mass. The most potent missing piece is giving each person a visible slice of the swarm.

Each spectator is assigned a colour/hue at join time. Their partition of agents inherits that colour; the swarm becomes a visible partition of individuals. When you tilt, you see *your* cluster move. The difference between clapping in an audience and playing an instrument in an orchestra.

**How it fits the existing system:**
- The server assigns a per-spectator hue on `join-session`
- The same hue is pushed to the remote via `device-message` `color` (already implemented)
- The same value is sent to the sim as an agent-colour override for that spectator's partition
- The render shader samples colour per-agent — no new architecture required

---

## 2. Collective ritual moments (orchestrated by n8n)

**The gap:** the piece has no *shared gesture*. There is no moment where the audience does something together and sees a direct, immediate consequence.

n8n scripts timed rituals: "everyone tilt left for 5 seconds — then the swarm exhales into a new form." A countdown appears on all phones simultaneously. The action is simple, the effect visible and dramatic. This creates genuine shared memory between strangers in the same room.

**How it fits the existing system:**
- The remote already receives text pushes via `device-message`
- A new `gesture` or `countdown` field could trigger a full-screen instruction on the mobile UI
- The sim responds via a heartbeat param change (formula swap, wind direction, status change)
- No new server infrastructure needed — purely n8n logic + a small remote UI addition

---

## 3. Persistence — text lingers as a field, not just a flash

**The gap:** when a user submits text it appears on the trace canvas and then disappears. Ephemeral to the point of feeling insignificant.

What if submitted text left an invisible attractor field for the next N minutes — a ghost region that subtly pulls agents even after the visual is gone? The image fades but the *pull remains*. Newcomers are drawn toward places where earlier people wrote, without knowing why. The space accumulates memory across the session.

**How it fits the existing system:**
- After `clearDelay`, instead of a hard clear, reduce trace alpha very slowly (a secondary decay rate for content older than X seconds)
- Old text becomes a faint fossil; new text arrives bright on top
- No shader changes needed — a second `traceDecayOld` parameter and a JS timer per submitted item
- Connects naturally to the trace canvas item array idea in `FUTURE.md` (each item tracks its own age)

---

## Common thread

All three ideas address the same root gap: **users contribute to something collective but never feel personally implicated in it.** Idea 1 is the most direct fix and the infrastructure for it (per-spectator colour, socket partitioning) is already mostly in place.
