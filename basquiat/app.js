/* Basquiat / Todo — marks to become king. */
(() => {
  'use strict';

  // ---------- constants ----------

  const LS = {
    tasks: 'basq.tasks',
    pen: 'basq.pen',
    vis: 'basq.vis',
    crews: 'basq.crews',
    archive: 'basq.archive',
  };

  // storage schema v2 (zero state) — wipe any pre-v2 data, e.g. old sample seeds
  const LS_VER = '2';
  if (localStorage.getItem('basq.v') !== LS_VER) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('basq.')) localStorage.removeItem(k);
    }
    localStorage.setItem('basq.v', LS_VER);
  }

  const COLORS = {
    black: '#141414',
    red: '#c92f1e',
    blue: '#2b4ea3',
    yellow: '#e3b71e',
  };
  const GOLD = '#d9a916';
  const INK = '#141414';
  // default fill for a closed shape: a companion color to the outline
  const COMPLEMENT = { black: 'yellow', yellow: 'red', red: 'blue', blue: 'white' };
  // fill palette = outline palette, but white takes black's place
  const FILL_COLORS = { white: '#f5f1e6', red: '#c92f1e', blue: '#2b4ea3', yellow: '#e3b71e' };

  const PRI = ['king', 'queen', 'bishop', 'knight', 'pawn', 'ghost'];
  const PRI_META = {
    king:   { label: 'MUST DO',  scale: 1.3,  crown: 'gold',    crownW: 30 },
    queen:  { label: 'IMPORTANT', scale: 1.15, crown: 'gold',    crownW: 24 },
    bishop: { label: 'SOON',     scale: 1.05, crown: 'ink',     crownW: 20 },
    knight: { label: 'IF I CAN', scale: 1,    crown: 'outline', crownW: 18 },
    pawn:   { label: 'SOMEDAY',  scale: 0.85, crown: null },
    ghost:  { label: 'LET IT GO', scale: 0.75, crown: null },
  };

  const FILL_NAMES = { white: 'White', red: 'Red', blue: 'Blue', yellow: 'Yellow' };

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // ---------- state ----------

  let tasks = [];
  let crews = {}; // cid -> { stacked, x, y } (stack anchor: x = width fraction, y = viewport heights)
  let pen = localStorage.getItem(LS.pen) || 'black';
  let vis = { white: true, red: true, blue: true, yellow: true };
  try {
    const saved = JSON.parse(localStorage.getItem(LS.vis) || '{}');
    for (const k of Object.keys(vis)) if (typeof saved[k] === 'boolean') vis[k] = saved[k];
  } catch { /* defaults */ }
  let mode = 'normal'; // 'normal' | 'draw' | 'lasso'
  let drawStrokes = []; // in-progress drawing, px points
  let curStroke = null;
  let lassoPts = null;
  const markEls = new Map();
  const ringEls = new Map(); // clusterId -> { el, box }
  const toastShown = new Set();

  // ---------- dom ----------

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const world = $('#world');
  const scrollbarEl = $('#scrollbar');
  const marksEl = $('#marks');
  const ringsEl = $('#rings');
  const scratch = $('#scratch');
  const sctx = scratch.getContext('2d');
  const hintEl = $('#hint');
  const drawbar = $('#drawbar');
  const drawHint = $('#drawHint');
  const lassoHint = $('#lassoHint');
  const bottombar = $('#bottombar');
  const nameOverlay = $('#nameOverlay');
  const nameInput = $('#nameInput');
  const inspect = $('#inspect');
  const backdrop = $('#backdrop');
  const layersSheet = $('#layersSheet');
  const daySheet = $('#daySheet');
  const toastEl = $('#toast');

  // ---------- utils ----------

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);

  // ---------- the scrolling world ----------
  // the canvas grows on demand: it starts MIN_SCREENS viewports tall and adds
  // a screen whenever you keep pulling past the bottom edge. x is a fraction
  // of the viewport width; y is measured in viewport heights (so the world
  // can grow without moving existing marks).

  const MIN_SCREENS = 3;
  let screens = MIN_SCREENS;
  const worldH = () => stage.clientHeight * screens;
  const yMax = () => screens - 0.12;
  let scrollY = 0;

  function syncWorldSize() {
    world.style.height = screens * 100 + '%';
  }

  // bottom-most content, in viewport heights
  function contentBottom() {
    let b = 0;
    for (const t of tasks) b = Math.max(b, t.y || 0);
    for (const c of Object.values(crews)) {
      if (c && c.stacked && typeof c.y === 'number') b = Math.max(b, c.y);
    }
    return b;
  }

  // trim empty trailing screens (load / archive / erase)
  function fitWorld() {
    screens = Math.max(MIN_SCREENS, Math.ceil(contentBottom() + 0.55));
    syncWorldSize();
  }

  let growPull = 0; // accumulated pull past the bottom edge, in px
  function growWorld() {
    screens += 1;
    syncWorldSize();
    applyWorldTransform();
    updateScrollbar();
    showToast('The canvas grows. Keep going.');
  }

  let sbTimer = null;
  function updateScrollbar() {
    const sh = stage.clientHeight, wh = worldH();
    const th = Math.max(40, (sh / wh) * (sh - 20));
    scrollbarEl.style.height = th + 'px';
    scrollbarEl.style.top = 10 + (scrollY / (wh - sh)) * (sh - 20 - th) + 'px';
    scrollbarEl.hidden = false;
    scrollbarEl.style.opacity = '1';
    clearTimeout(sbTimer);
    sbTimer = setTimeout(() => { scrollbarEl.style.opacity = '0'; }, 800);
  }

  // ---------- overview (pinch-zoom out) ----------

  let overview = false;

  function ovParams() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const s = Math.min((sh - 110) / worldH(), 0.9);
    return { s, tx: (sw - sw * s) / 2, ty: 62 };
  }

  function applyWorldTransform() {
    if (overview) {
      const { s, tx, ty } = ovParams();
      world.style.translate = `${tx}px ${ty}px`;
      world.style.scale = String(s);
    } else {
      world.style.translate = `0 ${-scrollY}px`;
      world.style.scale = '1';
    }
  }

  function setScroll(v) {
    const max = worldH() - stage.clientHeight;
    if (v > max + 0.5) {
      // pulling past the bottom edge: keep pulling and the canvas grows
      growPull += v - max;
      if (growPull > 150) { growPull = 0; growWorld(); }
    } else if (v < max - 4) {
      growPull = 0;
    }
    scrollY = clamp(v, 0, worldH() - stage.clientHeight);
    applyWorldTransform();
    if (!overview) updateScrollbar();
  }

  function animWorld() {
    world.classList.add('anim');
    setTimeout(() => world.classList.remove('anim'), 420);
  }

  function enterOverview() {
    if (overview) return;
    if (mode === 'draw') exitDraw();
    if (mode === 'lasso') exitLasso();
    closePanels();
    overview = true;
    stage.classList.add('overview');
    scrollbarEl.style.opacity = '0';
    animWorld();
    applyWorldTransform();
    showToast('The whole day at once. Tap where you want to go.');
  }

  function exitOverview(clientX, clientY) {
    if (!overview) return;
    if (clientY != null) {
      const { s, ty } = ovParams();
      const wy = (clientY - stage.getBoundingClientRect().top - ty) / s;
      scrollY = clamp(wy - stage.clientHeight / 2, 0, worldH() - stage.clientHeight);
    }
    overview = false;
    stage.classList.remove('overview');
    hideToast();
    animWorld();
    applyWorldTransform();
    swallowNextClick();
  }

  function localISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtDue(iso) {
    if (!iso) return null;
    if (iso === localISO(0)) return 'TODAY';
    if (iso === localISO(1)) return 'TOMORROW';
    if (iso === localISO(-1)) return 'YESTERDAY';
    const [, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }
  const saveTasks = () => localStorage.setItem(LS.tasks, JSON.stringify(tasks));
  const saveVis = () => localStorage.setItem(LS.vis, JSON.stringify(vis));
  const saveCrews = () => localStorage.setItem(LS.crews, JSON.stringify(crews));

  // ---------- paper + doodles ----------

  let paperCv = null;

  function paintPaper() {
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 1400;
    const ctx = cv.getContext('2d');
    const rnd = mulberry32(1960);
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, 800, 1400);
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(190,175,145,0.06)' : 'rgba(255,252,240,0.07)';
      ctx.beginPath();
      ctx.ellipse(rnd() * 800, rnd() * 1400, 70 + rnd() * 180, 50 + rnd() * 140, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // faint background scrawl
    const doodles = [doodleCrown, doodleX, doodleArrow, doodleSquiggle, doodleStar, doodleCircle];
    for (let i = 0; i < 30; i++) {
      const fn = doodles[Math.floor(rnd() * doodles.length)];
      const colored = rnd() < 0.16;
      const col = colored
        ? [COLORS.red, COLORS.blue, COLORS.yellow][Math.floor(rnd() * 3)]
        : '#3c372d';
      ctx.save();
      ctx.globalAlpha = colored ? 0.12 : 0.07 + rnd() * 0.06;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 2 + rnd() * 2;
      ctx.lineCap = 'round';
      ctx.translate(rnd() * 800, rnd() * 1400);
      ctx.rotate((rnd() - 0.5) * 0.9);
      fn(ctx, 18 + rnd() * 42, rnd);
      ctx.restore();
    }
    // speckles
    for (let i = 0; i < 550; i++) {
      ctx.fillStyle = 'rgba(110,98,75,0.13)';
      ctx.beginPath();
      ctx.arc(rnd() * 800, rnd() * 1400, 0.4 + rnd() * 1, 0, Math.PI * 2);
      ctx.fill();
    }
    paperCv = cv;
    world.style.backgroundImage = `url(${cv.toDataURL('image/jpeg', 0.8)})`;
  }

  function doodleCrown(ctx, s, rnd) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.7);
    ctx.lineTo(s * 0.06, s * 0.25);
    ctx.lineTo(s * 0.3, s * 0.5);
    ctx.lineTo(s * 0.5, s * 0.1);
    ctx.lineTo(s * 0.7, s * 0.5);
    ctx.lineTo(s * 0.94, s * 0.25);
    ctx.lineTo(s, s * 0.7);
    ctx.closePath();
    ctx.stroke();
  }
  function doodleX(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(s, s);
    ctx.moveTo(s, 0); ctx.lineTo(0, s);
    ctx.stroke();
  }
  function doodleArrow(ctx, s, rnd) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.5);
    ctx.quadraticCurveTo(s * 0.5, s * (0.3 + rnd() * 0.4), s, s * 0.5);
    ctx.moveTo(s * 0.75, s * 0.3); ctx.lineTo(s, s * 0.5); ctx.lineTo(s * 0.75, s * 0.72);
    ctx.stroke();
  }
  function doodleSquiggle(ctx, s, rnd) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= s; x += s / 8) ctx.lineTo(x, ((x / (s / 8)) % 2 ? 1 : -1) * s * 0.14 * (0.6 + rnd() * 0.8));
    ctx.stroke();
  }
  function doodleStar(ctx, s) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      ctx.moveTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5);
      ctx.lineTo(-Math.cos(a) * s * 0.5, -Math.sin(a) * s * 0.5);
    }
    ctx.stroke();
  }
  function doodleCircle(ctx, s, rnd) {
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.5, s * (0.35 + rnd() * 0.2), 0, 0.2, Math.PI * 2.15);
    ctx.stroke();
  }

  // ---------- mark rendering ----------

  function marker(ctx, pts, color, baseW, seed = 1) {
    if (pts.length < 2) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], baseW * 0.7, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = baseW * (0.72 + 0.55 * Math.abs(Math.sin(i * 1.7 + seed)));
      ctx.beginPath();
      ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
      ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  }

  function drawCrownGlyph(ctx, x, y, w, style) {
    const h = w * 0.72;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.12);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.78);
    ctx.lineTo(w * 0.06, h * 0.3);
    ctx.lineTo(w * 0.3, h * 0.55);
    ctx.lineTo(w * 0.5, h * 0.08);
    ctx.lineTo(w * 0.7, h * 0.55);
    ctx.lineTo(w * 0.94, h * 0.3);
    ctx.lineTo(w, h * 0.78);
    ctx.closePath();
    if (style === 'gold') { ctx.fillStyle = GOLD; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke(); }
    else if (style === 'ink') { ctx.fillStyle = INK; ctx.fill(); }
    else { ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke(); }
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    ctx.restore();
  }

  function wrapTitle(ctx, text, maxW) {
    const words = (text || 'UNTITLED').toUpperCase().split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const probe = line ? line + ' ' + w : w;
      if (ctx.measureText(probe).width <= maxW || !line) line = probe;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  }

  const fillColorOf = (t) => FILL_COLORS[catOf(t)] || null;

  // jittered outline points for a cleaned-up detected shape (normalized geometry -> px)
  function shapeOutlinePts(kind, x, y, w, h, rnd) {
    const j = (a) => (rnd() - 0.5) * 2 * a;
    const pts = [];
    const seg = (a, b, steps, amt) => {
      for (let i = 0; i < steps; i++) {
        const u = i / steps;
        pts.push([x + (a[0] + (b[0] - a[0]) * u) * w + j(amt), y + (a[1] + (b[1] - a[1]) * u) * h + j(amt)]);
      }
    };
    if (kind === 'rect') {
      const cs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let e = 0; e < 4; e++) seg(cs[e], cs[(e + 1) % 4], 5, 2.4);
    } else if (kind === 'circle') {
      const n = 36, a0 = rnd() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        pts.push([
          x + w / 2 + Math.cos(a) * (w / 2) * (1 + (rnd() - 0.5) * 0.055),
          y + h / 2 + Math.sin(a) * (h / 2) * (1 + (rnd() - 0.5) * 0.055),
        ]);
      }
    } else { // crown — always cleaned up to the classic three points
      const P = [[0.05, 0.93], [0.02, 0.33], [0.28, 0.56], [0.5, 0.07], [0.72, 0.56], [0.98, 0.33], [0.95, 0.93]];
      for (let i = 0; i < P.length; i++) seg(P[i], P[(i + 1) % P.length], i === P.length - 1 ? 6 : 3, 1.8);
    }
    return pts;
  }

  // a detected shape IS the mark: filled, outlined, title inside
  function drawShapeMark(cv, t, m) {
    const dpr = DPR();
    const { meta, fs, lineH, lines, blockW, blockH } = m;
    const need = {
      rect: { w: blockW * 1.18, h: blockH * 1.45 },
      circle: { w: blockW * 1.5, h: blockH * 1.9 },
      crown: { w: blockW * 1.3, h: blockH * 2.6 },
    }[t.shape];
    let SW = Math.max(t.strokesW || 0, need.w);
    let SH = Math.max(t.strokesH || 0, need.h);
    if (t.shape === 'crown') {
      SH = clamp(SH, SW * 0.55, SW * 0.85);
      if (SH < need.h) { SH = need.h; SW = Math.max(SW, SH / 0.85); }
    }
    const M = 22;
    const W = Math.ceil(SW + M * 2), H = Math.ceil(SH + M * 2);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(t.seed);
    const col = COLORS[t.color] || INK;
    const fillCol = fillColorOf(t);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((rnd() - 0.5) * 0.05);
    ctx.translate(-W / 2, -H / 2);
    const pts = shapeOutlinePts(t.shape, M, M, SW, SH, rnd);
    if (fillCol) {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = fillCol;
      ctx.fill();
    }
    marker(ctx, [...pts, pts[0]], col, 4.6, t.seed % 7);

    ctx.font = `${fs}px "Permanent Marker", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // title ink must contrast the fill: light fills carry dark/outline ink
    ctx.fillStyle = fillCol
      ? (t.fill === 'yellow' ? INK
        : t.fill === 'white' ? (t.color === 'yellow' ? GOLD : col)
        : '#f5f1e6')
      : (t.color === 'yellow' ? GOLD : col);
    const ty = t.shape === 'crown' ? M + SH * 0.7 : H / 2;
    const ly0 = ty - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => {
      ctx.save();
      ctx.translate(W / 2, ly0 + i * lineH);
      ctx.rotate((rnd() - 0.5) * 0.035);
      ctx.fillText(l, (rnd() - 0.5) * 3, 0);
      ctx.restore();
    });
    ctx.restore();

    if (meta.crown) {
      drawCrownGlyph(ctx, W / 2 + SW / 2 - meta.crownW * 0.7, H / 2 - SH / 2 - meta.crownW * 0.55, meta.crownW, meta.crown);
    }
    if (t.done) drawSlashes(ctx, t, W, H);
  }

  function drawMark(cv, t) {
    const dpr = DPR();
    const meta = PRI_META[t.priority] || PRI_META.knight;
    const fs = Math.round(19 * meta.scale);
    const lineH = fs * 1.18;
    const measure = cv.getContext('2d');
    measure.font = `${fs}px "Permanent Marker", cursive`;
    const lines = wrapTitle(measure, t.title, 132 * meta.scale);
    const textW = Math.max(...lines.map((l) => measure.measureText(l).width));
    const blockW = Math.ceil(textW + fs * 1.3);
    const blockH = Math.ceil(lines.length * lineH + fs * 0.95);

    if (t.shape) {
      drawShapeMark(cv, t, { meta, fs, lineH, lines, blockW, blockH });
      return;
    }

    const sW = t.strokes ? t.strokesW : 0;
    const sH = t.strokes ? t.strokesH : 0;
    const M = 22; // margin for crowns / decor / slashes
    const W = Math.ceil(Math.max(blockW, sW) + M * 2);
    const H = Math.ceil(Math.max(blockH, sH) + M * 2);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(t.seed);
    const cx = W / 2, cy = H / 2;
    const col = COLORS[t.color] || INK;

    // user-drawn strokes behind the block
    if (t.strokes) {
      const ox = cx - sW / 2, oy = cy - sH / 2;
      // any enclosed stroke gets filled solid first
      const fillCol = fillColorOf(t);
      if (fillCol && t.fillIdx && t.fillIdx.length) {
        ctx.fillStyle = fillCol;
        for (const fi of t.fillIdx) {
          const s = t.strokes[fi];
          if (!s || s.length < 3) continue;
          ctx.beginPath();
          s.forEach(([px, py], i) => (i
            ? ctx.lineTo(ox + px * sW, oy + py * sH)
            : ctx.moveTo(ox + px * sW, oy + py * sH)));
          ctx.closePath();
          ctx.fill();
        }
      }
      for (const s of t.strokes) {
        marker(ctx, s.map(([px, py]) => [ox + px * sW, oy + py * sH]), col, 4.4, t.seed % 7);
      }
    } else {
      drawDecor(ctx, rnd, cx, cy, blockW, blockH, col);
    }

    // the block: jittered polygon
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rnd() - 0.5) * 0.045);
    ctx.fillStyle = col;
    const hw = blockW / 2, hh = blockH / 2;
    const j = () => (rnd() - 0.5) * 5;
    ctx.beginPath();
    ctx.moveTo(-hw + j(), -hh + j());
    ctx.lineTo(0 + j(), -hh + j() * 0.6);
    ctx.lineTo(hw + j(), -hh + j());
    ctx.lineTo(hw + j() * 0.6, 0 + j());
    ctx.lineTo(hw + j(), hh + j());
    ctx.lineTo(0 + j(), hh + j() * 0.6);
    ctx.lineTo(-hw + j(), hh + j());
    ctx.lineTo(-hw + j() * 0.6, 0 + j());
    ctx.closePath();
    ctx.fill();

    // title
    ctx.fillStyle = t.color === 'yellow' ? INK : '#f5f1e6';
    ctx.font = `${fs}px "Permanent Marker", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y0 = -((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => {
      ctx.save();
      ctx.rotate((rnd() - 0.5) * 0.035);
      ctx.fillText(l, (rnd() - 0.5) * 3, y0 + i * lineH);
      ctx.restore();
    });
    ctx.restore();

    // crown
    if (meta.crown) {
      drawCrownGlyph(ctx, cx + blockW / 2 - meta.crownW * 0.7, cy - blockH / 2 - meta.crownW * 0.55, meta.crownW, meta.crown);
    }

    // crossed out
    if (t.done) drawSlashes(ctx, t, W, H);
  }

  function drawDecor(ctx, rnd, cx, cy, bw, bh, col) {
    const kind = rnd();
    ctx.save();
    ctx.globalAlpha = 0.9;
    if (kind < 0.3) {
      // rough underline
      const y = cy + bh / 2 + 7;
      marker(ctx, [[cx - bw / 2 - 6, y + rnd() * 3], [cx, y + (rnd() - 0.5) * 4], [cx + bw / 2 + 4, y + rnd() * 3]], col, 3.4, rnd() * 9);
    } else if (kind < 0.55) {
      // loose frame
      const p = 8 + rnd() * 4;
      const pts = [
        [cx - bw / 2 - p, cy - bh / 2 - p], [cx + bw / 2 + p, cy - bh / 2 - p + rnd() * 4],
        [cx + bw / 2 + p + rnd() * 3, cy + bh / 2 + p], [cx - bw / 2 - p + rnd() * 4, cy + bh / 2 + p],
        [cx - bw / 2 - p, cy - bh / 2 - p + 3],
      ];
      marker(ctx, pts, col, 2.6, rnd() * 9);
    } else if (kind < 0.75) {
      // arrow shooting off
      const a = rnd() * Math.PI * 2;
      const x0 = cx + Math.cos(a) * bw * 0.55, y0 = cy + Math.sin(a) * bh * 0.55;
      const x1 = x0 + Math.cos(a) * 20, y1 = y0 + Math.sin(a) * 20;
      marker(ctx, [[x0, y0], [x1, y1]], col, 3, rnd() * 9);
      marker(ctx, [[x1 - Math.cos(a - 0.5) * 8, y1 - Math.sin(a - 0.5) * 8], [x1, y1], [x1 - Math.cos(a + 0.5) * 8, y1 - Math.sin(a + 0.5) * 8]], col, 3, rnd() * 9);
    } else {
      // stray x marks
      for (let i = 0; i < 2; i++) {
        const x = cx + (rnd() - 0.5) * bw * 1.3, y = cy + (rnd() < 0.5 ? -1 : 1) * (bh / 2 + 8 + rnd() * 6);
        const s = 4 + rnd() * 3;
        marker(ctx, [[x - s, y - s], [x + s, y + s]], col, 2.4, rnd() * 9);
        marker(ctx, [[x + s, y - s], [x - s, y + s]], col, 2.4, rnd() * 9);
      }
    }
    ctx.restore();
  }

  function drawSlashes(ctx, t, W, H) {
    const rnd = mulberry32(t.slashSeed || 99);
    const n = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const y0 = H * (0.2 + rnd() * 0.6);
      const pts = [];
      const steps = 6;
      for (let s = 0; s <= steps; s++) {
        pts.push([
          W * 0.06 + (W * 0.88 * s) / steps,
          y0 + (rnd() - 0.5) * H * 0.3 + (s % 2 ? 6 : -6) * rnd(),
        ]);
      }
      marker(ctx, pts, INK, 4.2, i * 3 + 1);
    }
    // one big X
    marker(ctx, [[W * 0.14, H * 0.12], [W * 0.86, H * 0.88]], INK, 5, 2);
    marker(ctx, [[W * 0.86, H * 0.12], [W * 0.14, H * 0.88]], INK, 5, 5);
  }

  // ---------- marks on stage ----------

  // the fill color IS the category/layer
  const catOf = (t) => (FILL_COLORS[t.fill] ? t.fill : COMPLEMENT[t.color] || 'white');
  const isVisible = (t) => vis[catOf(t)] !== false;

  // messy-pile offset for a stacked crew member (seeded, stable)
  function stackOffset(t, members) {
    const i = Math.max(0, members.findIndex((m) => m.id === t.id));
    const rnd = mulberry32((t.seed || 1) + 11);
    return [(rnd() - 0.5) * 26, i * 9 - (members.length - 1) * 4.5 + (rnd() - 0.5) * 8];
  }

  function positionMark(el, t) {
    const c = t.cluster && crews[t.cluster];
    let ox = 0, oy = 0;
    if (c && c.stacked) {
      [ox, oy] = stackOffset(t, clusterMembers(t.cluster));
      el.style.left = c.x * 100 + '%';
      el.style.top = c.y * stage.clientHeight + 'px';
    } else {
      el.style.left = t.x * 100 + '%';
      el.style.top = t.y * stage.clientHeight + 'px';
    }
    el.style.translate = `calc(-50% + ${ox}px) calc(-50% + ${oy}px)`;
  }

  // where the mark actually sits, in WORLD px (screen y = world y - scrollY)
  function visPosPx(t) {
    const c = t.cluster && crews[t.cluster];
    if (c && c.stacked) {
      const [ox, oy] = stackOffset(t, clusterMembers(t.cluster));
      return [c.x * stage.clientWidth + ox, c.y * stage.clientHeight + oy];
    }
    return [t.x * stage.clientWidth, t.y * stage.clientHeight];
  }

  function buildMark(t, fresh = false) {
    const el = document.createElement('div');
    el.className = 'mark' + (t.done ? ' done' : '') + (fresh ? ' new' : '');
    el.dataset.id = t.id;
    const cv = document.createElement('canvas');
    drawMark(cv, t);
    el.appendChild(cv);
    positionMark(el, t);
    marksEl.appendChild(el);
    markEls.set(t.id, el);
    if (fresh) setTimeout(() => el.classList.remove('new'), 350);
    return el;
  }

  function redrawMark(t) {
    const el = markEls.get(t.id);
    if (!el) return;
    drawMark(el.querySelector('canvas'), t);
    el.classList.toggle('done', t.done);
  }

  function renderMarks() {
    marksEl.textContent = '';
    markEls.clear();
    for (const t of tasks.filter(isVisible)) buildMark(t);
    buildRings();
    updateHint();
  }

  function updateHint() {
    hintEl.hidden = marksEl.children.length > 0;
  }

  function stageFrac(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return {
      x: clamp((clientX - r.left) / r.width, 0.08, 0.92),
      y: clamp((clientY - r.top + scrollY) / stage.clientHeight, 0.09, yMax()),
    };
  }

  // ---------- clusters / crews ----------

  function clusterMembers(cid) {
    return tasks.filter((t) => t.cluster === cid && isVisible(t));
  }

  function buildRings() {
    ringsEl.textContent = '';
    ringEls.clear();
    const cids = [...new Set(tasks.map((t) => t.cluster).filter(Boolean))];
    for (const cid of cids) {
      const members = clusterMembers(cid);
      if (members.length < 2) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const m of members) {
        const el = markEls.get(m.id);
        if (!el) continue;
        const w = el.offsetWidth, h = el.offsetHeight;
        const [cx, cy] = visPosPx(m);
        x0 = Math.min(x0, cx - w / 2); y0 = Math.min(y0, cy - h / 2);
        x1 = Math.max(x1, cx + w / 2); y1 = Math.max(y1, cy + h / 2);
      }
      const pad = 16;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const el = document.createElement('div');
      el.className = 'ring';
      el.style.left = x0 + 'px';
      el.style.top = y0 + 'px';
      const cv = document.createElement('canvas');
      const w = x1 - x0, h = y1 - y0;
      const dpr = DPR();
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rnd = mulberry32(cid.length * 31 + cid.charCodeAt(0));
      ctx.strokeStyle = COLORS.blue;
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        const n = 26;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2 + pass * 0.15;
          const rx = (w / 2 - 3) * (0.96 + rnd() * 0.07);
          const ry = (h / 2 - 3) * (0.96 + rnd() * 0.07);
          const px = w / 2 + Math.cos(a) * rx;
          const py = h / 2 + Math.sin(a) * ry;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.lineWidth = pass ? 1.6 : 3;
        ctx.globalAlpha = pass ? 0.5 : 0.85;
        ctx.stroke();
      }
      // stacked pile: scrawl the crew size on the ring
      if (crews[cid] && crews[cid].stacked) {
        ctx.globalAlpha = 1;
        ctx.font = '17px "Permanent Marker", cursive';
        ctx.fillStyle = COLORS.blue;
        ctx.textAlign = 'center';
        ctx.fillText(String(members.length), w - 10, 20);
      }
      el.appendChild(cv);
      ringsEl.appendChild(el);
      ringEls.set(cid, { el, box: { x0, y0, x1, y1 } });
    }
  }

  function repositionCrew(members) {
    for (const m of members) {
      const el = markEls.get(m.id);
      if (!el) continue;
      el.classList.add('anim');
      positionMark(el, m);
      setTimeout(() => el.classList.remove('anim'), 380);
    }
    buildRings();
  }

  function spreadCrew(cid) {
    if (!crews[cid]) return;
    crews[cid].stacked = false;
    saveCrews();
    const members = clusterMembers(cid);
    repositionCrew(members);
    showToast(`A crew of ${members.length}. Slash one, or stack them again.`, 'BREAK UP', () => breakCrew(cid));
  }

  function stackCrew(cid) {
    const members = clusterMembers(cid);
    if (members.length < 2) return;
    const vps = members.map(visPosPx);
    const c = crews[cid] || (crews[cid] = {});
    c.stacked = true;
    c.x = clamp(vps.reduce((a, p) => a + p[0], 0) / vps.length / stage.clientWidth, 0.1, 0.9);
    c.y = clamp(vps.reduce((a, p) => a + p[1], 0) / vps.length / stage.clientHeight, 0.09, yMax());
    saveCrews();
    repositionCrew(members);
    showToast('Stacked. They move as one.');
  }

  function breakCrew(cid) {
    const members = tasks.filter((t) => t.cluster === cid);
    for (const t of members) t.cluster = null;
    delete crews[cid];
    saveTasks();
    saveCrews();
    repositionCrew(members);
  }

  // ---------- scratch canvas (draw + lasso + slash ink) ----------

  function sizeScratch() {
    const dpr = DPR();
    scratch.width = stage.clientWidth * dpr;
    scratch.height = stage.clientHeight * dpr;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const clearScratch = () => sctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);

  function scratchSegment(from, to, color, w) {
    sctx.strokeStyle = color;
    sctx.lineWidth = w;
    sctx.lineCap = 'round';
    sctx.beginPath();
    sctx.moveTo(from[0], from[1]);
    sctx.lineTo(to[0], to[1]);
    sctx.stroke();
  }

  // ---------- gestures ----------

  let gest = null;

  // a pointerup that opens UI is followed by a browser-generated click on
  // whatever now sits under the cursor (backdrop, toast) — swallow that one
  let swallowUntil = 0;
  const swallowNextClick = () => { swallowUntil = performance.now() + 150; };
  document.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- two-finger scroll ----------

  const touchPts = new Map(); // pointerId -> [x, y]
  let panning = false;
  let panLastY = 0;
  let pinchDist = 0;
  let ovTap = null; // single pointer that may become a tap-to-exit in overview

  // redraw committed draw-mode strokes after a cancelled in-progress one
  function redrawDrawInk() {
    clearScratch();
    for (const s of drawStrokes) {
      for (let i = 1; i < s.length; i++) scratchSegment(s[i - 1], s[i], COLORS[pen], 4.4);
    }
  }

  // a second finger means scroll: abandon whatever the first finger started
  function cancelForPan() {
    if (gest) {
      gest = null;
      document.querySelectorAll('.mark.dragging').forEach((el) => el.classList.remove('dragging'));
      clearScratch();
      buildRings();
    }
    if (mode === 'draw' && curStroke) { curStroke = null; redrawDrawInk(); }
    if (mode === 'lasso' && lassoPts) { lassoPts = null; clearScratch(); }
  }

  function touchDown(e) {
    if (e.pointerType !== 'touch') return false;
    touchPts.set(e.pointerId, [e.clientX, e.clientY]);
    if (touchPts.size === 2) {
      cancelForPan();
      ovTap = null; // two fingers = pinch/pan, not a tap
      panning = true;
      panLastY = [...touchPts.values()].reduce((a, p) => a + p[1], 0) / touchPts.size;
      const [p1, p2] = [...touchPts.values()];
      pinchDist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    }
    return panning;
  }

  function touchMove(e) {
    if (e.pointerType !== 'touch' || !touchPts.has(e.pointerId)) return false;
    touchPts.set(e.pointerId, [e.clientX, e.clientY]);
    if (!panning) return false;
    const pts = [...touchPts.values()];
    if (pts.length === 2 && pinchDist > 0) {
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      if (!overview && d < pinchDist * 0.72) { enterOverview(); pinchDist = d; }
      else if (overview && d > pinchDist * 1.35) { exitOverview(); pinchDist = d; }
    }
    const avg = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (!overview) setScroll(scrollY - (avg - panLastY));
    panLastY = avg;
    return true;
  }

  function touchEnd(e) {
    if (e.pointerType !== 'touch') return;
    touchPts.delete(e.pointerId);
    if (panning && touchPts.size < 2) {
      panning = false;
      swallowNextClick();
    }
  }

  // trackpad two-finger scroll / mouse wheel; ctrl+wheel = trackpad pinch
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      if (e.deltaY > 0) enterOverview();
      else exitOverview();
      return;
    }
    if (!overview) setScroll(scrollY + e.deltaY);
  }, { passive: false });

  // mouse fallback: double-click empty canvas to zoom out
  stage.addEventListener('dblclick', (e) => {
    if (!overview && mode === 'normal' && !e.target.closest('.mark')) enterOverview();
  });

  stage.addEventListener('pointerdown', (e) => {
    if (touchDown(e)) return;
    if (overview) {
      if (touchPts.size <= 1) ovTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return; // no gestures while zoomed out
    }
    if (!e.isPrimary) return;
    const r = stage.getBoundingClientRect();
    const pt = [e.clientX - r.left, e.clientY - r.top];

    if (mode === 'draw') {
      curStroke = [pt];
      try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      return;
    }
    if (mode === 'lasso') {
      lassoPts = [pt];
      try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      return;
    }

    const markEl = e.target.closest('.mark');
    const task = markEl ? tasks.find((t) => t.id === markEl.dataset.id) : null;
    // only a *stacked* crew moves/slashes as one; spread members act individually
    const stacked = !!(task && task.cluster && crews[task.cluster] && crews[task.cluster].stacked);
    gest = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      t0: performance.now(),
      markEl, task,
      sub: null, // 'drag' | 'slash'
      path: 0,
      slashPts: [pt],
      crewStacked: stacked,
      crew: stacked ? clusterMembers(task.cluster) : null,
      ringInfo: stacked ? ringEls.get(task.cluster) : null,
    };
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });

  stage.addEventListener('pointermove', (e) => {
    if (touchMove(e)) return;
    if (overview) return;
    const r = stage.getBoundingClientRect();
    const pt = [e.clientX - r.left, e.clientY - r.top];

    if (mode === 'draw' && curStroke) {
      scratchSegment(curStroke[curStroke.length - 1], pt, COLORS[pen], 4.4);
      curStroke.push(pt);
      return;
    }
    if (mode === 'lasso' && lassoPts) {
      scratchSegment(lassoPts[lassoPts.length - 1], pt, COLORS.blue, 3);
      lassoPts.push(pt);
      return;
    }
    if (!gest || e.pointerId !== gest.id) return;

    const dx = e.clientX - gest.lastX, dy = e.clientY - gest.lastY;
    gest.path += Math.hypot(dx, dy);
    const dist = Math.hypot(e.clientX - gest.startX, e.clientY - gest.startY);

    if (gest.task && !gest.sub && dist > 12) {
      // fast start = slash, slow start = drag
      gest.sub = performance.now() - gest.t0 < 110 && !gest.task.done ? 'slash' : 'drag';
      if (gest.sub === 'drag') gest.markEl.classList.add('dragging');
    }
    if (gest.sub === 'drag') {
      const fdx = (e.clientX - gest.lastX) / r.width;
      const fdy = (e.clientY - gest.lastY) / stage.clientHeight;
      if (gest.crewStacked) {
        // move the stack anchor too; members' spread spots shift with it
        const c = crews[gest.task.cluster];
        c.x = clamp(c.x + fdx, 0.05, 0.95);
        c.y = clamp(c.y + fdy, 0.06, yMax());
      }
      const targets = gest.crew || [gest.task];
      for (const t of targets) {
        t.x = clamp(t.x + fdx, 0.05, 0.95);
        t.y = clamp(t.y + fdy, 0.06, yMax());
        const el = markEls.get(t.id);
        if (el) { el.classList.add('dragging'); positionMark(el, t); }
      }
      if (gest.ringInfo) {
        gest.ringInfo.el.style.translate = `${e.clientX - gest.startX}px ${e.clientY - gest.startY}px`;
      }
    } else if (gest.sub === 'slash') {
      scratchSegment(gest.slashPts[gest.slashPts.length - 1], pt, INK, 5);
      gest.slashPts.push(pt);
    }
    gest.lastX = e.clientX; gest.lastY = e.clientY;
  });

  function endGesture(e, cancelled) {
    const r = stage.getBoundingClientRect();

    if (mode === 'draw') {
      if (curStroke) { drawStrokes.push(curStroke); curStroke = null; }
      return;
    }
    if (mode === 'lasso') {
      if (lassoPts && !cancelled) finishLasso();
      lassoPts = null;
      return;
    }
    if (!gest || e.pointerId !== gest.id) return;
    const g = gest;
    gest = null;

    document.querySelectorAll('.mark.dragging').forEach((el) => el.classList.remove('dragging'));

    if (cancelled) { clearScratch(); buildRings(); return; }

    if (g.task) {
      if (g.sub === 'drag') {
        saveTasks();
        saveCrews();
        buildRings();
      } else if (g.sub === 'slash') {
        clearScratch();
        const diag = Math.hypot(g.markEl.offsetWidth, g.markEl.offsetHeight);
        if (g.path > diag * 0.5) {
          if (g.crewStacked) crossOutCrew(g.task.cluster);
          else crossOut(g.task);
          swallowNextClick();
        }
      } else if (g.crewStacked) {
        spreadCrew(g.task.cluster);
        swallowNextClick();
      } else {
        openInspect(g.task);
        swallowNextClick();
      }
      return;
    }

    // tap on empty canvas: crew ring toggles stack <-> spread
    if (g.path < 10) {
      const px = g.startX - r.left, py = g.startY - r.top + scrollY;
      for (const [cid, { box }] of ringEls) {
        if (px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1) {
          if (crews[cid] && crews[cid].stacked) spreadCrew(cid);
          else stackCrew(cid);
          swallowNextClick();
          return;
        }
      }
    }
  }

  stage.addEventListener('pointerup', (e) => {
    touchEnd(e);
    if (overview) {
      // only a clean single tap (not the tail end of a pinch) dives back in
      if (ovTap && ovTap.id === e.pointerId
        && Math.hypot(e.clientX - ovTap.x, e.clientY - ovTap.y) < 14) {
        exitOverview(e.clientX, e.clientY);
      }
      ovTap = null;
      return;
    }
    endGesture(e, false);
  });
  stage.addEventListener('pointercancel', (e) => {
    touchEnd(e);
    if (overview) { ovTap = null; return; }
    endGesture(e, true);
  });

  // ---------- completing ----------

  function crossOut(t) {
    t.done = true;
    t.doneAt = Date.now();
    t.slashSeed = Math.floor(Math.random() * 2 ** 31);
    saveTasks();
    const el = markEls.get(t.id);
    if (el) {
      el.classList.add('slashing');
      setTimeout(() => {
        redrawMark(t);
        el.classList.remove('slashing');
        if (!isVisible(t)) renderMarks();
      }, 130);
    }
    showToast('Crossed out. Part of your history.', 'UNDO', () => restoreTask(t));
  }

  function crossOutCrew(cid) {
    const members = tasks.filter((t) => t.cluster === cid && !t.done);
    if (!members.length) return;
    for (const t of members) {
      t.done = true;
      t.doneAt = Date.now();
      t.slashSeed = Math.floor(Math.random() * 2 ** 31);
    }
    saveTasks();
    for (const t of members) {
      const el = markEls.get(t.id);
      if (el) {
        el.classList.add('slashing');
        setTimeout(() => {
          redrawMark(t);
          el.classList.remove('slashing');
        }, 130);
      }
    }
    showToast('The whole crew. Crossed out.', 'UNDO', () => {
      for (const t of members) {
        t.done = false;
        t.doneAt = null;
        t.slashSeed = null;
      }
      saveTasks();
      members.forEach((t) => redrawMark(t));
    });
  }

  function restoreTask(t) {
    t.done = false;
    t.doneAt = null;
    t.slashSeed = null;
    saveTasks();
    if (markEls.has(t.id)) redrawMark(t);
    else renderMarks();
  }

  function discardTask(t) {
    tasks = tasks.filter((x) => x.id !== t.id);
    pruneCrews(); // erasing can leave a crew of one
    saveTasks();
    saveCrews();
    const el = markEls.get(t.id);
    if (el) {
      el.classList.add('fading');
      setTimeout(() => { el.remove(); markEls.delete(t.id); renderMarks(); }, 300);
    }
  }

  // ---------- shape detection ----------

  function strokeLen(s) {
    let L = 0;
    for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    return L;
  }

  function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x0, y0, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0) };
  }

  // uniform arc-length resampling so detection ignores drawing speed
  function resamplePts(s, n) {
    const L = strokeLen(s);
    if (!L || s.length < 2) return s.slice();
    const step = L / (n - 1);
    const out = [s[0]];
    let acc = 0, prev = s[0];
    for (let i = 1; i < s.length; i++) {
      let cur = s[i];
      let d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      while (acc + d >= step && out.length < n) {
        const u = (step - acc) / d;
        const np = [prev[0] + (cur[0] - prev[0]) * u, prev[1] + (cur[1] - prev[1]) * u];
        out.push(np);
        prev = np;
        d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
        acc = 0;
      }
      acc += d;
      prev = cur;
    }
    while (out.length < n) out.push(s[s.length - 1]);
    return out;
  }

  const strokeClosed = (s, diag) =>
    Math.hypot(s[0][0] - s[s.length - 1][0], s[0][1] - s[s.length - 1][1]) < Math.max(22, diag * 0.22);

  // crown = wide-ish zigzag: 2–4 peaks with real prominence, ends at the bottom
  function isCrownStroke(pts, box) {
    if (box.w < box.h * 0.9 || box.w > box.h * 3.5) return false;
    const bottom = box.y0 + box.h * 0.5;
    if (pts[0][1] < bottom || pts[pts.length - 1][1] < bottom) return false;
    const prom = box.h * 0.22;
    let peaks = 0, valleys = 0;
    let curMin = pts[0][1], curMax = pts[0][1], dir = 0;
    for (const [, y] of pts) {
      if (y < curMin) curMin = y;
      if (y > curMax) curMax = y;
      if (dir <= 0 && y - curMin > prom) {
        if (curMin < box.y0 + box.h * 0.55) peaks++;
        dir = 1; curMax = y;
      } else if (dir >= 0 && curMax - y > prom) {
        valleys++;
        dir = -1; curMin = y;
      }
    }
    return peaks >= 2 && peaks <= 4 && valleys >= peaks - 1;
  }

  // a box concentrates its turning in a few corner bursts; a circle spreads it evenly.
  // count corners = runs of consecutive sharp turns (>=12°/pt) summing to >=50°
  function cornerCount(pts) {
    const n = pts.length;
    // light smoothing so hand jitter doesn't read as corners
    const sm = pts.map((_, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    });
    let clusters = 0, acc = 0;
    for (let i = 0; i < n; i++) {
      const a = sm[(i - 1 + n) % n], b = sm[i], c = sm[(i + 1) % n];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let d = a2 - a1;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) >= 0.21) acc += Math.abs(d);
      else { if (acc >= 0.87) clusters++; acc = 0; }
    }
    if (acc >= 0.87) clusters++;
    return clusters;
  }

  // how tightly the stroke hugs its own bounding box, per-axis normalized:
  // ~0 for a box (even rounded/tilted), ~0.10 for a circle — a circle can't hug corners
  function bboxHugOf(pts, box) {
    let sum = 0;
    for (const [x, y] of pts) {
      const dx = Math.min(x - box.x0, box.x0 + box.w - x) / (box.w / 2);
      const dy = Math.min(y - box.y0, box.y0 + box.h - y) / (box.h / 2);
      sum += Math.min(dx, dy);
    }
    return sum / pts.length;
  }

  function isCircleStroke(pts, box) {
    const cx = box.x0 + box.w / 2, cy = box.y0 + box.h / 2;
    const rs = pts.map(([x, y]) => Math.hypot((x - cx) / (box.w / 2), (y - cy) / (box.h / 2)));
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const std = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / rs.length);
    return mean > 0 && std / mean < 0.16;
  }

  // classify a whole drawing (px strokes): clean shape + which strokes enclose an area
  function analyzeDrawing(strokes) {
    const fillIdx = [];
    for (let i = 0; i < strokes.length; i++) {
      const b = bboxOf(strokes[i]);
      if (b.diag >= 40 && strokes[i].length > 6 && strokeClosed(strokes[i], b.diag)) fillIdx.push(i);
    }
    const lens = strokes.map(strokeLen);
    const total = lens.reduce((a, b) => a + b, 0);
    const mainIdx = lens.indexOf(Math.max(...lens));
    let kind = null;
    if (total && lens[mainIdx] / total >= 0.7) {
      const pts = resamplePts(strokes[mainIdx], 96);
      const box = bboxOf(pts);
      if (box.diag >= 40) {
        if (isCrownStroke(pts, box)) kind = 'crown';
        else if (strokeClosed(pts, box.diag)) {
          const corners = cornerCount(pts);
          const hug = bboxHugOf(pts, box);
          // boxy-first: tight hug is a box even when soft corners evade the turn detector;
          // 3-5 corner bursts buy slack for tilted boxes. circles must hug poorly.
          if (hug < 0.06 || (corners >= 3 && corners <= 5 && hug < 0.15)) kind = 'rect';
          else if (corners <= 2 && hug > 0.075 && isCircleStroke(pts, box)) kind = 'circle';
        }
      }
    }
    return { kind, fillIdx };
  }

  // ---------- draw mode ----------

  function enterDraw() {
    if (overview) exitOverview();
    mode = 'draw';
    drawStrokes = [];
    curStroke = null;
    sizeScratch();
    clearScratch();
    stage.classList.add('drawing');
    bottombar.hidden = true;
    drawbar.hidden = false;
    drawHint.hidden = false;
    closePanels();
    updatePens();
  }

  function exitDraw() {
    mode = 'normal';
    clearScratch();
    stage.classList.remove('drawing');
    bottombar.hidden = false;
    drawbar.hidden = true;
    drawHint.hidden = true;
  }

  let pendingDetect = null;

  const SHAPE_WORDS = {
    crown: 'A CROWN. OF COURSE.',
    rect: 'A BOX. I’LL SQUARE IT UP.',
    circle: 'A CIRCLE. I’LL TRUE IT UP.',
    closed: 'CLOSED SHAPE. I’LL FILL IT IN.',
  };

  $('#addBtn').addEventListener('click', enterDraw);
  $('#drawCancel').addEventListener('click', exitDraw);
  $('#drawDone').addEventListener('click', () => {
    if (!drawStrokes.length) { exitDraw(); return; }
    pendingDetect = analyzeDrawing(drawStrokes);
    const tag = $('#nameShape');
    const word = pendingDetect.kind
      ? SHAPE_WORDS[pendingDetect.kind]
      : (pendingDetect.fillIdx.length ? SHAPE_WORDS.closed : null);
    tag.textContent = word || '';
    tag.hidden = !word;
    nameOverlay.hidden = false;
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 30);
  });

  function updatePens() {
    document.querySelectorAll('.pen').forEach((b) =>
      b.classList.toggle('selected', b.dataset.pen === pen));
  }
  document.querySelectorAll('.pen').forEach((b) =>
    b.addEventListener('click', () => {
      pen = b.dataset.pen;
      localStorage.setItem(LS.pen, pen);
      updatePens();
    }));

  function commitDrawing() {
    const title = nameInput.value.trim();
    nameOverlay.hidden = true;
    if (!title) { exitDraw(); return; }
    // normalize strokes
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of drawStrokes) for (const [x, y] of s) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    let w = Math.max(x1 - x0, 10), h = Math.max(y1 - y0, 10);
    const scale = Math.min(1, 300 / Math.max(w, h));
    const det = pendingDetect || analyzeDrawing(drawStrokes);
    pendingDetect = null;
    const strokes = drawStrokes.map((s) => {
      const out = s.length > 60 ? s.filter((_, i) => i % 2 === 0) : s;
      return out.map(([x, y]) => [
        Math.round(((x - x0) / w) * 1000) / 1000,
        Math.round(((y - y0) / h) * 1000) / 1000,
      ]);
    });
    const r = stage.getBoundingClientRect();
    const f = stageFrac(x0 + w / 2 + r.left, y0 + h / 2 + r.top);
    const t = {
      id: crypto.randomUUID(),
      title,
      color: pen,
      x: f.x, y: f.y,
      seed: Math.floor(Math.random() * 2 ** 31),
      priority: 'knight',
      due: null,
      notes: '',
      done: false,
      doneAt: null,
      cluster: null,
      strokes: det.kind ? null : strokes,
      shape: det.kind,
      fillIdx: det.kind ? null : det.fillIdx,
      fill: COMPLEMENT[pen], // fill = category, even when nothing is painted
      strokesW: Math.round(w * scale),
      strokesH: Math.round(h * scale),
      createdAt: Date.now(),
    };
    tasks.push(t);
    saveTasks();
    exitDraw();
    buildMark(t, true);
    updateHint();
    pulse();
  }

  $('#nameDone').addEventListener('click', commitDrawing);
  $('#nameCancel').addEventListener('click', () => { nameOverlay.hidden = true; exitDraw(); });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitDrawing(); }
    if (e.key === 'Escape') { nameOverlay.hidden = true; exitDraw(); }
  });

  // ---------- lasso mode ----------

  const lassoBtn = $('#lassoBtn');

  function toggleLasso() {
    if (overview) exitOverview();
    if (mode === 'lasso') { exitLasso(); return; }
    if (mode === 'draw') exitDraw();
    mode = 'lasso';
    sizeScratch();
    clearScratch();
    lassoBtn.classList.add('active');
    lassoHint.hidden = false;
    closePanels();
  }
  function exitLasso() {
    mode = 'normal';
    clearScratch();
    lassoBtn.classList.remove('active');
    lassoHint.hidden = true;
  }
  lassoBtn.addEventListener('click', toggleLasso);

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function finishLasso() {
    const poly = lassoPts;
    clearScratch();
    if (!poly || poly.length < 8) { exitLasso(); return; }
    const selected = tasks.filter((t) => {
      if (!isVisible(t) || t.done) return false;
      const [vx, vy] = visPosPx(t);
      return pointInPoly(vx, vy - scrollY, poly); // lasso ink is in screen coords
    });
    exitLasso();
    if (selected.length < 2) {
      showToast('Circle at least two marks to build a crew.');
      return;
    }
    // anchor the new stack where the lassoed marks actually are (before reassigning)
    const vps = selected.map(visPosPx);
    const ax = clamp(vps.reduce((a, p) => a + p[0], 0) / vps.length / stage.clientWidth, 0.1, 0.9);
    const ay = clamp(vps.reduce((a, p) => a + p[1], 0) / vps.length / stage.clientHeight, 0.09, yMax());
    const cid = crypto.randomUUID();
    const oldCids = new Set(selected.map((t) => t.cluster).filter(Boolean));
    for (const t of selected) t.cluster = cid;
    // prune crews that fell below 2
    for (const old of oldCids) {
      const rest = tasks.filter((t) => t.cluster === old);
      if (rest.length < 2) rest.forEach((t) => { t.cluster = null; });
      if (!tasks.some((t) => t.cluster === old)) delete crews[old];
    }
    crews[cid] = { stacked: true, x: ax, y: ay };
    saveTasks();
    saveCrews();
    repositionCrew(selected);
    showToast(`A crew of ${selected.length}. Stacked. Tap to spread.`);
  }

  // ---------- inspect ----------

  const CROWN_SVG = '<svg viewBox="0 0 24 18"><path d="M3 14 L4 5 L8.5 9.5 L12 2.5 L15.5 9.5 L20 5 L21 14 Z"/><rect x="3.4" y="14.5" width="17.2" height="2.4"/></svg>';

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openInspect(t) {
    closePanels();
    const dueTxt = fmtDue(t.due);
    const overdue = t.due && t.due < localISO(0) && !t.done;
    inspect.innerHTML = `
      <div class="panel-head">
        <div class="insp-title" id="inspTitle">${escapeHtml(t.title || 'UNTITLED')}</div>
        <button class="panel-x" data-close aria-label="Close">✕</button>
      </div>
      <div class="insp-row">
        <span class="insp-label">CROWN</span>
        <div class="crown-row">
          ${PRI.map((p) => `<button class="crown-pick ${t.priority === p ? 'on' : ''}" data-pri="${p}">${CROWN_SVG}<span>${PRI_META[p].label}</span></button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">OUTLINE</span>
        <div class="color-row">
          ${Object.keys(COLORS).map((c) => `<button class="color-pick ${t.color === c ? 'on' : ''}" data-color="${c}" style="background:${COLORS[c]}" aria-label="${c}"></button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">FILL</span>
        <div class="color-row">
          ${Object.keys(FILL_COLORS).map((c) => `<button class="color-pick ${catOf(t) === c ? 'on' : ''}" data-fill="${c}" style="background:${FILL_COLORS[c]}" aria-label="fill ${c}"></button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">DUE</span>
        <button class="insp-due" id="inspDue">${dueTxt ? (overdue ? `<span class="overdue">${dueTxt} — OVERDUE</span>` : dueTxt) : 'No date. Someday.'}</button>
        <input type="date" class="insp-date" id="inspDate" value="${t.due || ''}" />
      </div>
      <textarea class="insp-notes" id="inspNotes" rows="2" placeholder="Notes. Fragments. Whatever.">${escapeHtml(t.notes || '')}</textarea>
      <div class="insp-actions">
        <button class="primary" id="inspDone">${t.done ? 'BRING IT BACK' : 'CROSS IT OUT'}</button>
        ${t.cluster ? '<button id="inspLeave">LEAVE CREW</button>' : ''}
        <button class="danger" id="inspDelete">ERASE</button>
      </div>
    `;
    backdrop.hidden = false;
    inspect.hidden = false;

    const rerender = () => { saveTasks(); redrawMark(t); };

    $('#inspTitle').addEventListener('click', () => {
      const holder = $('#inspTitle');
      if (holder.querySelector('input')) return;
      const input = document.createElement('input');
      input.value = t.title;
      input.maxLength = 60;
      holder.textContent = '';
      holder.appendChild(input);
      input.focus();
      const commit = () => {
        const v = input.value.trim();
        if (v) t.title = v;
        holder.textContent = t.title || 'UNTITLED';
        rerender();
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } });
      input.addEventListener('blur', commit);
    });

    inspect.querySelectorAll('[data-pri]').forEach((b) =>
      b.addEventListener('click', () => {
        t.priority = b.dataset.pri;
        inspect.querySelectorAll('[data-pri]').forEach((x) => x.classList.toggle('on', x === b));
        rerender();
        buildRings();
      }));
    inspect.querySelectorAll('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        t.color = b.dataset.color;
        inspect.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
        rerender();
      }));
    inspect.querySelectorAll('[data-fill]').forEach((b) =>
      b.addEventListener('click', () => {
        t.fill = b.dataset.fill;
        inspect.querySelectorAll('[data-fill]').forEach((x) => x.classList.toggle('on', x === b));
        rerender();
        // fill = category: recoloring can move the mark into a hidden color
        if (!isVisible(t)) { closePanels(); renderMarks(); }
      }));

    const dateInput = $('#inspDate');
    $('#inspDue').addEventListener('click', () => {
      if (dateInput.showPicker) { try { dateInput.showPicker(); } catch { dateInput.click(); } }
      else dateInput.click();
    });
    dateInput.addEventListener('change', () => {
      t.due = dateInput.value || null;
      saveTasks();
      const txt = fmtDue(t.due);
      $('#inspDue').textContent = txt || 'No date. Someday.';
    });

    $('#inspNotes').addEventListener('change', () => {
      t.notes = $('#inspNotes').value.trim();
      saveTasks();
    });

    $('#inspDone').addEventListener('click', () => {
      closePanels();
      if (t.done) restoreTask(t);
      else crossOut(t);
    });
    const leave = $('#inspLeave');
    if (leave) leave.addEventListener('click', () => {
      const cid = t.cluster;
      t.cluster = null;
      const rest = tasks.filter((x) => x.cluster === cid);
      if (rest.length < 2) {
        rest.forEach((x) => { x.cluster = null; });
        delete crews[cid];
      }
      saveTasks();
      saveCrews();
      closePanels();
      renderMarks();
    });
    $('#inspDelete').addEventListener('click', () => {
      closePanels();
      discardTask(t);
      showToast('Erased. Like it never happened.');
    });
    inspect.querySelector('[data-close]').addEventListener('click', closePanels);
  }

  // ---------- layers sheet ----------

  function buildLayersSheet() {
    const row = $('#layerList');
    row.textContent = '';
    for (const c of Object.keys(FILL_COLORS)) {
      const b = document.createElement('button');
      b.className = 'focus-swatch' + (vis[c] ? ' on' : '');
      b.style.background = FILL_COLORS[c];
      b.setAttribute('aria-label', `${vis[c] ? 'Hide' : 'Show'} ${FILL_NAMES[c]}`);
      b.addEventListener('click', () => {
        vis[c] = !vis[c];
        saveVis();
        b.classList.toggle('on', vis[c]);
        b.setAttribute('aria-label', `${vis[c] ? 'Hide' : 'Show'} ${FILL_NAMES[c]}`);
        renderMarks();
      });
      row.appendChild(b);
    }
  }

  // ---------- the day sheet ----------

  function computeNotices() {
    const open = tasks.filter((t) => !t.done);
    const out = [];
    const overdue = open.filter((t) => t.due && t.due < localISO(0));
    if (overdue.length) {
      const reds = overdue.filter((t) => t.color === 'red').length;
      out.push(reds === overdue.length && reds
        ? `${reds} red ${reds === 1 ? 'mark is' : 'marks are'} overdue.`
        : `${overdue.length} ${overdue.length === 1 ? 'mark is' : 'marks are'} overdue.`);
    }
    const royal = open.filter((t) => t.priority === 'king' || t.priority === 'queen');
    if (royal.length >= 2) {
      const avgX = royal.reduce((s, t) => s + t.x, 0) / royal.length;
      if (avgX < 0.42) out.push('Your crown is leaning left. One side is heavy.');
      else if (avgX > 0.58) out.push('Your crown is leaning right. One side is heavy.');
    }
    const oldIdea = open.find((t) => t.color === 'yellow' && Date.now() - t.createdAt > 2 * 864e5);
    if (oldIdea) out.push('Don’t forget your idea with the yellow square.');
    if (open.length >= 12) out.push('The canvas is loud today.');
    return out;
  }

  function buildDaySheet() {
    const ul = $('#notices');
    ul.textContent = '';
    const notices = computeNotices();
    if (!notices.length) {
      const li = document.createElement('li');
      li.className = 'quiet';
      li.textContent = 'All quiet. The crown rests.';
      ul.appendChild(li);
    }
    for (const n of notices) {
      const li = document.createElement('li');
      li.innerHTML = CROWN_SVG;
      li.appendChild(document.createTextNode(n));
      ul.appendChild(li);
    }
  }

  // ---------- export / archive ----------

  function exportImage() {
    const W = stage.clientWidth, H = worldH(); // the whole canvas, not just the view
    const S = H > 8000 ? 1 : 2; // stay under canvas size limits on tall worlds
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext('2d');
    ctx.scale(S, S);
    // paper (tiled down the canvas, like on the stage)
    const tileH = paperCv.height * (W / paperCv.width);
    for (let y = 0; y < H; y += tileH) ctx.drawImage(paperCv, 0, y, W, tileH);
    // rings
    for (const { el, box } of ringEls.values()) {
      ctx.drawImage(el.querySelector('canvas'), box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    }
    // marks
    for (const t of tasks.filter(isVisible)) {
      const el = markEls.get(t.id);
      if (!el) continue;
      const mcv = el.querySelector('canvas');
      const w = el.offsetWidth, h = el.offsetHeight;
      const [vx, vy] = visPosPx(t);
      ctx.save();
      if (t.done) ctx.globalAlpha = 0.55;
      ctx.drawImage(mcv, vx - w / 2, vy - h / 2, w, h);
      ctx.restore();
    }
    // header
    ctx.save();
    ctx.translate(18, 26);
    ctx.rotate(-0.03);
    drawCrownGlyph(ctx, 0, 0, 30, 'gold');
    ctx.fillStyle = INK;
    ctx.font = '26px "Permanent Marker", cursive';
    ctx.textBaseline = 'middle';
    ctx.fillText(`TODAY — ${fmtDue(localISO(0)) === 'TODAY' ? dayDateText() : ''}`, 40, 12);
    ctx.restore();

    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `basquiat-day-${localISO(0)}.png`;
    a.click();
    showToast('Saved. Make it part of the story.');
  }

  function archiveDay() {
    const ghosts = tasks.filter((t) => t.done);
    if (!ghosts.length) { showToast('Nothing crossed out yet. Nothing to archive.'); return; }
    try {
      const arch = JSON.parse(localStorage.getItem(LS.archive) || '[]');
      arch.push({ date: localISO(0), marks: ghosts.map(({ strokes, ...t }) => t) });
      localStorage.setItem(LS.archive, JSON.stringify(arch));
    } catch { /* archive is best-effort */ }
    tasks = tasks.filter((t) => !t.done);
    pruneCrews();
    fitWorld();
    setScroll(scrollY);
    saveTasks();
    saveCrews();
    renderMarks();
    closePanels();
    showToast(`${ghosts.length} ${ghosts.length === 1 ? 'ghost' : 'ghosts'} archived. The day is part of the story.`);
  }

  $('#saveImage').addEventListener('click', exportImage);
  $('#archiveDay').addEventListener('click', archiveDay);

  // ---------- panels ----------

  function openPanel(panel) {
    if (overview) exitOverview();
    closePanels();
    if (mode !== 'normal') { if (mode === 'draw') exitDraw(); else exitLasso(); }
    if (panel === layersSheet) buildLayersSheet();
    if (panel === daySheet) buildDaySheet();
    backdrop.hidden = false;
    panel.hidden = false;
  }
  function closePanels() {
    backdrop.hidden = true;
    inspect.hidden = true;
    layersSheet.hidden = true;
    daySheet.hidden = true;
  }
  $('#layersBtn').addEventListener('click', () => openPanel(layersSheet));
  $('#crownBtn').addEventListener('click', () => openPanel(daySheet));
  backdrop.addEventListener('click', closePanels);
  document.querySelectorAll('#layersSheet [data-close], #daySheet [data-close]').forEach((b) =>
    b.addEventListener('click', closePanels));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePanels();
      if (mode === 'draw') exitDraw();
      if (mode === 'lasso') exitLasso();
    }
  });

  // ---------- toast ----------

  let toastTimer = null;
  function showToast(text, actionLabel, onAction) {
    const btn = $('#toastAction');
    $('#toastText').textContent = text;
    if (actionLabel) {
      btn.textContent = actionLabel;
      btn.hidden = false;
      btn.onclick = () => { hideToast(); onAction && onAction(); };
    } else {
      btn.hidden = true;
      btn.onclick = null;
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4200);
  }
  function hideToast() {
    toastEl.hidden = true;
    clearTimeout(toastTimer);
  }

  function pulse() {
    for (const n of computeNotices()) {
      if (!toastShown.has(n)) {
        toastShown.add(n);
        setTimeout(() => showToast(n), 700);
        return;
      }
    }
  }

  // ---------- boot ----------

  function dayDateText() {
    const d = new Date();
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function pruneCrews() {
    const counts = {};
    for (const t of tasks) if (t.cluster) counts[t.cluster] = (counts[t.cluster] || 0) + 1;
    for (const t of tasks) if (t.cluster && counts[t.cluster] < 2) t.cluster = null;
    for (const cid of Object.keys(crews)) if (!counts[cid] || counts[cid] < 2) delete crews[cid];
  }

  function load() {
    try {
      tasks = JSON.parse(localStorage.getItem(LS.tasks) || '[]');
    } catch { tasks = []; }
    try {
      crews = JSON.parse(localStorage.getItem(LS.crews) || '{}');
    } catch { crews = {}; }
    // migrate: fill is the category now — every task needs a valid one
    for (const t of tasks) {
      if (!FILL_COLORS[t.fill]) t.fill = COMPLEMENT[t.color] || 'white';
      delete t.layer;
    }
    // migrate y to viewport-height units: wv '1' stored fractions of the old
    // fixed 3-screen world (×3); anything older stored viewport fractions (×1)
    const wv = localStorage.getItem('basq.wv');
    if (wv !== '2') {
      const f = wv === '1' ? 3 : 1;
      for (const t of tasks) t.y = (t.y || 0) * f;
      for (const c of Object.values(crews)) {
        if (c && typeof c.y === 'number') c.y *= f;
      }
      localStorage.setItem('basq.wv', '2');
    }
    pruneCrews();
    fitWorld();
    saveTasks();
    saveCrews();
  }

  // ---------- onboarding ----------

  const OB_KEY = 'basq.seen';
  const onboard = $('#onboard');
  if (onboard && !localStorage.getItem(OB_KEY)) {
    onboard.hidden = false;
    $('#onboardGo').addEventListener('click', () => {
      localStorage.setItem(OB_KEY, '1');
      onboard.hidden = true;
    });
  }

  load();
  paintPaper();
  sizeScratch();
  updatePens();
  $('#dayDate').textContent = dayDateText();
  window.addEventListener('resize', () => {
    sizeScratch();
    // mark tops are in px of the viewport height — reproject them
    for (const t of tasks.filter(isVisible)) {
      const el = markEls.get(t.id);
      if (el) positionMark(el, t);
    }
    setScroll(scrollY);
    buildRings();
  });

  document.fonts.load('20px "Permanent Marker"').then(() => document.fonts.ready).then(() => {
    renderMarks();
    pulse();
  });
})();
