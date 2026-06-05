// ─── OpenAI voice — turn-based pipeline ───────────────────────────────────────
// Drives a single conversation turn:
//   1. Toggle: first call starts recording (MediaRecorder on the existing mic
//      stream — the brightness analyser keeps running unaffected).
//   2. Toggle again: stops recording, base64-encodes the blob, POSTs through
//      the server proxy to Whisper, then to chat completions with the rolling
//      history, then to TTS, and finally plays the reply through the same
//      voiceover channel n8n audio uses.
//
// The server-side proxy keeps the OpenAI key out of the browser; this file
// only knows about the three /openai/* endpoints.
//
// Disabled by default — the GUI flag (params.openaiVoiceEnabled) gates the
// toggle. When off, calling toggleVoiceTurn() is a no-op.

import { startMic, startRecording, stopRecording, isRecording, playAudio } from './audio.js';

let _history    = [];
let _systemSeen = null;
let _inFlight   = false;
let _listeners  = new Set();

function _emit(state) { for (const fn of _listeners) try { fn(state); } catch (e) { console.warn('[voice listener]', e); } }
export function onVoiceState(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

export function resetVoiceHistory() {
    _history    = [];
    _systemSeen = null;
}

export function getVoiceHistory() { return _history.slice(); }

// Single entry point. Call once to start recording, again to stop and run the
// full pipeline. Returns the assistant reply text on success, null otherwise.
export async function toggleVoiceTurn({ enabled = false, voice = 'alloy', systemPrompt = '' } = {}) {
    if (!enabled) { console.warn('[voice] disabled — toggle the flag in the GUI first'); return null; }

    if (!isRecording() && !_inFlight) {
        try { await startMic(); } catch (e) { console.error('[voice] mic start', e); return null; }
        startRecording();
        _emit({ phase: 'recording' });
        return null;
    }
    if (_inFlight) { console.warn('[voice] pipeline already running'); return null; }

    _inFlight = true;
    try {
        _emit({ phase: 'processing' });
        const blob = await stopRecording();
        if (!blob || blob.size < 200) { _emit({ phase: 'idle' }); return null; }

        const audioB64 = await _blobToBase64(blob);
        const tRes = await fetch('/openai/transcribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ audio: audioB64, mimeType: blob.type }),
        });
        const tBody = await tRes.json();
        if (!tRes.ok) throw new Error(tBody.error || `transcribe ${tRes.status}`);
        const userText = (tBody.text || '').trim();
        if (!userText) { _emit({ phase: 'idle' }); return null; }

        // System prompt is only injected when it changes (or on first turn).
        if (systemPrompt && systemPrompt !== _systemSeen) {
            _history    = [{ role: 'system', content: systemPrompt }];
            _systemSeen = systemPrompt;
        }
        _history.push({ role: 'user', content: userText });
        _emit({ phase: 'thinking', userText });

        const cRes = await fetch('/openai/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ messages: _history }),
        });
        const cBody = await cRes.json();
        if (!cRes.ok) throw new Error(cBody.error || `chat ${cRes.status}`);
        const replyText = (cBody.text || '').trim();
        if (!replyText) { _emit({ phase: 'idle' }); return null; }
        _history.push({ role: 'assistant', content: replyText });

        _emit({ phase: 'speaking', userText, replyText });
        const sRes = await fetch('/openai/tts', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text: replyText, voice }),
        });
        const sBody = await sRes.json();
        if (!sRes.ok) throw new Error(sBody.error || `tts ${sRes.status}`);
        await playAudio(sBody.audio, sBody.mimeType || 'audio/ogg;codecs=opus');

        _emit({ phase: 'idle', userText, replyText });
        return replyText;
    } catch (e) {
        console.error('[voice]', e);
        _emit({ phase: 'error', message: e.message });
        return null;
    } finally {
        _inFlight = false;
    }
}
