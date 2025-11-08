import express from "express";
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import dotenv from "dotenv";
import cors from "cors";
import * as Utils from './server-utils.js';
import {chat, imagine, saveFileInVectorStore} from './openai-api.js';
import { randomUUID } from "node:crypto";

dotenv.config();

const ORIGINS = ["https://stubfx.io", "https://localhost", "https://192.168.1.12"];
const app = express();
const server = createServer(app);
const port = process.env.PORT;

const io = new Server(server, {
  path: "/socket.io",// keep in sync with client
  cors: {
    origin: ORIGINS,// no "*" if credentials=true
    methods: ["GET", "POST"],
    credentials: true
  }
});
app.use(express.json())
app.set('trust proxy', true);

let hostList = {}

io.on('connection', (socket) => {
    console.log('device connected');

    socket.on("event", (event) => {
        io.to(hostList[event.room]).emit("event", event.gyro);
    });

    socket.on("gyro", (event) => {
        io.to(hostList[event.room]).emit("gyro", event.gyro);
    });

    socket.on("color", (event) => {
        io.to(hostList[event.room]).emit("color", event.color);
    });

    socket.on("text-input", (event) => {
        io.to(hostList[event.room]).emit("text-input", event.data);
    });

    socket.on("register-host", (host) => {
        console.log("register-host", host.room);
        hostList[host.room] = socket.id;
    });
});


// allow only localhost:5173 (vite dev default)
app.use(cors({
    origin: ORIGINS,   // or "*" for all origins
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));


app.post("/uuid", async (req, res) => {
    res.json(randomUUID());
});

app.post("/chat", async (req, res) => {
    const text = await chat(req.body.text);
    res.json(JSON.parse(text.output_text));
});

app.post("/save", async (req, res) => {
    const data = req.body;
    const text = await saveFileInVectorStore(data.name, data.simConfig);
    res.json('ok');
});

app.post("/rndImage", async (req, res) => {
    const {fileName, data} = await Utils.randomPrevImage();
    const decoded = data.toString('base64');
    const base64 = "data:image/png;base64," + decoded;
    res.json({name: fileName, data: base64})
});

app.post("/imagine", async (req, res) => {
    const imagine_res = await imagine(req.body.prompt);
    const imageData = imagine_res.output.findLast(el => !!el.result)
    if (imageData) {
        // save the image first.
        Utils.saveBase64Async(imageData.result);
        res.json("data:image/png;base64," + imageData.result)
    } else {
        res.json();
    }
});

server.listen(port, () => {
    console.log(`Server running at :${port}`);
});

