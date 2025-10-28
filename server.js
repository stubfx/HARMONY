import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import {chat} from './openai-api.js';

dotenv.config();

const app = express();
const port = process.env.PORT;

app.use(express.json())
app.set('trust proxy', true);

// allow only localhost:5173 (vite dev default)
app.use(cors({
    origin: ["https://stubfx.io", "http://localhost:5173"],   // or "*" for all origins
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.post("/chat", async (req, res) => {
    const text = await chat(req.body.text);
    res.json(text.output_text);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

