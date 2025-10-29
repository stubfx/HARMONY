import { Runware } from "@runware/sdk-js";
import dotenv from "dotenv";

dotenv.config();

const runware = new Runware({
    apiKey: process.env.RUNWARE_API_KEY,
    shouldReconnect: true,
    globalMaxRetries: 3,
});

export async function imagine(prompt) {
    return await runware.requestImages({
        positivePrompt: prompt,
        model: "runware:101@1",
        width: 1024,
        height: 1024,
    });

}
