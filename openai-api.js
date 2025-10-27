import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function chat(text) {
    return await openai.responses.create({
        model: "gpt-4.1-nano",
        input: [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": "You are an agent controlling a physical simulation through simple outputs."
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": text
                    }
                ]
            },
        ],
        text: {
            "format": {
                "type": "json_schema",
                "name": "color_hex",
                "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {
                        "color": {
                            "type": "string",
                            "description": "A hex color code in the format #RRGGBB (e.g. #FF0033) based on the user explicit and/or implicit request.",
                            "pattern": "^#[0-9A-Fa-f]{6}$"
                        }
                    },
                    "required": [
                        "color"
                    ],
                    "additionalProperties": false
                }
            }
        },
        reasoning: {},
        tools: [],
        temperature: 1,
        max_output_tokens: 2048,
        top_p: 1,
        store: true,
        include: ["web_search_call.action.sources"]
    });
}
