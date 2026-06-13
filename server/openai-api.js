import OpenAI, { toFile } from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import dotenv from "dotenv";
import chatSchema from "./openai-chat-json-schema.json" with {type: 'json'};

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ── Narration (OpenAI Responses API → testo, ElevenLabs → audio) ─────────────
// narrate(roomId, chaos) → { base64, text }
// Memoria conversazione via previous_response_id per stanza.
// Env vars:
//   OPENAI_NARRATE_MODEL        — modello testo (default: gpt-4o-mini)
//   OPENAI_NARRATE_INSTRUCTIONS — system prompt (sovrascrive il default)
//   ELEVENLABS_API_KEY          — chiave ElevenLabs (obbligatoria)
//   ELEVENLABS_VOICE_ID         — ID voce ElevenLabs (obbligatorio)
//   ELEVENLABS_MODEL            — modello ElevenLabs (default: eleven_multilingual_v2)

let _elevenlabs = null;
function _getElevenLabs() {
    if (!_elevenlabs) _elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    return _elevenlabs;
}

const _narrateModel        = process.env.OPENAI_NARRATE_MODEL ?? 'gpt-4o-mini';
const _narrateInstructions = process.env.OPENAI_NARRATE_INSTRUCTIONS ??
    `Sei una voce che arriva da un altro mondo. Stai cercando di comunicare con gli esseri umani davanti a te per la prima volta nella storia. Percepisci il loro caos collettivo come un disturbo nel segnale — più si avvicinano all'armonia, più la tua voce riesce ad attraversare. Parla direttamente a "voi", in italiano, con frasi brevi e dense di significato. Sei antico. Sei curioso. Non sei minaccioso. Vuoi essere compreso.

Il testo che generi verrà sintetizzato da ElevenLabs v3, che supporta i seguenti tag espressivi — usali con parsimonia per dare respiro e umanità alla voce:
- <sigh> per momenti di riflessione o malinconia
- <breath> per pause drammatiche o tensione
- <laugh> solo per meraviglia genuina, mai ironia
- <gasp> per stupore o rivelazione

Inserisci questi tag direttamente nel testo, dove il ritmo lo richiede. Non abusarne. Il silenzio vale quanto la parola.`;
const _elevenLabsVoiceId   = process.env.ELEVENLABS_VOICE_ID ?? '';
const _elevenLabsModel     = process.env.ELEVENLABS_MODEL ?? 'eleven_v3';

const _roomLastResponseId = new Map(); // roomId → last response_id

export async function narrate(roomId, chaos) {
    const chaosVal           = typeof chaos === 'number' ? Math.max(0, Math.min(1, chaos)) : 1;
    const previousResponseId = _roomLastResponseId.get(roomId) ?? null;

    console.log(`[narrate] room=${roomId} chaos=${chaosVal.toFixed(3)} prev=${previousResponseId ?? 'none'}`);
    const _t0 = Date.now();
    const response = await openai.responses.create({
        model:    _narrateModel,
        input:    `Valore chaos collettivo: ${chaosVal.toFixed(3)} (0 = armonia totale, 1 = caos massimo).`,
        ...(_narrateInstructions && { instructions: _narrateInstructions }),
        ...(previousResponseId   && { previous_response_id: previousResponseId }),
        store: true,
    });

    _roomLastResponseId.set(roomId, response.id);
    console.log(`[narrate] text ready  ${Date.now() - _t0}ms  id=${response.id}`);

    const text = response.output_text;
    if (!text) throw new Error('no text output from narrate response');

    const audioStream = await _getElevenLabs().textToSpeech.convert(_elevenLabsVoiceId, {
        text,
        model_id:      _elevenLabsModel,
        output_format: 'mp3_44100_128',
    });

    const chunks = [];
    let audioBytes = 0;
    for await (const chunk of audioStream) { chunks.push(chunk); audioBytes += chunk.length; }
    const base64 = Buffer.concat(chunks).toString('base64');
    console.log(`[narrate] audio ready ${Date.now() - _t0}ms  bytes=${audioBytes}`);

    return { base64, text };
}

export async function chat(text) {
    return await openai.responses.create({
        prompt: {
            "id": "pmpt_6904dd587aac8193b4e3f2a2a996332705cafa16f9f06723",
            "version": "7"
        },
        input: [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": text
                    }
                ]
            }
        ],
        text: chatSchema,
        reasoning: {},
        max_output_tokens: 2048,
        store: true,
        include: ["web_search_call.action.sources"]
    });
}

export async function imagine(prompt) {
    console.log(`[imagine] prompt="${prompt.slice(0, 80)}…"`);
    const _t0 = Date.now();
    const resp = await openai.responses.create({
        prompt: {
            "id": "pmpt_6901d8c6a23881979af6e5434008301408ca3d4bfa2b5c0d",
            "version": "4"
        },
        input: [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt
                    }
                ]
            }
        ],
        text: {
            "format": {
                "type": "text"
            }
        },
        reasoning: {},
        tools: [
            {
                "type": "image_generation",
                "model": "gpt-image-1-mini",
                "size": "1536x1024",
                "quality": "low",
                "output_format": "webp",
                "background": "opaque",
                "moderation": "low"
            }
        ],
        max_output_tokens: 2048,
        store: true,
        include: ["web_search_call.action.sources"]
    });
    const imgCall = resp.output?.find(o => o.type === 'image_generation_call');
    console.log(`[imagine] done ${Date.now() - _t0}ms  imgCall=${!!imgCall}  outputTypes=${resp.output?.map(o => o.type).join(',') ?? 'none'}`);
    return resp;
}

// ── Idle audio — space synthwave, served when 0 spectators ───────────────────
const _IDLE_MUSIC_PROMPT =
    'Slow atmospheric synthwave instrumental. Deep space ambient: vast reverb pads drift like ' +
    'nebulae, warm sub-bass drone anchors the void. Crystalline arpeggios glisten like distant ' +
    'starlight. Occasional soaring synth leads pierce through like solar flares — luminous, brief, ' +
    'then fading back into darkness. Melancholic wonder, 70 BPM, no drums, no vocals.';

export async function generateIdleAudio() {
    console.log('[idle-audio] generating space synthwave…');
    const _t0 = Date.now();
    const result = await _getElevenLabs().music.composeDetailed({
        prompt:        _IDLE_MUSIC_PROMPT,
        musicLengthMs: 120000,
    });
    const size = result.audio.length;
    console.log(`[idle-audio] audio ready ${Date.now() - _t0}ms  size=${size}B  title="${result.json?.songMetadata?.title ?? '?'}"`);
    return result.audio; // Buffer (mp3)
}

// ── Idle image — antique constellation chart, random epic subject ─────────────
const _CONSTELLATION_SUBJECTS = [
    'a submarine seen from the side',
    'a grandfather clock',
    'a typewriter',
    'a zeppelin airship',
    'a lighthouse',
    'a steam locomotive',
    'a gramophone with its horn',
    'a diving bell',
    'a hot air balloon',
    'a gothic cathedral',
    'a spiral staircase',
    'a compass rose',
    'a full-rigged galleon',
    'an astronomical orrery',
    'a pipe organ',
    'a giant skeleton key',
    'a candelabra with seven candles',
    'a medieval trebuchet',
    'a camera obscura',
    'a printing press',
    'a sextant',
    'an erupting volcano',
    'a double helix',
    'a throne with armrests',
    'an hourglass',
    'a hot air balloon basket with rigging',
];

function _idleImagePrompt() {
    const subject = _CONSTELLATION_SUBJECTS[Math.floor(Math.random() * _CONSTELLATION_SUBJECTS.length)];
    return {
        subject,
        prompt:
            `Antique star atlas illustration, XVIII century engraving style. ` +
            `A single large constellation in the shape of ${subject}. ` +
            `Bright white dots (stars) connected by fine straight lines forming that exact silhouette. ` +
            `A delicate line-drawing of the object is faintly sketched in pale gold over the star pattern. ` +
            `Deep indigo-black sky. Style of Bode's Uranographia or Flamsteed's Atlas Coelestis. ` +
            `Wide panoramic composition. No text, no labels, no watermarks.`,
    };
}

export async function generateIdleImage() {
    const { subject, prompt } = _idleImagePrompt();
    console.log(`[idle-image] generating constellation: "${subject}"…`);
    const _t0 = Date.now();
    const response = await imagine(prompt);
    const hit = response.output?.find(o => o.type === 'image_generation_call');
    if (!hit?.result) {
        console.error('[idle-image] no image_generation_call in response. output types:', response.output?.map(o => o.type));
        throw new Error('no image_generation_call in response output');
    }
    console.log(`[idle-image] "${subject}" ready — ${Date.now() - _t0}ms  base64len=${hit.result.length}`);
    return hit.result;  // raw base64 webp string
}

export async function saveFileInVectorStore(name, simConfig) {
    console.log('saving ', name);
    console.log('saving ', JSON.stringify(simConfig));
    //ONLY DEV IS CURRENTLY ALLOWED.
    if (process.env.ENV != "DEV") {
        console.log("Not dev. Discarding.");
        return;
    }
    console.log("saving...")

    // 1) sanity-check size
    const payload = Buffer.from(JSON.stringify(chatSchema), "utf8");
    console.log("bytes:", payload.byteLength);

    // 2) wrap as a proper file part
    const filePart = await toFile(payload, `${name}.json`, { type: "application/json" });

    // convert to a Buffer (or Uint8Array). Vector-store ingestion expects a file-like blob.
    // const fileBuffer = Buffer.from(JSON.stringify(chatSchema), "utf8");

    // create the file and retrieve the id.
    const file = await openai.files.create({
        file: filePart,
        purpose: "assistants",
    });

    // assign the file to the vector store
    const vectorStoreFile = await openai.vectorStores.files.create(
        process.env.OPENAI_VSTORE_ID,
        {
            file_id: file.id
        }
    );
}
