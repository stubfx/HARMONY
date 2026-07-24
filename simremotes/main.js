import './style.css';

// Synthetic-crowd load test: spawn N real /remote instances in bot mode inside
// iframes, so the sim can be exercised solo. Takes one ?s=<token> like the remote.
const params = new URLSearchParams(location.search);
const token  = params.get('s');
const n      = Math.max(1, parseInt(params.get('n') ?? '6', 10) || 6);

const grid = document.getElementById('grid');

const NOTE_NAMES = ['D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4'];

if (!token) {
    const notice = document.createElement('div');
    notice.id = 'notice';
    notice.textContent = 'Open this page from the sim — click the session QR.';
    document.body.appendChild(notice);
} else {
    const frames = [];
    for (let i = 0; i < n; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';

        const frame = document.createElement('iframe');
        // Origin-relative + same-origin so sessionStorage/crypto behave as expected.
        frame.src = `/remote/?s=${encodeURIComponent(token)}&bot=1&i=${i}`;
        frame.allow = 'autoplay';
        cell.appendChild(frame);
        frames.push(frame);

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = String(i + 1);
        cell.appendChild(label);

        grid.appendChild(cell);
    }

    buildDashboard(frames);
}

// ── Dashboard ───────────────────────────────────────────────────────────────
// Broadcasts note (X) / colour hue (Y) sync commands to every bot iframe, so the
// director can pull the whole crowd onto one note / one colour. null = release
// that axis back to autonomous wandering. Steps persist so re-syncing resumes.
function buildDashboard(frames) {
    let noteIdx  = null;   // 0–8, or null = wandering
    let hue      = null;   // 0–270, or null = wandering
    let lastNote = 4;      // remembered position when re-activating from null
    let lastHue  = 210;

    const send = (cmd) => {
        for (const f of frames) f.contentWindow?.postMessage({ type: 'bot-cmd', ...cmd }, location.origin);
    };

    // A late-loading (or reloaded) bot announces itself → push the current state.
    window.addEventListener('message', (e) => {
        if (e.origin !== location.origin) return;
        if (e.data?.type === 'bot-ready') {
            e.source?.postMessage({ type: 'bot-cmd', note: noteIdx, hue }, location.origin);
        }
    });

    const dash = document.createElement('div');
    dash.id = 'dashboard';
    dash.innerHTML = `
        <div class="dash-group">
            <span class="dash-title">note</span>
            <button class="dash-btn" data-act="note-down">◀</button>
            <span class="dash-readout" id="note-readout">auto</span>
            <button class="dash-btn" data-act="note-up">▶</button>
        </div>
        <div class="dash-group">
            <span class="dash-title">colour</span>
            <button class="dash-btn" data-act="color-down">▼</button>
            <span class="dash-swatch" id="color-swatch"></span>
            <button class="dash-btn" data-act="color-up">▲</button>
        </div>
        <button class="dash-btn dash-auto" data-act="auto">auto</button>`;
    document.body.appendChild(dash);

    const noteReadout  = dash.querySelector('#note-readout');
    const colorSwatch  = dash.querySelector('#color-swatch');

    const refresh = () => {
        noteReadout.textContent = noteIdx === null ? 'auto' : NOTE_NAMES[noteIdx];
        colorSwatch.style.background = hue === null ? 'transparent' : `hsl(${hue}, 80%, 50%)`;
        colorSwatch.classList.toggle('auto', hue === null);
    };

    // First press after "auto" re-syncs at the remembered value (no step); further
    // presses step from there.
    const actions = {
        'note-down':  () => { noteIdx = noteIdx === null ? lastNote : Math.max(0, noteIdx - 1); lastNote = noteIdx; send({ note: noteIdx }); },
        'note-up':    () => { noteIdx = noteIdx === null ? lastNote : Math.min(8, noteIdx + 1); lastNote = noteIdx; send({ note: noteIdx }); },
        'color-down': () => { hue = hue === null ? lastHue : Math.max(0,   hue - 30); lastHue = hue; send({ hue }); },
        'color-up':   () => { hue = hue === null ? lastHue : Math.min(270, hue + 30); lastHue = hue; send({ hue }); },
        'auto':       () => { noteIdx = null; hue = null; send({ note: null, hue: null }); },
    };

    dash.addEventListener('click', (e) => {
        const act = e.target.closest('.dash-btn')?.dataset.act;
        if (!act || !actions[act]) return;
        actions[act]();
        refresh();
    });

    refresh();
}
