import './style.css';
import { getMovement } from './motion.js';
import { startDeviceTilt, requestMotionOrientationPermission } from './gyro';

const urlParams    = new URLSearchParams(window.location.search);
const uuid         = urlParams.get('s');   // host room ID (from QR)

// Unique ID for this spectator — stable across refreshes, fresh each new tab
const spectatorId  = sessionStorage.getItem('spectator-id') ?? (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('spectator-id', id);
    return id;
})();

// n8n webhook — set VITE_N8N_EVENT_URL in .env
const N8N_URL = import.meta.env.VITE_N8N_EVENT_URL ?? 'http://localhost:5678/webhook-test/user-event';

// Fire-and-forget: m_src → n8n directly (no server in the path)
function sendEvent(type, data) {
    fetch(N8N_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, room: uuid, spectatorId, data, timestamp: Date.now() }),
    })
    .then(res => { if (!res.ok) console.warn(`[n8n] HTTP ${res.status}`); })
    .catch(err => console.error('[n8n] unreachable:', err.message));
}

const statusEl = document.querySelector('#status');

let motion;

const buttons = document.querySelectorAll('.quick-color');
const formEl  = document.querySelector('#input-form');

const randomColor = () =>
    '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');

document.getElementById('enable-motion').addEventListener('click', async () => {
    await requestMotionOrientationPermission();
    startDeviceTilt(30, (d) => {
        motion = d.enabled ? d.motion : 0;
    });
});

formEl.onsubmit = (e) => {
    e.preventDefault();
    const form = new FormData(formEl);
    const data = Object.fromEntries(form);
    if (!data.text1) return;
    flashStatus();
    sendEvent('text', data.text1);
    formEl.reset();
};

buttons.forEach((el) => {
    const color = randomColor();
    el.style.backgroundColor = color;
    el.onclick = () => sendEvent('color', color);
});

function flashStatus() {
    statusEl.classList.add('loading');
    setTimeout(() => statusEl.classList.remove('loading'), 500);
}

function heartBeat() {
    if (motion) sendEvent('motion', motion);
    setTimeout(heartBeat, 1000);   // 1 Hz
}
heartBeat();
