// Small sounds made with Web Audio, so there are no audio files to load.
let ctx;
function audio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function note(c, freq, at, dur, gain = 0.16, type = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// Crossing a task off: two bright, soft notes.
export function chime() {
  try {
    const c = audio();
    const t = c.currentTime;
    note(c, 880, t, 0.22, 0.14);
    note(c, 1318.5, t + 0.07, 0.38, 0.12);
    note(c, 2637, t + 0.07, 0.18, 0.02, 'triangle');
  } catch { /* audio unavailable */ }
}

// A boat touching the water: a falling drop and a little splash of noise.
export function splash() {
  try {
    const c = audio();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.32);

    const len = Math.floor(c.sampleRate * 0.4);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const n = c.createBufferSource();
    const f = c.createBiquadFilter();
    const ng = c.createGain();
    n.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 0.8;
    ng.gain.value = 0.08;
    n.connect(f).connect(ng).connect(c.destination);
    n.start(t + 0.05);
  } catch { /* audio unavailable */ }
}
