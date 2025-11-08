import './style.css';

import {io} from 'socket.io-client';
import {startGyro} from './gyro';

const ROLE = "spec";
const urlParams = new URLSearchParams(window.location.search);
const uuid = urlParams.get("s");

const socket = io(import.meta.env.VITE_API_HOSTNAME);

const randomColor = () =>
  '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');

console.log(randomColor());

const statusEl = document.querySelector("#status");
socket.on('connect', s => {
    statusEl.classList.add("connected")
});

let gyroData;

const buttons = document.querySelectorAll(".quick-color")
const formEl = document.querySelector("#input-form")

formEl.onsubmit = (e) => {
    // prevent page reoload
    e.preventDefault();
    const form = new FormData(formEl);
    const data = Object.fromEntries(form);
    if (!data.text1) return;
    sendEvent()
    formEl.reset();
    socket.emit("text-input", {room: uuid, role: ROLE, data: data.text1})
}

buttons.forEach((el) => {
    const color = randomColor();
    console.log(color)
    el.style.backgroundColor = color;
    el.onclick = () => {
        socket.emit("color", {room: uuid, role: ROLE, color: color})
    }
})

startGyro(60, (data) => {
    console.log(data)
    gyroData = data;
})


function sendEvent() {
    // sending the event will show a ui feedback
    statusEl.classList.add("loading");   
    setTimeout(() => {
        statusEl.classList.remove("loading");   
    }, 500);
}

function loop() {
  if (gyroData) {
    // socket.emit("gyro", {room: uuid, role: ROLE, gyro: gyroData})
  }
  setTimeout(loop, 1000);      // 1 Hz
}
loop();
