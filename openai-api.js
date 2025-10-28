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
            "version": "4"
        },
        input: [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "relaxing sunlight"
                    }
                ]
            }
        ],
        text: {
            "format": {
                "type": "json_schema",
                "name": "simulation_schema",
                "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {
                        "STEP_LEN": {
                            "type": "number",
                            "description": "Step length of the simulation. Higher number = faster simulation.",
                            "minimum": 0,
                            "maximum": 200
                        },
                        "DRAG": {
                            "type": "number",
                            "description": "Drag coefficient",
                            "minimum": 0,
                            "maximum": 5
                        },
                        "TURN_JITTER": {
                            "type": "number",
                            "description": "Amount of direction jitter per step",
                            "minimum": 0.05,
                            "maximum": 2
                        },
                        "SENSE_DIST": {
                            "type": "number",
                            "description": "Sensor distance",
                            "minimum": 1,
                            "maximum": 200
                        },
                        "SENSE_ANGLE": {
                            "type": "number",
                            "description": "Sensor angle in radians",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "TURN_RATE": {
                            "type": "number",
                            "description": "Agent turning rate",
                            "minimum": 0,
                            "maximum": 100
                        },
                        "POINT_SIZE": {
                            "type": "number",
                            "description": "Rendered point size",
                            "minimum": 1,
                            "maximum": 3
                        },
                        "DEPOSIT_SIZE": {
                            "type": "number",
                            "description": "Deposit size for trail",
                            "minimum": 0.5,
                            "maximum": 40
                        },
                        "DEPOSIT_STRENGTH": {
                            "type": "number",
                            "description": "Strength of each deposit",
                            "minimum": 0,
                            "maximum": 20
                        },
                        "DEPOSIT_EDGE_SOFT": {
                            "type": "number",
                            "description": "Softness of deposit edge",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "CHAMP_SAMPLE_INTERVAL": {
                            "type": "number",
                            "description": "Sample interval for champion detection. Defined as 1 every X amount",
                            "minimum": 1,
                            "maximum": 1000000
                        },
                        "CHAMP_IMP_MULTIPLIER": {
                            "type": "number",
                            "description": "Multiplier for champion importance",
                            "minimum": 1,
                            "maximum": 5000
                        },
                        "TRAIL_DECAY": {
                            "type": "number",
                            "description": "Trail decay ratio",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "ENABLE_MOUSE": {
                            "type": "boolean",
                            "description": "Enable or disable mouse input"
                        },
                        "SHOW_TRAIL": {
                            "type": "boolean",
                            "description": "Display the agent trail"
                        },
                        "POINT_COLOR_HEX": {
                            "type": "string",
                            "description": "Color in hexadecimal integer format (es. #a308e3)"
                        }
                    },
                    "required": [
                        "STEP_LEN",
                        "DRAG",
                        "TURN_JITTER",
                        "SENSE_DIST",
                        "SENSE_ANGLE",
                        "TURN_RATE",
                        "POINT_SIZE",
                        "DEPOSIT_SIZE",
                        "DEPOSIT_STRENGTH",
                        "DEPOSIT_EDGE_SOFT",
                        "CHAMP_SAMPLE_INTERVAL",
                        "CHAMP_IMP_MULTIPLIER",
                        "TRAIL_DECAY",
                        "ENABLE_MOUSE",
                        "SHOW_TRAIL",
                        "POINT_COLOR_HEX"
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
