'use strict';
// Dos "runners de puertas", el formato que arrasa en TikTok, con la estética de Dopamina:
//   EJÉRCITO: una multitud de bolitas elige puertas x2 / x6 / +30 / −20 y al final pelea contra un jefe.
//   LARGO × ANCHO: una formación de monedas cambia de largo y de ancho con cada puerta; el área rompe el muro final.
// Se carga después de modes.js y antes de game.js; usa M, run, ctx, Sfx, spark, blob, floatText, addScore,
// bumpCombo, dopaBoost, damage, floorClear, fx, game y shockwaves de game.js.

// ---------------------------------------------------------------- geometría de la pista (perspectiva)
const RN = { yh: -250, yn: 250, wFar: 62, wNear: 256, k: 3.2, u: 1 };
// la pista se adapta a la pantalla: en móvil vertical ocupa todo el alto y todo el ancho
function rnFit() {
  const s = viewScale || 0.5;
  const hudPx = W < 520 ? 235 : 175, top = -((H / 2 + 30) - hudPx) / s, bottom = (H / 2 - 30) / s - 60, half = W / 2 / s;
  RN.yh = clamp(top, -450, -120); RN.yn = clamp(bottom, 200, 560);
  RN.wNear = clamp(half * 0.93, 200, 330); RN.wFar = RN.wNear * 0.26; RN.u = RN.wNear / 256;
  RN.fitKey = W + 'x' + H;
}
function rnS(d) {
  const s = 1 / (1 + RN.k * clamp(d / 1000, 0, 1.3)), s1 = 1 / (1 + RN.k);
  return clamp((s - s1) / (1 - s1), 0, 1);
}
const rnY = d => RN.yh + (RN.yn - RN.yh) * rnS(d);
const rnHalf = d => RN.wFar + (RN.wNear - RN.wFar) * rnS(d);
const rnSc = d => (0.2 + 0.8 * rnS(d)) * RN.u;

// ---------------------------------------------------------------- operaciones de las puertas
function rnApply(n, g) {
  switch (g.op) {
    case 'mul': return Math.floor(n * g.v);
    case 'add': return n + g.v;
    case 'sub': return Math.max(0, n - g.v);
    case 'div': return Math.max(1, Math.floor(n / g.v));
  }
  return n;
}
const rnOpLabel = g => g.op === 'mul' ? 'x' + g.v : g.op === 'add' ? '+' + fmt(g.v) : g.op === 'sub' ? '−' + fmt(g.v) : '÷' + g.v;
const rnGood = g => g.op === 'mul' || g.op === 'add';
const rnHue = g => g.op === 'mul' ? 205 : g.op === 'add' ? 140 : 355;

function rnMakeGate(kind, n, p) {
  if (kind === 'good') {
    if (Math.random() < 0.55) {
      const ks = [2, 2, 3, 3, 4, 5, 6, 8, 10, 12];
      return { op: 'mul', v: ks[Math.min(ks.length - 1, Math.floor(rand(3 + 7 * p)))] };
    }
    return { op: 'add', v: Math.max(5, Math.round(n * rand(0.3, 0.9) / 5) * 5) };
  }
  if (kind === 'bad') {
    if (Math.random() < 0.5) return { op: 'sub', v: Math.max(5, Math.round(n * rand(0.2, 0.55) / 5) * 5) };
    return { op: 'div', v: pick([2, 2, 3]) };
  }
  return Math.random() < 0.5 ? { op: 'add', v: Math.max(3, Math.round(n * rand(0.05, 0.2))) } : { op: 'mul', v: 2 };
}
function rnMakeDimGate(kind, L, W, p) {
  const dim = Math.random() < 0.5 ? 'L' : 'W', base = dim === 'L' ? L : W;
  if (kind === 'good') {
    if (Math.random() < 0.25) return { dim, op: 'mul', v: 2 };
    return { dim, op: 'add', v: Math.max(dim === 'L' ? 10 : 3, Math.round(base * rand(0.35, 1.1) / (dim === 'L' ? 5 : 1)) * (dim === 'L' ? 5 : 1)) };
  }
  return { dim, op: 'sub', v: Math.max(dim === 'L' ? 5 : 2, Math.round(base * rand(0.2, 0.45))) };
}
function rnApplyDim(st, g) {
  const o = { L: st.L, W: st.W }, base = o[g.dim];
  o[g.dim] = Math.max(1, g.op === 'mul' ? base * g.v : g.op === 'add' ? base + g.v : base - g.v);
  return o;
}

// ---------------------------------------------------------------- generación de la pista
function rnGenLayout(variant, lvl) {
  const sizes = variant === 'sizes';
  const len = 3400 + 300 * Math.min(lvl, 8), rows = Math.floor((len - 520) / 340);
  const specs = [];
  let n = 10, L = 6, W = 3;
  for (let i = 0; i < rows; i++) {
    const d = 420 + i * 340, p = i / Math.max(1, rows - 1);
    const hazard = i >= 2 && i % 3 === 2;
    if (!hazard) {
      const r = Math.random();
      let kinds = i === 0 ? ['good', 'bad'] : r < 0.55 ? ['good', 'bad'] : r < 0.8 ? ['good', 'good'] : ['ok', 'bad'];
      if (Math.random() < 0.5) kinds = kinds.slice().reverse();
      if (!sizes) {
        let A = rnMakeGate(kinds[0], n, p), B = rnMakeGate(kinds[1], n, p);
        if (i === 0) { A = { op: 'mul', v: 2 }; B = { op: 'sub', v: 5 }; if (Math.random() < 0.5) [A, B] = [B, A]; }
        specs.push({ type: 'gate', d, a: A, b: B });
        n = Math.max(rnApply(n, A), rnApply(n, B));
      } else {
        let A = rnMakeDimGate(kinds[0], L, W, p), B = rnMakeDimGate(kinds[1], L, W, p);
        if (i === 0) { A = { dim: 'L', op: 'add', v: 20 }; B = { dim: 'W', op: 'sub', v: 1 }; if (Math.random() < 0.5) [A, B] = [B, A]; }
        specs.push({ type: 'gate', d, a: A, b: B });
        const sa = rnApplyDim({ L, W }, A), sb = rnApplyDim({ L, W }, B), best = sa.L * sa.W >= sb.L * sb.W ? sa : sb;
        L = best.L; W = best.W;
      }
    } else {
      const h = Math.random();
      if (!sizes && h < 0.45) {
        const e = Math.max(3, Math.round(n * rand(0.12, 0.35)));
        specs.push({ type: 'enemy', d, lat: rand(-0.6, 0.6), e });
        n = Math.max(1, n - e);
      } else if (h < 0.8) {
        specs.push({ type: 'saw', d, lat: rand(-0.65, 0.65) });
        if (Math.random() < 0.5) specs.push({ type: 'saw', d: d + 40, lat: rand(-0.65, 0.65) });
      } else specs.push({ type: 'pick', d, lat: rand(-0.7, 0.7), v: sizes ? Math.max(4, Math.round(L * 0.1)) : Math.max(2, Math.round(n * 0.08)) });
    }
  }
  const boss = sizes ? Math.max(40, Math.round(L * W * 0.45)) : Math.max(20, Math.round(n * 0.5));
  return { specs, len, boss, best: sizes ? L * W : n };
}

function rnInstantiate() {
  M.ents = M.specs.map(s => Object.assign({ done: false, flash: 0 }, s, s.a ? { a: Object.assign({}, s.a), b: Object.assign({}, s.b) } : {}));
}
function rnReset() {
  M.pos = 0; M.px = M.tpx = 0; M.battle = false; M.bt = 0; M.over = false; M.retryT = 0; M.shownN = 0;
  const extra = has('crowd');
  if (M.variant === 'crowd') M.n = 10 + 25 * extra; else { M.L = 6 + 10 * extra; M.W = 3 + 2 * extra; }
  M.shownN = rnCount();
  rnInstantiate();
}
const rnCount = () => M.variant === 'crowd' ? M.n : M.L * M.W;
function rnCrowdR(n) { return Math.min(185, 7.2 * Math.sqrt(Math.max(1, n))) * RN.u; }
function rnLatR() {
  if (M.variant === 'crowd') return rnCrowdR(M.n) / RN.wNear;
  const cols = Math.min(M.W, 14), sx = Math.min(17, 250 / cols) * RN.u;
  return cols * sx / 2 / RN.wNear;
}

// ---------------------------------------------------------------- efectos de juego
function rnPlayerXY() { return [M.px * RN.wNear, RN.yn - 24 * RN.u - (M.battle ? M.bt * (RN.yn - RN.yh) * 0.6 : 0)]; }
function rnGoodFx(gain, big) {
  bumpCombo();
  addScore(Math.max(10, gain) * 3 * run.floor);
  dopaBoost(0.03 + Math.min(0.09, Math.log10(gain + 1) * 0.016));
  Sfx.jackpot(big ? 25 : gain > 200 ? 8 : 3);
  const [x, y] = rnPlayerXY();
  for (let k = 0; k < 18; k++) spark(x + rand(-50, 50), y - rand(0, 60), 190, 360, 0.6);
  shockwaves.push({ R: 10, t: 0, hue: 195, cx: x, cy: y });
  fx.shake = Math.max(fx.shake, big ? 12 : 6);
  if (big) { fx.flash = 0.35; fx.flashHue = 200; }
}
function rnBadFx(loss) {
  game.dopa = Math.max(0, game.dopa - 0.05);
  Sfx.deny();
  const [x, y] = rnPlayerXY();
  for (let k = 0; k < 14; k++) spark(x + rand(-40, 40), y - rand(0, 40), 355, 320, 0.5);
  fx.shake = Math.max(fx.shake, 7);
}
function rnFail(why) {
  if (M.over) return;
  M.over = true; M.retryT = 1.4;
  const [x, y] = rnPlayerXY();
  blob(x, y - 20, 355, 40, 7);
  floatText(why, 0, 30, 40, '#ff4d6a');
  damage('fail', 0, 120);
  if (phase === 'play') banner('¡OTRA VEZ!', 'misma pista · tú puedes', true);
}
function rnGate(e) {
  e.done = true;
  const left = M.px < 0, g = left ? e.a : e.b;
  e.pick = left ? 'a' : 'b'; e.flash = 1;
  const before = rnCount();
  if (M.variant === 'crowd') M.n = rnApply(M.n, g);
  else { const o = rnApplyDim({ L: M.L, W: M.W }, g); M.L = o.L; M.W = o.W; }
  const gain = rnCount() - before;
  const lab = M.variant === 'crowd' ? rnOpLabel(g) : `${g.dim === 'L' ? 'LARGO' : 'ANCHO'} ${rnOpLabel(g)}`;
  const [x, y] = rnPlayerXY();
  if (gain > 0) {
    floatText(lab, x, y - 90, 34, '#bfe9ff'); floatText('+' + fmt(gain), x, y - 125, 26, '#ffe27a');
    rnGoodFx(gain, g.op === 'mul' && g.v >= 5);
  } else {
    floatText(lab, x, y - 90, 34, '#ff8aa0');
    rnBadFx(-gain);
  }
  if (M.variant === 'crowd' && M.n <= 0) rnFail('¡TE QUEDASTE SIN GENTE!');
}
function rnHazard(e) {
  e.done = true;
  const dx = Math.abs(M.px - e.lat), [x, y] = rnPlayerXY();
  if (e.type === 'pick') {
    if (dx < rnLatR() + 0.12) {
      if (M.variant === 'crowd') M.n += e.v; else M.L += e.v;
      floatText('+' + e.v, x, y - 80, 26, '#9ff'); Sfx.pop(4, false);
      for (let k = 0; k < 8; k++) spark(x, y - 20, 160, 240, 0.4);
      dopaBoost(0.01);
    }
    return;
  }
  if (dx >= rnLatR() + 0.14) return;               // esquivado
  if (e.type === 'saw') {
    const before = rnCount();
    if (M.variant === 'crowd') M.n = Math.max(0, Math.floor(M.n * 0.78) - 2); else M.L = Math.max(1, Math.floor(M.L * 0.78));
    floatText('−' + fmt(before - rnCount()), x, y - 90, 30, '#ff8aa0'); rnBadFx();
    if (M.variant === 'crowd' && M.n <= 0) rnFail('¡TE QUEDASTE SIN GENTE!');
  } else if (e.type === 'enemy') {
    if (M.n > e.e) {
      M.n -= e.e; e.dead = true;
      bumpCombo(); addScore(e.e * 5 * run.floor); dopaBoost(0.05); Sfx.shatter(Math.min(10, game.combo), false);
      floatText('¡GANAS! −' + fmt(e.e), x, y - 100, 32, '#ffe27a');
      blob(RN.wNear * e.lat * 0.6, RN.yn - 110, 355, 40, 7); fx.shake = Math.max(fx.shake, 12);
      onDestroy(x, y, 0.5);
    } else { M.n = 0; rnFail('¡TE APLASTARON!'); }
  }
}
function rnStartBattle() {
  M.battle = true; M.bt = 0; M.startN = M.n;
  const cnt = rnCount();
  M.win = M.variant === 'crowd' ? cnt >= M.bossHp * 0.5 : cnt >= M.bossHp;
  M.ratio = Math.min(1.6, cnt / (M.variant === 'crowd' ? M.bossHp * 0.5 : M.bossHp));
  Sfx.bossHit();
  banner(M.variant === 'crowd' ? '¡A LUCHAR!' : '¡ROMPE EL MURO!', `${fmt(cnt)} contra ${fmt(M.bossHp)}`, !M.win);
}

// ---------------------------------------------------------------- dibujo
function rnRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
function rnBubble(text, x, y, hue, sc) {
  ctx.font = `900 ${Math.round(26 * sc)}px Rubik, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 24 * sc, h = 34 * sc;
  ctx.globalAlpha = 0.92; ctx.fillStyle = `hsl(${hue},80%,42%)`; rnRoundRect(x - w / 2, y - h / 2, w, h, 12 * sc); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2 * sc; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y + 1);
}
// la multitud: bolitas en espiral de girasol, más cerca = más grandes
function rnDrawCrowd(ax, ay, n, hue, sc, Rmax) {
  if (n < 1) return 0;
  const m = Math.min(260, Math.max(1, Math.floor(n))), R = Math.min(Rmax, 7.2 * Math.sqrt(n)) * sc;
  const u = clamp(R / Math.sqrt(m) * 0.62, 2.4 * sc, 10 * sc), pts = [];
  for (let i = 0; i < m; i++) { const a = i * 2.39996, rr = R * Math.sqrt((i + 0.5) / m); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.6]); }
  pts.sort((p, q) => p[1] - q[1]);
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? `hsl(${hue},95%,60%)` : `hsl(${hue},100%,55%)`;
    ctx.globalAlpha = pass ? 1 : 0.28; ctx.beginPath();
    for (const [ox, oy] of pts) {
      const pers = 1 + 0.14 * oy / Math.max(R, 1), r = u * pers * (pass ? 1 : 2);
      ctx.moveTo(ax + ox * pers + r, ay + oy); ctx.arc(ax + ox * pers, ay + oy, r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return R;
}
function rnDrawGrid(ax, ay, L, W, sc) {
  const cols = Math.min(W, 14), rows = Math.min(L, 30), sx = Math.min(17, 250 / cols) * sc, sy = Math.min(15, 240 / rows) * sc;
  const cr = clamp(sx * 0.42, 3.5, 8.5);
  for (let r = rows - 1; r >= 0; r--) {
    const persY = Math.max(0.55, 1 - (r * sy) / 900), y = ay - r * sy;
    for (let c = 0; c < cols; c++) {
      const x = ax + (c - (cols - 1) / 2) * sx * persY;
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#ffc531'; ctx.beginPath(); ctx.ellipse(x, y, cr * persY * 1.9, cr * persY * 1.3, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#b8780a'; ctx.beginPath(); ctx.ellipse(x, y + cr * persY * 0.45, cr * persY, cr * persY * 0.68, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.ellipse(x, y, cr * persY, cr * persY * 0.68, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.ellipse(x - cr * persY * 0.2, y - cr * persY * 0.15, cr * persY * 0.4, cr * persY * 0.22, 0, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return rows * sy;
}
function rnDrawTrack() {
  ctx.globalCompositeOperation = 'source-over';
  const slope = (RN.wNear - RN.wFar) / (RN.yn - RN.yh), yb = RN.yn + 62, wb = RN.wNear + slope * 62;
  const gr = ctx.createLinearGradient(0, RN.yh, 0, yb);
  gr.addColorStop(0, 'rgba(30,34,90,0)'); gr.addColorStop(1, 'rgba(36,40,100,0.6)');
  ctx.fillStyle = gr; ctx.beginPath();
  ctx.moveTo(-RN.wFar * 1.1, RN.yh); ctx.lineTo(RN.wFar * 1.1, RN.yh); ctx.lineTo(wb * 1.1, yb); ctx.lineTo(-wb * 1.1, yb); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#3df5ff';
  for (const [w, a] of [[10, 0.12], [3, 0.8]]) {
    ctx.globalAlpha = a; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(-RN.wFar * 1.1, RN.yh); ctx.lineTo(-wb * 1.1, yb); ctx.moveTo(RN.wFar * 1.1, RN.yh); ctx.lineTo(wb * 1.1, yb); ctx.stroke();
  }
  // rayas que se acercan: dan la sensación de velocidad
  const off = M.pos % 140;
  for (let k = 0; k < 8; k++) {
    const d = k * 140 - off; if (d < 0) continue;
    const y = rnY(d), hw = rnHalf(d) * 1.1, sc = rnSc(d);
    ctx.globalAlpha = 0.16 * (1 - d / 1000); ctx.strokeStyle = '#8fa6ff'; ctx.lineWidth = 2 * sc;
    ctx.beginPath(); ctx.moveTo(-hw, y); ctx.lineTo(hw, y); ctx.stroke();
    const d2 = d + 70, y2 = rnY(d2);
    ctx.globalAlpha = 0.5 * (1 - d / 1000); ctx.lineWidth = 4 * sc;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(0, y2); ctx.stroke();
  }
  ctx.lineCap = 'round';
  const hg = ctx.createRadialGradient(0, RN.yh, 0, 0, RN.yh, 260);
  hg.addColorStop(0, `hsla(${(game.t * 30) % 360},100%,60%,${0.28 * (0.3 + 0.7 * game.dopa)})`); hg.addColorStop(1, 'hsla(0,0%,0%,0)');
  ctx.globalAlpha = 1; ctx.fillStyle = hg; ctx.fillRect(-300, RN.yh - 260, 600, 520);
}
function rnDrawGate(e, dist) {
  const y = rnY(dist), sc = rnSc(dist), hw = rnHalf(dist), h = 96 * sc;
  const fade = dist < 30 ? clamp(dist / 30, 0, 1) : 1;
  ctx.globalCompositeOperation = 'source-over';
  for (const side of [-1, 1]) {
    const g = side < 0 ? e.a : e.b, picked = e.done && (side < 0) === (e.pick === 'a');
    const x0 = side < 0 ? -hw * 0.97 : hw * 0.03, x1 = side < 0 ? -hw * 0.03 : hw * 0.97, w = x1 - x0;
    const good = M.variant === 'crowd' ? rnGood(g) : g.op !== 'sub', hue = M.variant === 'crowd' ? rnHue(g) : (good ? 135 : 355);
    const boost = picked ? e.flash * 0.35 : 0;
    ctx.globalAlpha = 0.93 * fade * (e.done && !picked ? 0.4 : 1);
    const gr = ctx.createLinearGradient(0, y - h, 0, y);
    gr.addColorStop(0, `hsl(${hue},92%,${(good ? 64 : 58) + boost * 30}%)`); gr.addColorStop(1, `hsl(${hue},85%,${(good ? 38 : 32) + boost * 20}%)`);
    ctx.fillStyle = gr; ctx.fillRect(x0, y - h, w, h);
    ctx.globalAlpha = fade; ctx.strokeStyle = `hsl(${hue},100%,82%)`; ctx.lineWidth = 3 * sc; ctx.strokeRect(x0, y - h, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x0, y - h, w, h * 0.22);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5 * sc; ctx.strokeStyle = 'rgba(0,0,0,.45)';
    if (M.variant === 'crowd') {
      const t = rnOpLabel(g); ctx.font = `900 ${Math.round(62 * sc * (1 + boost))}px Rubik, sans-serif`;
      ctx.strokeText(t, x0 + w / 2, y - h / 2 + 2 * sc); ctx.fillText(t, x0 + w / 2, y - h / 2 + 2 * sc);
    } else {
      const nm = g.dim === 'L' ? 'LARGO' : 'ANCHO', t = rnOpLabel(g);
      ctx.font = `900 ${Math.round(24 * sc)}px Rubik, sans-serif`; ctx.fillText(nm, x0 + w / 2, y - h * 0.76);
      ctx.font = `900 ${Math.round(56 * sc * (1 + boost))}px Rubik, sans-serif`;
      ctx.strokeText(t, x0 + w / 2, y - h * 0.38); ctx.fillText(t, x0 + w / 2, y - h * 0.38);
    }
  }
  ctx.globalAlpha = fade; ctx.fillStyle = '#e8eaff';
  for (const x of [-hw * 0.99, -hw * 0.01, hw * 0.01, hw * 0.99]) ctx.fillRect(x - 3 * sc, y - h - 6 * sc, 6 * sc, h + 8 * sc);
  ctx.globalAlpha = 1;
}
function rnDrawEntity(e, dist) {
  const y = rnY(dist), sc = rnSc(dist), x = e.lat * rnHalf(dist);
  ctx.globalCompositeOperation = 'source-over';
  if (e.type === 'enemy' && !e.dead) {
    const R = rnDrawCrowd(x, y, e.e, 355, sc * 0.85, 120);
    rnBubble(fmt(e.e), x, y - R * 0.6 - 22 * sc, 355, sc);
  } else if (e.type === 'saw') {
    const r = 26 * sc; ctx.save(); ctx.translate(x, y - r * 0.6); ctx.rotate(game.t * 6);
    ctx.fillStyle = '#ff2f55'; ctx.globalAlpha = 0.95; ctx.beginPath();
    for (let k = 0; k < 14; k++) { const a = k / 14 * TAU, a2 = a + TAU / 28; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a2) * r * 1.4, Math.sin(a2) * r * 1.4); }
    ctx.closePath(); ctx.fill(); ctx.fillStyle = '#400'; ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.fill(); ctx.restore();
  } else if (e.type === 'pick') {
    const r = 15 * sc; ctx.globalAlpha = 0.35; ctx.fillStyle = M.variant === 'crowd' ? '#6cf' : '#ffc531'; ctx.beginPath(); ctx.arc(x, y - r, r * 2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y - r, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(18 * sc)}px Rubik, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+' + e.v, x, y - r);
  }
  ctx.globalAlpha = 1;
}
function rnDrawBoss() {
  const dist = Math.max(0, M.len - M.pos), y = rnY(dist), sc = rnSc(dist);
  const hpNow = M.bossHp * (M.battle ? (1 - (M.win ? M.bt : Math.min(0.85, M.bt * M.ratio))) : 1);
  ctx.globalCompositeOperation = 'source-over';
  if (M.variant === 'crowd') {
    const R = rnDrawCrowd(0, y - 30 * sc, Math.max(1, hpNow), 355, sc * 1.7, 230);
    // ojos de jefe
    ctx.fillStyle = '#fff'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * R * 0.28, y - 30 * sc - R * 0.2, R * 0.12, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#300'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * R * 0.28, y - 30 * sc - R * 0.17, R * 0.06, 0, TAU); ctx.fill(); }
    rnBubble(fmt(hpNow), 0, y - 30 * sc - R * 0.6 - 30 * sc, 355, Math.max(sc * 1.4, 0.6));
  } else {
    const w = rnHalf(dist) * 1.05, h = 120 * sc * 1.4, x0 = -w;
    const gr = ctx.createLinearGradient(0, y - h, 0, y); gr.addColorStop(0, '#ffe27a'); gr.addColorStop(1, '#a8680a');
    ctx.globalAlpha = 0.5 + 0.5 * (hpNow / M.bossHp); ctx.fillStyle = gr; ctx.fillRect(x0, y - h, w * 2, h);
    ctx.globalAlpha = 1; ctx.strokeStyle = '#fff5c2'; ctx.lineWidth = 4 * sc; ctx.strokeRect(x0, y - h, w * 2, h);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2 * sc;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x0, y - h * k / 4); ctx.lineTo(x0 + w * 2, y - h * k / 4); ctx.stroke(); }
    rnBubble(fmt(Math.ceil(hpNow)), 0, y - h / 2, 40, Math.max(sc * 1.6, 0.6));
  }
}

// ---------------------------------------------------------------- el modo
function rnBuild(variant, info) {
  rnFit();
  const lay = rnGenLayout(variant, info.lvl);
  M = { variant, specs: lay.specs, len: lay.len, bossHp: lay.boss, best: lay.best, pos: 0, px: 0, tpx: 0, n: 10, L: 6, W: 3, ents: [],
    bt: 0, battle: false, over: false, retryT: 0, speed: 175 * run.spinMul, t: 0, win: false, ratio: 1, shownN: 0 };
  rnReset();
  run.timeMax = run.time = 1;
}
function rnMode(variant) {
  const crowd = variant === 'crowd';
  return {
    id: crowd ? 'crowd' : 'sizes', title: crowd ? 'EJÉRCITO' : 'LARGO × ANCHO',
    tag: crowd ? 'elige la puerta buena · la multitud crece' : 'largo o ancho: elige la puerta que más área da',
    timed: false,
    hint: 'arrastra a izquierda y derecha · pasa por la puerta buena',
    bossTag: '',
    build(info) { rnBuild(variant, info); },
    tap(ang, wx) { M.tpx = clamp(wx / RN.wNear, -0.85, 0.85); },
    move(ang, wx) { M.tpx = clamp(wx / RN.wNear, -0.85, 0.85); },
    echo() { },
    update(dt, rdt, live) {
      if (RN.fitKey !== W + 'x' + H) rnFit();
      M.t += dt;
      const target = rnCount();
      M.shownN += (target - M.shownN) * Math.min(1, rdt * 10);
      for (const e of M.ents) e.flash = Math.max(0, e.flash - rdt * 2);
      if (!live) return;
      M.px += (M.tpx - M.px) * Math.min(1, rdt * 12);
      if (M.over) {
        M.retryT -= rdt;
        if (M.retryT <= 0 && phase === 'play') rnReset();
        return;
      }
      if (!M.battle) {
        M.pos += M.speed * dt;
        for (const e of M.ents) {
          if (e.done) continue;
          const dist = e.d - M.pos;
          if (dist > 30) continue;
          if (e.type === 'gate') rnGate(e); else rnHazard(e);
          if (M.over) return;
        }
        M.ents = M.ents.filter(e => e.d - M.pos > -30);
        if (M.len - M.pos <= 360) rnStartBattle();
      } else {
        M.bt = Math.min(1, M.bt + dt / 2.6);
        const bx = rand(-90, 90) * RN.u;
        if (Math.random() < 0.9) { spark(bx, rnY(M.len - M.pos) - 30, M.win ? 195 : 355, 420, 0.4); if (M.variant === 'crowd' && Math.random() < 0.4) spark(bx, rnY(M.len - M.pos) - 40, 355, 300, 0.4); }
        fx.shake = Math.max(fx.shake, 5);
        if (M.variant === 'crowd') M.n = Math.max(1, Math.floor(M.startN * (M.win ? 1 - 0.5 * M.bt : 1 - M.bt)));
        if (M.bt === 1 && !M.over) {
          M.over = true;
          if (M.win) {
            M.retryT = 99;
            const [x, y] = [0, rnY(M.len - M.pos) - 60];
            blob(x, y, 355, 90, 9); for (let k = 0; k < 6; k++) shockwaves.push({ R: 10, t: -k * 0.07, hue: 355 - k * 50, cx: x, cy: y });
            fx.shake = 36; fx.flash = 1; fx.flashHue = 50; fx.hitStop = 0.25;
            addScore(M.bossHp * 40 * run.floor); dopaBoost(0.25); bumpCombo(); run.stats.kills++;
            floorClear(`${fmt(rnCount())} de ${fmt(M.bossHp)}`);
          } else rnFail(M.variant === 'crowd' ? '¡EL JEFE PUDO MÁS!' : '¡EL MURO AGUANTÓ!');
        }
      }
    },
    ai() {
      const e = M.ents.find(q => q.type === 'gate' && !q.done);
      if (!e) return;
      let va, vb;
      if (M.variant === 'crowd') { va = rnApply(M.n, e.a); vb = rnApply(M.n, e.b); }
      else { const sa = rnApplyDim({ L: M.L, W: M.W }, e.a), sb = rnApplyDim({ L: M.L, W: M.W }, e.b); va = sa.L * sa.W; vb = sb.L * sb.W; }
      M.tpx = va >= vb ? -0.5 : 0.5;
    },
    drawBack() {
      rnDrawTrack();
      const list = M.ents.filter(e => { const d = e.d - M.pos; return d < 1000 && d > -30; }).sort((a, b) => b.d - a.d);
      for (const e of list) { const dist = e.d - M.pos; if (e.type === 'gate') rnDrawGate(e, dist); else if (!e.done || dist > 30) rnDrawEntity(e, dist); }
      rnDrawBoss();
    },
    drawFront() {
      const [ax, ay] = rnPlayerXY();
      ctx.globalCompositeOperation = 'source-over';
      if (M.variant === 'crowd') {
        const R = rnDrawCrowd(ax, ay, M.n, 205, RN.u, 185);
        rnBubble(fmt(M.n), ax, ay - R * 0.65 - 26 * RN.u, 215, RN.u);
      } else {
        const hgt = rnDrawGrid(ax, ay, M.L, M.W, RN.u);
        rnBubble(fmt(M.L * M.W), ax, ay - hgt - 26 * RN.u, 40, RN.u);
      }
      ctx.globalCompositeOperation = 'lighter';
    },
    hud() {
      const f = clamp(M.pos / Math.max(1, M.len - 360), 0, 1);
      const txt = M.variant === 'crowd' ? `${fmt(M.n)} unidades · jefe ${fmt(M.bossHp)}` : `LARGO ${fmt(M.L)} × ANCHO ${fmt(M.W)} · muro ${fmt(M.bossHp)}`;
      return { fill: f, text: txt, low: false };
    },
    frenzy() { if (M.variant === 'crowd') M.n = Math.floor(M.n * 1.5) + 5; else M.L += Math.ceil(M.L * 0.4) + 5; },
    blackhole() { const e = M.ents.find(q => (q.type === 'enemy' || q.type === 'saw') && !q.done); if (e) { e.done = true; e.dead = true; blob(e.lat * RN.wNear * 0.6, RN.yn - 100, 270, 20, 6); } },
    explode() { for (let k = 0; k < 60; k++) spark(rand(-250, 250), rand(-200, 240), rand(360), 400, 0.7); M.ents = []; },
  };
}
const RUNNER_CROWD = rnMode('crowd'), RUNNER_SIZES = rnMode('sizes');
