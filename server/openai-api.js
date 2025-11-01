import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import chatSchema from "./openai-chat-json-schema.json" with {type: 'json'};

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
