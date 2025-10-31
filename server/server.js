import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import {chat, imagine, saveFileInVectorStore} from './openai-api.js';

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
    res.json(JSON.parse(text.output_text));
});

app.post("/save", async (req, res) => {
    const data = req.body;
    const text = await saveFileInVectorStore(data.name, data.simConfig);
    res.json('ok');
});

app.post("/imagine", async (req, res) => {
    const imagine_res = await imagine(req.body.prompt);
    const imageData = imagine_res.output.findLast(el => !!el.result)
    if (imageData)
        res.json("data:image/png;base64," + imageData.result)
        else
        res.json();
});

app.listen(port, () => {
    console.log(`Server running at :${port}`);
});

