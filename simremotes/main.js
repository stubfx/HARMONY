import './style.css';

// Synthetic-crowd load test: spawn N real /remote instances in bot mode inside
// iframes, so the sim can be exercised solo. Takes one ?s=<token> like the remote.
const params = new URLSearchParams(location.search);
const token  = params.get('s');
const n      = Math.max(1, parseInt(params.get('n') ?? '15', 10) || 15);

const grid = document.getElementById('grid');

if (!token) {
    const notice = document.createElement('div');
    notice.id = 'notice';
    notice.textContent = 'Open this page from the sim — click the session QR.';
    document.body.appendChild(notice);
} else {
    for (let i = 0; i < n; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';

        const frame = document.createElement('iframe');
        // Origin-relative + same-origin so sessionStorage/crypto behave as expected.
        frame.src = `/remote/?s=${encodeURIComponent(token)}&bot=1&i=${i}`;
        frame.allow = 'autoplay';
        cell.appendChild(frame);

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = String(i + 1);
        cell.appendChild(label);

        grid.appendChild(cell);
    }
}
