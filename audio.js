import {baseParams, params, debug} from '/tunables.js';


export async function captureVolume() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512; // smaller size → faster, coarser
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);

  function update() {
    analyser.getByteTimeDomainData(data);
    
    // compute RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128.0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const volume = rms; // 0.0–1.0 approx

    // console.log(volume);
    // params.TURN_JITTER = baseParams.TURN_JITTER + volume * 50;
    // params.STEP_LEN = baseParams.STEP_LEN + volume * 50;

    requestAnimationFrame(update);
  }

  update();
}
