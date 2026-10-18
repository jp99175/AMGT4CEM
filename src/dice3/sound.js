// Petit « clac » synthétique (voyants qui brouillent), limité en cadence ; coupé par le bouton SOUND.
let audio = null;
let lastTick = 0;
export const sound = { on: true };
export function unlockAudio() {
  try { audio ||= new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch { /* pas de son */ }
}
export function tick() {
  const now = performance.now();
  if (!sound.on || !audio || now - lastTick < 35) return;
  lastTick = now;
  const len = Math.floor(audio.sampleRate * 0.025);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = audio.createBufferSource();
  const filt = audio.createBiquadFilter();
  const gain = audio.createGain();
  filt.type = 'bandpass'; filt.frequency.value = 1800;
  gain.gain.value = 0.25;
  src.buffer = buf;
  src.connect(filt).connect(gain).connect(audio.destination);
  src.start();
}

