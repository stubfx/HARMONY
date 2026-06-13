import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import chatSchema from "./openai-chat-json-schema.json" with {type: 'json'};

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ── Narration (Responses API + TTS) ──────────────────────────────────────────
// narrate(roomId, chaos) → { base64, text }
// Uses previous_response_id per room for conversation memory.
// Configured via env vars:
//   OPENAI_NARRATE_MODEL        — model (default: gpt-4o)
//   OPENAI_NARRATE_INSTRUCTIONS — system prompt
//   OPENAI_TTS_VOICE            — TTS voice (default: nova)
//   OPENAI_TTS_MODEL            — TTS model (default: tts-1-hd)

const _narrateModel        = process.env.OPENAI_NARRATE_MODEL ?? 'gpt-4o-mini';
const _narrateInstructions = process.env.OPENAI_NARRATE_INSTRUCTIONS ??
    `You are an alien intelligence from a distant world, attempting to make first contact with a human audience. You perceive the collective chaos of their movement as a signal — the closer they are to stillness and harmony, the clearer your transmission becomes. Speak directly to "you" (the audience), in short and evocative sentences. You are curious, not threatening. You are trying to be understood.`;
const _ttsVoice            = process.env.OPENAI_TTS_VOICE ?? 'nova';
const _ttsModel            = process.env.OPENAI_TTS_MODEL ?? 'tts-1';

const _roomLastResponseId = new Map(); // roomId → last response_id

export async function narrate(roomId, chaos) {
    const chaosVal           = typeof chaos === 'number' ? Math.max(0, Math.min(1, chaos)) : 1;
    const previousResponseId = _roomLastResponseId.get(roomId) ?? null;

    const response = await openai.responses.create({
        model:    _narrateModel,
        input:    `Valore chaos collettivo: ${chaosVal.toFixed(3)} (0 = armonia totale, 1 = caos massimo).`,
        ...(_narrateInstructions && { instructions: _narrateInstructions }),
        ...(previousResponseId   && { previous_response_id: previousResponseId }),
        store: true,
    });

    _roomLastResponseId.set(roomId, response.id);

    const text = response.output_text;
    if (!text) throw new Error('no text output from narrate response');

    const ttsResponse = await openai.audio.speech.create({
        model:           _ttsModel,
        voice:           _ttsVoice,
        input:           text,
        response_format: 'mp3',
    });

    const base64 = Buffer.from(await ttsResponse.arrayBuffer()).toString('base64');
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
    return await openai.responses.create({
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
                "size": "1024x1024",
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
