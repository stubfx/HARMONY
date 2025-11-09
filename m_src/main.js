import './style.css';
import {getMovement} from './motion.js';

import {io} from 'socket.io-client';
import {startDeviceTilt} from './gyro';

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

let motion;

const buttons = document.querySelectorAll(".quick-color")
const formEl = document.querySelector("#input-form")


startDeviceTilt(30, (d) => {
  // if (d.enabled) { /* disable UI */ return; }
  // d = { a, b, g, motion, enabled:true }
  // use normalized yaw/pitch/roll and recent-tilt "motion"
    motion = d.enabled ? d.motion : 0;
});


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

function sendEvent() {
    // sending the event will show a ui feedback
    statusEl.classList.add("loading");   
    setTimeout(() => {
        statusEl.classList.remove("loading");   
    }, 500);
}

function heartBeat() {
  if (motion) {
    socket.emit("motion", {room: uuid, role: ROLE, motion: motion})
  }
  setTimeout(heartBeat, 1000);      // 1 Hz
}
heartBeat();
