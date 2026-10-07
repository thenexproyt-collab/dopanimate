'use strict';
// Minijuegos de Dopamina (v2): MULTIPLICA, FUSIÓN, REACCIÓN y AGUJERO.
// Se cargan antes que game.js y usan sus utilidades en tiempo de juego (M, run, ctx, Sfx, spark, floatText,
// addScore, bumpCombo, dopaBoost, damage, floorClear...).

// Los emojis se dibujan UNA vez en una imagen y luego se estampan: dibujar texto emoji cada fotograma
// costaba ~70 ms en el Agujero (13 fps).
const EMO = new Map();
function emojiSprite(e) {
  let c = EMO.get(e);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '96px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    x.fillText(e, 64, 70);
    EMO.set(e, c);
  }
  return c;
}
function drawEmoji(e, x, y, glyph, rot) {
  const s = emojiSprite(e), size = glyph * 1.33;   // el emoji ocupa ~75% de la imagen
  if (rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(s, -size / 2, -size / 2, size, size); ctx.restore(); }
  else ctx.drawImage(s, x - size / 2, y - size / 2, size, size);
}

// ================================================================= MULTIPLICA (el juego principal)
// El cañón de arriba (y las TORRETAS que vayas consiguiendo) sueltan bolas que cruzan puertas móviles.
// Las puertas suben de nivel cuantas más bolas pasan (x2 → x3 → x5 → x10…). Calaveras y ÷2 las matan.
// Abajo hay un JEFE: cada bola que llega le quita vida. Mantén pulsado para disparar a ráfagas.
const ML_BOSSES = [
  { name: 'EL BLOQUE', hue: 350 }, { name: 'LA MURALLA', hue: 20 }, { name: 'EL DEVORABOLAS', hue: 280 },
  { name: 'EL TITÁN', hue: 200 }, { name: 'EL GUARDIÁN', hue: 320 }, { name: 'LA BESTIA', hue: 140 },
];
const mlHue = g => g.kind === 'skull' ? 350 : g.kind === 'half' ? 22 : g.kind === 'turret' ? 190 : g.kind === 'used' ? 220 : 118 + Math.min(g.k, 9) * 24;
const mlLabel = g => g.kind === 'mult' ? `x${g.k + 1}` : g.kind === 'half' ? '÷2' : g.kind === 'skull' ? '☠' : g.kind === 'turret' ? '+TORRETA' : '✓';
function mlRow(y, n, d, boost, withTurret) {
  const laneW = 580 / n, out = [];
  for (let k = 0; k < n; k++) {
    const w = laneW * rand(0.5, 0.72), cx = -290 + laneW * (k + 0.5), rr = Math.random(), bad = 0.16 + Math.min(0.16, d * 0.025);
    let kind = rr < bad * 0.45 ? 'skull' : rr < bad ? 'half' : 'mult';
    if (k === 0) kind = 'mult';
    const lv = kind === 'mult' ? Math.min(7, pick([1, 1, 2, 2, 3]) + boost) : 0;
    out.push({ y, w, cx, amp: (laneW - w) / 2 * 0.92, sp: rand(0.6, 1.5 + d * 0.08) * sgn(), ph: rand(TAU), x: cx, kind, k: lv,
      need: 30 + 18 * lv, passed: 0, flash: 0, up: 0, bit: 0 });
  }
  if (withTurret && n > 1) { const g = out[n - 1]; g.kind = 'turret'; g.k = 0; }
  return out;
}
function mlSpawn(x, vx, vy) {
  M.drops.push({ x, y: M.yT + 14, vx, vy, mask: 0, hue: 48 + rand(-8, 8) });
}
function mlHitBoss(p) {
  const dmg = run.ballDmg || 1, b = M.boss;
  b.hp -= dmg; M.bossFlash = 1; M.hits++; M.dmgAcc += dmg;
  if (run.boss) run.boss.hp = Math.max(0, b.hp);
  addScore(10 * run.floor * (1 + Math.floor(M.hits / 100)));
  if (M.hits % 20 === 0) { bumpCombo(); dopaBoost(0.03); Sfx.star(M.hits / 20); onDestroy(p.x, 270, 0.2); }
  if (M.hits % 100 === 0 && M.t - (M.lastDmgT || -9) > 0.6) {
    M.lastDmgT = M.t;
    floatText('-' + fmt(M.dmgAcc), p.x, M.yB - 80, 38, '#ffe27a'); M.dmgAcc = 0;
    shockwaves.push({ R: 10, t: 0, hue: 48, cx: p.x, cy: M.yB - 30 }); fx.shake = Math.max(fx.shake, 9); Sfx.jackpot(8);
  }
  if (Math.random() < 0.1) for (let k = 0; k < 3; k++) spark(p.x, M.yB - 40, b.hue, 260, 0.35);
}
function mlWin() {
  M.done = true;
  const b = M.boss;
  blob(0, M.yB - 25, b.hue, 120, 10);
  for (let k = 0; k < 6; k++) shockwaves.push({ R: 20 + k * 40, t: -k * 0.07, hue: b.hue + k * 40, cx: 0, cy: M.yB - 25 });
  fx.shake = 40; fx.flash = 1; fx.flashHue = b.hue; fx.hitStop = 0.2;
  if (run.boss) run.boss.alive = false;
  floorClear(`${b.name} derrotado`);
}
const MULTIPLY = {
  id: 'multiply', title: 'MULTIPLICA', tag: 'cada puerta sube de nivel · abajo te espera un jefe', timed: true,
  hint: 'mueve el cañón · mantén pulsado para disparar a ráfagas · toca para abanico',
  build(info) {
    const d = info.lvl, w = info.s, boost = Math.min(3, Math.floor(w / 4)) + (run.gateBonus || 0);
    const sv = viewScale || 0.5, yT = clamp(-((H / 2 + 30) - 190) / sv, -640, -310), yB = clamp((H / 2 - 30) / sv - 10, 310, 640);
    M = { yT, yB, cannonX: 0, tx: 0, gates: [], bumpers: [], drops: [], t: 0, fireT: 0, burstCd: 0, done: false, bossFlash: 0, hits: 0, dmgAcc: 0, tf: [0, 0, 0, 0, 0, 0], cap: 1500 + 150 * Math.min(w, 10) };
    const hasT = run.turrets < 6 && Math.random() < 0.6, tRow = 1 + Math.floor(rand(3));
    [0.2, 0.38, 0.56, 0.74].map(f => yT + (yB - yT) * f).forEach((y, ri) => M.gates.push(...mlRow(y, ri === 0 ? 2 : 2 + (Math.random() < 0.4 ? 1 : 0), d, boost, hasT && ri === tRow)));
    M.gates.forEach((g, i) => { g.bit = 1 << i; });
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) M.bumpers.push({ x: rand(-250, 250), y: yT + (yB - yT) * (0.29 + i * 0.18) + rand(-12, 12), r: rand(9, 13), flash: 0 });
    const bi = (w >> 0) % ML_BOSSES.length, bd = ML_BOSSES[bi];
    const hp = Math.round(18000 * (1 + 0.3 * w) * (info.boss ? 1.6 : 1));
    M.boss = { name: bd.name, hue: bd.hue, hp, maxHp: hp };
    if (info.boss) run.boss = { name: bd.name, hp, maxHp: hp, alive: true, hue: bd.hue };
    run.timeMax = run.time = 60 * run.timeMul;
  },
  tap(ang, wx) {
    M.tx = clamp(wx, -265, 265);
    if (M.burstCd <= 0) {
      M.burstCd = 1;
      for (let i = 0; i < 14; i++) mlSpawn(M.cannonX, (i - 6.5) * 38 + rand(-8, 8), 120 + rand(0, 60));
      Sfx.zap(true); fx.shake = Math.max(fx.shake, 6);
    }
  },
  move(ang, wx) { M.tx = clamp(wx, -265, 265); },
  echo() { },
  update(dt, rdt, live) {
    M.t += dt; M.burstCd -= rdt;
    M.bossFlash = Math.max(0, M.bossFlash - rdt * 4);
    for (const g of M.gates) { g.x = g.cx + Math.sin(M.t * g.sp + g.ph) * g.amp; g.flash = Math.max(0, g.flash - rdt * 3); g.up = Math.max(0, g.up - rdt * 1.6); }
    for (const b of M.bumpers) b.flash = Math.max(0, b.flash - rdt * 5);
    if (!live) return;
    M.cannonX += (M.tx - M.cannonX) * Math.min(1, rdt * 16);
    if (!M.done) {
      const rate = (game.down ? 22 : 9) * (run.rateMul || 1) * (game.frenzy > 0 ? 1.5 : 1);
      M.fireT -= dt;
      while (M.fireT <= 0) { M.fireT += 1 / rate; mlSpawn(M.cannonX + rand(-6, 6), rand(-35, 35), 160); }
      // torretas automáticas
      const nT = run.turrets | 0;
      for (let i = 0; i < nT; i++) {
        M.tf[i] -= dt;
        if (M.tf[i] <= 0) { M.tf[i] += 1 / (2.4 * (run.rateMul || 1)); mlSpawn(-240 + (i + 0.5) * 480 / nT + rand(-5, 5), rand(-25, 25), 170); }
      }
    }
    const add = [];
    for (const p of M.drops) {
      const py = p.y;
      p.vy += 560 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -286) { p.x = -286; p.vx = Math.abs(p.vx) * 0.8; }
      if (p.x > 286) { p.x = 286; p.vx = -Math.abs(p.vx) * 0.8; }
      for (const b of M.bumpers) {
        const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
        if (d < b.r + 4 && d > 0) {
          const nx = dx / d, ny = dy / d, vn = p.vx * nx + p.vy * ny;
          p.x = b.x + nx * (b.r + 4); p.y = b.y + ny * (b.r + 4);
          if (vn < 0) { p.vx -= 1.7 * vn * nx; p.vy -= 1.7 * vn * ny; }
          if (b.flash < 0.3 && Math.random() < 0.3) Sfx.peg(Math.floor(rand(12)));
          b.flash = 1;
        }
      }
      for (const g of M.gates) {
        if ((p.mask & g.bit) || g.kind === 'used') continue;
        if (py < g.y && p.y >= g.y && Math.abs(p.x - g.x) < g.w / 2) {
          p.mask |= g.bit; g.flash = 1; g.passed++;
          if (g.kind === 'mult') {
            p.hue = (p.hue + 28) % 360;
            for (let c = 0; c < g.k && M.drops.length + add.length < M.cap * Q.drops; c++)
              add.push({ x: p.x + rand(-7, 7), y: g.y + rand(-2, 6), vx: p.vx + rand(-120, 120), vy: p.vy * rand(0.7, 1), mask: p.mask, hue: p.hue });
            if (Math.random() < 0.3) Sfx.peg(8 + g.k * 3 + (g.passed % 6));
            dopaBoost(0.0012 * g.k);
            if (g.passed >= g.need && g.k < 9) {
              g.k++; g.passed = 0; g.need = 30 + 18 * g.k; g.up = 1; g.flash = 1.5;
              floatText(`¡x${g.k + 1}!`, g.x, g.y - 34, 40, `hsl(${hz(hz(mlHue(g)))},${sv(100)}%,70%)`);
              shockwaves.push({ R: 10, t: 0, hue: mlHue(g), cx: g.x, cy: g.y });
              for (let q = 0; q < 24; q++) spark(g.x + rand(-g.w / 2, g.w / 2), g.y, mlHue(g), 360, 0.6);
              Sfx.jackpot(g.k >= 4 ? 8 : 3); fx.shake = Math.max(fx.shake, 8); dopaBoost(0.09); bumpCombo();
            }
          } else if (g.kind === 'turret') {
            if (run.turrets < 6) {
              run.turrets++; g.kind = 'used';
              floatText('¡TORRETA!', g.x, g.y - 34, 40, '#7df');
              shockwaves.push({ R: 10, t: 0, hue: 190, cx: g.x, cy: g.y }); fx.shake = Math.max(fx.shake, 10); fx.flash = 0.4; fx.flashHue = 190;
              Sfx.cardPick(2); dopaBoost(0.1);
            }
          } else if (Math.random() < (g.kind === 'skull' ? 1 : 0.5)) {
            p.dead = true; spark(p.x, p.y, 350, 160, 0.3);
            if (Math.random() < 0.25) Sfx.deny();
          }
        }
      }
      if (p.y > M.yB - 42) { p.dead = true; if (!M.done) mlHitBoss(p); }
    }
    M.drops = M.drops.filter(p => !p.dead).concat(add);
    if (!M.done && M.boss.hp <= 0) mlWin();
    else if (!M.done && game.mut >= 1 && phase === 'play' && !run.demo) { M.boss.hp = 0; if (run.boss) run.boss.hp = 0; banner('¡CAMBIO DE JUEGO!', 'el jefe estalla', false); mlWin(); }
  },
  ai() {
    const g = M.gates.filter(q => q.kind === 'mult' || q.kind === 'turret').sort((a, b) => (b.kind === 'turret') - (a.kind === 'turret') || b.k - a.k || a.y - b.y)[0];
    if (g) M.tx = g.x;
    if (M.burstCd <= 0 && Math.random() < 0.02) this.tap(0, M.tx);
  },
  drawBack() {
    ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 2; ctx.strokeRect(-290, M.yT - 12, 580, M.yB - M.yT + 12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineCap = 'butt';
    for (const g of M.gates) {
      const hue = mlHue(g), lit = g.flash, used = g.kind === 'used';
      const col = `hsl(${hz(hz(hue))},${sv(100)}%,${52 + lit * 22}%)`, bh = 34 + g.up * 10;
      ctx.globalAlpha = (used ? 0.05 : 0.14) + lit * 0.3 + fx.beat * 0.1; ctx.fillStyle = col;
      ctx.fillRect(g.x - g.w / 2 - 12, g.y - bh - 10, g.w + 24, bh + 22);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = used ? 0.4 : 0.92; ctx.fillStyle = `hsl(${hz(hz(hue))},${sv(85)}%,${34 + lit * 14}%)`;
      ctx.fillRect(g.x - g.w / 2 - 6 * g.up, g.y - bh, g.w + 12 * g.up, bh + 4);
      ctx.globalAlpha = used ? 0.4 : 1; ctx.fillStyle = col;
      ctx.fillRect(g.x - g.w / 2, g.y - 2, g.w, 6);
      ctx.fillRect(g.x - g.w / 2 - 3, g.y - 20, 6, 24); ctx.fillRect(g.x + g.w / 2 - 3, g.y - 20, 6, 24);
      const label = mlLabel(g);
      ctx.font = `900 ${Math.round((g.kind === 'turret' ? 20 : 26) + lit * 10 + g.up * 14)}px Rubik, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(label, g.x, g.y - 18);
      ctx.fillStyle = '#fff'; ctx.fillText(label, g.x, g.y - 18);
      ctx.globalCompositeOperation = 'lighter';
      if (g.kind === 'mult') {
        ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff'; ctx.fillRect(g.x - g.w / 2, g.y + 9, g.w, 4);
        ctx.globalAlpha = 0.95; ctx.fillStyle = col; ctx.fillRect(g.x - g.w / 2, g.y + 9, g.w * clamp(g.passed / g.need, 0, 1), 4);
      }
    }
    ctx.lineCap = 'round';
    for (const b of M.bumpers) {
      ctx.globalAlpha = 0.3 + b.flash * 0.6; ctx.fillStyle = '#b77dff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1.5 + b.flash), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
    // el JEFE de abajo: dientes, ojos que siguen al cañón y barra de vida
    const b = M.boss, hpf = clamp(b.hp / b.maxHp, 0, 1), hot = 1 - hpf, yb = M.yB, y0 = yb - 42;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.95; ctx.fillStyle = `hsl(${hz(b.hue)},${60 + hot * 30}%,${16 + M.bossFlash * 34}%)`;
    ctx.beginPath(); ctx.moveTo(-290, yb); ctx.lineTo(-290, y0 + 10);
    for (let k = 0; k < 30; k++) { const x = -290 + k * 19.33; ctx.lineTo(x + 9.7, y0 + Math.sin(game.t * 4 + k) * 1.5); ctx.lineTo(x + 19.33, y0 + 10); }
    ctx.lineTo(290, yb); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = `hsl(${hz(hz(b.hue))},${sv(100)}%,${60 + M.bossFlash * 30}%)`; ctx.lineWidth = 3; ctx.stroke();
    for (const s of [-1, 1]) {
      const ex = s * 105, ey = y0 + 24, look = clamp((M.cannonX - ex) / 260, -1, 1) * 5;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = hot > 0.7 ? '#f22' : '#200'; ctx.beginPath(); ctx.arc(ex + look, ey + 1, 5, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = hpf > 0.35 ? '#ffd34d' : '#ff3d3d'; ctx.fillRect(-290, yb - 6, 580 * hpf, 5);
    ctx.font = '900 16px Rubik, sans-serif'; ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    const t = `${b.name} · ${fmt(Math.max(0, b.hp))}`; ctx.strokeText(t, 0, y0 + 26); ctx.fillText(t, 0, y0 + 26);
    ctx.globalCompositeOperation = 'lighter';
  },
  drawFront() {
    const groups = {};
    for (const p of M.drops) (groups[Math.round(p.hue / 30) % 12] = groups[Math.round(p.hue / 30) % 12] || []).push(p);
    for (const pass of (Q.halo ? [0, 1] : [1])) {
      ctx.globalAlpha = pass ? 1 : 0.22;
      for (const h in groups) {
        ctx.fillStyle = `hsl(${hz(hz(h * 30))},${sv(100)}%,${pass ? 62 : 55}%)`; ctx.beginPath();
        const r = pass ? 4 : 9;
        for (const p of groups[h]) { ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, TAU); }
        ctx.fill();
      }
    }
    // torretas
    const nT = run.turrets | 0;
    for (let i = 0; i < nT; i++) {
      const x = -240 + (i + 0.5) * 480 / nT, kick = clamp(M.tf[i] * 2, 0, 1) * 0;
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#7df';
      ctx.beginPath(); ctx.moveTo(x - 13, M.yT - 8); ctx.lineTo(x + 13, M.yT - 8); ctx.lineTo(x + 5, M.yT + 14 + kick); ctx.lineTo(x - 5, M.yT + 14 + kick); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x, M.yT + 10, 12, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(M.cannonX - 22, M.yT - 10); ctx.lineTo(M.cannonX + 22, M.yT - 10); ctx.lineTo(M.cannonX, M.yT + 22); ctx.fill();
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(M.cannonX, M.yT + 24, 7 + (game.down ? 5 : 0), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  },
  hud() {
    const b = M.boss;
    return { fill: 1 - clamp(b.hp / b.maxHp, 0, 1), text: `${b.name}: ${fmt(Math.max(0, b.hp))} · ${run.turrets ? '🔫' + run.turrets + ' · ' : ''}${Math.max(0, run.time).toFixed(0)} s`, low: run.time < 5 };
  },
  blackhole() { for (const p of M.drops) p.y = M.yB - 30; },
  frenzy() { run.rateMul = (run.rateMul || 1); M.fireT = 0; for (let i = 0; i < 40; i++) mlSpawn(rand(-250, 250), rand(-40, 40), 170); },
  explode() { for (const p of M.drops.slice(0, 200)) spark(p.x, p.y, p.hue, 300, 0.6); M.drops = []; M.gates = []; M.bumpers = []; },
};

// ================================================================= FUSIÓN (frutas que se juntan)
// Física Verlet con restricciones: apila bien, no tiembla y los choques empujan a los vecinos.
const FR = [
  { e: '🍒', r: 13, hue: 350 }, { e: '🍓', r: 17, hue: 340 }, { e: '🍇', r: 22, hue: 285 }, { e: '🍊', r: 28, hue: 28 },
  { e: '🍋', r: 35, hue: 52 }, { e: '🍎', r: 43, hue: 0 }, { e: '🍑', r: 52, hue: 20 }, { e: '🍍', r: 62, hue: 50 },
  { e: '🍈', r: 74, hue: 110 }, { e: '🍉', r: 88, hue: 130 },
];
const BOX = { l: -190, r: 190, f: 272 };
const DANGER_Y = -165;
function mgMake(tier, x, y, vx = 0, vy = 0) {
  const r = tier < 0 ? 17 : FR[tier].r;
  return { tier, r, x, y, px: x - vx / 120, py: y - vy / 120, born: M.t, pop: 1, hit: 0, cn: 0, dead: false, mg: false };
}
function mgNextTier() {
  if (Math.random() < 0.06) return -1;
  const r = Math.random();
  return r < 0.35 ? 0 : r < 0.65 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : 4;
}
function mgMerge(a, b) {
  a.dead = b.dead = true;
  const tier = a.tier + 1, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const hue = FR[a.tier].hue;
  if (tier >= FR.length) { // dos sandías: desaparecen en un jackpot
    addScore(5000 * run.floor); floatText('¡¡JACKPOT!!', x, y, 50, '#ffd34d'); fx.flash = 1; fx.flashHue = 48; Sfx.jackpot(25);
    blob(x, y, 130, 60, 9); dopaBoost(0.3); return;
  }
  const f = mgMake(tier, x, y);
  f.px = (a.px + b.px) / 2 + (x - (a.x + b.x) / 2); f.py = (a.py + b.py) / 2 + (y - (a.y + b.y) / 2);
  M.newF.push(f);
  // la fusión empuja a los vecinos: así una fusión provoca la siguiente
  for (const o of M.fruits) {
    if (o.dead || o === a || o === b) continue;
    const dx = o.x - x, dy = o.y - y, d = Math.hypot(dx, dy) || 1;
    if (d < f.r + o.r + 28) { const k = 7 * (1 - d / (f.r + o.r + 28)); o.x += dx / d * k; o.y += dy / d * k; o.hit = 1; }
  }
  bumpCombo();
  const v = 40 * Math.pow(2, tier) * run.floor * comboMult(game.combo);
  addScore(v); dopaBoost(0.07 + tier * 0.02);
  floatText('+' + fmt(v * run.scoreMul), x, y - f.r, clamp(18 + tier * 4, 18, 58), `hsl(${hz(hz(hue))},${sv(100)}%,72%)`);
  blob(x, y, hue, 10 + tier * 4, 4 + tier);
  for (let k = 0; k < 8 + tier * 2; k++) spark(x, y, hue, 220 + tier * 40, 0.5);
  shockwaves.push({ R: f.r, t: 0.3, hue, cx: x, cy: y });
  Sfx.pop(tier * 2 + game.combo, tier >= 5);
  fx.shake = Math.max(fx.shake, 3 + tier * 1.8);
  if (tier >= 6) { fx.flash = 0.5; fx.flashHue = hue; fx.hitStop = 0.07; }
  onDestroy(x, y, 0.35);
  if (tier > M.best) {
    M.best = tier;
    floatText(`${FR[tier].e} ¡NUEVA!`, x, y - f.r - 36, 32, '#fff');
    if (!M.done && tier >= M.goal) { M.done = true; M.finT = 0.5; banner(`¡${FR[tier].e} CONSEGUIDA!`, 'todo estalla'); }
  }
}
function mgBomb(f) {
  if (f.dead) return;
  f.dead = true;
  let n = 0;
  for (const o of M.fruits) {
    if (o.dead || o === f || Math.hypot(o.x - f.x, o.y - f.y) > 125) continue;
    o.dead = true; n++;
    blob(o.x, o.y, o.tier < 0 ? 20 : FR[o.tier].hue, 8, 5);
    addScore(25 * Math.pow(2, Math.max(0, o.tier)) * run.floor);
  }
  for (let k = 0; k < 40; k++) spark(f.x, f.y, 25, 620, 0.7);
  shockwaves.push({ R: 10, t: 0, hue: 22, cx: f.x, cy: f.y });
  floatText(n ? `¡BOOM! x${n}` : '¡BOOM!', f.x, f.y - 24, 34, '#ff9a3d');
  dopaBoost(0.05 + n * 0.01);
  Sfx.shatter(5, false); fx.shake = 22; fx.flash = 0.5; fx.flashHue = 22;
}
function mgStep(h) {
  const F = M.fruits, G = 1500;
  for (const f of F) {
    const vx = (f.x - f.px) * 0.998, vy = (f.y - f.py) * 0.998;
    f.px = f.x; f.py = f.y; f.cn = 0;
    f.x += vx; f.y += vy + G * h * h;
  }
  const merges = [], bombs = [];
  for (let it = 0; it < 5; it++) {
    for (const f of F) {
      if (f.x < BOX.l + f.r) { f.x = BOX.l + f.r; f.cn++; } else if (f.x > BOX.r - f.r) { f.x = BOX.r - f.r; f.cn++; }
      if (f.y > BOX.f - f.r) { f.y = BOX.f - f.r; f.cn++; }
    }
    for (let i = 0; i < F.length; i++) {
      const a = F[i];
      if (a.dead) continue;
      for (let j = i + 1; j < F.length; j++) {
        const b = F[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y, md = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 >= md * md) continue;
        if (a.tier < 0 || b.tier < 0) { bombs.push(a.tier < 0 ? a : b); continue; }
        if (a.tier === b.tier && !a.mg && !b.mg) { a.mg = b.mg = true; merges.push([a, b]); continue; }
        const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d, pen = md - d;
        const ma = a.r * a.r, mb = b.r * b.r, t = ma + mb;
        a.x -= nx * pen * mb / t; a.y -= ny * pen * mb / t; b.x += nx * pen * ma / t; b.y += ny * pen * ma / t;
        a.cn++; b.cn++;
      }
    }
  }
  // rozamiento: lo que está apoyado se calma, así no tiembla
  for (const f of F) if (f.cn > 0) { f.px += (f.x - f.px) * 0.07; f.py += (f.y - f.py) * 0.03; }
  for (const f of bombs) mgBomb(f);
  for (const [a, b] of merges) if (!a.dead || !b.dead) mgMerge(a, b);
  M.fruits = F.filter(f => !f.dead).concat(M.newF); M.newF = [];
  for (const f of M.fruits) f.mg = false;
}
const MERGE = {
  id: 'merge', title: 'FUSIÓN', tag: 'junta dos iguales y crecen · una fusión empuja la siguiente', timed: true,
  hint: 'toca para soltar fruta · dos iguales se fusionan · 💣 revienta lo de alrededor',
  build(info) {
    const d = info.lvl;
    M = { fruits: [], newF: [], next: 0, after: 0, cd: 0, best: -1, goal: d < 4 ? 6 : d < 8 ? 7 : 8, overT: 0, aimX: 0, t: 0, acc: 0, d, done: false, finT: -1 };
    M.next = mgNextTier(); M.after = mgNextTier();
    // arranca con fruta en el suelo para que haya fusiones desde el primer segundo
    for (let k = 0; k < 7; k++) { const t = Math.floor(rand(3)); M.fruits.push(mgMake(t, -150 + k * 50, BOX.f - FR[t].r - 1)); M.best = Math.max(M.best, t); }
    run.timeMax = run.time = (80 + d * 3) * run.timeMul;
  },
  tap(ang, wx) {
    M.aimX = clamp(wx, BOX.l + 24, BOX.r - 24);
    if (M.cd > 0 || M.done) return;
    M.cd = game.frenzy > 0 ? 0.07 : 0.24;
    M.fruits.push(mgMake(M.next, M.aimX, -262, 0, 60));
    M.next = M.after; M.after = mgNextTier();
    Sfx.peg(Math.floor(rand(4, 12)));
  },
  move(ang, wx) { M.aimX = clamp(wx, BOX.l + 24, BOX.r - 24); },
  echo() { },
  update(dt, rdt, live) {
    M.t += dt; M.cd -= rdt;
    for (const f of M.fruits) { f.pop = Math.max(0, f.pop - rdt * 4); f.hit = Math.max(0, f.hit - rdt * 4); }
    if (!live) return;
    M.acc += Math.min(dt, 0.05);
    let n = 0;
    while (M.acc >= 1 / 120 && n++ < 8) { mgStep(1 / 120); M.acc -= 1 / 120; }
    if (n >= 8) M.acc = 0;
    if (M.done) { // final: todas las frutas estallan en cadena
      M.finT -= rdt;
      if (M.finT <= 0) {
        const f = M.fruits.sort((p, q) => q.r - p.r)[0];
        if (f) {
          M.fruits = M.fruits.filter(o => o !== f); M.finT = 0.05;
          const hue = f.tier < 0 ? 20 : FR[f.tier].hue, v = 60 * Math.pow(2, Math.max(0, f.tier)) * run.floor;
          addScore(v); blob(f.x, f.y, hue, 14, 6); for (let k = 0; k < 6; k++) spark(f.x, f.y, hue, 350, 0.5);
          if (f.tier >= 3) floatText('+' + fmt(v * run.scoreMul), f.x, f.y, 24, '#ffe27a');
          Sfx.pop(M.fruits.length % 25, f.tier >= 5); fx.shake = Math.max(fx.shake, 6); dopaBoost(0.01);
        } else if (!M.over) { M.over = true; floorClear(`¡${FR[M.best].e}!`); }
      }
      return;
    }
    // si algo se queda por encima de la línea roja, empieza a doler
    const danger = M.fruits.some(f => M.t - f.born > 1.4 && f.y - f.r < DANGER_Y && Math.abs(f.y - f.py) + Math.abs(f.x - f.px) < 0.6);
    M.overT = danger ? M.overT + dt : Math.max(0, M.overT - dt * 2);
    if (M.overT > 4 && phase === 'play') {
      M.overT = 0;
      for (const f of M.fruits) if (f.y < DANGER_Y + 130) { f.dead = true; blob(f.x, f.y, 0, 10, 6); }
      M.fruits = M.fruits.filter(f => !f.dead);
      damage('overflow', 0, DANGER_Y);
      if (phase === 'play') banner('¡REBOSA!', '−1 ♥', true);
    }
  },
  ai(dt) { M.aiT = (M.aiT || 0) - dt; if (M.aiT <= 0) { M.aiT = 0.5; this.tap(0, rand(-170, 170)); } },
  drawBack() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ff7ad9';
    for (const [w, a] of [[16, 0.12], [5, 0.9]]) {
      ctx.globalAlpha = a * (0.8 + fx.beat * 0.2); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(BOX.l - 3, -300); ctx.lineTo(BOX.l - 3, BOX.f + 3); ctx.lineTo(BOX.r + 3, BOX.f + 3); ctx.lineTo(BOX.r + 3, -300); ctx.stroke();
    }
    ctx.globalAlpha = 0.45 + (M.overT > 0 ? 0.55 * Math.abs(Math.sin(game.t * 14)) : 0);
    ctx.strokeStyle = '#ff2f55'; ctx.lineWidth = 3; ctx.setLineDash([12, 9]);
    ctx.beginPath(); ctx.moveTo(BOX.l, DANGER_Y); ctx.lineTo(BOX.r, DANGER_Y); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  },
  drawFront() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const drawF = (f, alpha, ox = 0, oy = 0, scale = 1) => {
      const s = (1 + f.pop * 0.3 * Math.sin(f.pop * 3) + f.hit * 0.08) * scale, r = f.r * s, x = f.x + ox, y = f.y + oy;
      const hue = f.tier < 0 ? 0 : FR[f.tier].hue;
      ctx.globalAlpha = alpha;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      if (f.tier < 0) { g.addColorStop(0, '#666'); g.addColorStop(1, '#161616'); }
      else { g.addColorStop(0, `hsl(${hz(hz(hue))},${sv(95)}%,76%)`); g.addColorStop(1, `hsl(${hz(hz(hue))},${sv(80)}%,38%)`); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2.5; ctx.stroke();
      drawEmoji(f.tier < 0 ? '💣' : FR[f.tier].e, x, y + r * 0.04, r * 1.35, 0);
    };
    for (const f of M.fruits) drawF(f, 1);
    if (phase === 'play' || phase === 'menu') {
      const ghost = mgMake(M.next, M.aimX, -262); ghost.pop = 0;
      ctx.globalAlpha = 0.28; ctx.strokeStyle = '#fff'; ctx.setLineDash([3, 7]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(M.aimX, -240); ctx.lineTo(M.aimX, BOX.f); ctx.stroke(); ctx.setLineDash([]);
      drawF(ghost, M.cd > 0 ? 0.3 : 0.8);
      const nx = mgMake(M.after, BOX.l + 34, -278); nx.pop = 0;
      drawF(nx, 0.85, 0, 0, 0.65);
      ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff'; ctx.font = '800 12px Rubik, sans-serif'; ctx.fillText('LUEGO', BOX.l + 34, -302);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
  },
  hud() { return { fill: (M.best + 1) / (M.goal + 1), text: `META ${FR[M.goal].e} · tienes ${M.best >= 0 ? FR[M.best].e : '—'} · ${Math.max(0, run.time).toFixed(1)} s`, low: run.time < 5 && !M.done }; },
  blackhole() {
    M.fruits.sort((a, b) => a.r - b.r).slice(0, 6).forEach(f => { f.dead = true; blob(f.x, f.y, 270, 10, 5); });
    M.fruits = M.fruits.filter(f => !f.dead);
  },
  frenzy() { M.cd = 0; },
  explode() { for (const f of M.fruits) blob(f.x, f.y, f.tier < 0 ? 0 : FR[f.tier].hue, 8, 6); M.fruits = []; },
};

// ================================================================= REACCIÓN EN CADENA
// Decenas de bolitas flotando. Tocas, explota y todo lo que toque explota también. Cadenas largas dan chispas extra.
function chDot(d, edge) {
  const a = rand(TAU), rr = edge ? 305 : rand(30, 295), sp = (50 + d * 5) * rand(0.6, 1.4) * run.spinMul;
  const va = edge ? a + Math.PI + rand(-0.6, 0.6) : rand(TAU), roll = Math.random();
  return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: Math.cos(va) * sp, vy: Math.sin(va) * sp, r: rand(6, 10), hue: rand(360),
    type: roll < 0.03 ? 'mega' : roll < 0.1 ? 'gold' : 'normal', dead: false };
}
function chBoom(x, y, max, hue, gen, src) {
  M.booms.push({ x, y, r: 0, max, t: 0, life: 0.85, hue, gen, src: !!src });
}
function chPop(o, gen) {
  o.dead = true;
  M.popped++; M.chain++;
  M.bestChain = Math.max(M.bestChain, M.chain);
  const big = o.type === 'mega' ? 2.4 : o.type === 'gold' ? 1.6 : 1;
  chBoom(o.x, o.y, 46 * big, (o.hue + gen * 18) % 360, gen);
  const v = 10 * run.floor * M.chain * (o.type === 'gold' ? 5 : 1);
  addScore(v); dopaBoost(0.008);
  for (let k = 0; k < 5; k++) spark(o.x, o.y, o.hue, 260, 0.45);
  if (M.chain % 5 === 0 || o.type !== 'normal') floatText('+' + fmt(v * run.scoreMul), o.x, o.y, clamp(14 + M.chain * 0.5, 14, 46), '#ffe27a');
  if (o.type === 'gold') floatText('¡ORO!', o.x, o.y - 24, 22, '#ffd34d');
  Sfx.pop(M.chain, o.type === 'mega');
  fx.shake = Math.max(fx.shake, Math.min(18, 2 + M.chain * 0.2));
  if (o.type === 'mega') { shockwaves.push({ R: 10, t: 0, hue: o.hue, cx: o.x, cy: o.y }); fx.flash = 0.4; fx.flashHue = o.hue; }
  if (M.chain % 10 === 0) fx.hitStop = Math.max(fx.hitStop, 0.05);
  onDestroy(o.x, o.y, 0.08);
}
const CHAIN = {
  id: 'chain', title: 'REACCIÓN', tag: 'una chispa · todo explota', timed: false,
  hint: 'toca para crear una explosión · lo que la toque, explota también',
  build(info) {
    const d = info.lvl, n = Math.min(150, 85 + d * 10);
    M = { dots: [], booms: [], n, taps: 5 + Math.max(0, run.maxCharges - 2) + (run.balls - 1), quota: Math.floor(n * Math.min(1.6, 1.1 + d * 0.05)),
      popped: 0, chain: 0, bestChain: 0, done: false, d, refT: 0 };
    for (let i = 0; i < n; i++) M.dots.push(chDot(d, false));
  },
  tap(ang, wx, wy) {
    if (Math.hypot(wx, wy) > 335 || M.done) return;
    if (M.taps <= 0 && !run.demo) { game.denyT = 0.3; Sfx.deny(); return; }
    if (!run.demo) M.taps--;
    chBoom(wx, wy, 60, 50, 0, true);
    Sfx.zap(true); fx.shake = Math.max(fx.shake, 4);
  },
  echo() { },
  update(dt, rdt, live) {
    if (!live) return;
    for (const o of M.dots) {
      o.x += o.vx * dt; o.y += o.vy * dt;
      const d = Math.hypot(o.x, o.y);
      if (d > 320 - o.r) { const nx = o.x / d, ny = o.y / d, vn = o.vx * nx + o.vy * ny; if (vn > 0) { o.vx -= 2 * vn * nx; o.vy -= 2 * vn * ny; } }
    }
    for (const b of M.booms) {
      b.t += dt;
      b.r = b.t < 0.2 ? b.max * (1 - Math.pow(1 - b.t / 0.2, 3)) : b.t < b.life ? b.max : b.max * Math.max(0, 1 - (b.t - b.life) / 0.25);
    }
    M.booms = M.booms.filter(b => b.t < b.life + 0.25);
    for (const o of M.dots) {
      if (o.dead) continue;
      for (const b of M.booms) if (b.r > 2 && Math.hypot(o.x - b.x, o.y - b.y) < b.r + o.r) { chPop(o, b.gen + 1); break; }
    }
    M.dots = M.dots.filter(o => !o.dead);
    if (!M.booms.length && M.chain > 0) {
      const c = M.chain; M.chain = 0;
      if (c >= 8) {
        floatText(`¡CADENA x${c}!`, 0, -30, clamp(26 + c * 0.6, 26, 72), '#fff');
        Sfx.jackpot(c >= 40 ? 25 : 8);
        if (c >= 30) { fx.flash = 0.6; fx.flashHue = rand(360); }
      }
      if (c >= 12 && !M.done) { M.taps++; floatText('+1 CHISPA', 0, 40, 28, '#ffe27a'); Sfx.buy(); }
      dopaBoost(Math.min(0.25, c * 0.01));
    }
    if (!M.done && M.popped >= M.quota) { M.done = true; floorClear(`cadena máx x${M.bestChain}`); chBoom(0, 0, 420, 50, 0); }
    if (!M.done && phase === 'play' && M.taps <= 0 && !M.booms.length) {
      damage('fail', 0, 0); M.taps += 2;
      for (let i = 0; i < 25; i++) M.dots.push(chDot(M.d, true));
      if (phase === 'play') banner('¡SIN CHISPAS!', '−1 ♥ · +2 chispas', true);
    }
    // entran bolitas nuevas desde fuera para que siempre haya algo que reventar
    if (!M.done && !M.booms.length && M.dots.length < M.n) {
      M.refT -= dt;
      if (M.refT <= 0) { M.refT = 0.03; M.dots.push(chDot(M.d, true)); }
    }
  },
  ai(dt) {
    M.aiT = (M.aiT || 1) - dt;
    if (M.aiT <= 0 && !M.booms.length && M.dots.length) { M.aiT = 1.4; const o = pick(M.dots); this.tap(0, o.x, o.y); }
  },
  drawBack() {
    ctx.globalAlpha = 0.25 + fx.beat * 0.2; ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 322, 0, TAU); ctx.stroke();
    for (const b of M.booms) {
      const k = clamp(b.t / (b.life + 0.25), 0, 1);
      ctx.globalAlpha = 0.2 * (1 - k * 0.5); ctx.fillStyle = `hsl(${hz(hz(b.hue))},${sv(100)}%,60%)`;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9 * (1 - k * 0.6); ctx.strokeStyle = `hsl(${hz(hz(b.hue))},${sv(100)}%,78%)`; ctx.lineWidth = 3; ctx.stroke();
    }
    for (const o of M.dots) {
      const col = o.type === 'gold' ? '#ffd34d' : o.type === 'mega' ? '#ffffff' : `hsl(${hz(hz(o.hue))},${sv(100)}%,62%)`, R = o.r * (o.type === 'mega' ? 1.7 : 1);
      ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(o.x, o.y, R * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(o.x, o.y, R, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  drawFront() {
    if (game.aim !== null && phase === 'play' && game.aimWorld) {
      ctx.globalAlpha = 0.4; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(game.aimWorld[0], game.aimWorld[1], 60, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (M.chain > 3) {
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.min(100, 34 + M.chain)}px Rubik, sans-serif`;
      ctx.fillText('x' + M.chain, 0, 0);
    }
    ctx.globalAlpha = 1;
  },
  hud() { return { fill: M.popped / M.quota, text: `${M.popped}/${M.quota} · 💥 x${M.taps}`, low: M.taps === 0 }; },
  blackhole() { for (const o of M.dots) if (!o.dead && Math.hypot(o.x, o.y) < 160) chPop(o, 1); },
  frenzy() { M.taps += 2; },
  explode() { for (const o of M.dots) spark(o.x, o.y, o.hue, 400, 0.6); M.dots = []; M.booms = []; },
};

// ================================================================= AGUJERO NEGRO
// Mueve el agujero. Se traga lo pequeño con una espiral, crece y puede con lo grande. Las bombas 💣 hacen daño.
const HO_SMALL = ['🍪', '🍬', '🍄', '🍓', '🧁', '🎈'], HO_MID = ['🍔', '🍕', '🧸', '📦', '🐔', '⚽'], HO_BIG = ['🚗', '🛋️', '🐘', '🌳', '🏠', '🚌'];
function hoObj(inside) {
  const h = M.h.r, roll = Math.random();
  let r = roll < 0.5 ? rand(0.2, 0.7) * h : roll < 0.75 ? rand(0.8, 1.2) * h : rand(1.4, 2.4) * h;
  r = clamp(r, 7, Math.max(62, h * 0.85));
  const a = rand(TAU), dd = inside ? rand(80, 285) : 308, va = rand(TAU), sp = rand(25, 80) * (1 + M.d * 0.06) * run.spinMul, t = Math.random();
  let type = t < 0.04 && M.objs.filter(q => q.type === 'poison').length < 2 ? 'poison' : t < 0.1 ? 'gold' : 'normal';
  if (type === 'poison') r = clamp(rand(0.4, 0.8) * h, 9, 34);
  const e = type === 'poison' ? '💣' : type === 'gold' ? '🪙' : pick(r < 16 ? HO_SMALL : r < 32 ? HO_MID : HO_BIG);
  return { x: Math.cos(a) * dd, y: Math.sin(a) * dd, vx: Math.cos(va) * sp, vy: Math.sin(va) * sp, r, type, e, sw: 0, dead: false, flash: 0, ang: rand(TAU), wasEdible: false };
}
function hoEat(o) {
  o.dead = true;
  const h = M.h;
  if (o.type === 'poison') {
    if (M.done) { blob(o.x, o.y, 355, 10, 5); return; }
    h.r = Math.max(16, h.r * 0.88);
    for (let k = 0; k < 40; k++) spark(h.x, h.y, 355, 520, 0.7);
    floatText('¡VENENO!', h.x, h.y - h.r, 34, '#ff4d6a');
    if (!M.done) damage('poison', h.x, h.y);
    return;
  }
  h.r = Math.sqrt(h.r * h.r + o.r * o.r * 0.13);
  M.eaten++; h.kick = 1;
  bumpCombo();
  const v = Math.round(2 * o.r * run.floor * Math.min(comboMult(game.combo), 30) * (o.type === 'gold' ? 5 : 1));
  addScore(v); dopaBoost(0.008 + o.r * 0.0005);
  if ((o.r > 34 || o.type === 'gold') && (M.lastTxt = (M.lastTxt || 0) + 1) % 2 === 0) floatText('+' + fmt(v * run.scoreMul), h.x, h.y - h.r - 6, clamp(14 + o.r * 0.6, 14, 44), o.type === 'gold' ? '#ffd34d' : '#ffe27a');
  for (let k = 0; k < 6; k++) spark(h.x, h.y, 280 + rand(60), 200, 0.35);
  Sfx.pop(Math.min(30, M.eaten % 30), o.r > 26);
  fx.shake = Math.max(fx.shake, Math.min(12, o.r * 0.22));
  if (o.type === 'gold') { run.time += 2; floatText('+2 s', h.x, h.y - h.r - 30, 20, '#ffd34d'); }
  onDestroy(h.x, h.y, 0.15);
  if (!M.done && h.r >= M.target) {
    M.done = true; M.finT = 1.6;
    banner('¡ENORME!', 'se lo traga todo');
    for (const q of M.objs) if (!q.dead && q.sw === 0) q.sw = 0.001 - rand(0.6);
    fx.flash = 0.8; fx.flashHue = 280;
  }
}
const HOLE = {
  id: 'hole', title: 'AGUJERO', tag: 'trágatelo todo y crece', timed: true,
  hint: 'mueve el agujero · come lo pequeño · evita las bombas 💣',
  build(info) {
    const d = info.lvl;
    M = { h: { x: 0, y: 0, tx: 0, ty: 0, r: 22, dr: 22, kick: 0 }, objs: [], target: Math.min(180, 140 + d * 8), spawnT: 0, done: false, d, eaten: 0, t: 0, finT: 0 };
    for (let i = 0; i < 70; i++) M.objs.push(hoObj(true));
    run.timeMax = run.time = 55 * run.timeMul;
  },
  move(ang, wx, wy) { const d = Math.hypot(wx, wy), k = d > 300 ? 300 / d : 1; M.h.tx = wx * k; M.h.ty = wy * k; },
  tap(ang, wx, wy) { this.move(ang, wx, wy); },
  echo() { },
  update(dt, rdt, live) {
    const h = M.h; M.t += dt;
    h.dr += (h.r - h.dr) * Math.min(1, rdt * 10); h.kick = Math.max(0, h.kick - rdt * 5);
    if (!live) return;
    const dx0 = h.tx - h.x, dy0 = h.ty - h.y, dd = Math.hypot(dx0, dy0), step = 620 * rdt;
    if (dd > step) { h.x += dx0 / dd * step; h.y += dy0 / dd * step; } else { h.x = h.tx; h.y = h.ty; }
    for (const o of M.objs) {
      if (o.dead) continue;
      o.flash = Math.max(0, o.flash - rdt * 3);
      if (o.sw !== 0) { // se lo está tragando: espiral hacia el centro
        o.sw += dt * 3; if (o.sw < 0) continue;
        const ax = o.x - h.x, ay = o.y - h.y, d = Math.hypot(ax, ay) || 1, ang = Math.atan2(ay, ax) + dt * 9, nd = d * Math.max(0, 1 - dt * 7);
        o.x = h.x + Math.cos(ang) * nd; o.y = h.y + Math.sin(ang) * nd; o.ang += dt * 10;
        if (o.sw >= 1) hoEat(o);
        continue;
      }
      o.x += o.vx * dt; o.y += o.vy * dt; o.ang += dt * (o.vx > 0 ? 0.5 : -0.5);
      const od = Math.hypot(o.x, o.y);
      if (od > 318 - o.r) { const nx = o.x / od, ny = o.y / od, vn = o.vx * nx + o.vy * ny; if (vn > 0) { o.vx -= 2 * vn * nx; o.vy -= 2 * vn * ny; } o.x = nx * (318 - o.r); o.y = ny * (318 - o.r); }
      const s = Math.hypot(o.vx, o.vy); if (s > 240) { o.vx *= 240 / s; o.vy *= 240 / s; }
      const dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy) || 1;
      const edible = o.type === 'poison' ? false : o.r < h.r * 0.88;
      if (edible !== o.wasEdible) { if (edible && o.r > 20) { o.flash = 1; Sfx.ping(); } o.wasEdible = edible; }
      if (edible) {
        const range = h.r * 2.6 + o.r;
        if (d < range) { const pull = 1800 * (1 - d / range); o.vx += (dx / d * pull - dy / d * pull * 0.5) * dt; o.vy += (dy / d * pull + dx / d * pull * 0.5) * dt; }
        if (d < h.r * 0.7) { o.sw = 0.001; Sfx.ping(); }
      } else if (o.type === 'poison') {
        if (d < h.r * 2.2 + o.r) { o.vx += -dx / d * 700 * dt; o.vy += -dy / d * 700 * dt; }   // las bombas huyen de ti
        if (d < h.r + o.r * 0.6) {
          if (run.inv <= 0 || M.done) hoEat(o);
          else { o.x += -dx / d * 6; o.y += -dy / d * 6; o.vx = -dx / d * 160; o.vy = -dy / d * 160; }
        }
      } else if (d < h.r + o.r) { // demasiado grande: el agujero lo empuja
        const nx = -dx / d, ny = -dy / d;
        o.x = h.x + nx * (h.r + o.r + 1); o.y = h.y + ny * (h.r + o.r + 1);
        o.vx = nx * 170; o.vy = ny * 170; o.flash = 0.5;
      }
    }
    M.objs = M.objs.filter(o => !o.dead);
    if (!M.done) {
      M.spawnT -= dt;
      if (M.objs.length < 70 && M.spawnT <= 0) { M.spawnT = 0.08; M.objs.push(hoObj(false)); }
    } else {
      M.finT -= rdt;
      if (!M.objs.length || M.finT <= 0) { if (!M.over) { M.over = true; for (const q of M.objs) hoEat(q); floorClear(`tamaño ${Math.round(M.h.r)}`); } }
    }
  },
  ai() {
    let best = null, bd = 1e9;
    for (const o of M.objs) { if (o.type === 'poison' || o.r >= M.h.r * 0.88 || o.sw !== 0) continue; const d = Math.hypot(o.x - M.h.x, o.y - M.h.y); if (d < bd) { bd = d; best = o; } }
    if (best) { M.h.tx = best.x; M.h.ty = best.y; }
  },
  drawBack() {
    ctx.globalAlpha = 0.3 + fx.beat * 0.2; ctx.strokeStyle = '#b77dff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 320, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const o of M.objs) {
      const edible = o.type !== 'poison' && o.r < M.h.r * 0.88, sc = o.sw > 0 ? Math.max(0.05, 1 - o.sw) : 1, r = o.r * sc;
      // aro de color: verde = te lo puedes comer, rojo = veneno, nada = demasiado grande
      if (o.type === 'poison') { ctx.globalAlpha = 0.5 + 0.4 * Math.sin(game.t * 9); ctx.strokeStyle = '#ff2f55'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(o.x, o.y, r * 1.35, 0, TAU); ctx.stroke(); }
      else if (edible) { ctx.globalAlpha = 0.5 + o.flash * 0.5; ctx.strokeStyle = o.type === 'gold' ? '#ffd34d' : '#3dffb0'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(o.x, o.y, r * 1.2, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = edible || o.type === 'poison' ? 1 : 0.55;
      drawEmoji(o.e, o.x, o.y, Math.max(6, r * 1.7), o.ang);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
  },
  drawFront() {
    const h = M.h, R = h.dr * (1 + h.kick * 0.1);
    for (let k = 0; k < 10; k++) {
      const a = game.t * 3.2 + k * TAU / 10;
      ctx.globalAlpha = 0.75; ctx.strokeStyle = `hsl(${hz(hz((k * 36 + game.t * 120) % 360))},${sv(100)}%,62%)`; ctx.lineWidth = 3 + R * 0.07;
      ctx.beginPath(); ctx.arc(h.x, h.y, R * (1.16 + 0.05 * Math.sin(game.t * 6 + k)), a, a + 0.5); ctx.stroke();
    }
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#b77dff'; ctx.beginPath(); ctx.arc(h.x, h.y, R * 2.6, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 2; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.arc(0, 0, M.target, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  },
  hud() { return { fill: M.h.r / M.target, text: `TAMAÑO ${Math.round(M.h.r)}/${M.target} · ${Math.max(0, run.time).toFixed(1)} s`, low: run.time < 5 && !M.done }; },
  blackhole() { for (const o of M.objs) if (!o.dead && o.sw === 0 && o.type !== 'poison' && Math.hypot(o.x - M.h.x, o.y - M.h.y) < 170) o.sw = 0.001; },
  frenzy() { M.h.r = Math.min(M.target - 1, M.h.r * 1.2); },
  explode() { for (const o of M.objs) spark(o.x, o.y, rand(360), 400, 0.6); M.objs = []; },
};
