import './style.css';

import {io} from 'socket.io-client';
import {startGyro} from './gyro';

const urlParams = new URLSearchParams(window.location.search);
const uuid = urlParams.get("s");

const socket = io(import.meta.env.VITE_API_HOSTNAME);

const testButton = document.querySelector("#test");

console.log("test")

socket.on('connect', s => {
    const status = document.querySelector("#status");
    status.classList.add("connected")
});

test.onclick = () => {
    socket.emit("event", {room: uuid})
}
let gyroData;
startGyro(60, (data) => {
    console.log(data);
    gyroData = data;
})

const role = "spec";

function loop() {
  if (gyroData) {
    socket.emit("gyro", {room: uuid, role, gyro: gyroData})
  }
  setTimeout(loop, 1000);      // 1 Hz
}
loop();
