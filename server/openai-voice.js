// ─── OpenAI voice helpers ─────────────────────────────────────────────────────
// Thin wrappers around the OpenAI SDK for the browser-side turn-based voice
// pipeline (Whisper → chat → TTS). Kept separate from openai-api.js so the
// existing stored-prompt chat flow stays untouched.
//
// All three functions are called by the /openai/* endpoints in server.js. The
// API key lives only on the server (OPENAI_API_KEY in .env) — the browser
// never sees it.

import OpenAI, { toFile } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TRANSCRIBE_MODEL = process.env.OPENAI_VOICE_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';
const CHAT_MODEL       = process.env.OPENAI_VOICE_CHAT_MODEL       ?? 'gpt-4o-mini';
const TTS_MODEL        = process.env.OPENAI_VOICE_TTS_MODEL        ?? 'gpt-4o-mini-tts';

export async function voiceTranscribe(buffer, mimeType = 'audio/webm') {
    const ext  = mimeType.includes('webm') ? 'webm'
               : mimeType.includes('mp3')  ? 'mp3'
               : mimeType.includes('wav')  ? 'wav'
               : 'audio';
    const file = await toFile(buffer, `audio.${ext}`, { type: mimeType });
    const r = await openai.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL });
    return r.text ?? '';
}

export async function voiceChat(messages) {
    const r = await openai.chat.completions.create({ model: CHAT_MODEL, messages });
    return r.choices?.[0]?.message?.content ?? '';
}

export async function voiceTts(text, voice = 'alloy') {
    const r = await openai.audio.speech.create({
        model:  TTS_MODEL,
        voice,
        input:  text,
        format: 'opus',
    });
    return Buffer.from(await r.arrayBuffer());
}
