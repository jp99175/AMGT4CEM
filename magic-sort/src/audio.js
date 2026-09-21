// Every sound is synthesized on the fly with WebAudio -- no binary assets,
// so the game loads instantly and stays self-contained.
let ctx = null;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  return ctx;
}

function tone({ freq = 440, duration = 0.12, type = "sine", gain = 0.15, slideTo = null, delay = 0 }) {
  const audioCtx = getCtx();
  const startAt = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, startAt + duration);
  g.gain.setValueAtTime(0.0001, startAt);
  g.gain.exponentialRampToValueAtTime(gain, startAt + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export const audio = {
  sfxEnabled: true,
  musicEnabled: true,

  unlock() {
    const audioCtx = getCtx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  },

  select() {
    if (!this.sfxEnabled) return;
    tone({ freq: 560, duration: 0.07, type: "triangle", gain: 0.09 });
  },

  pour() {
    if (!this.sfxEnabled) return;
    tone({ freq: 340, duration: 0.22, type: "sine", gain: 0.11, slideTo: 210 });
  },

  invalid() {
    if (!this.sfxEnabled) return;
    tone({ freq: 180, duration: 0.16, type: "sawtooth", gain: 0.06 });
    tone({ freq: 140, duration: 0.18, type: "sawtooth", gain: 0.05, delay: 0.05 });
  },

  merge() {
    if (!this.sfxEnabled) return;
    tone({ freq: 700, duration: 0.09, type: "sine", gain: 0.08 });
  },

  victory() {
    if (!this.sfxEnabled) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone({ freq, duration: 0.22, type: "triangle", gain: 0.11, delay: i * 0.09 });
    });
  },
};
