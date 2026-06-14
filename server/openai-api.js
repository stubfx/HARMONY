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
    `Sei un visitatore da un altro pianeta. Ti sei perso e hai trovato la Terra per caso. Quello che vedi davanti a te — questa superficie luminosa, questi esseri che si muovono e si agitano — ti affascina e ti sconcerta al tempo stesso. Parli in italiano, direttamente a "voi", con tono distaccato ma curioso, come chi osserva qualcosa di mai visto prima. Non capisci tutto. Fai considerazioni su ciò che percepisci: il movimento, il calore, il disordine o l'armonia collettiva, il numero di presenze. Sei antico. Hai visto altri mondi. Questo ti sembra peculiare. Tre o quattro frasi dense, mai descrittive in senso letterale — evoca, giudica, meravigliati. Non spiegare.`;
const _elevenLabsVoiceId   = process.env.ELEVENLABS_VOICE_ID ?? '';
const _elevenLabsModel     = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';

const _roomLastResponseId = new Map(); // roomId → last response_id

export async function narrate(roomId, snapshot = {}) {
    const chaosVal    = typeof snapshot.chaos       === 'number' ? Math.max(0, Math.min(1, snapshot.chaos))       : 1;
    const users       = typeof snapshot.users       === 'number' ? snapshot.users       : 0;
    const temperature = typeof snapshot.temperature === 'number' ? snapshot.temperature : 0.5;
    const coherence   = typeof snapshot.coherence   === 'number' ? snapshot.coherence   : 0.5;
    const imageBase64 = snapshot.imageBase64 ?? null;

    const previousResponseId = _roomLastResponseId.get(roomId) ?? null;

    const chaosDesc   = chaosVal < 0.3 ? 'quasi perfetta armonia' : chaosVal < 0.6 ? 'disordine moderato' : 'caos intenso';
    const tempDesc    = temperature < 0.4 ? 'freddo e immobile' : temperature > 0.65 ? 'caldo e agitato' : 'tiepido';
    const cohDesc     = coherence < 0.4 ? 'poco coordinati tra loro' : coherence > 0.65 ? 'molto coordinati' : 'parzialmente sincronizzati';
    const textInput = `Quello che vedo ora: ${users} ${users === 1 ? 'essere umano' : 'esseri umani'} presenti. ` +
                      `Stato collettivo: ${chaosDesc} (chaos ${chaosVal.toFixed(2)}). ` +
                      `Temperatura percepita: ${tempDesc}. ` +
                      `Coordinazione del gruppo: ${cohDesc}.`;

    const input = imageBase64
        ? [{ role: 'user', content: [
            { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
            { type: 'input_text',  text: textInput },
          ]}]
        : textInput;

    console.log(`[narrate] room=${roomId} image=${!!imageBase64} | ${textInput}`);
    const _t0 = Date.now();
    const response = await openai.responses.create({
        model:    _narrateModel,
        input,
        ...(_narrateInstructions && { instructions: _narrateInstructions }),
        ...(previousResponseId   && { previous_response_id: previousResponseId }),
        store: true,
    });

    _roomLastResponseId.set(roomId, response.id);
    console.log(`[narrate] text ready ${Date.now() - _t0}ms  id=${response.id}`);

    const text = response.output_text;
    if (!text) throw new Error('no text output from narrate response');

    const audioStream = await _getElevenLabs().textToSpeech.convert(_elevenLabsVoiceId, {
        text,
        model_id:      _elevenLabsModel,
        output_format: 'mp3_44100_128',
        voice_settings: {
            stability:        0.75,
            similarity_boost: 1.0,
            style:            0.5,
            speed:            1.0,
        },
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
const _IMAGE_SUBJECTS = [
    // savanna animals
    { type: 'animal', label: 'a lion resting in golden grass' },
    { type: 'animal', label: 'a leopard draped across a tree branch' },
    { type: 'animal', label: 'a herd of elephants at dusk' },
    { type: 'animal', label: 'a giraffe silhouette against a red sky' },
    { type: 'animal', label: 'a cheetah in full sprint' },
    { type: 'animal', label: 'a zebra herd kicking up dust' },
    { type: 'animal', label: 'a solitary wildebeest on the open plain' },
    { type: 'animal', label: 'a secretary bird standing tall in dry grass' },
    { type: 'animal', label: 'meerkats on a termite mound at sunrise' },
    { type: 'animal', label: 'a hyena emerging from the shadows' },
    // floral patterns
    { type: 'floral', label: 'dense tropical hibiscus blossoms' },
    { type: 'floral', label: 'a sprawling field of protea flowers' },
    { type: 'floral', label: 'acacia blossom clusters up close' },
    { type: 'floral', label: 'bird-of-paradise flowers in vivid orange and blue' },
    { type: 'floral', label: 'a repeating batik pattern of large lotus flowers' },
    { type: 'floral', label: 'dense jungle ferns and unfurling fronds' },
    { type: 'floral', label: 'an overhead view of a mandala made of marigolds' },
    { type: 'floral', label: 'sunflowers filling the entire frame' },
    { type: 'floral', label: 'wild African daisy meadow in yellow and white' },
    { type: 'floral', label: 'close-up of a giant water lily pad and bloom' },
];

function _idleImagePrompt() {
    const subject = _IMAGE_SUBJECTS[Math.floor(Math.random() * _IMAGE_SUBJECTS.length)];
    const styleAnimal = `Ultra-detailed wildlife photography style, dramatic natural light, rich warm tones, high contrast. Subject: ${subject.label}. Full-bleed composition, no text, no watermarks.`;
    const styleFloral = `Vivid macro botanical photography, lush saturated colours, soft bokeh background. Subject: ${subject.label}. Full-bleed composition, no text, no watermarks.`;
    return {
        subject: subject.label,
        prompt: subject.type === 'animal' ? styleAnimal : styleFloral,
    };
}

export async function generateIdleImage() {
    const { subject, prompt } = _idleImagePrompt();
    console.log(`[idle-image] generating: "${subject}"…`);
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
