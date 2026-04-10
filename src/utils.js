// ─── Utilities (no Three.js) ─────────────────────────────────────────────────

export function deepReplace(target, source) {
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object'
        ) {
            deepReplace(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
}

export function isDEV() {
    return !!import.meta.env.DEV;
}

// Clamp a value between min and max
export function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Convert {r,g,b} (0-1 floats) to CSS hex string
export function rgbToHex({ r, g, b }) {
    const toHex = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Parse CSS hex to {r,g,b} 0-1 floats
export function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return {
        r: ((n >> 16) & 0xff) / 255,
        g: ((n >> 8)  & 0xff) / 255,
        b: (n         & 0xff) / 255,
    };
}
