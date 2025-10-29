import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function chat(text) {
    return await openai.responses.create({
        prompt: {
            "id": "pmpt_6901d285bcac819383687e9bbc72515a0067f4fc25dbf8d1",
            "version": "3"
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
                            "type": "object",
                            "properties": {
                                "primary": {
                                    "type": "string",
                                    "description": "The main hex color representing the combined emotion (e.g. #1A2B3C)",
                                    "pattern": "^#[0-9A-Fa-f]{6}$"
                                },
                                "secondary": {
                                    "type": "string",
                                    "description": "A hex color that goes well with the primary color",
                                    "pattern": "^#[0-9A-Fa-f]{6}$"
                                },
                                "terciary": {
                                    "type": "string",
                                    "description": "A hex color that goes well with both the primary and secondary colors",
                                    "pattern": "^#[0-9A-Fa-f]{6}$"
                                }
                            },
                            "required": [
                                "primary",
                                "secondary",
                                "terciary"
                            ],
                            "additionalProperties": false
                        },
                        "image_prompt": {
                            "type": "string",
                            "description": "A text prompt describing an image evoking the specified emotions",
                            "minLength": 1
                        }
                    },
                    "required": [
                        "feelings",
                        "color",
                        "image_prompt"
                    ],
                    "additionalProperties": false
                }
            }
        },
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
