import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function chat(text) {
    return await openai.responses.create({
        prompt: {
            "id": "pmpt_69008cb402f08193af25c0255cf58bd00b05f606f3d9299e",
            "version": "19"
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
        text: {
            "format": {
                "type": "json_schema",
                "name": "emotion_to_simulation",
                "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {
                        "feelings": {
                            "type": "object",
                            "properties": {
                                "arousal": {
                                    "type": "number",
                                    "description": "Energy / intensity / pace of activity, from 0 (low) to 1 (high)",
                                    "minimum": 0,
                                    "maximum": 1
                                },
                                "valence": {
                                    "type": "number",
                                    "description": "Emotional pleasantness, from 0 (negative) to 1 (positive)",
                                    "minimum": 0,
                                    "maximum": 1
                                },
                                "dominance": {
                                    "type": "number",
                                    "description": "Sense of control, confidence, or assertiveness, from 0 (low) to 1 (high)",
                                    "minimum": 0,
                                    "maximum": 1
                                },
                                "cohesion": {
                                    "type": "number",
                                    "description": "Unity and harmony among agents/elements, from 0 (low) to 1 (high)",
                                    "minimum": 0,
                                    "maximum": 1
                                },
                                "novelty": {
                                    "type": "number",
                                    "description": "Unpredictability, surprise, or exploration, from 0 (low) to 1 (high)",
                                    "minimum": 0,
                                    "maximum": 1
                                },
                                "focus": {
                                    "type": "number",
                                    "description": "Stability, precision, attention, from 0 (low) to 1 (high)",
                                    "minimum": 0,
                                    "maximum": 1
                                },
                                "tension": {
                                    "type": "number",
                                    "description": "Latent unease or unresolved energy, from 0 (low) to 1 (high)",
                                    "minimum": 0,
                                    "maximum": 1
                                }
                            },
                            "required": [
                                "arousal",
                                "valence",
                                "dominance",
                                "cohesion",
                                "novelty",
                                "focus",
                                "tension"
                            ],
                            "additionalProperties": false
                        },
                        "color": {
                            "type": "string",
                            "description": "A hex color representing the combined emotion (e.g. #1A2B3C)",
                            "pattern": "^#[0-9A-Fa-f]{6}$"
                        }
                    },
                    "required": [
                        "feelings",
                        "color"
                    ],
                    "additionalProperties": false
                }
            }
        },
        reasoning: {},
        tools: [
            {
                "type": "image_generation",
                "background": "transparent",
                "model": "gpt-image-1-mini",
                "moderation": "auto",
                "output_compression": 100,
                "output_format": "png",
                "quality": "low",
                "size": "1024x1024"
            }
        ],
        max_output_tokens: 2048,
        store: true,
        include: ["web_search_call.action.sources"]  
    });
}
