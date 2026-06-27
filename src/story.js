import { PHASE, RESEED } from './constants.js';

// ─── Narrator Audio Map ──────────────────────────────────────────────────────
// All files live in simAss/narrator/. Replace any file to swap the narration.
//
//   audio1.mp3    →  preshow           (PHASE 1 — parte subito; si ferma alla prima connessione)
//   audio2.mp3    →  preshow           (PHASE 1 — parte alla prima connessione; 10s dopo → PHASE 2)
//   audio3_2.mp3  →  nota              (PHASE 2 — parte 20s dopo la prima nota suonata)
//   audio3.mp3    →  nota              (PHASE 2 — parte subito all'entrata)
//   audio4.mp3    →  rosso             (PHASE 3 — date un colore alla nota)
//   audio5.mp3    →  immagini-tempesta (PHASE 5 — "Il rombo prima del lampo...")
//   audio6.mp3    →  testo             (PHASE 7 — una parola a testa)
//   audio7.mp3    →  chiusura          (PHASE 8 — l'armonia non e' la stessa nota)
//
// immagini-bigbang (PHASE 6) non ha audio (note di regia: "non si commenta").

// ─── Nota sui parametri hardcodati ───────────────────────────────────────────
// Tutti i timer, le soglie e i nomi dei file sono volutamente hardcodati in
// questo file. E' intenzionale: ogni fase ha tempi precisi scelti in fase di
// regia, e avere tutto qui rende facile modificare qualsiasi dettaglio senza
// cercare tra i parametri del sim.

// ─── Story Steps ────────────────────────────────────────────────────────────
// Each object is one step. Order matters — the engine runs them in sequence.
//
// Hooks available on each step:
//   enter(sim)                — called when the step becomes active
//   exit(sim)                 — called before moving to the next step
//   onSpectatorJoined(sim, n) — called each time a spectator connects
//   onNote(sim, noteIndex)    — called each time any spectator plays a note
//
// sim primitives:
//   sim.dormantSeed()              — seed all agents invisible (weight=0)
//   sim.activateChunk(fraction)    — light up next N% of agents from center
//   sim.freezeParams(overrides)    — save + override named params
//   sim.thawParams()               — restore params saved by freezeParams
//   sim.reseed({ mode })           — full reseed; mode: RESEED.FADE_FROM_EDGES → perimeter spawn at weight=0
//   sim.next()                     — advance to the next step
//   sim.setParam(key, val)         — override a single param
//   sim.suppressImages()           — block loadAvoidMap (images from admin)
//   sim.restoreImages()            — re-enable loadAvoidMap
//   sim.enableHarmonyImages()      — allow harmony to show its avoidmap image (off by default)
//   sim.disableHarmonyImages()     — hide harmony image; blocks future ones until re-enabled
//   sim.playNarratorAudio(file)    — play simAss/narrator/<file>; auto-next on ended
//   sim.setTraceText(text)         — set the trace text input and re-render the avoidmap

const log = (msg) => console.log(`[story] ${msg}`);

export const STORY = [

    // ── PHASE 1 — CONNESSIONE ─────────────────────────────────────────────────
    // audio1 parte subito all'entrata.
    // Prima connessione → audio2 parte (audio1 si ferma se ancora in corso).
    // audio2 finisce → 10s → sim.next().
    // dotRespawnChance abilitato 10s dopo la prima connessione.
    {
        id: PHASE.PRESHOW,
        enter(sim) {
            this._audio2Started = false;
            log('PHASE 1 — connessione. audio1 in partenza.');
            sim.freezeParams({ spectatorSpawnChance: 0, randomTeleportChance: 0, dotRespawnChance: 0, spawnFadeRate: 0 });
            sim.suppressImages();
            sim.dormantSeed();
            this._audio = sim.playNarratorAudio('audio1.mp3');
        },
        onSpectatorJoined(sim, userCount) {
            log('utente connesso — totale: ' + userCount);
            sim.activateChunk(1);
            if (userCount === 1) {
                log('primo utente: dotRespawnChance attivo tra 10s.');
                setTimeout(() => {
                    log('dotRespawnChance abilitato (0.002).');
                    sim.setParam('dotRespawnChance', 0.002);
                }, 10_000);
                if (!this._audio2Started) {
                    this._audio2Started = true;
                    this._audio?.pause();
                    log('audio1 fermato. audio2 in partenza.');
                    this._audio = sim.playNarratorAudio('audio2.mp3');
                    this._audio.addEventListener('ended', () => {
                        log('audio2 terminato. attesa 10s prima di avanzare a PHASE 2.');
                        setTimeout(() => {
                            log('10s scaduti — avanzamento a PHASE 2.');
                            sim.next();
                        }, 10_000);
                    }, { once: true });
                }
            }
        },
        exit(sim) {
            log('uscita PHASE 1 — reseed con fade dai bordi.');
            this._audio?.pause();
            this._audio = null;
            sim.restoreImages();
            sim.thawParams();
            sim.reseed({ mode: RESEED.FADE_FROM_EDGES });
        },
    },

    // ── PHASE 2 — LA NOTA ─────────────────────────────────────────────────────
    // audio3 parte subito all'entrata. wind disabilitato fino alla prima nota.
    // Prima nota → wind on → timer 20s → audio3_2 → timer 10s → sim.next().
    // Il timer da 20s parte una sola volta.
    {
        id: PHASE.NOTA,
        _noteTimerStarted: false,
        enter(sim) {
            this._noteTimerStarted = false;
            sim.freezeParams({ windEnabled: false });
            sim.setTraceText('HARMONY');
            log('PHASE 2 — nota. wind disabilitato. testo HARMONY impostato. audio3 in partenza.');
            this._audio = sim.playNarratorAudio('audio3.mp3');
        },
        onNote(sim, noteIndex) {
            if (this._noteTimerStarted) return;
            this._noteTimerStarted = true;
            sim.setParam('windEnabled', true);
            log('prima nota ricevuta (index ' + noteIndex + '). wind abilitato. timer 20s avviato.');
            setTimeout(() => {
                log('20s scaduti — audio3_2 in partenza.');
                this._audio = sim.playNarratorAudio('audio3_2.mp3');
                this._audio.addEventListener('ended', () => {
                    log('audio3_2 terminato. attesa 10s prima di avanzare a PHASE 3.');
                    setTimeout(() => {
                        log('10s scaduti — avanzamento a PHASE 3.');
                        sim.next();
                    }, 10_000);
                }, { once: true });
            }, 20_000);
        },
        exit(sim) {
            log('uscita PHASE 2.');
            sim.thawParams();
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 3 — IL ROSSO ────────────────────────────────────────────────────
    // Narrator speaks; advances automatically when audio ends.
    // color1 e color2 impostati a rosso puro per tutta la fase.
    // File: simAss/narrator/audio4.mp3
    {
        id: PHASE.ROSSO,
        enter(sim) {
            sim.freezeParams({ color1: '#ff0000', color2: '#ff0000' });
            sim.enableHarmonyImages();
            log('PHASE 3 — rosso. colori impostati a rosso. immagini harmony abilitate. audio4 in partenza.');
            this._audio = sim.playNarratorAudio('audio4.mp3', { autoNext: true });
        },
        exit(sim) {
            log('uscita PHASE 3.');
            sim.disableHarmonyImages();
            sim.thawParams();
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 4 — IMMAGINE: CUORE ─────────────────────────────────────────────
    // TODO: implement image appearance logic (how the image fades/arrives on screen).
    // Narrator speaks after silence; advances when audio ends.
    // File: simAss/narrator/audio4.mp3
    {
        id: PHASE.IMMAGINI_CUORE,
        enter(sim) {
            log('PHASE 4 — cuore. audio4 in partenza.');
            // TODO: load cuore image into avoidmap
            this._audio = sim.playNarratorAudio('audio4.mp3', { autoNext: true });
        },
        exit(sim) {
            log('uscita PHASE 4.');
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 5 — IMMAGINE: TEMPESTA ──────────────────────────────────────────
    // TODO: implement image appearance logic.
    // Narrator speaks; advances when audio ends.
    // File: simAss/narrator/audio5.mp3
    {
        id: PHASE.IMMAGINI_TEMPESTA,
        enter(sim) {
            log('PHASE 5 — tempesta. audio5 in partenza.');
            // TODO: load tempesta image into avoidmap
            this._audio = sim.playNarratorAudio('audio5.mp3', { autoNext: true });
        },
        exit(sim) {
            log('uscita PHASE 5.');
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 6 — IMMAGINE: BIG BANG ──────────────────────────────────────────
    // TODO: implement image appearance logic.
    // No narration (script note: "non si commenta").
    // Shown for 5 seconds, then cuts to black and auto-advances.
    {
        id: PHASE.IMMAGINI_BIGBANG,
        enter(sim) {
            log('PHASE 6 — bigbang. timer 5s avviato (no audio).');
            // TODO: load bigbang image into avoidmap
            this._timer = setTimeout(() => {
                log('5s scaduti — avanzamento a PHASE 7.');
                sim.next();
            }, 5_000);
        },
        exit(sim) {
            log('uscita PHASE 6.');
            clearTimeout(this._timer);
            // TODO: cut to black before advancing
        },
    },

    // ── PHASE 7 — IL TESTO ────────────────────────────────────────────────────
    // Narrator speaks; advances automatically when audio ends.
    // File: simAss/narrator/audio6.mp3
    {
        id: PHASE.TESTO,
        enter(sim) {
            log('PHASE 7 — testo. audio6 in partenza.');
            this._audio = sim.playNarratorAudio('audio6.mp3', { autoNext: true });
        },
        exit(sim) {
            log('uscita PHASE 7.');
            this._audio?.pause();
            this._audio = null;
        },
    },

    // ── PHASE 8 — CHIUSURA ────────────────────────────────────────────────────
    // Narrator speaks. Last step — no next().
    // File: simAss/narrator/audio7.mp3
    {
        id: PHASE.CHIUSURA,
        enter(sim) {
            log('PHASE 8 — chiusura. audio7 in partenza. fine storia.');
            this._audio = sim.playNarratorAudio('audio7.mp3');
        },
        exit(sim) {
            this._audio?.pause();
            this._audio = null;
        },
    },
];
