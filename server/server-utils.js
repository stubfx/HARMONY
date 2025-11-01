import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import dotenv from "dotenv";
import { readFileSync } from 'node:fs';
dotenv.config();

const currentDir = process.cwd()
// yeah, i know.
const assDir = `${currentDir}/${process.env.SERVER_ASSETS_DIR}`;


async function listFiles() {
    const entries = await readdir(assDir, { withFileTypes: true });
    return entries
        .filter(e => e.isFile())
        .map(e => join(assDir, e.name));
}

export async function randomPrevImage() {
    const files = await listFiles();
    if (files.length === 0) return null;
    const i = Math.floor(Math.random() * files.length);
    const filePath = files[i];
    const data = readFileSync(filePath);   // Buffer
    return { filePath, data };
}

export async function saveBase64Async(base64) {
    const buffer = Buffer.from(base64, 'base64');
    const fileName = `${assDir}/${randomUUID()}.png`;
    console.log(`saving to ${fileName}`);
    await writeFile(fileName, buffer);
}

