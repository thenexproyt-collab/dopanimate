'use strict';
// Dopamina — roguelike que muta: empieza como un juego de anillos y se va transformando
// (rompebloques circular, enjambre, tragaperras...) mientras todo se vuelve más psicodélico.

const TAU = Math.PI * 2;
const $ = s => document.querySelector(s);
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const sgn = () => Math.random() < 0.5 ? -1 : 1;

function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('es-ES');
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];
  let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + u[i];
}

// ---------------------------------------------------------------- guardado (solo lo permanente)
const SAVE_KEY = 'dopamina_rogue_v2';
const meta = { shards: 0, best: 0, bestScore: 0, runs: 0, up: {}, seen: [] };
let resetting = false;
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) { Object.assign(meta, s); meta.up = Object.assign({}, s.up); meta.seen = s.seen || []; }
  } catch (e) { }
}
function save() { if (resetting) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(meta)); } catch (e) { } }
const metaLv = id => meta.up[id] || 0;

const META = [
  { id: 'hp', name: 'Corazón inicial', desc: '+1 corazón al empezar', costs: [15, 50, 120] },
  { id: 'shots', name: 'Cargador', desc: '+1 tiro / munición al empezar', costs: [10, 35, 90] },
  { id: 'time', name: 'Reloj', desc: '+10% de tiempo en cada piso', costs: [10, 30, 70] },
  { id: 'reroll', name: 'Dado', desc: '+1 cambio de cartas por partida', costs: [8, 25, 60] },
  { id: 'luck', name: 'Trébol', desc: 'Salen cartas más raras', costs: [20, 70] },
  { id: 'start', name: 'Equipaje', desc: 'Empiezas con una carta rara', costs: [25] },
  { id: 'shield', name: 'Coraza', desc: 'Empiezas con la carta Escudo', costs: [40] },
];

// ---------------------------------------------------------------- audio: efectos + música generativa
const Sfx = (() => {
  let ac = null, master = null, musicBus = null, musicLP = null, analyser = null, noiseBuf = null, volume = 0.7;
  let windowStart = 0, voices = 0;
  const gainFor = v => 0.8 * v * v;
  const SCALE = [0, 2, 4, 7, 9];
  const note = i => 220 * Math.pow(2, (Math.floor(i / 5) * 12 + SCALE[((i % 5) + 5) % 5]) / 12);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master = ac.createGain(); master.gain.value = gainFor(volume);
    master.connect(comp); comp.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = 0.55;
    musicLP = ac.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 420; musicLP.Q.value = 0.6;
    musicBus.connect(musicLP); musicLP.connect(master);
    analyser = ac.createAnalyser(); analyser.fftSize = 1024; musicLP.connect(analyser);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startSeq();
  }
  function budget(n = 1) {
    if (!ac) return false;
    const now = ac.currentTime;
    if (now - windowStart > 0.05) { windowStart = now; voices = 0; }
    if (voices + n > 7) return false;
    voices += n; return true;
  }
  function tone(f, dur, type = 'sine', vol = 0.2, slide = 0, when = 0, bus = master, at) {
    const t = at !== undefined ? at : ac.currentTime + when;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, freq, q = 1, when = 0, bus = master, at, type = 'bandpass') {
    const t = at !== undefined ? at : ac.currentTime + when;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.02);
  }

  // --- drum & bass generativo (174 bpm). Empieza apagado y gris; se va abriendo con la dopamina.
  const FLAVOR = {
    rings: { root: 33, scale: [0, 3, 5, 7, 10], lead: 'sawtooth' },
    breakout: { root: 36, scale: [0, 2, 3, 7, 8], lead: 'square' },
    swarm: { root: 31, scale: [0, 1, 5, 7, 8], lead: 'sawtooth' },
    plinko: { root: 38, scale: [0, 2, 4, 7, 9], lead: 'triangle' },
    multiply: { root: 35, scale: [0, 3, 5, 7, 10], lead: 'square' },
    merge: { root: 34, scale: [0, 2, 4, 7, 9], lead: 'triangle' },
    chain: { root: 32, scale: [0, 3, 5, 6, 10], lead: 'sawtooth' },
    hole: { root: 30, scale: [0, 1, 3, 7, 8], lead: 'square' },
  };
  const BPM = 174;
  const KICKS = ['x.........x.....', 'x.........x.....', 'x.....x...x.....', 'x.........x..x..'];
  const BASSP = ['x..x..x...x.x...', 'x..x....x.x..x..', 'x.x...x.x..x..x.', 'x..x..x...x.xx..'];
  const ARPP = 'x.xx.xx.x.xx.xx.';
  const ARPN = [0, 2, 4, 2, 1, 3, 4, 6];
  let style = FLAVOR.rings, pending = null, seq = null, step = 0, nextT = 0, dopa = 0, frenzyOn = false, onBeat = null, lastCut = 0;

  function reese(m, dur, t, vol) {
    const f = mtof(m), open = 320 + dopa * 1500 + (frenzyOn ? 700 : 0);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(open * 0.45, t);
    lp.frequency.exponentialRampToValueAtTime(open, t + dur * 0.35);
    lp.frequency.exponentialRampToValueAtTime(open * 0.4, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur * 0.8)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const det of [-16, 16]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
    lp.connect(g); g.connect(musicBus);
  }
  function pad(m, dur, t, vol) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.35);
    g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const det of [-9, 9]) {
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    }
    g.connect(musicBus);
  }
  function playStep(st, t) {
    const i = st % 16, bar = Math.floor(st / 16), spb = 60 / BPM / 4, L = dopa;
    if (i === 0 && pending) { style = pending; pending = null; }
    const S = style;
    const prog = [0, 0, 2, 3, 0, 4, 2, 3][bar % 8];
    const deg = d => S.root + S.scale[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
    const fill = bar % 4 === 3;
    // bombo (siempre, aunque apagado y sin brillo)
    if (KICKS[bar % 4][i] === 'x') {
      tone(175, 0.24, 'sine', 0.5 + 0.35 * L, 0.2, 0, musicBus, t);
      noise(0.02, 0.08 * L, 5000, 1, 0, musicBus, t);
      setTimeout(() => onBeat && onBeat(), Math.max(0, (t - ac.currentTime) * 1000));
    }
    // caja
    if (L > 0.1 && (i === 4 || i === 12)) {
      const v = 0.1 + 0.3 * L;
      noise(0.17, v, 1900, 0.7, 0, musicBus, t); tone(210, 0.1, 'triangle', v * 0.7, 0.6, 0, musicBus, t);
    }
    if (L > 0.5 && (i === 7 || i === 15 || (fill && i >= 13))) noise(0.07, 0.07 + 0.1 * L, 2200, 0.8, 0, musicBus, t);
    // hats
    const hatOn = L > 0.28 ? i % 2 === 0 : (i === 4 || i === 12);
    if (hatOn) noise(0.03, 0.035 + 0.08 * L + (i % 4 === 2 ? 0.03 : 0), 9500, 1, 0, musicBus, t, 'highpass');
    if (L > 0.45 && i === 14) noise(0.13, 0.06 + 0.05 * L, 8000, 1, 0, musicBus, t, 'highpass');
    if ((L > 0.8 || frenzyOn) && i % 2 === 1) noise(0.02, 0.04, 10000, 1, 0, musicBus, t, 'highpass');
    // bajo: sub triste y lento al principio; reese sincopado cuando hay dopamina
    if (L < 0.2) {
      if (i === 0 || i === 8) tone(mtof(deg(prog)), spb * 7, 'sine', 0.32, 0, 0, musicBus, t);
    } else {
      const pat = BASSP[bar % 4];
      if (pat[i] === 'x') {
        let j = i + 1; while (j < 16 && pat[j] !== 'x') j++;
        const len = (j - i) * spb, up = ((i * 7 + bar) % 5 === 0) ? 5 : 0;
        reese(deg(prog + up) + 12, len, t, 0.07 + 0.08 * L);
        tone(mtof(deg(prog + up)), len * 0.95, 'sine', 0.2, 0, 0, musicBus, t);
      }
    }
    // pad, arpegio y lead: solo cuando el mundo ya tiene color
    if (L > 0.35 && i === 0 && bar % 2 === 0) {
      for (const k of [0, 2, 4]) pad(deg(prog + k) + 12, spb * 32, t, 0.012 + 0.022 * L);
    }
    if (L > 0.62 && ARPP[i] === 'x') {
      tone(mtof(deg(prog + ARPN[(i + bar * 3) % 8]) + 24), spb * 0.9, S.lead, 0.016 + 0.03 * (L - 0.6), 0, 0, musicBus, t);
    }
    if (L > 0.85 && bar % 2 === 1 && (i === 0 || i === 6 || i === 10)) {
      tone(mtof(deg(prog + [4, 6, 5][i / 5 | 0 ? 1 : 0]) + 36), spb * 3, 'sawtooth', 0.03, 0, 0, musicBus, t);
    }
    if (L > 0.5 && i === 0 && bar % 4 === 0) noise(0.9, 0.08, 7000, 0.6, 0, musicBus, t, 'highpass');
  }
  function sched() {
    if (!ac) return;
    if (nextT < ac.currentTime - 0.05) nextT = ac.currentTime + 0.02;
    while (nextT < ac.currentTime + 0.12) { playStep(step, nextT); nextT += 60 / BPM / 4; step++; }
  }
  function startSeq() {
    if (!ac || seq) return;
    nextT = ac.currentTime + 0.05;
    seq = setInterval(sched, 25);
  }

  return {
    init,
    setVolume(v) { volume = v; if (master) master.gain.setTargetAtTime(gainFor(v), ac.currentTime, 0.02); },
    music(name) { pending = FLAVOR[name] || FLAVOR.rings; startSeq(); },
    probe() {
      if (!analyser) return null;
      const d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d);
      let sum = 0, w = 0; for (let i = 0; i < d.length; i++) { sum += d[i]; w += d[i] * i; }
      return { state: ac.state, level: +(sum / d.length).toFixed(1), centroidHz: sum ? Math.round(w / sum * ac.sampleRate / 2 / d.length) : 0 };
    },
    debug(L, fl) { dopa = L; frenzyOn = fl; for (let k = 0; k < 64; k++) playStep(k, ac.currentTime + k * 0.05); },
    mood(d, frenzy, boss) {
      dopa = clamp(d + (boss ? 0.08 : 0), 0, 1); frenzyOn = frenzy;
      if (!musicLP || !ac) return;
      const cut = 420 + 17000 * Math.pow(dopa, 1.6) + (frenzy ? 4000 : 0);
      if (Math.abs(cut - lastCut) > 90) { lastCut = cut; musicLP.frequency.setTargetAtTime(cut, ac.currentTime, 0.25); }
    },
    onBeat(fn) { onBeat = fn; },
    bounce(idx, speed) {
      if (!budget()) return;
      const f = note(idx + 5), v = clamp(speed / 1400, 0.04, 0.11);
      tone(f, 0.14, 'sine', v); tone(f * 2, 0.04, 'triangle', v * 0.35);
    },
    shatter(combo, gold) {
      if (!ac) return;
      noise(0.18, 0.22, 3500 + combo * 250, 1.2);
      const f = note(combo + 8);
      tone(f, 0.4, 'triangle', 0.18); tone(f * 1.5, 0.3, 'sine', 0.08, 0, 0.03);
      tone(90, 0.45, 'sine', 0.5, 0.4); noise(0.35, 0.18, 220, 0.7);
      if (gold) for (let i = 0; i < 4; i++) tone(note(combo + 12 + i * 2), 0.25, 'sine', 0.08, 0, 0.05 + i * 0.05);
      if (combo > 0 && combo % 5 === 0) tone(55, 0.9, 'sine', 0.6, 0.4, 0.05);
    },
    brick(combo, big) {
      if (!budget(big ? 2 : 1)) return;
      tone(note(combo + 6), 0.12, 'square', 0.05); noise(0.08, 0.15, 2500 + combo * 200, 2);
      if (big) tone(80, 0.3, 'sine', 0.4, 0.4);
    },
    ping() { if (budget()) tone(1200, 0.05, 'square', 0.03, 0.7); },
    paddle() { if (budget()) { tone(330, 0.08, 'square', 0.06); tone(660, 0.06, 'triangle', 0.05, 0, 0.02); } },
    enemyHit() { if (budget()) { noise(0.06, 0.15, 1500, 2); tone(220, 0.08, 'sawtooth', 0.05, 0.5); } },
    splat(combo) {
      if (!budget(2)) return;
      noise(0.2, 0.25, 700, 0.8); tone(note(combo + 6), 0.22, 'triangle', 0.11); tone(70, 0.25, 'sine', 0.35, 0.5);
    },
    peg(row) { if (budget()) tone(note(row + 9), 0.07, 'sine', 0.05); },
    jackpot(m) {
      if (!ac) return;
      const n = m >= 25 ? 14 : m >= 8 ? 8 : 4;
      for (let i = 0; i < n; i++) tone(note(10 + i * 2), 0.25, 'square', 0.05, 0, i * 0.045);
      if (m >= 8) { tone(55, 1, 'sine', 0.6, 0.5); noise(0.8, 0.2, 5000, 0.5); }
    },
    almost() { if (budget()) tone(420, 0.3, 'sine', 0.1, 0.55); },
    clear() {
      if (!ac) return;
      for (let i = 0; i < 8; i++) tone(note(10 + i * 2), 0.3, 'triangle', 0.12, 0, i * 0.055);
      tone(60, 0.9, 'sine', 0.6, 0.45, 0.02); noise(0.6, 0.15, 900, 0.6);
    },
    star(i) { if (budget()) tone(1800 + (i % 6) * 120, 0.05, 'square', 0.025); },
    zap(perfect) {
      if (!ac) return;
      tone(perfect ? 520 : 380, 0.16, 'sawtooth', 0.07, 3); noise(0.08, 0.12, 2500, 2);
      if (perfect) tone(1560, 0.2, 'sine', 0.1, 1.5, 0.04);
    },
    deny() { if (ac) tone(150, 0.15, 'square', 0.06, 0.7); },
    perfect(streak) { if (ac) for (let i = 0; i < 3; i++) tone(note(14 + streak + i * 2), 0.22, 'square', 0.05, 0, i * 0.05); },
    hurt() { if (!ac) return; noise(0.35, 0.5, 400, 0.7); tone(240, 0.5, 'sawtooth', 0.16, 0.3); tone(70, 0.6, 'sine', 0.6, 0.5); },
    shieldBreak() { if (!ac) return; noise(0.3, 0.3, 5000, 1.5); tone(1800, 0.3, 'triangle', 0.1, 0.5); },
    death() { if (!ac) return; tone(300, 1.6, 'sawtooth', 0.15, 0.12); tone(60, 1.8, 'sine', 0.6, 0.4); noise(1.2, 0.3, 300, 0.5); },
    tick(urgent) { if (ac) tone(urgent ? 1400 : 1000, 0.05, 'square', urgent ? 0.07 : 0.04); },
    heartbeat() { if (!ac) return; tone(62, 0.18, 'sine', 0.5, 0.6); tone(55, 0.2, 'sine', 0.4, 0.6, 0.2); },
    cardShow(i) { if (!ac) return; noise(0.15, 0.08, 1200 + i * 400, 1); tone(500 + i * 150, 0.12, 'triangle', 0.05, 1.5); },
    cardPick(rar) {
      if (!ac) return;
      const n = 3 + Math.max(0, rar) * 2;
      for (let i = 0; i < n; i++) tone(note(8 + i * 2 + Math.max(0, rar) * 3), 0.25, 'triangle', 0.09, 0, i * 0.06);
      if (rar >= 3) tone(55, 1, 'sine', 0.5, 0.5);
      if (rar < 0) tone(110, 0.9, 'sawtooth', 0.12, 0.5);
    },
    bossHit() { if (!ac) return; tone(90, 0.8, 'square', 0.12, 0.4); noise(0.5, 0.35, 700, 0.6); tone(45, 1, 'sine', 0.6, 0.5); },
    armor() { if (ac) { tone(700, 0.12, 'square', 0.08, 0.6); noise(0.12, 0.25, 3000, 3); } },
    timeout() { if (ac) for (let i = 0; i < 3; i++) tone(880, 0.12, 'square', 0.08, 0, i * 0.15); },
    buy() { if (ac) { tone(990, 0.07, 'square', 0.05); tone(1480, 0.14, 'square', 0.05, 0, 0.06); } },
    mutate() {
      if (!ac) return;
      for (let i = 0; i < 16; i++) tone(note(24 - Math.round(i * 1.5)), 0.07, 'square', 0.06, 0, i * 0.045);
      tone(70, 1.6, 'sawtooth', 0.14, 8, 0.2); noise(1.4, 0.25, 500, 0.4);
      tone(40, 1.2, 'sine', 0.7, 3, 0.9);
      for (let i = 0; i < 6; i++) tone(note(12 + i * 3), 0.3, 'triangle', 0.08, 0, 1.05 + i * 0.05);
    },
    blackhole() { if (ac) { tone(400, 1.2, 'sine', 0.3, 0.05); noise(1, 0.3, 200, 0.5); } },
    lit() {
      if (!ac) return;
      for (let i = 0; i < 9; i++) tone(note(8 + i * 2), 0.22, 'triangle', 0.07, 0, i * 0.05);
      tone(60, 0.8, 'sine', 0.5, 0.5, 0.1);
    },
    pop(i, big) {
      if (!budget(big ? 2 : 1)) return;
      tone(note(5 + (i % 25)), 0.12, 'sine', 0.1); noise(0.05, 0.12, 3000 + (i % 20) * 200, 2);
      if (big) tone(70, 0.4, 'sine', 0.5, 0.4);
    },
    fever() {
      if (!ac) return;
      tone(110, 1.2, 'sawtooth', 0.12, 6); noise(1, 0.25, 4000, 0.5);
      for (let i = 0; i < 10; i++) tone(note(12 + i * 2), 0.18, 'square', 0.05, 0, 0.3 + i * 0.05);
    },
  };
})();

// ---------------------------------------------------------------- cartas (reliquias)
const RAR = {
  '-1': { name: 'PACTO', color: '#ff2f55' },
  0: { name: 'COMÚN', color: '#cfd3e0' },
  1: { name: 'RARA', color: '#4dbbff' },
  2: { name: 'ÉPICA', color: '#b77dff' },
  3: { name: 'LEGENDARIA', color: '#ffc531' },
};
const has = id => (run && run.relics[id]) || 0;
const RELICS = [
  { id: 'heal', rar: 0, icon: '🩹', name: 'Vendaje', desc: 'Cura 1 corazón.', consumable: true, avail: () => run.hp < run.maxHp, apply() { run.hp = Math.min(run.maxHp, run.hp + 1); } },
  { id: 'battery', rar: 0, icon: '🔋', name: 'Batería', desc: '+1 tiro, +1 munición y +2 bolas en los bonus.', apply() { run.maxCharges++; } },
  { id: 'cap', rar: 0, icon: '⚡', name: 'Condensador', desc: 'Los tiros se recargan un 25% más rápido.', apply() { run.rechargeMul *= 0.75; } },
  { id: 'lever', rar: 0, icon: '🔧', name: 'Palanca', desc: 'Huecos un 15% más anchos y bolas más gordas.', apply() { run.gapMul *= 1.15; } },
  { id: 'hourglass', rar: 0, icon: '⏳', name: 'Reloj de arena', desc: '+20% de tiempo y los bichos van un 10% más lentos.', apply() { run.timeMul *= 1.2; run.enemyMul *= 0.9; } },
  { id: 'crystal', rar: 1, icon: '💎', name: 'Corazón de cristal', desc: '+1 corazón máximo y te cura 1.', apply() { run.maxHp++; run.hp++; } },
  { id: 'twin', rar: 1, icon: '⚪', name: 'Gemela', desc: '+1 bola en todos los juegos.', apply() { run.balls++; } },
  { id: 'shield', rar: 1, icon: '🛡️', name: 'Escudo', desc: 'Empiezas cada piso con 1 escudo que para un golpe.', apply() { run.shield++; run.shieldNow++; } },
  { id: 'anchor', rar: 1, icon: '⚓', name: 'Ancla', desc: 'Todo gira y corre un 15% más lento.', apply() { run.spinMul *= 0.85; } },
  { id: 'link', rar: 1, icon: '🔗', name: 'Eslabón', desc: 'Cada cosa que rompes recarga tiros.' },
  { id: 'magnet', rar: 1, icon: '🧲', name: 'Imán', desc: 'Tus bolas buscan objetivos y el tiro perfecto es más fácil.' },
  { id: 'prism', rar: 1, icon: '🌈', name: 'Prisma', desc: '15% de que cada destrucción suelte una bola extra.' },
  { id: 'chrono', rar: 2, icon: '⏱️', name: 'Cronógrafo', desc: 'Cada destrucción te da tiempo extra.' },
  { id: 'drill', rar: 2, icon: '🔩', name: 'Taladro', desc: 'Cada 4º disparo es perforante.' },
  { id: 'fang', rar: 2, icon: '🦷', name: 'Colmillo', desc: 'Destruir cosas acaba curándote corazones.' },
  { id: 'gauntlet', rar: 2, icon: '🥊', name: 'Guantelete', desc: 'Tus disparos rompen los pinchos.' },
  { id: 'kaleido', rar: 2, icon: '🔮', name: 'Caleidoscopio', desc: 'Puntos x1,5. El mundo se vuelve todavía más raro.', apply() { run.scoreMul *= 1.5; run.tripBonus += 2; } },
  { id: 'veil', rar: 3, icon: '👻', name: 'Velo', desc: 'Esquivas 1 de cada 2 golpes (no el del tiempo).', unique: true },
  { id: 'echo', rar: 3, icon: '🔊', name: 'Eco', desc: 'Cada disparo sale doble.', unique: true },
  { id: 'phoenix', rar: 3, icon: '🔥', name: 'Fénix', desc: 'Al morir, revives una vez con 2 corazones.', unique: true },
  { id: 'blackhole', rar: 3, icon: '🕳️', name: 'Agujero negro', desc: 'Cada 15 s el centro se traga lo que tenga cerca.', unique: true },
  { id: 'pact_blood', rar: -1, icon: '🩸', name: 'Pacto de sangre', desc: '+2 tiros y recarga +30%… pero −1 corazón máximo.', avail: () => run.maxHp > 1,
    apply() { run.maxCharges += 2; run.rechargeMul *= 0.7; run.maxHp--; run.hp = Math.min(run.hp, run.maxHp); } },
  { id: 'pact_time', rar: -1, icon: '⌛', name: 'Pacto del tiempo', desc: 'Huecos +30%… pero −25% de tiempo.', apply() { run.gapMul *= 1.3; run.timeMul *= 0.75; } },
  { id: 'pact_glass', rar: -1, icon: '🪞', name: 'Pacto de cristal', desc: 'Puntos x2 para siempre… pero pierdes 1 corazón ahora.', avail: () => run.hp > 1, apply() { run.scoreMul *= 2; run.hp--; } },
];
const relic = id => RELICS.find(r => r.id === id);

// ---------------------------------------------------------------- maldiciones (solo en los anillos)
const CURSES = [
  { id: 'invgrav', name: '⬆ GRAVEDAD INVERTIDA' },
  { id: 'zerog', name: '🌌 INGRAVIDEZ' },
  { id: 'frenzy', name: '🌀 FRENESÍ' },
  { id: 'dark', name: '🌑 APAGÓN' },
  { id: 'rush', name: '⏰ PRISA' },
  { id: 'spikes', name: '🔺 ESPINAS EN TODO' },
  { id: 'drought', name: '🏜 SEQUÍA' },
];
const cursed = id => run && run.curses.includes(id);

// ---------------------------------------------------------------- mundo
const canvas = $('#c');
const ctx = canvas.getContext('2d');
const darkC = document.createElement('canvas'), darkCtx = darkC.getContext('2d');
let W = 0, H = 0, DPR = 1, viewScale = 1;

const WORLD_R = 345;
const CIRCUIT_R = 322;
const RING_T = 3.2;
const BALL_R = 6;
const GRAVITY = 560;
const MAX_SPEED = 1500;
const DASH_SPEED = 950;

let rings = [], balls = [], particles = [], floaters = [], stars = [], shockwaves = [], beams = [], pulses = [];
let run = null, mode = null, M = {};
let phase = 'menu';   // menu | play | clear | pick | picked | mutate | dying | dead
const fx = { shake: 0, zoom: 1, zoomTarget: 1, camX: 0, camY: 0, timeScale: 1, slowTarget: 1, flash: 0, flashHue: 0, hitStop: 0, hurt: 0, beat: 0, rot: 0, lastSlow: false };
const game = { dopa: 0, down: false, combo: 0, comboTimer: 0, almostCd: 0, displayScore: 0, aim: null, aimLast: 0, denyT: 0, phaseT: 0, lastTick: 99, beatT: 0, t: 0, mutateTo: 0, demoT: 0, demoIdx: 0, hintT: 0 };
Sfx.onBeat(() => { fx.beat = 1; });

function resize() {
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  darkC.width = canvas.width; darkC.height = canvas.height;
  viewScale = Math.max(0.12, Math.min(W, H - 60) / 2 / WORLD_R);
}

// ---------------------------------------------------------------- estructura de la partida
// Cada ciclo de 6 pisos: 4 juegos distintos al azar + jefe + tragaperras. Casi cada piso es OTRO juego.
// Los anillos son el juego favorito: salen en 2 de cada 4 pisos normales y en la mayoría de jefes.
// (El rompebloques se quitó: sigue en el código pero ya no sale.)
const POOL = ['swarm', 'multiply', 'merge', 'chain', 'hole'];
const BOSS_MODES = ['rings', 'rings', 'swarm'];
const DEMO_ORDER = ['rings', 'multiply', 'rings', 'merge', 'swarm', 'chain', 'hole', 'plinko'];
function modeAt(s) {
  if (!run.sched) run.sched = [];
  while (run.sched.length <= s) {
    const i = run.sched.length, k = i % 6;
    let m;
    if (run.demo) m = DEMO_ORDER[i % DEMO_ORDER.length];
    else if (k === 0 || k === 2) m = 'rings';
    else if (k === 4) m = pick(BOSS_MODES);
    else if (k === 5) m = 'plinko';
    else {
      const recent = run.sched.slice(-4);
      m = pick(POOL.filter(x => !recent.includes(x)));
    }
    run.sched.push(m);
  }
  return run.sched[s];
}
function stageInfo(s) {
  const loop = Math.floor(s / 6), k = s % 6;
  return { s, loop, k, mode: modeAt(s), boss: k === 4 && !run.demo, bonus: k === 5 && !run.demo, lvl: Math.floor(s / 3) };
}
const GAME_SPEED = 1.12;
const tripI = () => run ? (clamp((Math.floor((run.stage || 0) / 3) + run.tripBonus) / 6, 0, 1) * (run.demo ? 0.5 : 1) + (run.demo ? 0.3 : 0.12) + (game.frenzy > 0 ? 0.4 : 0)) * (run.demo ? 1 : 0.3 + 0.7 * game.dopa) : 0.2;

function newRun(demo = false) {
  run = {
    demo, stage: 0, floor: 1, info: null, sched: null, hp: 3 + metaLv('hp'), maxHp: 3 + metaLv('hp'), shield: 0, shieldNow: 0,
    score: 0, scoreMul: 1, relics: {}, order: [], balls: 1, maxCharges: 2 + metaLv('shots'), charges: 2, rechargeMul: 1,
    gapMul: 1, timeMul: 1 + 0.1 * metaLv('time'), spinMul: 1, enemyMul: 1, tripBonus: 0, rerolls: metaLv('reroll'),
    time: 0, timeMax: 1, curses: [], inv: 0, shots: 0, streak: 0, feed: 0, veilToggle: false, phoenixUsed: false, bhT: 15,
    boss: null, echo: [], stats: { rings: 0, perfects: 0, bestCombo: 0, bosses: 0, hits: 0, kills: 0, bricks: 0 }, shardsEarned: 0,
  };
  run.info = stageInfo(0);
  game.fever = 0; game.frenzy = 0;
  if (!demo) {
    if (metaLv('start')) grantRelic(pick(RELICS.filter(r => r.rar === 1)), true);
    if (metaLv('shield')) grantRelic(relic('shield'), true);
  }
}

function grantRelic(r, silent) {
  run.relics[r.id] = (run.relics[r.id] || 0) + 1;
  if (!run.order.includes(r.id) && !r.consumable) run.order.push(r.id);
  if (r.apply) r.apply();
  renderRelics(silent ? null : r.id);
  renderHearts();
}

function startStage(s) {
  const info = stageInfo(s);
  run.stage = s; run.floor = s + 1; run.info = info;
  mode = MODES[info.mode];
  run.boss = null;
  run.curses = info.mode === 'rings' && !info.boss && !run.demo ? rollCurses(info.lvl) : [];
  run.shieldNow = run.shield; run.inv = 1; run.echo = [];
  game.combo = 0; run.streak = 0; game.lastTick = 99; updateCombo();
  if (!run.demo && info.boss && run.hp < run.maxHp) { run.hp++; floatText('+1 ♥ antes del jefe', 0, -60, 26, '#ff4d6a'); }
  balls = []; M = {};
  mode.build(info);
  phase = run.demo ? 'menu' : 'play';
  if (!run.demo && !meta.seen.includes(info.mode)) { meta.seen.push(info.mode); save(); }
  const actName = info.bonus ? 'BONUS' : mode.title;
  M.lvl = M.lvl === undefined ? info.lvl : M.lvl;
  $('#floorN').textContent = `${actName} · PISO ${run.floor}${info.boss ? ' · JEFE' : ''}${info.loop ? ` · BUCLE ${info.loop + 1}` : ''}`;
  $('#curses').innerHTML = run.curses.map(id => `<span class="curse">${CURSES.find(c => c.id === id).name}</span>`).join('');
  $('#boss').classList.toggle('on', !!run.boss);
  if (run.boss) $('#bossName').textContent = run.boss.name;
  renderHearts();
  Sfx.music(info.mode);
  showHint(mode.hint);
  if (!run.demo) {
    if (info.boss) banner(run.boss.name, mode.bossTag || '', true);
    else if (info.bonus) banner('¡BONUS!', 'sin daño · los bordes pagan x25 y esquirlas');
    else banner(`PISO ${run.floor}`, run.curses.length ? run.curses.map(id => CURSES.find(c => c.id === id).name).join(' · ') : '', run.curses.length > 0);
  }
}

function goNext() {
  const next = run.stage + 1;
  if (stageInfo(next).mode !== run.info.mode) mutate(next); else startStage(next);
}

function mutate(next) {
  phase = 'mutate'; game.phaseT = 1.45; game.mutateTo = next;
  const ni = stageInfo(next), m = MODES[ni.mode];
  $('#mutName').textContent = ni.bonus ? 'TRAGAPERRAS' : m.title;
  $('#mutTag').textContent = ni.bonus ? 'bonus · nada te puede matar' : m.tag;
  const el = $('#mutate');
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  canvas.classList.add('glitch');
  Sfx.mutate();
  fx.shake = 30; fx.flash = 1; fx.flashHue = rand(360);
  // todo lo que había en pantalla revienta
  mode.explode && mode.explode();
  for (const b of balls) for (let k = 0; k < 20; k++) spark(b.x, b.y, rand(360), 700, 1);
  balls = [];
  for (let k = 0; k < 6; k++) shockwaves.push({ R: 20 + k * 50, t: -k * 0.07, hue: rand(360) });
}

function rollCurses(lvl) {
  if (lvl < 1) return [];
  const n = lvl >= 6 ? 2 : Math.random() < 0.35 + lvl * 0.1 ? 1 : 0;
  const out = [];
  while (out.length < n) {
    const c = pick(CURSES).id;
    if (out.includes(c)) continue;
    if ((c === 'zerog' && out.includes('invgrav')) || (c === 'invgrav' && out.includes('zerog'))) continue;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- utilidades compartidas
// dopamina: empieza todo gris y apagado; se gana rompiendo cosas, se pierde parado o con un golpe
function dopaBoost(x) {
  if (!run || run.demo) return;
  x *= 0.4 + 0.6 * clamp((run.age || 0) / 30, 0, 1);   // al principio cuesta más: todo empieza gris
  const before = game.dopa;
  game.dopa = Math.min(1, game.dopa + x);
  if (before < 0.5 && game.dopa >= 0.5 && !run.lit1) {
    run.lit1 = true; banner('¡EL MUNDO SE ILUMINA!', 'sigue rompiendo cosas'); Sfx.lit(); fx.flash = 0.8; fx.flashHue = 50;
  } else if (before < 0.85 && game.dopa >= 0.85 && !run.lit2) {
    run.lit2 = true; banner('¡TODO BRILLA!', ''); Sfx.lit(); fx.flash = 1; fx.flashHue = rand(360);
  }
}
function addScore(v) { run.score += v * run.scoreMul * (game.frenzy > 0 ? 3 : 1); }
function startFrenzy() {
  game.fever = 0; game.frenzy = 7; game.dopa = 1;
  banner('¡FRENESÍ!', 'x3 puntos · todo más rápido · más bolas');
  Sfx.fever();
  fx.flash = 1; fx.flashHue = rand(360); fx.shake = 20;
  for (let k = 0; k < 6; k++) shockwaves.push({ R: 30 + k * 50, t: -k * 0.05, hue: k * 60 });
  if (mode.frenzy) mode.frenzy();
}
function floatText(text, x, y, size = 16, color = '#fff') {
  if (floaters.length > 28 && size < 28) return;   // que no se amontonen los números pequeños
  floaters.push({ text, x, y, size, color, life: 1, vy: -40 - size * 1.5 });
  if (floaters.length > 60) floaters.shift();
}
const ESCAPE_WORDS = ['¡FUERA!', '¡LIBRE!', '¡ESCAPE!', '¡BOOM!', '¡CRACK!', '¡ADIÓS!'];
const COMBO_TABLE = [1, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25];
const comboMult = c => c < COMBO_TABLE.length ? COMBO_TABLE[c] : Math.min(100, 25 + (c - COMBO_TABLE.length + 1) * 5);
const COMBO_WORDS = [[3, 'NICE'], [5, 'GREAT'], [8, 'PERFECT'], [12, 'INSANE'], [18, 'ULTRA'], [25, 'GODLIKE'], [40, 'DIOS'], [60, '¿¿¿???']];
function bumpCombo() {
  game.combo++; game.comboTimer = 3;
  run.stats.bestCombo = Math.max(run.stats.bestCombo, game.combo);
  updateCombo(true);
}
function updateCombo(bump) {
  const el = $('#combo');
  if (game.combo >= 2) {
    const word = COMBO_WORDS.filter(w => game.combo >= w[0]).pop();
    const hue = (game.combo * 25) % 360;
    el.innerHTML = `<span class="m${bump ? ' bump' : ''}" style="color:hsl(${hue},100%,65%);text-shadow:0 0 20px hsl(${hue},100%,50%)">` +
      `${word ? word[1] + ' · ' : ''}COMBO x${comboMult(game.combo)}</span>`;
    el.classList.add('on');
  } else el.classList.remove('on');
}
function banner(big, small, danger) {
  const el = $('#banner');
  el.innerHTML = big + (small ? `<small>${small}</small>` : '');
  el.classList.toggle('danger', !!danger);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function showHint(text) {
  const el = $('#hint');
  el.textContent = text || '';
  el.classList.add('show');
  game.hintT = 4.5;
}

// Efectos comunes a cualquier destrucción (cartas que curan, recargan, dan tiempo o sueltan bolas)
function onDestroy(x, y, w) {
  if (run.demo) return;
  if (game.frenzy <= 0 && phase === 'play') { game.fever += w * 0.06; if (game.fever >= 1) startFrenzy(); }
  run.feed += w;
  if (has('fang') && run.feed >= 10 / has('fang')) {
    run.feed = 0;
    if (run.hp < run.maxHp) { run.hp++; floatText('+1 ♥', x, y - 40, 26, '#ff4d6a'); renderHearts(); }
  }
  if (has('link')) run.charges = Math.min(run.maxCharges, run.charges + 0.5 * w * has('link'));
  if (has('chrono') && mode.timed) run.time += 1.5 * w * has('chrono');
  if (has('prism') && Math.random() < 0.15 * has('prism') && mode.prism) mode.prism(x, y);
}

function damage(src, x = 0, y = 0) {
  if (phase !== 'play' || run.demo) return false;
  if (src !== 'time' && run.inv > 0) return false;
  if (src !== 'time' && has('veil')) {
    run.veilToggle = !run.veilToggle;
    if (run.veilToggle) { floatText('ESQUIVADO', x, y - 16, 20, '#bfe9ff'); run.inv = 0.5; return false; }
  }
  if (run.shieldNow > 0 && src !== 'time') {
    run.shieldNow--; run.inv = 1;
    Sfx.shieldBreak(); floatText('ESCUDO', x, y - 16, 24, '#5fd4ff');
    fx.shake = 10; fx.flash = 0.4; fx.flashHue = 200;
    renderHearts(); return false;
  }
  run.hp--; run.stats.hits++; run.inv = 1.4; game.dopa = Math.max(0, game.dopa - 0.3);
  game.combo = 0; updateCombo(); run.streak = 0;
  Sfx.hurt();
  fx.shake = 24; fx.flash = 0.8; fx.flashHue = 350; fx.hitStop = 0.14; fx.hurt = 1;
  floatText(src === 'time' ? '¡TIEMPO!' : '−1 ♥', x, y - 10, 36, '#ff4d6a');
  renderHearts(true);
  if (run.hp <= 0) {
    if (has('phoenix') && !run.phoenixUsed) {
      run.phoenixUsed = true; run.hp = 2; run.inv = 2;
      banner('🔥 FÉNIX', 'vuelves de entre los muertos');
      fx.flash = 1; fx.flashHue = 30; Sfx.cardPick(3);
      renderHearts(); return true;
    }
    die();
  }
  return true;
}

function die() {
  phase = 'dying'; game.phaseT = 1.8;
  Sfx.death();
  for (const b of balls) for (let k = 0; k < 50; k++) spark(b.x, b.y, b.hue, 600, 1.2);
  balls = [];
  fx.shake = 30; fx.flash = 1; fx.flashHue = 350;
  $('#combo').classList.remove('on');
}

function floorClear(extraText) {
  if (run.demo) { game.demoT = Math.min(game.demoT, 1.2); return; }
  phase = 'clear'; game.phaseT = 1.15; dopaBoost(0.07);
  const info = run.info;
  const bonus = mode.timed ? Math.floor(Math.max(0, run.time) * 25 * run.floor) : 0;
  addScore(bonus);
  const shards = info.bonus ? 0 : 2 + run.floor + (info.boss ? 10 : 0);
  run.shardsEarned += shards;
  if (info.boss) run.stats.bosses++;
  const big = info.bonus ? 'BONUS COMPLETADO' : info.boss ? '¡JEFE DERROTADO!' : `PISO ${run.floor} SUPERADO`;
  const parts = [];
  if (bonus) parts.push(`+${fmt(bonus * run.scoreMul)} por tiempo`);
  if (shards) parts.push(`+${shards} ◆`);
  if (extraText) parts.push(extraText);
  banner(big, parts.join(' · '));
  if (mode.timed && run.time < 1.5) floatText('¡POR LOS PELOS!', 0, -60, 34, '#ff8a5c');
  Sfx.clear();
  fx.shake = 16; fx.flash = 0.7; fx.flashHue = 50;
  for (let i = 0; i < 30; i++) {
    const a = rand(TAU), s = rand(150, 600);
    stars.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: -i * 0.012, home: 0 });
  }
}

// ---------------------------------------------------------------- partículas
function spark(x, y, hue, speed, life) {
  const a = rand(TAU), s = rand(0.3, 1) * speed;
  particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, hue, len: 3, rot: 0, vr: 0, kind: 0 });
  if (particles.length > 2500) particles.shift();
}
function blob(x, y, hue, n, size) {
  for (let k = 0; k < n; k++) {
    const a = rand(TAU), s = rand(40, 320);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, hue, len: rand(2, size), rot: 0, vr: 0, kind: 2 });
  }
}
function shatterArc(R, start, span, hue, w, omega, gold, maxN = 90) {
  const n = Math.max(3, Math.min(maxN, Math.floor(R * span / 9)));
  for (let k = 0; k < n; k++) {
    const a = start + span * (k + 0.5) / n, s = rand(60, 260), tang = omega * R;
    particles.push({
      x: Math.cos(a) * R, y: Math.sin(a) * R,
      vx: Math.cos(a) * s - Math.sin(a) * tang, vy: Math.sin(a) * s + Math.cos(a) * tang,
      life: rand(0.6, 1.1), max: 1.1, hue, len: R * span / n * 0.8, rot: a + Math.PI / 2, vr: rand(-8, 8), kind: 1, gold, w,
    });
  }
  if (particles.length > 2500) particles.splice(0, particles.length - 2500);
}

// ================================================================= MODO 1: ANILLOS
function makeRing(i, R, o) {
  return Object.assign({
    i, R, T: RING_T, gap: 0.4, gapC: 0, omega: 1, target: 1, rot: 0, alive: true, hue: 0, flash: 0, appear: -i * 0.03,
    spikes: [], kind: 'normal', reverses: false, blinks: false, armor: 0, flipT: rand(1.6, 3), blinkT: rand(2), open: true,
    boss: false, hp: 0, maxHp: 0, gold: false, name: '',
  }, o);
}
function makeSpikes(ring, cover) {
  const n = 1 + Math.floor(rand(3)), w = cover * Math.PI / n;
  const out = [];
  for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const c = rand(TAU);
      if (Math.abs(wrap(c - ring.gapC)) < w + ring.gap / 2 + 0.3) continue;
      if (out.some(s => Math.abs(wrap(c - s.c)) < w + s.w + 0.12)) continue;
      out.push({ c, w, alive: true }); break;
    }
  }
  return out;
}
function relocateGap(ring) {
  for (let tries = 0; tries < 40; tries++) {
    const c = rand(TAU);
    if (ring.spikes.some(s => s.alive && Math.abs(wrap(c - s.c)) < s.w + ring.gap / 2 + 0.2)) continue;
    ring.gapC = c; return;
  }
}
const PATTERNS = ['spiral', 'spiral', 'aligned', 'alternate', 'random', 'twist', 'spiral', 'random'];
function buildRingFloor(f) {
  const count = Math.min(3 + Math.floor(f * 0.7), 16);
  const gap = Math.max(0.22, 0.44 - f * 0.012) * run.gapMul;
  const omega = Math.min(2.6, 0.95 + f * 0.07) * run.spinMul * (cursed('frenzy') ? 1.4 : 1);
  const spikeChance = cursed('spikes') ? 1 : clamp((f - 2) * 0.1, 0, 0.7);
  const spikeCover = Math.min(0.4, 0.1 + f * 0.015);
  const r0 = 62, rMax = 290, sp = count > 1 ? Math.min(28, (rMax - r0) / (count - 1)) : 0;
  const pattern = f === 1 ? 'aligned' : pick(PATTERNS);
  const dir = sgn(), step = rand(0.16, 0.42) * sgn();
  const hue = (f * 47 + 40) % 360;
  rings = [];
  for (let i = 0; i < count; i++) {
    let gapC = 0, w = omega * dir;
    if (pattern === 'spiral') gapC = i * step;
    else if (pattern === 'alternate') { gapC = i * step * 0.5; w *= (i % 2 ? -1 : 1); }
    else if (pattern === 'random') { gapC = rand(TAU); w *= rand(0.6, 1.4) * (Math.random() < 0.3 ? -1 : 1); }
    else if (pattern === 'twist') { gapC = i * step; w *= 1 + i * 0.05; }
    let kind = 'normal';
    const roll = Math.random();
    if (f >= 4 && roll < 0.22) kind = Math.random() < 0.5 ? 'reverser' : 'blinker';
    else if (f >= 7 && roll < 0.36) kind = 'armored';
    else if (f >= 10 && roll < 0.46) kind = 'ghost';
    const ring = makeRing(i, r0 + i * sp, {
      gap, gapC, omega: w, target: w, hue: hue + i * 4, kind, reverses: kind === 'reverser', blinks: kind === 'blinker',
      armor: kind === 'armored' ? 1 : 0, T: kind === 'armored' ? RING_T * 2 : RING_T, gold: Math.random() < 0.07,
    });
    if (Math.random() < spikeChance) ring.spikes = makeSpikes(ring, spikeCover);
    rings.push(ring);
  }
  run.timeMax = run.time = (9 + count * 2.8) * run.timeMul * (cursed('rush') ? 0.7 : 1);
}
const BOSSES = [
  { name: 'EL GUARDIÁN', hue: 350 }, { name: 'EL OJO', hue: 285 }, { name: 'LA BOCA', hue: 18 }, { name: 'EL VACÍO', hue: 200 },
];
function buildRingBoss(info) {
  const L = info.loop, b = BOSSES[L % BOSSES.length];
  rings = [];
  const inner = Math.min(L, 2);
  for (let i = 0; i < inner; i++) {
    const r = makeRing(i, 75 + i * 30, { gap: 0.36 * run.gapMul, gapC: rand(TAU), hue: b.hue + 30 });
    r.omega = r.target = rand(0.9, 1.4) * sgn() * run.spinMul;
    rings.push(r);
  }
  const hp = 3 + L * 2;
  const boss = makeRing(inner, 200, {
    T: 10, boss: true, name: b.name, hp, maxHp: hp, gap: Math.max(0.28, 0.42 - L * 0.04) * run.gapMul,
    gapC: rand(TAU), hue: b.hue, reverses: true, blinks: L >= 1, flipT: 3,
  });
  boss.omega = boss.target = (0.95 + L * 0.2) * sgn() * run.spinMul;
  boss.spikes = makeSpikes(boss, Math.min(0.4, 0.16 + L * 0.06));
  rings.push(boss);
  run.boss = boss;
  run.timeMax = run.time = (50 + L * 10) * run.timeMul;
}
function ringBall(i) {
  const a = rand(TAU);
  return { x: Math.cos(a) * 8, y: Math.sin(a) * 8 - 10, vx: rand(-220, 220), vy: rand(-260, -120), trail: [], hue: 22 + (i * 37) % 60, dash: 0, glow: 0 };
}
const innermost = () => { for (const r of rings) if (r.alive) return r; return null; };
const gravity = () => cursed('zerog') ? 0 : cursed('invgrav') ? -GRAVITY : GRAVITY;

function ringOnBounce(b, ring, rel, half) {
  ring.flash = 1;
  Sfx.bounce(ring.i, Math.hypot(b.vx, b.vy));
  for (let k = 0; k < 4; k++) spark(b.x, b.y, ring.gold ? 48 : ring.hue, 120, 0.35);
  if (Math.abs(rel) < half + 0.13 && game.almostCd <= 0) {
    game.almostCd = 1.2;
    floatText('¡CASI!', b.x, b.y - 14, 20, '#ff8a5c');
    Sfx.almost();
    fx.shake = Math.max(fx.shake, 3);
  }
}
function hitSpike(b, ring, s) {
  if (b.dash > 0 && has('gauntlet')) {
    s.alive = false;
    for (let k = 0; k < 30; k++) spark(b.x, b.y, 350, 400, 0.6);
    floatText('¡PINCHOS ROTOS!', b.x, b.y - 16, 22, '#ff8aa0');
    Sfx.armor(); fx.shake = Math.max(fx.shake, 8);
    addScore(50 * run.floor);
    return;
  }
  for (let k = 0; k < 16; k++) spark(b.x, b.y, 350, 300, 0.5);
  damage('spike', b.x, b.y);
}
function passRing(ring, b, ang) {
  const d = Math.hypot(b.x, b.y) || 1, nx = b.x / d, ny = b.y / d;
  if (ring.armor > 0) {
    ring.armor--; ring.T = RING_T; ring.flash = 1; relocateGap(ring);
    const inner = ring.R - ring.T / 2 - BALL_R - 1;
    b.x = nx * inner; b.y = ny * inner;
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    b.dash = 0;
    for (let k = 0; k < 24; k++) spark(b.x, b.y, 220, 380, 0.6);
    floatText('¡GRIETA!', b.x, b.y - 16, 24, '#c9d6e8');
    Sfx.armor(); fx.shake = Math.max(fx.shake, 9);
    addScore(30 * run.floor); dopaBoost(0.04);
    return;
  }
  if (ring.boss && ring.hp > 1) {
    ring.hp--; ring.flash = 1;
    relocateGap(ring);
    ring.target = -ring.target * 1.08; ring.flipT = 2.5;
    for (let k = 0; k < 60; k++) spark(Math.cos(ang) * ring.R, Math.sin(ang) * ring.R, ring.hue, 600, 0.9);
    shockwaves.push({ R: ring.R, t: 0, hue: ring.hue });
    floatText(`¡GOLPE! quedan ${ring.hp}`, Math.cos(ang) * ring.R, Math.sin(ang) * ring.R, 30, '#ff8aa0');
    Sfx.bossHit();
    fx.shake = 22; fx.flash = 0.6; fx.flashHue = ring.hue; fx.hitStop = 0.15; fx.zoom += 0.15;
    bumpCombo(); dopaBoost(0.08);
    addScore(500 * run.floor * comboMult(game.combo));
    if (b.dash > 0) run.streak++;
    for (const bb of balls) Object.assign(bb, { x: rand(-6, 6), y: rand(-6, 6), vx: rand(-200, 200), vy: -220, dash: 0, trail: [], glow: 1 });
    run.inv = Math.max(run.inv, 0.8);
    run.charges = Math.min(run.maxCharges, run.charges + 1);
    return;
  }
  breakRing(ring, b, ang);
}
function breakRing(ring, b, ang) {
  ring.alive = false;
  run.stats.rings++;
  bumpCombo(); dopaBoost(0.07);
  const shot = b.dash > 0;
  if (shot) run.streak++;
  const perfect = shot && b.perfect;
  if (perfect) run.stats.perfects++;
  const perfectMult = perfect ? 2 + Math.min(run.streak - 1, 8) * 0.5 : 1;
  const v = 100 * run.floor * comboMult(game.combo) * perfectMult * (ring.gold ? 5 : 1) * (ring.boss ? 10 : 1);
  addScore(v);
  const ex = Math.cos(ang) * ring.R, ey = Math.sin(ang) * ring.R;
  const size = clamp(30 + Math.log10(v + 1) * 4 + (ring.gold ? 12 : 0), 30, 80);
  floatText('+' + fmt(v * run.scoreMul), ex, ey, size, '#ffe27a');
  const word = ring.boss ? '¡ROTO!' : ring.gold ? '¡ORO! +3 s' : perfect ? (run.streak > 1 ? `¡PERFECTO x${run.streak}!` : '¡TIRO PERFECTO!') : pick(ESCAPE_WORDS);
  floatText(word, ex, ey - size * 0.9, 24, ring.gold ? '#ffd34d' : `hsl(${ring.hue},100%,75%)`);
  if (perfect) { Sfx.perfect(run.streak); pulses.push({ a: ang, t: 0, hue: 50, big: true }); }
  if (shot) { b.perfect = false; b.dash = Math.min(b.dash, 0.08); b.scored = true; }
  if (ring.gold) run.time += 3;
  onDestroy(ex, ey, 1);
  shatterArc(ring.R, ring.rot + ring.gapC + ring.gap / 2, TAU - ring.gap, ring.gold ? 48 : ring.hue, ring.T, ring.omega, ring.gold);
  for (let k = 0; k < 40; k++) spark(ex, ey, ring.gold ? 48 : ring.hue, 520, 0.7);
  shockwaves.push({ R: ring.R, t: 0, hue: ring.gold ? 48 : ring.hue, gold: ring.gold });
  for (const r of rings) if (r.alive) r.flash = 1;
  b.glow = 1;
  Sfx.shatter(game.combo, ring.gold);
  fx.shake = Math.max(fx.shake, ring.gold ? 20 : 12 + Math.min(game.combo, 10));
  fx.flash = ring.gold ? 0.7 : 0.4;
  fx.flashHue = ring.gold ? 48 : ring.hue;
  fx.hitStop = ring.boss ? 0.3 : ring.gold ? 0.16 : 0.09;
  fx.zoom += ring.gold ? 0.18 : 0.1;
  if (ring.boss) { for (let k = 0; k < 4; k++) shockwaves.push({ R: ring.R * (0.5 + k * 0.3), t: -k * 0.08, hue: ring.hue }); fx.shake = 40; }
  if (!innermost()) floorClear();
}
function ringShoot(ang, free) {
  const r = innermost();
  if (!r) return;
  if (!free && !run.demo) {
    if (run.charges < 1) { game.denyT = 0.35; Sfx.deny(); return; }
    run.charges -= 1;
  }
  if (!free) run.shots++;
  const drill = !free && has('drill') && run.shots % 4 === 0;
  const margin = 0.13 * (has('magnet') ? 1.7 : 1);
  const perfect = Math.abs(wrap(ang - (r.rot + r.gapC))) < r.gap / 2 + margin;
  const tx = Math.cos(ang) * CIRCUIT_R, ty = Math.sin(ang) * CIRCUIT_R;
  for (const b of balls) {
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
    b.vx = dx / d * DASH_SPEED; b.vy = dy / d * DASH_SPEED;
    b.dash = perfect ? 0.7 : 0.45; b.perfect = perfect; b.scored = false; b.glow = 0.6; b.drill = drill;
    beams.push({ x0: b.x, y0: b.y, x1: tx, y1: ty, t: 0, col: drill ? '#ff9a3d' : perfect ? '#ffe27a' : '#3df5ff' });
  }
  if (drill && balls[0]) floatText('TALADRO', balls[0].x, balls[0].y - 20, 22, '#ff9a3d');
  pulses.push({ a: ang, t: 0, hue: perfect ? 50 : 185 });
  Sfx.zap(perfect);
  fx.shake = Math.max(fx.shake, perfect ? 5 : 3);
}
function ringStep(b, dt) {
  if (b.dash > 0) {
    if (b.perfect) {
      const r = innermost();
      if (r) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const reach = (r.R * 1.2 - Math.hypot(b.x, b.y)) / sp;
        const ta = r.rot + r.gapC + r.omega * Math.max(0, reach);
        const tx = Math.cos(ta) * r.R * 1.2 - b.x, ty = Math.sin(ta) * r.R * 1.2 - b.y;
        const tl = Math.hypot(tx, ty) || 1, k = Math.min(1, dt * 25);
        b.vx += (tx / tl * sp - b.vx) * k; b.vy += (ty / tl * sp - b.vy) * k;
      }
    }
  } else b.vy += gravity() * dt;
  b.x += b.vx * dt; b.y += b.vy * dt;
  const ring = innermost();
  if (!ring) return;
  const d = Math.hypot(b.x, b.y) || 1e-4;
  const inner = ring.R - ring.T / 2 - BALL_R;
  if (d <= inner) return;
  const ang = Math.atan2(b.y, b.x);
  const rel = wrap(ang - (ring.rot + ring.gapC));
  const half = b.dash > 0 && b.perfect ? ring.gap / 2 + 0.14 : ring.gap / 2 - (BALL_R / ring.R) * 0.8;
  const through = (ring.open && Math.abs(rel) < half) || (b.drill && b.dash > 0);
  if (through) { if (d > ring.R) passRing(ring, b, ang); return; }
  const nx = b.x / d, ny = b.y / d;
  const vn = b.vx * nx + b.vy * ny;
  if (vn > 0) {
    b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny;
    b.vx += -ny * ring.omega * ring.R * 0.06; b.vy += nx * ring.omega * ring.R * 0.06;
    const s = Math.hypot(b.vx, b.vy);
    if (s < 300) { b.vx *= 300 / s; b.vy *= 300 / s; } else if (s > MAX_SPEED) { b.vx *= MAX_SPEED / s; b.vy *= MAX_SPEED / s; }
    const local = wrap(ang - ring.rot), aw = BALL_R / ring.R;
    const sp = ring.spikes.find(s => s.alive && Math.abs(wrap(local - s.c)) < s.w + aw);
    if (sp) hitSpike(b, ring, sp); else ringOnBounce(b, ring, rel, half);
    if (b.dash > 0 && !b.perfect) { if (!b.scored) run.streak = 0; b.dash = 0; }
  }
  b.x = nx * inner; b.y = ny * inner;
}
function drawRing(r) {
  const e = r.appear, sc = 1 + 2.70158 * Math.pow(e - 1, 3) + 1.70158 * Math.pow(e - 1, 2);
  const R = r.R * sc, g0 = r.rot + r.gapC;
  const a0 = g0 + r.gap / 2, a1 = g0 - r.gap / 2 + TAU;
  const alpha = r.kind === 'ghost' ? 0.12 + 0.88 * Math.max(0, Math.sin(game.t * 2.4 + r.i)) : 1;
  const col = r.gold ? 'hsl(46,100%,' : `hsl(${r.hue},95%,`;
  ctx.globalAlpha = (0.13 + r.flash * 0.2 + fx.beat * 0.08) * alpha;
  ctx.strokeStyle = col + '55%)';
  ctx.lineWidth = r.T * 4 + r.flash * 6;
  ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col + (68 + r.flash * 25) + '%)';
  ctx.lineWidth = r.T + r.flash * 1.5;
  ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
  if (r.armor > 0) {
    ctx.strokeStyle = '#c9d6e8'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8 * alpha;
    ctx.beginPath(); ctx.arc(0, 0, R + r.T, a0, a1); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R - r.T, a0, a1); ctx.stroke();
  }
  if (r.blinks && !r.open) {
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(game.t * 30);
    ctx.strokeStyle = '#ff5c7a'; ctx.lineWidth = r.T;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(0, 0, R, g0 - r.gap / 2, g0 + r.gap / 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (r.reverses) {
    const dir = Math.sign(r.omega) || 1;
    ctx.fillStyle = `hsl(${r.hue},100%,80%)`; ctx.globalAlpha = 0.8 * alpha;
    for (let k = 1; k <= 3; k++) {
      const a = g0 + Math.PI * (k / 2), c = Math.cos(a), s = Math.sin(a), tc = -s * dir, ts = c * dir;
      ctx.beginPath();
      ctx.moveTo(c * R + tc * 7, s * R + ts * 7);
      ctx.lineTo(c * (R - 5) - tc * 3, s * (R - 5) - ts * 3);
      ctx.lineTo(c * (R + 5) - tc * 3, s * (R + 5) - ts * 3);
      ctx.fill();
    }
  }
  for (const sp of r.spikes) {
    if (!sp.alive) continue;
    const s0 = r.rot + sp.c - sp.w, span = sp.w * 2;
    const teeth = Math.max(2, Math.round(span * R / 8));
    const base = R - r.T / 2, tip = base - 8;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ff2f55'; ctx.lineWidth = r.T + 1;
    ctx.beginPath(); ctx.arc(0, 0, R, s0, s0 + span); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.cos(s0) * base, Math.sin(s0) * base);
    for (let t = 0; t < teeth; t++) {
      const am = s0 + span * (t + 0.5) / teeth, ae = s0 + span * (t + 1) / teeth;
      ctx.lineTo(Math.cos(am) * tip, Math.sin(am) * tip);
      ctx.lineTo(Math.cos(ae) * base, Math.sin(ae) * base);
    }
    ctx.fillStyle = '#ff2f55aa'; ctx.fill();
    ctx.strokeStyle = '#ff7d92'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawCircuit() {
  const R = CIRCUIT_R, mc = Math.max(1, Math.floor(run.maxCharges)), ch = run.demo ? mc : run.charges;
  const deny = game.denyT > 0, dry = cursed('drought');
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = deny ? '#ff3d5a55' : '#3df5ff26';
  ctx.beginPath(); ctx.arc(0, 0, R - 7, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#3df5ff30'; ctx.strokeStyle = '#3df5ff1c'; ctx.lineWidth = 1;
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * TAU, c = Math.cos(a), sn = Math.sin(a);
    ctx.fillRect(c * (R + 7) - 1, sn * (R + 7) - 1, 2, 2);
    if (i % 6 === 0) {
      ctx.beginPath(); ctx.moveTo(c * (R + 7), sn * (R + 7)); ctx.lineTo(c * (R + 16), sn * (R + 16));
      ctx.lineTo(Math.cos(a + 0.03) * (R + 22), Math.sin(a + 0.03) * (R + 22)); ctx.stroke();
    }
  }
  const total = Math.max(mc, Math.ceil(ch));
  const seg = TAU / total, pad = 0.05;
  for (let i = 0; i < total; i++) {
    const a0 = -Math.PI / 2 + i * seg + pad, a1 = a0 + seg - pad * 2;
    const fill = clamp(ch - i, 0, 1);
    if (fill <= 0) continue;
    const full = fill >= 1;
    ctx.strokeStyle = deny ? '#ff3d5a' : dry ? '#ffb13d' : full ? '#3df5ff' : '#1d7c88';
    ctx.globalAlpha = full ? 0.18 : 0.1; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + (a1 - a0) * fill); ctx.stroke();
    ctx.globalAlpha = full ? 0.95 : 0.6; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + (a1 - a0) * fill); ctx.stroke();
  }
  const r = innermost();
  if (r && (phase === 'play' || phase === 'menu')) {
    const gc = r.rot + r.gapC, w = r.gap / 2 + 0.13 * (has('magnet') ? 1.7 : 1);
    const pulse = 0.6 + 0.4 * Math.sin(game.t * 8);
    const col = !r.open ? '#ff5c7a' : r.gold ? '#ffd34d' : '#fff';
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.15 * pulse; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(0, 0, R, gc - w, gc + w); ctx.stroke();
    ctx.globalAlpha = 0.9; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, R + 13, gc - w, gc + w); ctx.stroke();
    const c = Math.cos(gc), sn = Math.sin(gc), tc = -sn, ts = c;
    ctx.fillStyle = col; ctx.globalAlpha = 0.85 * pulse;
    ctx.beginPath();
    ctx.moveTo(c * (R + 4), sn * (R + 4));
    ctx.lineTo(c * (R + 22) + tc * 8, sn * (R + 22) + ts * 8);
    ctx.lineTo(c * (R + 22) - tc * 8, sn * (R + 22) - ts * 8);
    ctx.fill();
  }
  if (game.aim !== null && phase === 'play') {
    const a = game.aim, c = Math.cos(a), sn = Math.sin(a);
    ctx.globalAlpha = 0.7; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c * R, sn * R, 11, 0, TAU); ctx.stroke();
    if (balls[0]) {
      ctx.setLineDash([4, 8]); ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.moveTo(balls[0].x, balls[0].y); ctx.lineTo(c * R, sn * R); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  drawPulses(R);
  ctx.globalAlpha = 1;
}
function drawPulses(R) {
  for (const p of pulses) {
    const k = p.t / 0.8, off = k * Math.PI * (p.big ? 1 : 0.7);
    ctx.strokeStyle = `hsl(${p.hue},100%,70%)`;
    ctx.globalAlpha = 1 - k; ctx.lineWidth = p.big ? 7 : 4;
    for (const s of [-1, 1]) { const a = p.a + off * s; ctx.beginPath(); ctx.arc(0, 0, R, a - 0.12, a + 0.12); ctx.stroke(); }
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(Math.cos(p.a) * R, Math.sin(p.a) * R, 8 + k * 40, 0, TAU); ctx.stroke();
  }
  for (const bm of beams) {
    const k = bm.t / 0.3;
    ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = bm.col; ctx.lineWidth = 6 * (1 - k) + 1;
    ctx.beginPath(); ctx.moveTo(bm.x0, bm.y0); ctx.lineTo(bm.x1, bm.y1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const RINGS = {
  id: 'rings', title: 'ANILLOS', tag: 'escapa por el hueco', timed: true,
  hint: 'toca el circuito exterior para disparar · apunta a la flecha blanca',
  bossTag: 'atraviésalo varias veces',
  build(info) {
    if (info.boss) buildRingBoss(info); else buildRingFloor(1 + Math.floor(info.s * 0.5));
    run.charges = run.maxCharges + (cursed('drought') ? 1 : 0);
    for (let i = 0; i < run.balls; i++) balls.push(ringBall(i));
  },
  tap(ang) { ringShoot(ang, false); },
  echo(ang) { ringShoot(ang, true); },
  update(dt, rdt, live) {
    for (const r of rings) {
      if (r.reverses) {
        r.flipT -= dt;
        if (r.flipT <= 0) { r.target = -r.target; r.flipT = r.boss ? rand(2.2, 3.4) : rand(1.8, 3); r.flash = 1; }
        r.omega += (r.target - r.omega) * Math.min(1, dt * 4);
      }
      if (r.blinks) { r.blinkT += dt; r.open = (r.blinkT % 1.8) < 1.1; }
      if (phase !== 'pick') r.rot += r.omega * dt;
      r.appear = Math.min(1, r.appear + rdt * 2.6);
      r.flash = Math.max(0, r.flash - rdt * 5);
    }
    if (!live) return;
    let maxV = 0;
    for (const b of balls) maxV = Math.max(maxV, Math.abs(b.vx) + Math.abs(b.vy));
    const steps = clamp(Math.ceil(maxV * dt / 3), 1, 24), sdt = dt / steps;
    for (let s = 0; s < steps; s++) for (const b of balls) ringStep(b, sdt);
    for (const b of balls) if (b.dash > 0) { b.dash -= dt; if (b.dash <= 0) { b.dash = 0; if (!b.scored) run.streak = 0; } }
    if (phase === 'play' && !cursed('drought') && run.charges < run.maxCharges) run.charges = Math.min(run.maxCharges, run.charges + rdt / (3 * run.rechargeMul));
    // cámara lenta cuando una bola va directa al hueco
    let focus = null;
    const r0 = innermost();
    if (r0 && phase === 'play') {
      fx.lastSlow = rings.filter(r => r.alive).length === 1;
      for (const b of balls) {
        const d = Math.hypot(b.x, b.y), rel = wrap(Math.atan2(b.y, b.x) - (r0.rot + r0.gapC));
        if (r0.open && d > r0.R - 40 && Math.abs(rel) < r0.gap * 0.7 && (b.vx * b.x + b.vy * b.y) > 0) { focus = b; break; }
      }
    }
    fx.focus = focus;
  },
  ai(dt) {
    M.aiT = (M.aiT || 1) - dt;
    const r = innermost();
    if (M.aiT <= 0 && r) { M.aiT = rand(1, 1.8); ringShoot(r.rot + r.gapC, false); }
  },
  drawBack() { for (const r of rings) if (r.alive && r.appear > 0) drawRing(r); },
  drawFront() { drawCircuit(); },
  hud() { return { fill: run.time / run.timeMax, text: Math.max(0, run.time).toFixed(1) + ' s', low: run.time < 5 }; },
  frenzy() { for (let i = 0; i < 3; i++) { const b = ringBall(balls.length); b.glow = 1; balls.push(b); } },
  prism(x, y) { const b = ringBall(balls.length); b.x = x * 0.8; b.y = y * 0.8; b.glow = 1; balls.push(b); floatText('+BOLA', x, y - 30, 20, '#9ff'); },
  blackhole() { const r = innermost(); if (r && balls[0]) breakRing(r, balls[0], r.rot + r.gapC); },
  explode() { for (const r of rings) if (r.alive) { shatterArc(r.R, r.rot + r.gapC + r.gap / 2, TAU - r.gap, r.hue, r.T, r.omega, false, 40); r.alive = false; } },
};

// ================================================================= MODO 2: ROMPEBLOQUES CIRCULAR
const PADDLE_R = 300;
function bkBall(off = 0) {
  const a = M.paddle.a + off, R = PADDLE_R - 24, dir = a + Math.PI + rand(-0.35, 0.35);
  return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(dir) * M.speed, vy: Math.sin(dir) * M.speed, trail: [], hue: 190, dash: 0, glow: 1, pierce: 0 };
}
function bkBuild(info) {
  const lvl = info.lvl;
  M = { paddle: { a: Math.PI / 2, target: Math.PI / 2, flash: 0 }, layers: [], bricks: [], shots: [], fireT: 2.5, core: null, hits: 0,
    speed: (480 + lvl * 26) * (1 + info.loop * 0.1) * run.spinMul, pw: 0.3 * run.gapMul };
  if (info.boss) {
    const L = info.loop;
    M.layers = [{ r: 0, rot: 0, omega: 0 }, { r: 115, rot: 0, omega: (1 + L * 0.2) * run.spinMul }, { r: 175, rot: 0, omega: -0.4 }];
    const hp = 10 + L * 6;
    M.core = { r: 38, hp, maxHp: hp, flash: 0 };
    run.boss = { name: ['EL MURO', 'LA COLMENA', 'EL BLOQUE NEGRO'][L % 3], hp, maxHp: hp, alive: true, hue: 190 };
    for (let k = 0; k < 3; k++) M.bricks.push({ L: 1, ac: k * TAU / 3, hw: 0.42, r: 115, th: 14, hp: Infinity, maxHp: Infinity, type: 'steel', alive: true, flash: 0, hue: 210 });
    for (let k = 0; k < 18; k++) M.bricks.push({ L: 2, ac: k * TAU / 18, hw: Math.PI / 18 - 0.03, r: 175, th: 14, hp: 1, maxHp: 1, type: Math.random() < 0.15 ? 'multi' : 'normal', alive: true, flash: 0, hue: 300 + k * 4 });
  } else {
    const nL = Math.min(2 + lvl, 6);
    for (let L = 0; L < nL; L++) {
      const r = 80 + L * 28, n = 8 + L * 3;
      M.layers.push({ r, rot: rand(TAU), omega: L === 0 && lvl === 0 ? 0 : rand(0.08, 0.3 + lvl * 0.05) * sgn() * run.spinMul });
      const hw = Math.PI / n - 0.03, pattern = Math.floor(rand(3));
      for (let k = 0; k < n; k++) {
        if (pattern === 1 && k % 3 === 2) continue;
        if (Math.random() < 0.1) continue;
        const roll = Math.random();
        const type = roll < 0.12 ? 'multi' : roll < 0.2 ? 'bomb' : roll < 0.2 ? 'gold' : (lvl >= 2 && roll < 0.27) ? 'steel' : 'normal';
        const hp = type === 'steel' ? Infinity : 1 + (Math.random() < 0.1 + lvl * 0.08 ? 1 : 0) + (Math.random() < lvl * 0.04 ? 1 : 0);
        M.bricks.push({ L, ac: k * TAU / n, hw, r, th: 15, hp, maxHp: hp, type, alive: true, flash: 0, hue: (L * 38 + 280 + info.loop * 60) % 360 });
      }
    }
  }
  const count = M.bricks.filter(b => b.type !== 'steel').length;
  run.timeMax = run.time = (info.boss ? 60 : 40 + count * 0.8) * run.timeMul;
  for (let i = 0; i < run.balls + 1; i++) balls.push(bkBall(i * 0.25));
}
function bkHitBrick(br, b) {
  if (br.type === 'steel') { br.flash = 1; Sfx.ping(); return; }
  br.hp -= b.pierce > 0 ? 99 : 1; br.flash = 1;
  if (br.hp > 0) { Sfx.brick(game.combo, false); for (let k = 0; k < 5; k++) spark(b.x, b.y, br.hue, 160, 0.3); return; }
  bkKillBrick(br, b);
}
function bkKillBrick(br, b) {
  if (!br.alive) return;
  br.alive = false;
  run.stats.bricks++;
  bumpCombo(); dopaBoost(0.03);
  const L = M.layers[br.L], a = L.rot + br.ac;
  const x = Math.cos(a) * br.r, y = Math.sin(a) * br.r;
  const v = 40 * run.floor * comboMult(game.combo) * (br.type === 'gold' ? 6 : 1);
  addScore(v);
  floatText('+' + fmt(v * run.scoreMul), x, y, clamp(18 + Math.log10(v + 1) * 3, 18, 50), br.type === 'gold' ? '#ffd34d' : '#ffe27a');
  shatterArc(br.r, a - br.hw, br.hw * 2, br.type === 'gold' ? 48 : br.hue, br.th, L.omega, br.type === 'gold', 14);
  for (let k = 0; k < 14; k++) spark(x, y, br.hue, 380, 0.5);
  Sfx.brick(game.combo, br.type !== 'normal');
  fx.shake = Math.max(fx.shake, 5 + Math.min(game.combo, 12) * 0.5);
  onDestroy(x, y, 0.3);
  if (br.type === 'gold') { run.time += 3; floatText('¡ORO! +3 s', x, y - 26, 22, '#ffd34d'); fx.flash = 0.4; fx.flashHue = 48; }
  if (br.type === 'multi' && b) {
    for (let k = 0; k < 2; k++) {
      const a2 = rand(TAU);
      balls.push({ x, y, vx: Math.cos(a2) * M.speed, vy: Math.sin(a2) * M.speed, trail: [], hue: 190 + k * 60, dash: 0, glow: 1, pierce: 0 });
    }
    floatText('¡MULTIBOLA!', x, y - 26, 24, '#9ff');
  }
  if (br.type === 'bomb') {
    shockwaves.push({ R: 10, t: 0, hue: 15, cx: x, cy: y });
    fx.shake = Math.max(fx.shake, 16); fx.flash = 0.5; fx.flashHue = 15;
    Sfx.shatter(game.combo, false);
    // las bombas encadenan: todo lo que esté cerca revienta un instante después
    const MM = M;
    setTimeout(() => {
      if (M !== MM) return;
      for (const o of M.bricks) {
        if (!o.alive || o.type === 'steel') continue;
        const oa = M.layers[o.L].rot + o.ac;
        if (Math.hypot(Math.cos(oa) * o.r - x, Math.sin(oa) * o.r - y) < 75) bkKillBrick(o, null);
      }
      bkCheckWin();
    }, 90);
  }
  bkCheckWin();
}
function bkCheckWin() {
  if (phase !== 'play' && phase !== 'menu') return;
  if (M.core) return;
  if (!M.bricks.some(o => o.alive && o.type !== 'steel')) floorClear();
}
function bkStep(b, dt) {
  // imán (o cuando quedan pocos bloques): la bola se tuerce hacia el bloque más cercano
  const few = M.bricks.reduce((n, o) => n + (o.alive && o.type !== 'steel' ? 1 : 0), 0) <= 6;
  if (has('magnet') || few) {
    let best = null, bd = 1e9;
    for (const o of M.bricks) {
      if (!o.alive || o.type === 'steel') continue;
      const oa = M.layers[o.L].rot + o.ac, ox = Math.cos(oa) * o.r, oy = Math.sin(oa) * o.r, d = Math.hypot(ox - b.x, oy - b.y);
      if (d < bd) { bd = d; best = [ox, oy]; }
    }
    if (best && (bd < 160 || few)) { const k = few ? 420 : 300; b.vx += (best[0] - b.x) / bd * k * dt; b.vy += (best[1] - b.y) / bd * k * dt; }
  }
  const sp = Math.hypot(b.vx, b.vy) || 1, want = M.speed * (b.pierce > 0 ? 1.2 : 1);
  b.vx *= want / sp; b.vy *= want / sp;
  b.x += b.vx * dt; b.y += b.vy * dt;
  const d = Math.hypot(b.x, b.y) || 1e-4, ang = Math.atan2(b.y, b.x);
  // núcleo del jefe
  if (M.core && M.core.hp > 0 && d < M.core.r + BALL_R) {
    const nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    b.x = nx * (M.core.r + BALL_R + 1); b.y = ny * (M.core.r + BALL_R + 1);
    M.core.hp--; M.core.flash = 1; run.boss.hp = M.core.hp;
    bumpCombo();
    addScore(300 * run.floor * comboMult(game.combo));
    floatText(M.core.hp > 0 ? `¡GOLPE! quedan ${M.core.hp}` : '¡ROTO!', b.x, b.y - 20, 26, '#ff8aa0');
    Sfx.bossHit(); fx.shake = 18; fx.hitStop = 0.08; fx.flash = 0.4; fx.flashHue = 190;
    if (M.core.hp <= 0) {
      for (const o of M.bricks) if (o.alive) { o.alive = false; const oa = M.layers[o.L].rot + o.ac; shatterArc(o.r, oa - o.hw, o.hw * 2, o.hue, o.th, 0, false, 10); }
      for (let k = 0; k < 5; k++) shockwaves.push({ R: 30 + k * 40, t: -k * 0.08, hue: 190 + k * 30 });
      run.boss.alive = false; M.core = null; fx.shake = 40; fx.hitStop = 0.3;
      floorClear();
    }
    return;
  }
  // bloques (anillos troceados que giran)
  for (const o of M.bricks) {
    if (!o.alive) continue;
    if (Math.abs(d - o.r) > o.th / 2 + BALL_R) continue;
    const local = wrap(ang - M.layers[o.L].rot - o.ac), angTol = BALL_R / d;
    if (Math.abs(local) > o.hw + angTol) continue;
    if (b.pierce > 0 && o.type !== 'steel') { bkHitBrick(o, b); continue; }
    const dr = d - o.r;
    const radialPen = o.th / 2 + BALL_R - Math.abs(dr), angPen = (o.hw + angTol - Math.abs(local)) * d;
    const rx = b.x / d, ry = b.y / d;
    if (radialPen < angPen) {
      const s = dr > 0 ? 1 : -1, nx = rx * s, ny = ry * s, vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
      b.x += nx * radialPen; b.y += ny * radialPen;
    } else {
      const s = local > 0 ? 1 : -1, nx = -ry * s, ny = rx * s, vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
      b.x += nx * angPen; b.y += ny * angPen;
    }
    bkHitBrick(o, b);
    break;
  }
  // pala
  const d2 = Math.hypot(b.x, b.y);
  if (d2 > PADDLE_R - BALL_R - 4 && d2 < PADDLE_R + 6 && (b.vx * b.x + b.vy * b.y) > 0) {
    const da = wrap(Math.atan2(b.y, b.x) - M.paddle.a);
    if (Math.abs(da) < M.pw + BALL_R / PADDLE_R) {
      // efecto: nunca vuelve recta, así no se queda en bucle atravesando el centro
      let off = clamp(da / M.pw, -1, 1) * 0.95 + rand(-0.22, 0.22);
      if (Math.abs(off) < 0.15) off = 0.15 * (Math.random() < 0.5 ? -1 : 1);
      const dir = Math.atan2(b.y, b.x) + Math.PI + off;
      b.vx = Math.cos(dir) * M.speed; b.vy = Math.sin(dir) * M.speed;
      const k = (PADDLE_R - BALL_R - 5) / d2; b.x *= k; b.y *= k;
      M.paddle.flash = 1; M.hits++;
      Sfx.paddle();
      for (let q = 0; q < 6; q++) spark(b.x, b.y, 185, 200, 0.3);
      if (has('drill') && M.hits % 4 === 0) { b.pierce = 1.2; floatText('TALADRO', b.x, b.y - 20, 20, '#ff9a3d'); }
      if (has('echo') && M.hits % 6 === 0) { const nb = bkBall(rand(-0.2, 0.2)); nb.x = b.x; nb.y = b.y; balls.push(nb); }
    }
  }
}
const BREAKOUT = {
  id: 'breakout', title: 'ROMPEBLOQUES', tag: 'la pala sigue tu dedo · no dejes escapar la bola', timed: true,
  hint: 'mueve el ratón o el dedo alrededor: la pala te sigue',
  bossTag: 'golpea el núcleo · esquiva sus balas rojas',
  build: bkBuild,
  tap(ang) { M.paddle.target = ang; },
  move(ang) { M.paddle.target = ang; },
  echo() { },
  update(dt, rdt, live) {
    for (const L of M.layers) L.rot += L.omega * dt;
    for (const o of M.bricks) o.flash = Math.max(0, o.flash - rdt * 5);
    M.paddle.flash = Math.max(0, M.paddle.flash - rdt * 4);
    if (M.core) M.core.flash = Math.max(0, M.core.flash - rdt * 4);
    if (!live) return;
    const da = wrap(M.paddle.target - M.paddle.a);
    M.paddle.a += clamp(da, -13 * rdt, 13 * rdt);
    const steps = clamp(Math.ceil(M.speed * 1.2 * dt / 4), 1, 16), sdt = dt / steps;
    for (let s = 0; s < steps; s++) for (const b of balls) bkStep(b, sdt);
    for (const b of balls) if (b.pierce > 0) b.pierce -= dt;
    // bolas perdidas por detrás de la pala
    const before = balls.length;
    balls = balls.filter(b => Math.hypot(b.x, b.y) < PADDLE_R + 40);
    if (balls.length < before) { Sfx.deny(); fx.shake = Math.max(fx.shake, 6); }
    if (!balls.length && (phase === 'play' || phase === 'menu')) {
      if (phase === 'play') { floatText('¡SE ESCAPÓ!', Math.cos(M.paddle.a) * 260, Math.sin(M.paddle.a) * 260, 28, '#ff4d6a'); damage('ball', 0, 0); }
      if (phase === 'play' || phase === 'menu') for (let i = 0; i < run.balls; i++) balls.push(bkBall(i * 0.25));
    }
    // balas del jefe
    if (M.core && phase === 'play') {
      M.fireT -= dt;
      if (M.fireT <= 0) {
        M.fireT = Math.max(0.7, 1.7 - run.info.loop * 0.25);
        const a = M.paddle.a + rand(-0.7, 0.7);
        M.shots.push({ x: 0, y: 0, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, alive: true });
      }
    }
    for (const s of M.shots) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      const d = Math.hypot(s.x, s.y);
      if (d > PADDLE_R - 6 && s.alive) {
        s.alive = false;
        const onPad = Math.abs(wrap(Math.atan2(s.y, s.x) - M.paddle.a)) < M.pw + 0.04;
        if (onPad && has('gauntlet')) { floatText('¡DEVUELTA!', s.x, s.y - 16, 20, '#9ff'); Sfx.paddle(); }
        else if (onPad) { for (let k = 0; k < 20; k++) spark(s.x, s.y, 0, 300, 0.5); damage('shot', s.x, s.y); }
      }
    }
    M.shots = M.shots.filter(s => s.alive);
  },
  ai() {
    let best = null, bd = 1e9;
    for (const b of balls) { const d = PADDLE_R - Math.hypot(b.x, b.y); if ((b.vx * b.x + b.vy * b.y) > 0 && d < bd) { bd = d; best = b; } }
    if (best) M.paddle.target = Math.atan2(best.y, best.x);
  },
  drawBack() {
    // guía de la pala
    ctx.globalAlpha = 0.18; ctx.strokeStyle = '#3df5ff'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 10]); ctx.beginPath(); ctx.arc(0, 0, PADDLE_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    for (const o of M.bricks) {
      if (!o.alive) continue;
      const a = M.layers[o.L].rot + o.ac;
      let col;
      if (o.type === 'steel') col = '#8fa3b8';
      else if (o.type === 'gold') col = 'hsl(46,100%,60%)';
      else if (o.type === 'bomb') col = `hsl(12,100%,${50 + 15 * Math.sin(game.t * 10)}%)`;
      else if (o.type === 'multi') col = '#e8fbff';
      else col = `hsl(${o.hue},95%,${o.hp > 1 ? 45 : 60}%)`;
      ctx.globalAlpha = 0.18 + o.flash * 0.3 + fx.beat * 0.1;
      ctx.strokeStyle = col; ctx.lineWidth = o.th + 8;
      ctx.beginPath(); ctx.arc(0, 0, o.r, a - o.hw, a + o.hw); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = o.th + o.flash * 3;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(0, 0, o.r, a - o.hw, a + o.hw); ctx.stroke();
      if (o.hp > 1 && o.hp < 99) { ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, o.r, a - o.hw * 0.7, a + o.hw * 0.7); ctx.stroke(); }
      if (o.type === 'multi') { ctx.fillStyle = '#3df5ff'; for (const q of [-0.4, 0, 0.4]) { const qa = a + q * o.hw; ctx.beginPath(); ctx.arc(Math.cos(qa) * o.r, Math.sin(qa) * o.r, 2.5, 0, TAU); ctx.fill(); } }
      ctx.lineCap = 'round';
    }
    if (M.core) {
      const c = M.core, pulse = 1 + 0.06 * Math.sin(game.t * 6) + fx.beat * 0.05;
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#3df5ff';
      ctx.beginPath(); ctx.arc(0, 0, c.r * 1.6 * pulse, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = c.flash > 0 ? '#fff' : '#0a2a33';
      ctx.beginPath(); ctx.arc(0, 0, c.r * pulse, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3df5ff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#ff2f55'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, c.r * 0.6, -Math.PI / 2, -Math.PI / 2 + TAU * c.hp / c.maxHp); ctx.stroke();
    }
    for (const s of M.shots) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ff2f55'; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ff8aa0'; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  drawFront() {
    const a = M.paddle.a, w = M.pw;
    ctx.strokeStyle = '#3df5ff'; ctx.globalAlpha = 0.25 + M.paddle.flash * 0.4; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(0, 0, PADDLE_R, a - w, a + w); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = M.paddle.flash > 0.5 ? '#fff' : '#bdfcff'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(0, 0, PADDLE_R, a - w, a + w); ctx.stroke();
    if (game.aim !== null && phase === 'play') {
      ctx.globalAlpha = 0.4; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(Math.cos(game.aim) * (PADDLE_R + 20), Math.sin(game.aim) * (PADDLE_R + 20), 6, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  hud() { return { fill: run.time / run.timeMax, text: Math.max(0, run.time).toFixed(1) + ' s', low: run.time < 5 }; },
  frenzy() { for (let i = 0; i < 4; i++) balls.push(bkBall(rand(-0.5, 0.5))); },
  prism(x, y) { const a = rand(TAU); balls.push({ x, y, vx: Math.cos(a) * M.speed, vy: Math.sin(a) * M.speed, trail: [], hue: 280, dash: 0, glow: 1, pierce: 0 }); floatText('+BOLA', x, y - 30, 20, '#9ff'); },
  blackhole() {
    const list = M.bricks.filter(o => o.alive && o.type !== 'steel').sort((p, q) => p.r - q.r).slice(0, 5);
    for (const o of list) bkKillBrick(o, null);
  },
  explode() {
    for (const o of M.bricks) if (o.alive) { const a = M.layers[o.L].rot + o.ac; shatterArc(o.r, a - o.hw, o.hw * 2, o.hue, o.th, 0, false, 8); o.alive = false; }
  },
};

// ================================================================= MODO 3: ENJAMBRE
const CORE_R = 24, ARENA_R = 335;
const ENEMY = {
  blob: { r: 15, hp: 1, sp: 1, hue: 300, score: 40 },
  tank: { r: 23, hp: 3, sp: 0.55, hue: 25, score: 120 },
  dart: { r: 11, hp: 1, sp: 1.8, hue: 185, score: 60 },
  split: { r: 19, hp: 2, sp: 0.8, hue: 120, score: 90 },
  mini: { r: 10, hp: 1, sp: 1.3, hue: 120, score: 20 },
  queen: { r: 44, hp: 16, sp: 0.25, hue: 330, score: 5000 },
};
function swSpawn(type, a = rand(TAU), d = ARENA_R - 5) {
  const T = ENEMY[type];
  const hp = type === 'queen' ? T.hp + run.info.loop * 8 : T.hp;
  const e = { type, x: Math.cos(a) * d, y: Math.sin(a) * d, r: T.r, hp, maxHp: hp, sp: T.sp, hue: T.hue, flash: 0, wob: rand(TAU), alive: true, orbit: a };
  M.enemies.push(e);
  return e;
}
function swPickType() {
  const l = M.lvl, r = Math.random();
  if (l >= 2 && r < 0.18) return 'split';
  if (l >= 1 && r < 0.38) return 'tank';
  if (l >= 1 && r < 0.6) return 'dart';
  return 'blob';
}
function swBuild(info) {
  const lvl = info.lvl;
  M = { enemies: [], spawnT: 0.8, killed: 0, spawned: 0, quota: 14 + lvl * 5 + info.loop * 6, spawnEvery: Math.max(0.3, 1.25 - lvl * 0.1),
    speed: (34 + lvl * 5) * (1 + info.loop * 0.15) * run.spinMul * run.enemyMul, lvl, queen: null, coreFlash: 0, ammo: run.maxCharges + run.balls, minionT: 2.5, cleared: false };
  M.maxAmmo = M.ammo;
  if (info.boss) {
    M.queen = swSpawn('queen', rand(TAU), 300);
    run.boss = { name: ['LA REINA', 'LA MADRE', 'LA PLAGA'][info.loop % 3], hp: M.queen.hp, maxHp: M.queen.maxHp, alive: true, hue: 330 };
  }
}
function swShoot(ang, free) {
  const cap = M.maxAmmo;
  if (!free && balls.length >= cap) {
    // ya tienes todas fuera: el toque las redirige a todas hacia allí
    const tx = Math.cos(ang) * ARENA_R, ty = Math.sin(ang) * ARENA_R;
    for (const b of balls) {
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
      b.vx = dx / d * 760; b.vy = dy / d * 760; b.glow = 1;
      beams.push({ x0: b.x, y0: b.y, x1: b.x + dx / d * 90, y1: b.y + dy / d * 90, t: 0, col: '#3dffb0' });
    }
    pulses.push({ a: ang, t: 0, hue: 160 });
    Sfx.zap(true);
    return;
  }
  if (!free) run.shots++;
  const mega = !free && has('drill') && run.shots % 4 === 0;
  const r = (mega ? 15 : BALL_R + 1) * run.gapMul;
  balls.push({ x: Math.cos(ang) * (CORE_R + 4), y: Math.sin(ang) * (CORE_R + 4), vx: Math.cos(ang) * 760, vy: Math.sin(ang) * 760,
    trail: [], hue: mega ? 30 : 140 + balls.length * 25, dash: 0, glow: 1, r, dmg: mega ? 3 : 1 });
  if (mega) floatText('¡MEGABOLA!', 0, -40, 22, '#ff9a3d');
  beams.push({ x0: 0, y0: 0, x1: Math.cos(ang) * 120, y1: Math.sin(ang) * 120, t: 0, col: '#3dffb0' });
  Sfx.zap(false);
}
function swHit(e, b) {
  if (e.flash > 0.75) return;
  e.hp -= b.dmg; e.flash = 1;
  const d = Math.hypot(e.x, e.y) || 1;
  const kb = e.type === 'queen' ? 8 : 26;
  e.x += e.x / d * kb; e.y += e.y / d * kb;
  for (let k = 0; k < 6; k++) spark(e.x, e.y, e.hue, 220, 0.35);
  if (e.type === 'queen') { run.boss.hp = Math.max(0, e.hp); Sfx.bossHit(); fx.shake = Math.max(fx.shake, 10); }
  else Sfx.enemyHit();
  if (e.hp <= 0) swKill(e);
}
function swKill(e, quiet) {
  if (!e.alive) return;
  e.alive = false;
  run.stats.kills++;
  if (!quiet) { bumpCombo(); dopaBoost(0.05); }
  const v = ENEMY[e.type].score * run.floor * (quiet ? 1 : comboMult(game.combo));
  addScore(v);
  if (!quiet || Math.random() < 0.3) floatText('+' + fmt(v * run.scoreMul), e.x, e.y, clamp(16 + Math.log10(v + 1) * 3, 16, 44), '#ffe27a');
  blob(e.x, e.y, e.hue, e.type === 'queen' ? 80 : 14, e.type === 'queen' ? 9 : 5);
  for (let k = 0; k < 10; k++) spark(e.x, e.y, e.hue, 340, 0.5);
  if (!quiet) Sfx.splat(game.combo);
  fx.shake = Math.max(fx.shake, e.type === 'queen' ? 40 : 4 + Math.min(game.combo, 12) * 0.5);
  onDestroy(e.x, e.y, 0.4);
  if (e.type === 'split') for (let k = 0; k < 2; k++) { const m = swSpawn('mini', 0, 0); m.x = e.x + rand(-10, 10); m.y = e.y + rand(-10, 10); }
  if (e.type !== 'mini' && e.type !== 'queen') M.killed++;
  if (e.type === 'queen') {
    run.boss.alive = false;
    for (const o of M.enemies) if (o.alive && o !== e) swKill(o, true);
    for (let k = 0; k < 5; k++) shockwaves.push({ R: 20 + k * 40, t: -k * 0.08, hue: 330 - k * 30 });
    fx.hitStop = 0.3; fx.flash = 1; fx.flashHue = 330;
    floorClear();
  } else if (!M.queen && M.killed >= M.quota && !M.cleared) {
    M.cleared = true;
    // fin de oleada: todo lo que queda revienta en cadena
    const MM = M;
    M.enemies.filter(o => o.alive).forEach((o, i) => setTimeout(() => { if (M === MM) swKill(o, true); }, 40 * i));
    shockwaves.push({ R: CORE_R, t: 0, hue: 120 });
    floorClear();
  }
}
const SWARM = {
  id: 'swarm', title: 'ENJAMBRE', tag: 'defiende el núcleo · las bolas no paran', timed: false,
  hint: 'toca para lanzar bolas · cuando estén todas fuera, tocar las redirige',
  bossTag: 'dale hasta que reviente',
  build: swBuild,
  tap(ang) { swShoot(ang, false); },
  echo(ang) { swShoot(ang + 0.15, true); },
  update(dt, rdt, live) {
    M.coreFlash = Math.max(0, M.coreFlash - rdt * 3);
    for (const e of M.enemies) e.flash = Math.max(0, e.flash - rdt * 6);
    if (!live) return;
    const spawning = phase === 'play' || phase === 'menu';
    if (spawning && !M.cleared) {
      M.spawnT -= dt;
      const alive = M.enemies.filter(e => e.alive).length;
      const room = M.queen ? alive < 14 : M.killed + alive < M.quota + 3 && alive < 40;
      if (M.spawnT <= 0 && room) {
        M.spawnT = M.spawnEvery * rand(0.6, 1.3) * (M.queen ? 2.4 : 1);
        swSpawn(swPickType()); M.spawned++;
        if (M.lvl >= 3 && Math.random() < 0.3) { swSpawn('dart'); M.spawned++; }
      }
      if (M.queen && M.queen.alive) {
        M.minionT -= dt;
        if (M.minionT <= 0) { M.minionT = Math.max(1.6, 3.2 - run.info.loop * 0.4); for (let k = 0; k < 2; k++) { const m = swSpawn('mini', 0, 0); m.x = M.queen.x + rand(-20, 20); m.y = M.queen.y + rand(-20, 20); } }
      }
    }
    // los bichos avanzan hacia el núcleo
    for (const e of M.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x, e.y) || 1;
      if (e.type === 'queen') {
        e.orbit += 0.3 * dt;
        const nd = d - 9 * dt * run.spinMul * run.enemyMul;
        e.x = Math.cos(e.orbit) * nd; e.y = Math.sin(e.orbit) * nd;
      } else {
        const sp = M.speed * e.sp, nx = -e.x / d, ny = -e.y / d;
        const w = Math.sin(game.t * (e.type === 'dart' ? 7 : 3) + e.wob) * (e.type === 'dart' ? 60 : 22);
        e.x += (nx * sp - ny * w) * dt; e.y += (ny * sp + nx * w) * dt;
      }
      if (Math.hypot(e.x, e.y) < CORE_R + e.r) {
        M.coreFlash = 1;
        if (e.type === 'queen') {
          damage('enemy', e.x, e.y);
          const a = Math.atan2(e.y, e.x); e.x = Math.cos(a) * 300; e.y = Math.sin(a) * 300; e.orbit = a;
        } else {
          e.alive = false; blob(e.x, e.y, 0, 20, 6);
          if (phase === 'play' && damage('enemy', e.x, e.y)) {
            // el núcleo dañado suelta una onda que limpia lo que tenga encima
            shockwaves.push({ R: CORE_R, t: 0, hue: 350 });
            for (const o of M.enemies) if (o.alive && o.type !== 'queen' && Math.hypot(o.x, o.y) < 110) swKill(o, true);
          }
        }
      }
    }
    M.enemies = M.enemies.filter(e => e.alive);
    // bolas: rebotan para siempre por el ruedo, contra la pared y contra los bichos
    for (const b of balls) {
      if (has('magnet')) {
        let best = null, bd = 220;
        for (const e of M.enemies) { const dd = Math.hypot(e.x - b.x, e.y - b.y); if (dd < bd) { bd = dd; best = e; } }
        if (best) { b.vx += (best.x - b.x) / bd * 1400 * dt; b.vy += (best.y - b.y) / bd * 1400 * dt; }
      }
      const sp = Math.hypot(b.vx, b.vy) || 1; b.vx *= 760 / sp; b.vy *= 760 / sp;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const d = Math.hypot(b.x, b.y);
      if (d > ARENA_R - b.r) {
        const nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
        b.x = nx * (ARENA_R - b.r); b.y = ny * (ARENA_R - b.r);
        Sfx.bounce(3 + Math.floor(rand(6)), 500);
        for (let k = 0; k < 4; k++) spark(b.x, b.y, b.hue, 200, 0.3);
      }
      if (d < CORE_R + b.r && d > 0) { // el núcleo también rebota
        const nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
        b.x = nx * (CORE_R + b.r); b.y = ny * (CORE_R + b.r);
      }
      for (const e of M.enemies) {
        if (!e.alive) continue;
        const dx = b.x - e.x, dy = b.y - e.y, dd = Math.hypot(dx, dy);
        if (dd < e.r + b.r && dd > 0) {
          const nx = dx / dd, ny = dy / dd, vn = b.vx * nx + b.vy * ny;
          if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
          b.x = e.x + nx * (e.r + b.r + 1); b.y = e.y + ny * (e.r + b.r + 1);
          swHit(e, b);
        }
      }
    }
    balls = balls.filter(b => !b.done);
  },
  ai(dt) {
    M.aiT = (M.aiT || 0.4) - dt;
    if (M.aiT <= 0 && M.enemies.length) {
      M.aiT = 0.35;
      const e = M.enemies.reduce((p, q) => Math.hypot(p.x, p.y) < Math.hypot(q.x, q.y) ? p : q);
      swShoot(Math.atan2(e.y, e.x), true);
    }
  },
  drawBack() {
    ctx.globalAlpha = 0.25 + fx.beat * 0.2; ctx.strokeStyle = '#3dffb0'; ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = -game.t * 30;
    ctx.beginPath(); ctx.arc(0, 0, ARENA_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    for (const e of M.enemies) {
      const wob = 1 + 0.12 * Math.sin(game.t * 9 + e.wob);
      ctx.globalAlpha = 0.25; ctx.fillStyle = `hsl(${e.hue},100%,55%)`;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.7 * wob, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = e.flash > 0 ? '#fff' : `hsl(${e.hue},90%,${e.type === 'tank' ? 40 : 52}%)`;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * wob, e.r / wob, game.t * 2 + e.wob, 0, TAU); ctx.fill();
      // ojos mirando al núcleo
      const d = Math.hypot(e.x, e.y) || 1, lx = -e.x / d, ly = -e.y / d, px = -ly, py = lx, er = Math.max(2, e.r * 0.28);
      for (const s of [-1, 1]) {
        const ex = e.x + lx * e.r * 0.3 + px * s * e.r * 0.38, ey = e.y + ly * e.r * 0.3 + py * s * e.r * 0.38;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex + lx * er * 0.4, ey + ly * er * 0.4, er * 0.5, 0, TAU); ctx.fill();
      }
      if (e.type === 'queen') {
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * e.hp / e.maxHp); ctx.stroke();
        ctx.fillStyle = '#ffd34d';
        for (let k = -2; k <= 2; k++) { const a = Math.atan2(e.y, e.x) + Math.PI + k * 0.3; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, 4, 0, TAU); ctx.fill(); }
      } else if (e.maxHp > 1) {
        ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 4, 0, TAU * e.hp / e.maxHp); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  },
  drawFront() {
    const low = run.hp === 1 && !run.demo;
    const pulse = 1 + 0.08 * Math.sin(game.t * 5) + fx.beat * 0.12 + M.coreFlash * 0.3;
    const hue = low ? 350 : 160;
    ctx.globalAlpha = 0.3; ctx.fillStyle = `hsl(${hue},100%,55%)`;
    ctx.beginPath(); ctx.arc(0, 0, CORE_R * 2 * pulse, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = M.coreFlash > 0.5 ? '#fff' : `hsl(${hue},100%,60%)`;
    ctx.beginPath(); ctx.arc(0, 0, CORE_R * pulse, 0, TAU); ctx.fill();
    // bolas que aún puedes lanzar: puntitos orbitando el núcleo
    for (let i = 0; i < M.maxAmmo; i++) {
      const a = game.t * 2 + i * TAU / M.maxAmmo;
      ctx.fillStyle = i < M.maxAmmo - balls.length ? '#3dffb0' : '#ffffff22';
      ctx.beginPath(); ctx.arc(Math.cos(a) * (CORE_R + 12), Math.sin(a) * (CORE_R + 12), 3.5, 0, TAU); ctx.fill();
    }
    if (game.aim !== null && phase === 'play') {
      ctx.globalAlpha = 0.3; ctx.strokeStyle = '#3dffb0'; ctx.lineWidth = 2; ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(game.aim) * ARENA_R, Math.sin(game.aim) * ARENA_R); ctx.stroke(); ctx.setLineDash([]);
    }
    drawPulses(ARENA_R);
  },
  hud() {
    if (M.queen) return { fill: M.queen.hp / M.queen.maxHp, text: `${run.boss.name}: ${Math.max(0, M.queen.hp)}`, low: false };
    const left = Math.max(0, M.quota - M.killed);
    return { fill: left / M.quota, text: `QUEDAN ${left}`, low: false };
  },
  prism(x, y) { if (M.enemies.length) { const e = pick(M.enemies); const a = Math.atan2(e.y, e.x); swShoot(a, true); } },
  frenzy() { for (let i = 0; i < 3; i++) swShoot(rand(TAU), true); },
  blackhole() { for (const e of M.enemies) if (e.alive && Math.hypot(e.x, e.y) < 170 && e.type !== 'queen') swKill(e, true); },
  explode() { for (const e of M.enemies) if (e.alive) { blob(e.x, e.y, e.hue, 10, 5); e.alive = false; } },
};

// ================================================================= BONUS: TRAGAPERRAS (plinko)
const PK_MULTS = [25, 8, 3, 1, 0.5, 1, 3, 8, 25];
function pkBuild(info) {
  M = { pegs: [], bins: [], drops: 0, cd: 0, endT: 0, shards: 0, total: 0 };
  for (let i = 0; i < 11; i++) {
    const count = i + 3, y = -215 + i * 38, sp = 46, x0 = -(count - 1) * sp / 2;
    for (let k = 0; k < count; k++) {
      const roll = Math.random();
      M.pegs.push({ x: x0 + k * sp, y, r: 5, row: i, type: roll < 0.08 ? 'gold' : roll < 0.13 ? 'split' : 'normal', flash: 0 });
    }
  }
  PK_MULTS.forEach((m, i) => M.bins.push({ x0: -270 + i * 60, x1: -210 + i * 60, m, flash: 0 }));
  M.drops = M.maxDrops = 10 + (run.maxCharges - 2) * 2 + (run.balls - 1) * 2;
}
const PLINKO = {
  id: 'plinko', title: 'TRAGAPERRAS', tag: 'bonus · nada te puede matar', timed: false,
  hint: 'toca para soltar bolas · los bordes pagan x25 y esquirlas',
  build: pkBuild,
  tap(ang, wx) {
    if (M.drops <= 0 || M.cd > 0) return;
    if (!run.demo) M.drops--;
    M.cd = 0.09;
    balls.push({ x: clamp(wx, -255, 255) + rand(-3, 3), y: -300, vx: rand(-25, 25), vy: 0, trail: [], hue: 48, dash: 0, glow: 0.5, value: 1, used: new Set() });
    Sfx.zap(false);
  },
  echo() { },
  update(dt, rdt, live) {
    M.cd -= rdt;
    for (const p of M.pegs) p.flash = Math.max(0, p.flash - rdt * 4);
    for (const bn of M.bins) bn.flash = Math.max(0, bn.flash - rdt * 2);
    if (!live) return;
    const steps = 3, sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const b of balls) {
        b.vy += 650 * sdt; b.x += b.vx * sdt; b.y += b.vy * sdt;
        if (Math.abs(b.x) > 285) { b.x = Math.sign(b.x) * 285; b.vx *= -0.7; }
        for (const p of M.pegs) {
          const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
          if (d > p.r + BALL_R || d === 0) continue;
          const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
          b.x = p.x + nx * (p.r + BALL_R); b.y = p.y + ny * (p.r + BALL_R);
          if (vn < 0) { b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; b.vx += rand(-35, 35); }
          if (p.flash < 0.5) Sfx.peg(p.row);
          p.flash = 1;
          if (p.type === 'gold' && !b.used.has(p)) { b.used.add(p); b.value *= 2; b.hue = 40; b.glow = 1; floatText('x2', p.x, p.y - 12, 18, '#ffd34d'); }
          if (p.type === 'split' && !b.used.has(p) && balls.length < 60) {
            b.used.add(p);
            const nb = { x: b.x, y: b.y, vx: -b.vx + rand(-40, 40), vy: b.vy, trail: [], hue: 300, dash: 0, glow: 1, value: b.value, used: new Set(b.used) };
            balls.push(nb); floatText('¡SPLIT!', p.x, p.y - 12, 18, '#ff7ad9');
          }
        }
        if (b.y > 228) for (let k = 1; k < 9; k++) {
          const X = -270 + k * 60;
          if (Math.abs(b.x - X) < BALL_R + 1.5) { b.x = X + Math.sign(b.x - X || 1) * (BALL_R + 1.5); b.vx = -b.vx * 0.6; }
        }
        if (b.y > 285 && !b.done) {
          b.done = true;
          const i = clamp(Math.floor((b.x + 270) / 60), 0, 8), bn = M.bins[i], m = bn.m * b.value;
          bn.flash = 1;
          const v = 150 * run.floor * m;
          addScore(v); M.total += v; dopaBoost(0.02 + bn.m * 0.006);
          const sh = run.demo ? 0 : bn.m >= 3 ? Math.round(bn.m * b.value / 2) : 0;
          run.shardsEarned += sh; M.shards += sh;
          floatText(`x${fmt(m)}`, b.x, 250, clamp(20 + m, 20, 70), m >= 8 ? '#ffd34d' : '#fff');
          if (sh) floatText(`+${sh} ◆`, b.x, 215, 20, '#c58bff');
          if (bn.m >= 8) {
            Sfx.jackpot(bn.m); fx.shake = bn.m >= 25 ? 26 : 12; fx.flash = bn.m >= 25 ? 0.9 : 0.4; fx.flashHue = 48;
            if (bn.m >= 25) { banner('¡JACKPOT!', `x${fmt(m)}`); for (let q = 0; q < 20; q++) stars.push({ x: W / 2 + rand(-100, 100), y: H * 0.8, vx: rand(-300, 300), vy: rand(-600, -200), t: -q * 0.02, home: 0 }); }
            for (let q = 0; q < 40; q++) spark(b.x, 270, 48, 500, 0.8);
          } else { Sfx.bounce(i + 3, 500); for (let q = 0; q < 8; q++) spark(b.x, 270, 48, 200, 0.4); }
        }
      }
      balls = balls.filter(b => !b.done);
    }
    if (M.drops <= 0 && !balls.length && phase === 'play') {
      M.endT += rdt;
      if (M.endT > 0.8) { M.endT = -99; floorClear(`+${M.shards} ◆ de la tragaperras`); }
    }
    if (run.demo && M.drops <= 0 && !balls.length) M.drops = M.maxDrops;
  },
  ai(dt) { M.aiT = (M.aiT || 0) - dt; if (M.aiT <= 0) { M.aiT = 0.35; this.tap(0, rand(-250, 250)); } },
  drawBack() {
    for (const p of M.pegs) {
      const col = p.type === 'gold' ? '#ffd34d' : p.type === 'split' ? '#ff7ad9' : `hsl(${(p.row * 25 + game.t * 40) % 360},90%,70%)`;
      ctx.globalAlpha = 0.25 + p.flash * 0.5 + fx.beat * 0.15; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (2.4 + p.flash * 2), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < M.bins.length; i++) {
      const bn = M.bins[i], hot = bn.m >= 8, cx = (bn.x0 + bn.x1) / 2;
      ctx.globalAlpha = 0.15 + bn.flash * 0.6;
      ctx.fillStyle = hot ? '#ffd34d' : bn.m >= 3 ? '#ff7ad9' : '#3df5ff';
      ctx.fillRect(bn.x0 + 3, 240, 54, 60);
      ctx.globalAlpha = 1;
      ctx.font = `900 ${hot ? 18 : 15}px Rubik, sans-serif`;
      ctx.fillText(`x${bn.m}`, cx, 272);
      if (i > 0) { ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bn.x0, 228); ctx.lineTo(bn.x0, 300); ctx.stroke(); }
    }
    ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 2;
    ctx.strokeRect(-290, -310, 580, 612);
    ctx.globalAlpha = 1;
  },
  drawFront() {
    if (game.aim !== null && phase === 'play' && M.drops > 0) {
      const [wx] = game.aimWorld || [0];
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(clamp(wx, -255, 255), -300, BALL_R, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  },
  hud() { return { fill: M.drops / M.maxDrops, text: `BOLAS: ${M.drops} · +${M.shards} ◆`, low: false }; },
  frenzy() { M.drops += 12; },
  explode() { for (const p of M.pegs) for (let k = 0; k < 2; k++) spark(p.x, p.y, 48, 300, 0.6); M.pegs = []; M.bins = []; },
};

const MODES = { rings: RINGS, breakout: BREAKOUT, swarm: SWARM, plinko: PLINKO, multiply: MULTIPLY, merge: MERGE, chain: CHAIN, hole: HOLE };

// ---------------------------------------------------------------- bucle
function update(rdt) {
  game.t += rdt;
  if (phase === 'dying') fx.slowTarget = 0.15;
  if (fx.hitStop > 0) { fx.hitStop -= rdt; rdt *= 0.05; }
  fx.timeScale += (fx.slowTarget - fx.timeScale) * Math.min(1, rdt * 10);
  const dt = rdt * fx.timeScale * (phase === 'play' ? GAME_SPEED * (game.frenzy > 0 ? 1.2 : 1) : 1);
  const live = phase === 'play' || phase === 'menu' || phase === 'clear';
  if (game.frenzy > 0) game.frenzy -= rdt;

  fx.focus = null;
  if (mode) mode.update(dt, rdt, live);
  if (run.demo && phase === 'menu' && mode.ai) mode.ai(dt);

  for (const b of balls) {
    b.trail.push(b.x, b.y);
    if (b.trail.length > 28) b.trail.splice(0, 2);
    if (b.glow) b.glow = Math.max(0, b.glow - rdt * 2);
  }

  // cámara: lenta y cerca cuando una bola va a escapar
  const slow = !!fx.focus && phase === 'play';
  if (phase !== 'dying') fx.slowTarget = slow ? (fx.lastSlow ? 0.2 : 0.35) : 1;
  fx.zoomTarget = slow ? (fx.lastSlow ? 1.4 : 1.18) : 1;
  const tx = slow ? fx.focus.x * 0.5 : 0, ty = slow ? fx.focus.y * 0.5 : 0;
  fx.camX += (tx - fx.camX) * Math.min(1, rdt * 6);
  fx.camY += (ty - fx.camY) * Math.min(1, rdt * 6);
  fx.zoom += (fx.zoomTarget - fx.zoom) * Math.min(1, rdt * 6);
  const I = tripI();
  fx.rot = Math.sin(game.t * 0.37) * 0.1 * I + Math.sin(game.t * 0.11) * 0.05 * I;

  if (phase === 'play') {
    run.age = (run.age || 0) + rdt;
    if (mode.timed) {
      run.time -= dt;
      const sec = Math.ceil(run.time);
      if (sec <= 5 && sec !== game.lastTick && run.time > 0) { game.lastTick = sec; Sfx.tick(sec <= 2); }
      if (run.time <= 0) {
        Sfx.timeout();
        damage('time');
        run.time = 12; game.lastTick = 99;
        if (phase === 'play') banner('¡TIEMPO!', '+12 s · −1 ♥', true);
      }
    }
    run.inv = Math.max(0, run.inv - rdt);
    for (const e of run.echo) { e.t -= rdt; if (e.t <= 0) mode.echo(e.ang); }
    run.echo = run.echo.filter(e => e.t > 0);
    if (run.hp === 1) { game.beatT -= rdt; if (game.beatT <= 0) { game.beatT = 1.1; Sfx.heartbeat(); } }
    if (has('blackhole') && mode.blackhole) {
      run.bhT -= dt;
      if (run.bhT <= 0) {
        run.bhT = 15; mode.blackhole(); Sfx.blackhole();
        for (let k = 0; k < 4; k++) shockwaves.push({ R: 300 - k * 60, t: -k * 0.06, hue: 270, implode: true });
        floatText('🕳️ ¡AGUJERO NEGRO!', 0, 0, 30, '#c58bff'); fx.shake = 20;
      }
    }
  }
  if (run.demo) game.dopa = 0.9;
  else if (phase === 'play' || phase === 'clear') {
    if (game.frenzy > 0) game.dopa = 1;
    else game.dopa = Math.max(Math.min(0.18, run.floor * 0.01), game.dopa - rdt * (game.combo > 0 ? 0.012 : 0.04));
  } else if (phase === 'dying' || phase === 'dead') game.dopa = Math.max(0, game.dopa - rdt * 0.5);
  Sfx.mood(game.dopa, game.frenzy > 0, !!run.boss);

  if (game.comboTimer > 0) { game.comboTimer -= dt; if (game.comboTimer <= 0) { game.combo = 0; updateCombo(); } }
  game.almostCd -= rdt;
  game.denyT = Math.max(0, game.denyT - rdt);
  if (game.hintT > 0) { game.hintT -= rdt; if (game.hintT <= 0) $('#hint').classList.remove('show'); }

  // menú: la demo va saltando de juego en juego
  if (run.demo && phase === 'menu') {
    game.demoT -= rdt;
    if (game.demoT <= 0) { game.demoT = 7; game.demoIdx++; startStage(game.demoIdx); }
  }
  if (game.phaseT > 0) {
    game.phaseT -= rdt;
    if (game.phaseT <= 0) {
      if (phase === 'clear') { if (run.info.bonus || !(run.info.boss || run.floor % 2 === 0)) goNext(); else openPick(); }
      else if (phase === 'dying') showDead();
      else if (phase === 'mutate') { $('#mutate').classList.remove('on'); canvas.classList.remove('glitch'); startStage(game.mutateTo); }
    }
  }

  for (const p of particles) {
    p.vy += (p.kind === 1 ? 300 : 0) * dt;
    p.vx *= 1 - dt * 1.5; p.vy *= 1 - dt * 1.5;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) { f.y += f.vy * rdt; f.vy *= 1 - rdt * 3; f.life -= rdt * 0.9; }
  floaters = floaters.filter(f => f.life > 0);
  for (const w of shockwaves) w.t += rdt;
  shockwaves = shockwaves.filter(w => w.t < 0.7);
  for (const x of beams) x.t += rdt;
  beams = beams.filter(x => x.t < 0.3);
  for (const x of pulses) x.t += rdt;
  pulses = pulses.filter(x => x.t < 0.8);

  const target = scoreTarget();
  stars = stars.filter((c, i) => {
    c.t += rdt;
    if (c.t < 0) return true;
    if (c.t < 0.35) { c.x += c.vx * rdt; c.y += c.vy * rdt; c.vx *= 0.9; c.vy *= 0.9; return true; }
    c.home = Math.min(1, c.home + rdt * 2.2);
    const k = c.home * c.home;
    c.x += (target.x - c.x) * k; c.y += (target.y - c.y) * k;
    if (Math.hypot(target.x - c.x, target.y - c.y) < 12) {
      Sfx.star(i);
      const el = $('#score'); el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 80);
      return false;
    }
    return true;
  });

  fx.shake = Math.max(0, fx.shake - rdt * 40);
  fx.flash = Math.max(0, fx.flash - rdt * 2.5);
  fx.hurt = Math.max(0, fx.hurt - rdt * 1.5);
  fx.beat = Math.max(0, fx.beat - rdt * 4);
}
function scoreTarget() {
  const cr = canvas.getBoundingClientRect(), r = $('#score').getBoundingClientRect();
  return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
}

// ---------------------------------------------------------------- dibujo
const viewS = () => viewScale * fx.zoom * (1 + fx.beat * 0.015 * (0.4 + tripI()));
function worldToScreen(x, y) {
  const s = viewS(), c = Math.cos(fx.rot), si = Math.sin(fx.rot);
  const dx = (x - fx.camX) * s, dy = (y - fx.camY) * s;
  return [W / 2 + c * dx - si * dy, H / 2 + 30 + si * dx + c * dy];
}
function screenToWorld(px, py) {
  const s = viewS(), c = Math.cos(fx.rot), si = Math.sin(fx.rot);
  const dx = px - W / 2, dy = py - H / 2 - 30;
  return [(c * dx + si * dy) / s + fx.camX, (-si * dx + c * dy) / s + fx.camY];
}
function setWorld(sx = 0, sy = 0) {
  const s = viewS(), c = Math.cos(fx.rot), si = Math.sin(fx.rot);
  const cx = W / 2 + sx, cy = H / 2 + 30 + sy;
  ctx.setTransform(DPR * s * c, DPR * s * si, -DPR * s * si, DPR * s * c,
    DPR * (cx - s * (c * fx.camX - si * fx.camY)), DPR * (cy - s * (si * fx.camX + c * fx.camY)));
}

// fondo hipnótico: polígonos que nacen del centro, rayos y color que nunca se está quieto
function drawPsyche(I) {
  const t = game.t, sides = 3 + ((run.stage || 0) % 5), beat = fx.beat;
  ctx.lineWidth = 2 + 8 * I;
  for (let i = 0; i < 14; i++) {
    const r = (i * 38 + t * 45 * (0.6 + I)) % 532;
    ctx.globalAlpha = (0.035 + 0.07 * I) * (1 + beat) * (1 - r / 532);
    ctx.strokeStyle = `hsl(${(t * 40 + i * 25) % 360},100%,60%)`;
    ctx.beginPath();
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU + t * 0.15 * (i % 2 ? 1 : -1) + i * 0.2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  if (I > 0.25) {
    ctx.lineWidth = 30;
    for (let k = 0; k < 12; k++) {
      const a = t * 0.25 + k * TAU / 12;
      ctx.globalAlpha = 0.025 * I * (1 + beat);
      ctx.strokeStyle = `hsl(${(t * 60 + k * 30) % 360},100%,60%)`;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 60, Math.sin(a) * 60); ctx.lineTo(Math.cos(a) * 700, Math.sin(a) * 700); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
// cuando la dopamina está alta el mundo se llena de nebulosas de color y destellos
function drawBloom(D) {
  if (D < 0.4) return;
  const k = (D - 0.4) / 0.6, t = game.t;
  for (let i = 0; i < 6; i++) {
    const a = t * (0.2 + i * 0.05) + i * 1.05, r = 120 + 160 * Math.sin(t * 0.3 + i);
    const x = Math.cos(a) * r, y = Math.sin(a * 1.3) * r;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 230);
    gr.addColorStop(0, `hsla(${(t * 30 + i * 60) % 360},100%,60%,${(0.17 * k * (1 + fx.beat * 0.6)).toFixed(3)})`);
    gr.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(x - 230, y - 230, 460, 460);
  }
  ctx.lineCap = 'butt';
  for (let i = 0; i < 46; i++) {
    const a = i * 2.4 + t * (0.08 + (i % 5) * 0.03), rr = 60 + (i * 53) % 290;
    const x = Math.cos(a) * rr, y = Math.sin(a * 0.9 + i) * rr, s = (2 + (i % 4)) * (0.6 + 0.6 * Math.sin(t * 4 + i)) * (0.5 + k);
    ctx.globalAlpha = 0.7 * k; ctx.strokeStyle = `hsl(${(i * 37 + t * 60) % 360},100%,75%)`; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - s * 2, y); ctx.lineTo(x + s * 2, y); ctx.moveTo(x, y - s * 2); ctx.lineTo(x, y + s * 2); ctx.stroke();
  }
  ctx.lineCap = 'round'; ctx.globalAlpha = 1;
}
function drawBalls() {
  const blink = phase === 'play' && run.inv > 0 && Math.floor(game.t * 16) % 2 === 0;
  for (const b of balls) {
    const t = b.trail, n = t.length / 2, R = b.r || BALL_R;
    for (let k = 1; k < n; k++) {
      ctx.globalAlpha = (k / n) * 0.55;
      ctx.strokeStyle = `hsl(${b.hue},100%,55%)`;
      ctx.lineWidth = R * 1.6 * (k / n);
      ctx.beginPath(); ctx.moveTo(t[k * 2 - 2], t[k * 2 - 1]); ctx.lineTo(t[k * 2], t[k * 2 + 1]); ctx.stroke();
    }
    if (blink && mode !== SWARM) continue;
    ctx.globalAlpha = 0.25 + b.glow * 0.5;
    ctx.fillStyle = `hsl(${b.hue},100%,55%)`;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * (2.4 + b.glow * 4), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = (b.drill && b.dash > 0) || b.pierce > 0 ? '#ff9a3d' : `hsl(${b.hue},100%,56%)`;
    ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc(b.x - R * 0.33, b.y - R * 0.33, R * 0.35, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
  }
  ctx.globalAlpha = 1;
}

function render() {
  if (W <= 0 || H <= 0 || !canvas.width || !darkC.width) return;   // ventana oculta o sin tamaño
  const I = tripI();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  // con el "viaje" alto el fondo no se borra del todo: deja estelas
  ctx.globalAlpha = phase === 'mutate' ? 0.25 : Math.max(0.42, 1 - 0.6 * I);
  const D = game.dopa;
  ctx.fillStyle = run && run.boss ? `hsl(${run.boss.hue},${Math.round(50 * D)}%,${(3 + 3 * (1 - D)).toFixed(1)}%)` : `hsl(240,${Math.round(25 * D)}%,${(3 + 3.5 * (1 - D)).toFixed(1)}%)`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  // gris y apagado cuando no pasa nada; colorido y brillante cuando consigues dopamina
  canvas.style.filter = phase === 'mutate' ? '' :
    `saturate(${(0.03 + 1.2 * Math.pow(D, 0.85)).toFixed(2)}) brightness(${(0.55 + 0.6 * Math.pow(D, 0.7)).toFixed(2)}) hue-rotate(${Math.round((game.t * 25 * I * D) % 360)}deg)`;
  if (!run || !mode) return;

  const sx = (Math.random() - 0.5) * fx.shake, sy = (Math.random() - 0.5) * fx.shake;
  setWorld(sx, sy);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  drawPsyche(I);
  drawBloom(D);
  mode.drawBack();
  for (const p of particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    const col = p.gold ? `hsl(46,100%,${60 + a * 30}%)` : `hsl(${p.hue},95%,${55 + a * 30}%)`;
    if (p.kind === 2) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, p.len * a + 1, 0, TAU); ctx.fill(); continue; }
    ctx.strokeStyle = col;
    ctx.lineWidth = p.kind ? p.w : 2;
    const c = Math.cos(p.rot) * p.len / 2, sn = Math.sin(p.rot) * p.len / 2;
    ctx.beginPath();
    if (p.kind) { ctx.moveTo(p.x - c, p.y - sn); ctx.lineTo(p.x + c, p.y + sn); }
    else { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); }
    ctx.stroke();
  }
  for (const w of shockwaves) {
    if (w.t < 0) continue;
    const k = w.t / 0.7;
    ctx.globalAlpha = (1 - k) * 0.9;
    ctx.strokeStyle = w.gold ? 'hsl(46,100%,70%)' : `hsl(${w.hue},100%,70%)`;
    ctx.lineWidth = 14 * (1 - k) + 1;
    const grow = (1 - Math.pow(1 - k, 3)) * (w.cx !== undefined ? 90 : 420);
    ctx.beginPath(); ctx.arc(w.cx || 0, w.cy || 0, Math.max(1, w.implode ? w.R * (1 - k) : w.R + grow), 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  if (cursed('dark') && phase !== 'pick' && phase !== 'picked') {
    darkCtx.setTransform(1, 0, 0, 1, 0, 0);
    darkCtx.globalCompositeOperation = 'source-over';
    darkCtx.clearRect(0, 0, darkC.width, darkC.height);
    darkCtx.fillStyle = 'rgba(2,2,6,0.96)';
    darkCtx.fillRect(0, 0, darkC.width, darkC.height);
    darkCtx.globalCompositeOperation = 'destination-out';
    const rad = Math.max(2, 85 * viewS() * DPR);
    for (const b of balls) {
      const [x, y] = worldToScreen(b.x, b.y);
      const g = darkCtx.createRadialGradient(x * DPR, y * DPR, rad * 0.3, x * DPR, y * DPR, rad);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      darkCtx.fillStyle = g; darkCtx.fillRect(x * DPR - rad, y * DPR - rad, rad * 2, rad * 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(darkC, 0, 0);
  }

  setWorld(sx, sy);
  ctx.globalCompositeOperation = 'lighter';
  mode.drawFront();
  drawBalls();
  ctx.globalCompositeOperation = 'source-over';

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of floaters) {
    const [x, y] = worldToScreen(f.x, f.y);
    const pop = f.life > 0.85 ? 1 + (f.life - 0.85) * 4 : 1;
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.font = `900 ${Math.round(f.size * pop)}px Rubik, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(f.text, x, y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
  }
  for (const c of stars) {
    if (c.t < 0) continue;
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffe27a';
    ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, TAU); ctx.fill();
  }
  if (fx.flash > 0) { ctx.globalAlpha = fx.flash * 0.35; ctx.fillStyle = `hsl(${fx.flashHue},100%,85%)`; ctx.fillRect(0, 0, W, H); }
  const vignette = (alpha, color) => {
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  if (fx.timeScale < 0.9) vignette((1 - fx.timeScale) * 0.6, '#000');
  if (fx.hurt > 0) vignette(fx.hurt * 0.9, '#ff0030');
  if (phase === 'play' && run.hp === 1) vignette(0.35 + 0.25 * Math.max(0, Math.sin(game.t * 5.7)), '#a0001c');
  if (phase === 'play' && mode.timed && run.time < 5) vignette(0.25 * (0.5 + 0.5 * Math.sin(game.t * 12)), '#ff3000');
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- HUD
function renderHearts(lost) {
  if (!run) return;
  const el = $('#hearts');
  let h = '';
  for (let i = 0; i < run.maxHp; i++) h += `<span class="heart${i < run.hp ? '' : ' empty'}${lost && i === run.hp ? ' lost' : ''}">♥</span>`;
  for (let i = 0; i < run.shieldNow; i++) h += '<span class="heart shield">⛊</span>';
  el.innerHTML = h;
  el.classList.toggle('low', run.hp === 1);
}
function renderRelics(fresh) {
  const el = $('#relics');
  if (!run || !run.order.length) { el.innerHTML = '<div class="head">TU BUILD</div><div class="empty">Tus cartas aparecerán aquí</div>'; return; }
  el.innerHTML = '<div class="head">TU BUILD</div>' + run.order.map(id => {
    const r = relic(id), n = run.relics[id];
    return `<div class="rl${id === fresh ? ' new' : ''}" style="--r:${RAR[r.rar].color}" title="${r.desc}">` +
      `<span class="i">${r.icon}</span><span class="t">${r.name}<small>${r.desc}</small></span>${n > 1 ? `<span class="x">x${n}</span>` : ''}</div>`;
  }).join('');
}
function updateHud(rdt) {
  if (!run || !mode) return;
  const d = run.score - game.displayScore;
  game.displayScore += Math.abs(d) < 1 ? d : d * Math.min(1, rdt * 8);
  $('#score').textContent = fmt(game.displayScore);
  const h = mode.hud();
  $('#timerFill').style.width = clamp(h.fill, 0, 1) * 100 + '%';
  $('#timerN').textContent = h.text;
  $('#timer').classList.toggle('low', !!h.low && phase === 'play');
  if (run.boss) $('#bossFill').style.width = (run.boss.alive === false ? 0 : (run.boss.hp / run.boss.maxHp)) * 100 + '%';
  $('#hud').style.visibility = run.demo ? 'hidden' : 'visible';
  $('#mid').style.filter = `saturate(${(0.15 + 0.85 * game.dopa).toFixed(2)})`;
  $('#feverFill').style.width = (game.frenzy > 0 ? game.frenzy / 7 : game.fever) * 100 + '%';
  $('#fever').classList.toggle('on', game.frenzy > 0);
}

// ---------------------------------------------------------------- cartas
let offer = [];
function rollCards(chest) {
  const luck = metaLv('luck');
  const pool = RELICS.filter(r => (!r.avail || r.avail()) && !(r.unique && has(r.id)));
  const out = [];
  for (let slot = 0; slot < 3; slot++) {
    let rar;
    if (Math.random() < 0.12 && !chest) rar = -1;
    else {
      const x = Math.random() * 100 - luck * 8 - Math.min(run.floor, 20) * 1.2 - (chest ? 40 : 0);
      rar = x < 6 ? 3 : x < 22 ? 2 : x < 55 ? 1 : 0;
    }
    let cands = pool.filter(r => r.rar === rar && !out.includes(r));
    if (!cands.length) cands = pool.filter(r => r.rar >= 0 && !out.includes(r));
    if (cands.length) out.push(pick(cands));
  }
  return out;
}
function openPick(rerolled) {
  phase = 'pick';
  if (!rerolled) offer = rollCards(!!run.info.boss);
  const wrapEl = $('#cards');
  wrapEl.innerHTML = '';
  offer.forEach((r, i) => {
    const c = document.createElement('div');
    c.className = 'card' + (r.rar === 3 ? ' r3' : '') + (r.rar < 0 ? ' pact' : '');
    c.style.setProperty('--r', RAR[r.rar].color);
    const own = run.relics[r.id];
    c.innerHTML = `<span class="key">${i + 1}</span><div class="ico">${r.icon}</div><div class="body"><div class="rar">${RAR[r.rar].name}</div>` +
      `<div class="nm">${r.name}</div><div class="ds">${r.desc}</div>${own && !r.consumable ? `<div class="own">Tienes x${own}</div>` : ''}</div>`;
    c.addEventListener('click', () => choose(i));
    wrapEl.appendChild(c);
    setTimeout(() => { c.classList.add('in'); Sfx.cardShow(i); }, 120 + i * 140);
  });
  const ni = stageInfo(run.stage + 1);
  const nextTxt = ni.mode !== run.info.mode ? '⚠ el juego va a mutar' : ni.boss ? '¡JEFE!' : `piso ${run.floor + 1}`;
  $('#pickTitle').innerHTML = (run.info.boss ? '🏆 BOTÍN DEL JEFE' : 'ELIGE UNA CARTA') + `<small>siguiente: ${nextTxt}</small>`;
  const rb = $('#rerollBtn');
  rb.disabled = run.rerolls <= 0;
  rb.querySelector('span').textContent = `(${run.rerolls})`;
  $('#pick').classList.add('on');
}
function choose(i) {
  if (phase !== 'pick' || !offer[i]) return;
  phase = 'picked';
  const cards = [...$('#cards').children];
  cards.forEach((c, k) => c.classList.add(k === i ? 'chosen' : 'gone'));
  Sfx.cardPick(offer[i].rar);
  grantRelic(offer[i]);
  setTimeout(() => { $('#pick').classList.remove('on'); goNext(); }, 480);
}
$('#rerollBtn').addEventListener('click', () => {
  if (phase !== 'pick' || run.rerolls <= 0) return;
  run.rerolls--; offer = rollCards(!!run.info.boss); Sfx.buy(); openPick(true);
});

// ---------------------------------------------------------------- menú, muerte y mejoras permanentes
function statBox(v, label) { return `<div class="stat"><b>${v}</b><span>${label}</span></div>`; }
function renderMeta() {
  document.querySelectorAll('.shards').forEach(e => e.textContent = `◆ ${meta.shards}`);
  for (const id of ['#metaMenu', '#metaDead']) {
    const el = $(id);
    el.innerHTML = '';
    META.forEach((m, idx) => {
      const lv = metaLv(m.id), max = lv >= m.costs.length, cost = m.costs[lv];
      const b = document.createElement('button');
      b.className = 'mu' + (max ? ' max' : meta.shards >= cost ? ' can' : '');
      b.innerHTML = `<div class="n">${m.name}</div><div class="d">${m.desc}</div>` +
        `<div class="pips">${m.costs.map((_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div>` +
        `<div class="c">${max ? 'MÁXIMO' : '◆ ' + cost}</div>`;
      b.addEventListener('click', () => {
        if (max || meta.shards < cost) return;
        Sfx.init();
        meta.shards -= cost; meta.up[m.id] = lv + 1; save(); Sfx.buy(); renderMeta();
        $(id).children[idx].classList.add('bought');
      });
      el.appendChild(b);
    });
  }
}
function showMenu() {
  newRun(true);
  game.demoIdx = 0; game.demoT = 7;
  startStage(0);
  game.displayScore = 0;
  const nSeen = meta.seen.filter(x => x !== 'breakout').length, seen = nSeen ? `${nSeen}/7` : '';
  $('#menuStats').innerHTML = meta.runs ? statBox(meta.best, 'MEJOR PISO') + statBox(fmt(meta.bestScore), 'MEJOR PUNTUACIÓN') + statBox(meta.runs, 'PARTIDAS') + (seen ? statBox(seen, 'JUEGOS VISTOS') : '') : '';
  renderMeta(); renderRelics();
  $('#menu').classList.add('on');
}
function startRun() {
  Sfx.init();
  ['#menu', '#dead'].forEach(s => $(s).classList.remove('on'));
  $('#mutate').classList.remove('on'); canvas.classList.remove('glitch');
  particles = []; floaters = []; shockwaves = []; stars = []; beams = []; pulses = [];
  Object.assign(fx, { shake: 0, flash: 0, hurt: 0, hitStop: 0, zoom: 1, timeScale: 1, slowTarget: 1 });
  newRun(false);
  game.dopa = 0; game.displayScore = 0;
  renderRelics();
  startStage(0);
}
function showDead() {
  phase = 'dead';
  meta.runs++;
  const floor = run.floor, rec = floor > meta.best || run.score > meta.bestScore;
  meta.best = Math.max(meta.best, floor);
  meta.bestScore = Math.max(meta.bestScore, Math.floor(run.score));
  // al morir te llevas también una parte por lo lejos que llegaste
  run.shardsEarned += Math.floor(floor * 1.5);
  meta.shards += run.shardsEarned;
  save();
  $('#deadFloor').textContent = `${floor} · ${run.info.bonus ? 'BONUS' : mode.title}`;
  $('#record').textContent = rec ? '★ ¡NUEVO RÉCORD! ★' : '';
  const s = run.stats;
  $('#deadStats').innerHTML = statBox(fmt(run.score), 'PUNTOS') + statBox(s.rings, 'ANILLOS') + statBox(s.bricks, 'BLOQUES') +
    statBox(s.kills, 'BICHOS') + statBox('x' + comboMult(s.bestCombo), 'MEJOR COMBO') + statBox(s.bosses, 'JEFES');
  const gain = run.shardsEarned, el = $('#shardsGain');
  let shown = 0;
  el.textContent = '+0 ◆';
  const iv = setInterval(() => {
    shown = Math.min(gain, shown + Math.max(1, Math.ceil(gain / 20)));
    el.textContent = `+${shown} ◆`;
    Sfx.star(shown);
    if (shown >= gain) clearInterval(iv);
  }, 50);
  renderMeta();
  $('#dead').classList.add('on');
}
$('#playBtn').addEventListener('click', startRun);
$('#againBtn').addEventListener('click', startRun);

// ---------------------------------------------------------------- entrada
function pointerWorld(e) {
  const r = canvas.getBoundingClientRect();
  return screenToWorld(e.clientX - r.left, e.clientY - r.top);
}
function doTap(ang, wx, wy) {
  if (phase !== 'play') return;
  Sfx.init();
  game.aimLast = ang;
  mode.tap(ang, wx, wy);
  if (has('echo') && mode.echo) run.echo.push({ t: 0.16, ang });
}
window.addEventListener('pointerup', () => { game.down = false; });
window.addEventListener('pointercancel', () => { game.down = false; });
window.addEventListener('blur', () => { game.down = false; });
canvas.addEventListener('pointerdown', e => {
  volEl.classList.remove('open');
  Sfx.init();
  game.down = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
  const [wx, wy] = pointerWorld(e);
  doTap(Math.atan2(wy, wx), wx, wy);
});
canvas.addEventListener('pointermove', e => {
  const [wx, wy] = pointerWorld(e);
  const ang = Math.atan2(wy, wx);
  if (e.pointerType === 'mouse') { game.aim = ang; game.aimWorld = [wx, wy]; }
  if (phase === 'play' && mode.move && (e.pointerType === 'mouse' || e.buttons)) mode.move(ang, wx, wy);
});
canvas.addEventListener('pointerleave', () => game.aim = null);
window.addEventListener('keydown', e => {
  Sfx.init();
  if (e.code === 'Space' && game.aim !== null && phase === 'play') { e.preventDefault(); doTap(game.aim, ...(game.aimWorld || [0, 0])); }
  if (phase === 'pick') {
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) choose(+e.code.slice(-1) - 1);
    if (e.code === 'KeyR') $('#rerollBtn').click();
  }
  if (e.code === 'Enter' && (phase === 'dead' || (phase === 'menu' && $('#menu').classList.contains('on')))) startRun();
});

const volEl = $('#vol'), volRange = $('#volRange');
let volume = 70;
try { const v = localStorage.getItem('dopamina_vol'); if (v !== null) volume = +v; } catch (e) { }
function applyVolume() {
  volRange.value = volume; $('#volN').textContent = volume;
  volEl.classList.toggle('muted', volume === 0);
  volEl.classList.toggle('low', volume > 0 && volume < 40);
  Sfx.setVolume(volume / 100);
  try { localStorage.setItem('dopamina_vol', volume); } catch (e) { }
}
$('#volBtn').addEventListener('click', () => { Sfx.init(); volEl.classList.toggle('open'); });
volRange.addEventListener('input', () => { Sfx.init(); volume = +volRange.value; applyVolume(); });
volRange.addEventListener('change', () => Sfx.buy());
document.addEventListener('pointerdown', () => Sfx.init(), { once: true });
applyVolume();

new ResizeObserver(resize).observe(canvas);

// ---------------------------------------------------------------- arranque
load();
resize();
showMenu();

let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(rdt);
  render();
  updateHud(rdt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__dop = {
  meta, get run() { return run; }, get phase() { return phase; }, get M() { return M; }, balls: () => balls,
  reset() { resetting = true; localStorage.removeItem(SAVE_KEY); location.reload(); },
};
