/* Basquiat / Todo — marks to become king. */
(() => {
  'use strict';

  // ---------- constants ----------

  const LS = {
    tasks: 'basq.tasks',
    pen: 'basq.pen',
    vis: 'basq.vis',
    archive: 'basq.archive',
  };

  const COLORS = {
    black: '#141414',
    red: '#c92f1e',
    blue: '#2b4ea3',
    yellow: '#e3b71e',
  };
  const GOLD = '#d9a916';
  const INK = '#141414';

  const PRI = ['king', 'queen', 'bishop', 'knight', 'pawn', 'ghost'];
  const PRI_META = {
    king:   { label: 'MUST DO',  scale: 1.3,  crown: 'gold',    crownW: 30 },
    queen:  { label: 'IMPORTANT', scale: 1.15, crown: 'gold',    crownW: 24 },
    bishop: { label: 'SOON',     scale: 1.05, crown: 'ink',     crownW: 20 },
    knight: { label: 'IF I CAN', scale: 1,    crown: 'outline', crownW: 18 },
    pawn:   { label: 'SOMEDAY',  scale: 0.85, crown: null },
    ghost:  { label: 'LET IT GO', scale: 0.75, crown: null },
  };

  const LAYERS = [
    { id: 'today', name: 'Today', color: GOLD },
    { id: 'work', name: 'Work', color: COLORS.blue },
    { id: 'personal', name: 'Personal', color: COLORS.red },
    { id: 'ideas', name: 'Ideas', color: COLORS.yellow },
    { id: 'waiting', name: 'Waiting', color: '#8f8a80' },
  ];

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // ---------- state ----------

  let tasks = [];
  let pen = localStorage.getItem(LS.pen) || 'black';
  let vis = { today: true, work: true, personal: true, ideas: true, waiting: true, done: true };
  try { vis = { ...vis, ...JSON.parse(localStorage.getItem(LS.vis) || '{}') }; } catch { /* defaults */ }
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
    stage.style.backgroundImage = `url(${cv.toDataURL('image/jpeg', 0.8)})`;
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

  const isVisible = (t) => vis[t.layer] && (!t.done || vis.done);

  function positionMark(el, t) {
    el.style.left = t.x * 100 + '%';
    el.style.top = t.y * 100 + '%';
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
      y: clamp((clientY - r.top) / r.height, 0.12, 0.85),
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
        const cx = m.x * stage.clientWidth, cy = m.y * stage.clientHeight;
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
      el.appendChild(cv);
      ringsEl.appendChild(el);
      ringEls.set(cid, { el, box: { x0, y0, x1, y1 } });
    }
  }

  function breakCrew(cid) {
    for (const t of tasks) if (t.cluster === cid) t.cluster = null;
    saveTasks();
    buildRings();
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

  stage.addEventListener('pointerdown', (e) => {
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
    gest = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      t0: performance.now(),
      markEl, task,
      sub: null, // 'drag' | 'slash'
      path: 0,
      slashPts: [pt],
      crew: task && task.cluster ? clusterMembers(task.cluster) : null,
      ringInfo: task && task.cluster ? ringEls.get(task.cluster) : null,
    };
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });

  stage.addEventListener('pointermove', (e) => {
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
      const fdy = (e.clientY - gest.lastY) / r.height;
      const targets = gest.crew || [gest.task];
      for (const t of targets) {
        t.x = clamp(t.x + fdx, 0.05, 0.95);
        t.y = clamp(t.y + fdy, 0.08, 0.9);
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
        buildRings();
      } else if (g.sub === 'slash') {
        clearScratch();
        const diag = Math.hypot(g.markEl.offsetWidth, g.markEl.offsetHeight);
        if (g.path > diag * 0.5) { crossOut(g.task); swallowNextClick(); }
      } else {
        openInspect(g.task);
        swallowNextClick();
      }
      return;
    }

    // tap on empty canvas: crew ring?
    if (g.path < 10) {
      const px = g.startX - r.left, py = g.startY - r.top;
      for (const [cid, { box }] of ringEls) {
        if (px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1) {
          const n = clusterMembers(cid).length;
          showToast(`A crew of ${n}. They move together.`, 'BREAK UP', () => breakCrew(cid));
          swallowNextClick();
          return;
        }
      }
    }
  }

  stage.addEventListener('pointerup', (e) => endGesture(e, false));
  stage.addEventListener('pointercancel', (e) => endGesture(e, true));

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
    saveTasks();
    const el = markEls.get(t.id);
    if (el) {
      el.classList.add('fading');
      setTimeout(() => { el.remove(); markEls.delete(t.id); buildRings(); updateHint(); }, 300);
    }
  }

  // ---------- draw mode ----------

  function enterDraw() {
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

  $('#addBtn').addEventListener('click', enterDraw);
  $('#drawCancel').addEventListener('click', exitDraw);
  $('#drawDone').addEventListener('click', () => {
    if (!drawStrokes.length) { exitDraw(); return; }
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
      layer: 'today',
      x: f.x, y: f.y,
      seed: Math.floor(Math.random() * 2 ** 31),
      priority: 'knight',
      due: null,
      notes: '',
      done: false,
      doneAt: null,
      cluster: null,
      strokes,
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
      return pointInPoly(t.x * stage.clientWidth, t.y * stage.clientHeight, poly);
    });
    exitLasso();
    if (selected.length < 2) {
      showToast('Circle at least two marks to build a crew.');
      return;
    }
    const cid = crypto.randomUUID();
    const oldCids = new Set(selected.map((t) => t.cluster).filter(Boolean));
    for (const t of selected) t.cluster = cid;
    // prune crews that fell below 2
    for (const old of oldCids) {
      const rest = tasks.filter((t) => t.cluster === old);
      if (rest.length < 2) rest.forEach((t) => { t.cluster = null; });
    }
    saveTasks();
    buildRings();
    showToast(`A crew of ${selected.length}. They have more power.`);
  }

  // ---------- inspect ----------

  const EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><path d="M4 20 20 4"/></svg>';
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
        <span class="insp-label">LAYER</span>
        <div class="chip-row">
          ${LAYERS.map((l) => `<button class="chip ${t.layer === l.id ? 'on' : ''}" data-layer="${l.id}">${l.name}</button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">COLOR</span>
        <div class="color-row">
          ${Object.keys(COLORS).map((c) => `<button class="color-pick ${t.color === c ? 'on' : ''}" data-color="${c}" style="background:${COLORS[c]}" aria-label="${c}"></button>`).join('')}
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
    inspect.querySelectorAll('[data-layer]').forEach((b) =>
      b.addEventListener('click', () => {
        t.layer = b.dataset.layer;
        inspect.querySelectorAll('[data-layer]').forEach((x) => x.classList.toggle('on', x === b));
        saveTasks();
        if (!isVisible(t)) { closePanels(); renderMarks(); }
      }));
    inspect.querySelectorAll('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        t.color = b.dataset.color;
        inspect.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
        rerender();
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
      if (rest.length < 2) rest.forEach((x) => { x.cluster = null; });
      saveTasks();
      buildRings();
      closePanels();
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
    const ul = $('#layerList');
    ul.textContent = '';
    const rows = [...LAYERS.map((l) => ({ ...l, done: false })), { id: 'done', name: 'Done', color: '#f5f1e6', done: true }];
    for (const L of rows) {
      const li = document.createElement('li');
      li.className = 'layer-row';
      const sw = document.createElement('span');
      sw.className = 'layer-swatch';
      sw.innerHTML = `<i style="background:${L.color};${L.id === 'done' ? 'outline:1px solid #555' : ''}"></i>`;
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = L.name;
      const count = document.createElement('span');
      count.className = 'layer-count';
      const n = L.id === 'done'
        ? tasks.filter((t) => t.done).length
        : tasks.filter((t) => t.layer === L.id && !t.done).length;
      count.textContent = n || '';
      const eye = document.createElement('button');
      eye.className = 'eye-btn' + (vis[L.id] ? '' : ' off');
      eye.setAttribute('aria-label', `${vis[L.id] ? 'Hide' : 'Show'} ${L.name}`);
      eye.innerHTML = vis[L.id] ? EYE_OPEN : EYE_OFF;
      eye.addEventListener('click', () => {
        vis[L.id] = !vis[L.id];
        saveVis();
        eye.classList.toggle('off', !vis[L.id]);
        eye.innerHTML = vis[L.id] ? EYE_OPEN : EYE_OFF;
        renderMarks();
      });
      li.append(sw, name, count, eye);
      ul.appendChild(li);
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
    const W = stage.clientWidth, H = stage.clientHeight;
    const S = 2;
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext('2d');
    ctx.scale(S, S);
    // paper (cover)
    const pr = Math.max(W / paperCv.width, H / paperCv.height);
    ctx.drawImage(paperCv, (W - paperCv.width * pr) / 2, (H - paperCv.height * pr) / 2, paperCv.width * pr, paperCv.height * pr);
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
      ctx.save();
      if (t.done) ctx.globalAlpha = 0.55;
      ctx.drawImage(mcv, t.x * W - w / 2, t.y * H - h / 2, w, h);
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
    saveTasks();
    renderMarks();
    closePanels();
    showToast(`${ghosts.length} ${ghosts.length === 1 ? 'ghost' : 'ghosts'} archived. The day is part of the story.`);
  }

  $('#saveImage').addEventListener('click', exportImage);
  $('#archiveDay').addEventListener('click', archiveDay);

  // ---------- panels ----------

  function openPanel(panel) {
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

  // ---------- samples ----------

  function sampleTasks() {
    const mk = (title, color, layer, priority, x, y, extra = {}) => ({
      id: crypto.randomUUID(),
      title, color, layer, priority, x, y,
      seed: Math.floor(Math.random() * 2 ** 31),
      due: null, notes: '', done: false, doneAt: null, cluster: null,
      strokes: null, strokesW: 0, strokesH: 0,
      createdAt: Date.now() - 3 * 864e5,
      ...extra,
    });
    const crew = crypto.randomUUID();
    return [
      mk('Write lyrics', 'black', 'today', 'king', 0.24, 0.2),
      mk('Call Samo', 'blue', 'today', 'queen', 0.68, 0.26, { cluster: crew }),
      mk('Studio session', 'black', 'today', 'queen', 0.6, 0.4, { due: localISO(0), cluster: crew }),
      mk('Buy paint', 'red', 'today', 'bishop', 0.3, 0.47, { due: localISO(-1) }),
      mk('Idea: mural', 'yellow', 'ideas', 'knight', 0.66, 0.58),
      mk('Read Jean-Michel bio', 'black', 'personal', 'pawn', 0.32, 0.68),
      mk('Invoice the gallery $$$', 'blue', 'work', 'bishop', 0.7, 0.74, { due: localISO(2) }),
      mk('Stretch canvases', 'black', 'today', 'knight', 0.28, 0.82, { done: true, doneAt: Date.now(), slashSeed: 4242 }),
    ];
  }

  // ---------- boot ----------

  function dayDateText() {
    const d = new Date();
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS.tasks);
      if (raw) { tasks = JSON.parse(raw); return; }
    } catch { /* fall through */ }
    tasks = sampleTasks();
    saveTasks();
  }

  load();
  paintPaper();
  sizeScratch();
  updatePens();
  $('#dayDate').textContent = dayDateText();
  window.addEventListener('resize', () => { sizeScratch(); buildRings(); });

  document.fonts.load('20px "Permanent Marker"').then(() => document.fonts.ready).then(() => {
    renderMarks();
    pulse();
  });
})();
