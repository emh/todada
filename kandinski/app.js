/* Kandinski / Todo — bring harmony to your day. */
(() => {
  'use strict';

  // ---------- constants ----------

  const LS = {
    tasks: 'kand.tasks',
    vis: 'kand.vis',
    tone: 'kand.tone',
    color: 'kand.color',
  };

  const COLORS = {
    purple: '#7b5ea7',
    blue: '#3457a4',
    yellow: '#d9a916',
    red: '#c9401f',
    green: '#5a8a5a',
    gray: '#8f8a80',
  };
  const COLOR_MEANING = {
    purple: 'creative', blue: 'work', yellow: 'personal',
    red: 'urgent', green: 'health', gray: 'someday',
  };
  const INK = '#1d2b50';

  const SHAPES = ['point', 'circle', 'square', 'triangle', 'line', 'curve', 'dots'];
  const SHAPE_META = {
    point: 'quick action',
    circle: 'open-ended',
    square: 'focused',
    triangle: 'decision',
    line: 'routine',
    curve: 'flow',
    dots: 'exploratory',
  };

  const LAYERS = [
    { id: 'today', name: 'Today', color: COLORS.purple },
    { id: 'work', name: 'Work', color: COLORS.blue },
    { id: 'personal', name: 'Personal', color: COLORS.yellow },
    { id: 'health', name: 'Health', color: COLORS.green },
    { id: 'someday', name: 'Someday', color: COLORS.gray },
  ];

  const TONES = [
    { id: 'calm', name: 'Calm & Clear', wash: ['#b9cbd8', '#d9d0b8', '#c9d5c5'], grid: false },
    { id: 'structured', name: 'Structured', wash: ['#a9b4c8', '#c8c2b0', '#b8b8c8'], grid: true },
    { id: 'creative', name: 'Creative Flow', wash: ['#9b7fc0', '#5470b8', '#d9b34a'], grid: false },
    { id: 'deep', name: 'Deep Focus', wash: ['#31427a', '#5a6a9a', '#8a97b8'], grid: false },
    { id: 'high', name: 'High Energy', wash: ['#d05a3a', '#e0b030', '#8a4fb0'], grid: false },
    { id: 'restorative', name: 'Restorative', wash: ['#6a9a6a', '#b0c8a0', '#d0c8a8'], grid: false },
  ];

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // ---------- state ----------

  let tasks = [];
  let vis = { today: true, work: true, personal: true, health: true, someday: true, completed: true };
  try { vis = { ...vis, ...JSON.parse(localStorage.getItem(LS.vis) || '{}') }; } catch { /* defaults */ }
  let toneId = localStorage.getItem(LS.tone) || 'calm';
  let lastColor = localStorage.getItem(LS.color) || 'blue';
  let mode = 'normal'; // 'normal' | 'lasso'
  let focusOn = false;
  let pendingCreate = null; // gesture captured, awaiting name & intent
  let lassoPts = null;
  const markEls = new Map();
  const ringEls = new Map();
  const toastShown = new Set();

  // ---------- dom ----------

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const marksEl = $('#marks');
  const ringsEl = $('#rings');
  const scratch = $('#scratch');
  const sctx = scratch.getContext('2d');
  const hintEl = $('#hint');
  const backdrop = $('#backdrop');
  const nameSheet = $('#nameSheet');
  const nameInput = $('#nameInput');
  const inspect = $('#inspect');
  const layersSheet = $('#layersSheet');
  const viewSheet = $('#viewSheet');
  const balanceVeil = $('#balanceVeil');
  const toastEl = $('#toast');
  const lassoBtn = $('#lassoBtn');
  const lassoHint = $('#lassoHint');

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
  const tone = () => TONES.find((t) => t.id === toneId) || TONES[0];

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => clamp(Math.round(v * (1 + f)), 0, 255);
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  function localISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtDue(iso) {
    if (!iso) return null;
    if (iso === localISO(0)) return 'Today';
    if (iso === localISO(1)) return 'Tomorrow';
    if (iso === localISO(-1)) return 'Yesterday';
    const [, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
  }
  const saveTasks = () => localStorage.setItem(LS.tasks, JSON.stringify(tasks));
  const saveVis = () => localStorage.setItem(LS.vis, JSON.stringify(vis));

  // ---------- background ----------

  function paintBackground() {
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 1400;
    const ctx = cv.getContext('2d');
    const rnd = mulberry32(1911 + toneId.length * 131);
    ctx.fillStyle = '#f3ecdd';
    ctx.fillRect(0, 0, 800, 1400);

    // soft watercolor washes in the tone palette (stacked translucent discs)
    const spots = [
      [80, 120], [720, 240], [90, 1100], [700, 1250], [400, 60], [200, 700],
    ];
    tone().wash.forEach((col, i) => {
      for (let k = 0; k < 2; k++) {
        const [bx, by] = spots[(i * 2 + k) % spots.length];
        const x = bx + (rnd() - 0.5) * 120, y = by + (rnd() - 0.5) * 160;
        const R = 130 + rnd() * 150;
        for (let ring = 6; ring >= 1; ring--) {
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.028;
          ctx.beginPath();
          ctx.ellipse(x, y, (R * ring) / 6, (R * 0.8 * ring) / 6, rnd() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    ctx.globalAlpha = 1;

    // faint structural grid for the structured tone
    if (tone().grid) {
      ctx.strokeStyle = 'rgba(29,43,80,0.05)';
      ctx.lineWidth = 1;
      for (let x = 100; x < 800; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1400); ctx.stroke(); }
      for (let y = 100; y < 1400; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke(); }
    }

    // long thin ink lines crossing the field
    ctx.strokeStyle = 'rgba(29,43,80,0.09)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x0 = rnd() * 800, y0 = rnd() * 1400;
      const a = rnd() * Math.PI;
      const L = 300 + rnd() * 500;
      ctx.lineWidth = 0.8 + rnd() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 - Math.cos(a) * L / 2, y0 - Math.sin(a) * L / 2);
      ctx.lineTo(x0 + Math.cos(a) * L / 2, y0 + Math.sin(a) * L / 2);
      ctx.stroke();
    }
    // a faint circle outline and a crosshatch cluster
    ctx.strokeStyle = 'rgba(29,43,80,0.07)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(rnd() * 700 + 50, rnd() * 1200 + 100, 60 + rnd() * 70, 0, Math.PI * 2);
    ctx.stroke();
    const hx = rnd() * 600 + 100, hy = rnd() * 1100 + 150;
    for (let i = 0; i < 7; i++) {
      const a = (i % 2 ? 0.6 : 2.2) + (rnd() - 0.5) * 0.25;
      ctx.beginPath();
      ctx.moveTo(hx + (rnd() - 0.5) * 90 - Math.cos(a) * 35, hy + (rnd() - 0.5) * 60 - Math.sin(a) * 35);
      ctx.lineTo(hx + (rnd() - 0.5) * 90 + Math.cos(a) * 35, hy + (rnd() - 0.5) * 60 + Math.sin(a) * 35);
      ctx.stroke();
    }
    stage.style.backgroundImage = `url(${cv.toDataURL('image/jpeg', 0.82)})`;
  }

  // ---------- shape rendering (SVG) ----------

  function shapeSVG(t, forPicker = false) {
    const size = forPicker ? 22 : t.size;
    const pad = forPicker ? 3 : 16;
    const W = size + pad * 2;
    const c = W / 2;
    const col = COLORS[t.color] || COLORS.blue;
    const dark = shade(col, -0.3);
    const rnd = mulberry32(t.seed || 7);
    const a = ((t.angle || 0) * 180) / Math.PI;
    let body = '';

    if (t.shape === 'point') {
      body = `<circle cx="${c}" cy="${c}" r="${size / 2}" fill="${col}"/>
        <circle cx="${c + size * 0.15}" cy="${c - size * 0.15}" r="${size / 2 + 3}" fill="none" stroke="${dark}" stroke-width="1" opacity="0.55"/>`;
    } else if (t.shape === 'circle') {
      body = `<circle cx="${c}" cy="${c}" r="${size / 2}" fill="${col}" fill-opacity="0.92"/>
        <circle cx="${c + 3}" cy="${c - 3}" r="${size / 2 + 4}" fill="none" stroke="${dark}" stroke-width="1.3" opacity="0.5"/>
        <circle cx="${c - size * 0.16}" cy="${c + size * 0.14}" r="${size * 0.16}" fill="${dark}" opacity="0.55"/>`;
    } else if (t.shape === 'square') {
      const h = size / 2;
      body = `<g transform="rotate(${a * 0.4 + (rnd() - 0.5) * 10} ${c} ${c})">
        <rect x="${c - h}" y="${c - h}" width="${size}" height="${size}" fill="${col}" fill-opacity="0.94"/>
        <rect x="${c - h - 4}" y="${c - h + 4}" width="${size}" height="${size}" fill="none" stroke="${dark}" stroke-width="1.2" opacity="0.4"/>
      </g>`;
    } else if (t.shape === 'triangle') {
      const r = size / 2;
      const pts = [0, 1, 2].map((i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3 + (t.angle || 0) * 0.3;
        return `${c + Math.cos(ang) * r},${c + Math.sin(ang) * r}`;
      }).join(' ');
      body = `<polygon points="${pts}" fill="${col}" fill-opacity="0.94"/>
        <line x1="${c - r - 6}" y1="${c + r * 0.62}" x2="${c + r + 8}" y2="${c + r * 0.52}" stroke="${dark}" stroke-width="1.2" opacity="0.5"/>`;
    } else if (t.shape === 'line') {
      const ang = t.angle || -0.3;
      const dx = Math.cos(ang) * size / 2, dy = Math.sin(ang) * size / 2;
      const ox = Math.cos(ang + Math.PI / 2) * 5, oy = Math.sin(ang + Math.PI / 2) * 5;
      body = `<line x1="${c - dx}" y1="${c - dy}" x2="${c + dx}" y2="${c + dy}" stroke="${col}" stroke-width="${Math.max(4, size / 12)}" stroke-linecap="round"/>
        <line x1="${c - dx * 0.8 + ox}" y1="${c - dy * 0.8 + oy}" x2="${c + dx * 0.8 + ox}" y2="${c + dy * 0.8 + oy}" stroke="${dark}" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>`;
    } else if (t.shape === 'curve') {
      const pts = (t.path && t.path.length > 2 ? t.path : [[0, 0.7], [0.3, 0.1], [0.7, 0.9], [1, 0.3]])
        .map(([px, py]) => [pad + px * size, pad + py * size]);
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
      }
      const last = pts[pts.length - 1];
      d += ` L ${last[0]} ${last[1]}`;
      body = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${Math.max(3.5, size / 16)}" stroke-linecap="round"/>
        <circle cx="${last[0]}" cy="${last[1]}" r="${Math.max(3, size / 18)}" fill="${dark}"/>`;
    } else { // dots
      const n = 6 + Math.floor(rnd() * 4);
      let dots = '';
      for (let i = 0; i < n; i++) {
        dots += `<circle cx="${pad + rnd() * size}" cy="${pad + rnd() * size}" r="${2 + rnd() * 2.5}" fill="${i % 3 ? col : dark}"/>`;
      }
      body = dots;
    }

    const halo = !forPicker && t.priority === 'high' && !t.done
      ? `<circle cx="${c}" cy="${c}" r="${size / 2 + 11}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="2.5 4" opacity="0.5"/>`
      : '';
    return `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg">${halo}${body}</svg>`;
  }

  // ---------- marks on stage ----------

  const isVisible = (t) => vis[t.layer] && (!t.done || vis.completed);
  const pullsFocus = (t) => !t.done && (t.priority === 'high' || (t.due && t.due <= localISO(1)));

  function positionMark(el, t) {
    el.style.left = t.x * 100 + '%';
    el.style.top = t.y * 100 + '%';
  }

  function markClasses(el, t) {
    el.classList.toggle('done', t.done);
    el.classList.toggle('pulls', pullsFocus(t));
  }

  function buildMark(t, fresh = false) {
    const el = document.createElement('div');
    el.className = 'mark' + (fresh ? ' new' : '');
    el.dataset.id = t.id;
    el.innerHTML = shapeSVG(t);
    markClasses(el, t);
    positionMark(el, t);
    marksEl.appendChild(el);
    markEls.set(t.id, el);
    if (fresh) setTimeout(() => el.classList.remove('new'), 500);
    return el;
  }

  function redrawMark(t) {
    const el = markEls.get(t.id);
    if (!el) return;
    el.innerHTML = shapeSVG(t);
    markClasses(el, t);
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
      x: clamp((clientX - r.left) / r.width, 0.07, 0.93),
      y: clamp((clientY - r.top) / r.height, 0.12, 0.86),
    };
  }

  // ---------- groups ----------

  function groupMembers(gid) {
    return tasks.filter((t) => t.group === gid && isVisible(t));
  }

  function buildRings() {
    ringsEl.textContent = '';
    ringEls.clear();
    const gids = [...new Set(tasks.map((t) => t.group).filter(Boolean))];
    const sw = stage.clientWidth, sh = stage.clientHeight;
    for (const gid of gids) {
      const members = groupMembers(gid);
      if (members.length < 2) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const centers = [];
      for (const m of members) {
        const el = markEls.get(m.id);
        if (!el) continue;
        const w = el.offsetWidth, h = el.offsetHeight;
        const cx = m.x * sw, cy = m.y * sh;
        centers.push([cx, cy]);
        x0 = Math.min(x0, cx - w / 2); y0 = Math.min(y0, cy - h / 2);
        x1 = Math.max(x1, cx + w / 2); y1 = Math.max(y1, cy + h / 2);
      }
      const pad = 20;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const w = x1 - x0, h = y1 - y0;
      const el = document.createElement('div');
      el.className = 'ring';
      el.style.left = x0 + 'px';
      el.style.top = y0 + 'px';
      // connecting lines between member centers + a dashed ellipse around them
      const lines = centers.slice(1).map((p, i) =>
        `<line x1="${centers[i][0] - x0}" y1="${centers[i][1] - y0}" x2="${p[0] - x0}" y2="${p[1] - y0}" stroke="${INK}" stroke-width="1" opacity="0.3"/>`).join('');
      el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 2}" ry="${h / 2 - 2}" fill="none"
          stroke="${INK}" stroke-width="1.2" stroke-dasharray="4 5" opacity="0.45"/>${lines}</svg>`;
      ringsEl.appendChild(el);
      ringEls.set(gid, { el, box: { x0, y0, x1, y1 } });
    }
  }

  function dissolveGroup(gid) {
    for (const t of tasks) if (t.group === gid) t.group = null;
    saveTasks();
    buildRings();
  }

  // ---------- scratch (gesture ink) ----------

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

  // swallow the browser-generated click that trails a pointerup which opened UI
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
      sub: null, // 'drag' | 'flick' (marks) — empty canvas collects trace
      path: 0,
      trace: [pt],
      crew: task && task.group ? groupMembers(task.group) : null,
      ringInfo: task && task.group ? ringEls.get(task.group) : null,
    };
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });

  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    const pt = [e.clientX - r.left, e.clientY - r.top];

    if (mode === 'lasso' && lassoPts) {
      scratchSegment(lassoPts[lassoPts.length - 1], pt, 'rgba(29,43,80,0.65)', 2.4);
      lassoPts.push(pt);
      return;
    }
    if (!gest || e.pointerId !== gest.id) return;

    const dx = e.clientX - gest.lastX, dy = e.clientY - gest.lastY;
    gest.path += Math.hypot(dx, dy);
    const dist = Math.hypot(e.clientX - gest.startX, e.clientY - gest.startY);

    if (gest.task) {
      if (!gest.sub && dist > 12) {
        gest.sub = performance.now() - gest.t0 < 110 && !gest.task.done ? 'flick' : 'drag';
        if (gest.sub === 'drag') gest.markEl.classList.add('dragging');
      }
      if (gest.sub === 'drag') {
        const fdx = dx / r.width, fdy = dy / r.height;
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
      }
    } else {
      // empty canvas: live ink trace becomes the shape
      const col = COLORS[lastColor] || INK;
      scratchSegment(gest.trace[gest.trace.length - 1], pt, col, 3.4);
      gest.trace.push(pt);
    }
    gest.lastX = e.clientX; gest.lastY = e.clientY;
  });

  function endGesture(e, cancelled) {
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

    const dist = Math.hypot(g.lastX - g.startX, g.lastY - g.startY);

    if (g.task) {
      if (g.sub === 'drag') {
        saveTasks();
        buildRings();
      } else if (g.sub === 'flick') {
        const angle = Math.atan2(g.lastY - g.startY, g.lastX - g.startX);
        resolveTask(g.task, angle);
        swallowNextClick();
      } else {
        openInspect(g.task);
        swallowNextClick();
      }
      return;
    }

    // empty canvas: tap = point, drag = shape from the motion
    if (dist <= 12 && g.path < 16) {
      startCreate({
        x: g.startX, y: g.startY,
        shape: 'point', size: 15, angle: 0, path: null,
      });
      swallowNextClick();
    } else if (g.path > 26) {
      startCreate(inferShape(g.trace));
      swallowNextClick();
    } else {
      clearScratch();
    }
  }

  stage.addEventListener('pointerup', (e) => endGesture(e, false));
  stage.addEventListener('pointercancel', (e) => endGesture(e, true));

  function inferShape(trace) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, L = 0;
    for (let i = 0; i < trace.length; i++) {
      const [x, y] = trace[i];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      if (i) L += Math.hypot(x - trace[i - 1][0], y - trace[i - 1][1]);
    }
    const w = Math.max(x1 - x0, 8), h = Math.max(y1 - y0, 8);
    const D = Math.hypot(trace[trace.length - 1][0] - trace[0][0], trace[trace.length - 1][1] - trace[0][1]);
    const straightness = D / L;
    let shape = 'curve';
    if (D < L * 0.35 && L > 90) shape = 'circle';
    else if (straightness > 0.9) shape = 'line';
    const angle = Math.atan2(trace[trace.length - 1][1] - trace[0][1], trace[trace.length - 1][0] - trace[0][0]);
    // keep the actual motion for curves
    const step = Math.max(1, Math.floor(trace.length / 12));
    const path = trace.filter((_, i) => i % step === 0 || i === trace.length - 1)
      .map(([x, y]) => [
        Math.round(((x - x0) / w) * 100) / 100,
        Math.round(((y - y0) / h) * 100) / 100,
      ]);
    const r = stage.getBoundingClientRect();
    return {
      x: x0 + w / 2 + r.left,
      y: y0 + h / 2 + r.top,
      shape,
      size: Math.round(clamp(Math.hypot(w, h) * 0.72, 30, 130)),
      angle: Math.round(angle * 100) / 100,
      path,
    };
  }

  // ---------- create: name & intent ----------

  const SHAPE_ICONS = {}; // built once from shapeSVG with a probe task
  function shapeIcon(shape) {
    if (!SHAPE_ICONS[shape]) {
      SHAPE_ICONS[shape] = shapeSVG({ shape, color: 'ink', size: 22, seed: 5, angle: -0.4, path: null }, true)
        .replaceAll(COLORS.blue, 'currentColor').replaceAll(shade(COLORS.blue, -0.3), 'currentColor');
    }
    return SHAPE_ICONS[shape];
  }

  function startCreate(geo) {
    pendingCreate = { ...geo, color: lastColor };
    // shape picker
    const sr = $('#shapeRow');
    sr.innerHTML = SHAPES.map((s) =>
      `<button class="shape-pick ${s === geo.shape ? 'on' : ''}" data-shape="${s}" title="${SHAPE_META[s]}" aria-label="${s} — ${SHAPE_META[s]}">${shapeIcon(s)}</button>`).join('');
    sr.querySelectorAll('[data-shape]').forEach((b) =>
      b.addEventListener('click', () => {
        pendingCreate.shape = b.dataset.shape;
        sr.querySelectorAll('[data-shape]').forEach((x) => x.classList.toggle('on', x === b));
      }));
    // color picker
    const cr = $('#colorRow');
    cr.innerHTML = Object.keys(COLORS).map((c) =>
      `<button class="color-pick ${c === pendingCreate.color ? 'on' : ''}" data-color="${c}" style="background:${COLORS[c]}" title="${COLOR_MEANING[c]}" aria-label="${c} — ${COLOR_MEANING[c]}"></button>`).join('');
    cr.querySelectorAll('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        pendingCreate.color = b.dataset.color;
        cr.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      }));
    nameInput.value = '';
    backdrop.hidden = false;
    nameSheet.hidden = false;
    setTimeout(() => nameInput.focus(), 40);
  }

  function commitCreate() {
    if (!pendingCreate) return;
    const title = nameInput.value.trim();
    if (!title) { cancelCreate(); return; }
    const f = stageFrac(pendingCreate.x, pendingCreate.y);
    const t = {
      id: crypto.randomUUID(),
      title,
      shape: pendingCreate.shape,
      color: pendingCreate.color,
      layer: 'today',
      x: f.x, y: f.y,
      size: pendingCreate.size,
      angle: pendingCreate.angle,
      path: pendingCreate.shape === 'curve' ? pendingCreate.path : null,
      seed: Math.floor(Math.random() * 2 ** 31),
      due: null,
      priority: 'med',
      subs: [],
      done: false,
      doneAt: null,
      group: null,
      createdAt: Date.now(),
    };
    lastColor = pendingCreate.color;
    localStorage.setItem(LS.color, lastColor);
    pendingCreate = null;
    tasks.push(t);
    saveTasks();
    closeSheets();
    clearScratch();
    buildMark(t, true);
    updateHint();
    pulse();
  }

  function cancelCreate() {
    pendingCreate = null;
    closeSheets();
    clearScratch();
  }

  $('#nameDone').addEventListener('click', commitCreate);
  $('#nameCancel').addEventListener('click', cancelCreate);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
    if (e.key === 'Escape') cancelCreate();
  });

  $('#addBtn').addEventListener('click', () => {
    // find a quiet spot for a new element
    const r = stage.getBoundingClientRect();
    const rnd = Math.random;
    let best = null, bestScore = -1;
    for (let i = 0; i < 14; i++) {
      const fx = 0.15 + rnd() * 0.7, fy = 0.18 + rnd() * 0.6;
      const near = tasks.filter(isVisible)
        .reduce((m, t) => Math.min(m, Math.hypot(t.x - fx, t.y - fy)), 1);
      if (near > bestScore) { bestScore = near; best = [fx, fy]; }
    }
    startCreate({
      x: r.left + best[0] * r.width,
      y: r.top + best[1] * r.height,
      shape: 'circle', size: 46, angle: 0, path: null,
    });
  });

  // ---------- resolve (complete) ----------

  function resolveTask(t, angle) {
    t.done = true;
    t.doneAt = Date.now();
    if (angle != null) {
      t.x = clamp(t.x + Math.cos(angle) * 0.11, 0.05, 0.95);
      t.y = clamp(t.y + Math.sin(angle) * 0.11, 0.08, 0.9);
    }
    saveTasks();
    const el = markEls.get(t.id);
    if (el) {
      el.classList.add('resolving');
      positionMark(el, t);
      markClasses(el, t);
      setTimeout(() => {
        el.classList.remove('resolving');
        if (!isVisible(t)) renderMarks(); else buildRings();
      }, 580);
    }
    showToast('Resolved. It fades into the background.', 'Undo', () => restoreTask(t));
    pulse();
  }

  function restoreTask(t) {
    t.done = false;
    t.doneAt = null;
    saveTasks();
    if (markEls.has(t.id)) { redrawMark(t); markClasses(markEls.get(t.id), t); }
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

  // ---------- lasso ----------

  function toggleLasso() {
    if (mode === 'lasso') { exitLasso(); return; }
    mode = 'lasso';
    sizeScratch();
    clearScratch();
    lassoBtn.classList.add('active');
    lassoHint.hidden = false;
    closeSheets();
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
      showToast('Circle at least two elements to relate them.');
      return;
    }
    const gid = crypto.randomUUID();
    const oldGids = new Set(selected.map((t) => t.group).filter(Boolean));
    for (const t of selected) t.group = gid;
    for (const old of oldGids) {
      const rest = tasks.filter((t) => t.group === old);
      if (rest.length < 2) rest.forEach((t) => { t.group = null; });
    }
    saveTasks();
    buildRings();
    showToast(`${selected.length} elements now move as one.`);
  }

  // ---------- inspect ----------

  const EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><path d="M4 20 20 4"/></svg>';

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openInspect(t, refocusSub = false) {
    closeSheets();
    const dueTxt = fmtDue(t.due);
    const overdue = t.due && t.due < localISO(0) && !t.done;
    inspect.innerHTML = `
      <div class="insp-head">
        <span class="insp-dot" style="background:${COLORS[t.color]}"></span>
        <div class="insp-title" id="inspTitle">${escapeHtml(t.title)}</div>
        <button class="sheet-x" data-close aria-label="Close">✕</button>
      </div>
      <p class="insp-meta">${SHAPE_META[t.shape]} · ${LAYERS.find((l) => l.id === t.layer)?.name || t.layer}${t.done ? ' · resolved' : ''}</p>
      <ul class="subtasks" id="subList">
        ${t.subs.map((s, i) => `
          <li class="subtask ${s.done ? 'done' : ''}">
            <input type="checkbox" id="sub${i}" data-sub="${i}" ${s.done ? 'checked' : ''} />
            <label for="sub${i}">${escapeHtml(s.t)}</label>
            <button class="sub-x" data-subx="${i}" aria-label="Remove">✕</button>
          </li>`).join('')}
      </ul>
      <input class="sub-add" id="subAdd" type="text" placeholder="+ add a step" maxlength="60" />
      <div class="insp-row">
        <span class="insp-label">Due</span>
        <button class="insp-due" id="inspDue">${dueTxt ? (overdue ? `<span class="overdue">${dueTxt} — slipped</span>` : dueTxt) : 'No date'}</button>
        <input type="date" class="insp-date" id="inspDate" value="${t.due || ''}" />
      </div>
      <div class="insp-row">
        <span class="insp-label">Weight</span>
        <div class="chip-row">
          ${['low', 'med', 'high'].map((p) => `<button class="chip ${t.priority === p ? 'on' : ''}" data-pri="${p}">${p === 'med' ? 'Medium' : p[0].toUpperCase() + p.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">Layer</span>
        <div class="chip-row">
          ${LAYERS.map((l) => `<button class="chip ${t.layer === l.id ? 'on' : ''}" data-layer="${l.id}">${l.name}</button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">Color</span>
        <div class="mini-colors">
          ${Object.keys(COLORS).map((c) => `<button class="color-pick ${t.color === c ? 'on' : ''}" data-color="${c}" style="background:${COLORS[c]}" aria-label="${c}"></button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">Shape</span>
        <div class="mini-shapes">
          ${SHAPES.map((s) => `<button class="shape-pick ${t.shape === s ? 'on' : ''}" data-shape="${s}" aria-label="${s}">${shapeIcon(s)}</button>`).join('')}
        </div>
      </div>
      <div class="insp-actions">
        <button class="solid-btn" id="inspDone">${t.done ? 'Return to the canvas' : 'Resolve'}</button>
        ${t.group ? '<button class="ghost-btn" id="inspUngroup">Unrelate</button>' : ''}
        <button class="danger" id="inspDelete">Erase</button>
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
        holder.textContent = t.title;
        saveTasks();
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } });
      input.addEventListener('blur', commit);
    });

    inspect.querySelectorAll('[data-sub]').forEach((cb) =>
      cb.addEventListener('change', () => {
        t.subs[+cb.dataset.sub].done = cb.checked;
        cb.closest('.subtask').classList.toggle('done', cb.checked);
        saveTasks();
      }));
    inspect.querySelectorAll('[data-subx]').forEach((b) =>
      b.addEventListener('click', () => {
        t.subs.splice(+b.dataset.subx, 1);
        saveTasks();
        openInspect(t);
      }));
    $('#subAdd').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = $('#subAdd').value.trim();
        if (!v) return;
        t.subs.push({ t: v, done: false });
        saveTasks();
        openInspect(t, true);
      }
    });
    if (refocusSub) setTimeout(() => $('#subAdd').focus(), 30);

    const dateInput = $('#inspDate');
    $('#inspDue').addEventListener('click', () => {
      if (dateInput.showPicker) { try { dateInput.showPicker(); } catch { dateInput.click(); } }
      else dateInput.click();
    });
    dateInput.addEventListener('change', () => {
      t.due = dateInput.value || null;
      saveTasks();
      $('#inspDue').textContent = fmtDue(t.due) || 'No date';
      markClasses(markEls.get(t.id), t);
    });

    inspect.querySelectorAll('[data-pri]').forEach((b) =>
      b.addEventListener('click', () => {
        t.priority = b.dataset.pri;
        inspect.querySelectorAll('[data-pri]').forEach((x) => x.classList.toggle('on', x === b));
        rerender();
      }));
    inspect.querySelectorAll('[data-layer]').forEach((b) =>
      b.addEventListener('click', () => {
        t.layer = b.dataset.layer;
        inspect.querySelectorAll('[data-layer]').forEach((x) => x.classList.toggle('on', x === b));
        saveTasks();
        if (!isVisible(t)) { closeSheets(); renderMarks(); }
      }));
    inspect.querySelectorAll('.mini-colors [data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        t.color = b.dataset.color;
        inspect.querySelectorAll('.mini-colors [data-color]').forEach((x) => x.classList.toggle('on', x === b));
        $('.insp-dot').style.background = COLORS[t.color];
        rerender();
      }));
    inspect.querySelectorAll('.mini-shapes [data-shape]').forEach((b) =>
      b.addEventListener('click', () => {
        t.shape = b.dataset.shape;
        inspect.querySelectorAll('.mini-shapes [data-shape]').forEach((x) => x.classList.toggle('on', x === b));
        rerender();
      }));

    $('#inspDone').addEventListener('click', () => {
      closeSheets();
      if (t.done) restoreTask(t);
      else resolveTask(t);
    });
    const ug = $('#inspUngroup');
    if (ug) ug.addEventListener('click', () => {
      const gid = t.group;
      t.group = null;
      const rest = tasks.filter((x) => x.group === gid);
      if (rest.length < 2) rest.forEach((x) => { x.group = null; });
      saveTasks();
      buildRings();
      closeSheets();
    });
    $('#inspDelete').addEventListener('click', () => {
      closeSheets();
      discardTask(t);
      showToast('Erased from the composition.');
    });
    inspect.querySelector('[data-close]').addEventListener('click', closeSheets);
  }

  // ---------- layers ----------

  function buildLayersSheet() {
    const ul = $('#layerList');
    ul.textContent = '';
    const rows = [...LAYERS, { id: 'completed', name: 'Completed', color: '#c8c2b2' }];
    for (const L of rows) {
      const li = document.createElement('li');
      li.className = 'layer-row';
      const dot = document.createElement('span');
      dot.className = 'layer-dot' + (L.id === 'completed' ? ' sq' : '');
      dot.style.background = L.color;
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = L.name;
      const count = document.createElement('span');
      count.className = 'layer-count';
      const n = L.id === 'completed'
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
      li.append(dot, name, count, eye);
      ul.appendChild(li);
    }
  }

  // ---------- balance ----------

  function composition() {
    const open = tasks.filter((t) => isVisible(t) && !t.done);
    if (!open.length) return null;
    let M = 0, mx = 0, my = 0;
    for (const t of open) {
      const m = Math.pow(t.size, 1.6);
      M += m; mx += m * t.x; my += m * t.y;
    }
    const cx = mx / M, cy = my / M;
    let disp = 0;
    for (const t of open) {
      const m = Math.pow(t.size, 1.6);
      disp += m * (Math.pow(t.x - cx, 2) + Math.pow(t.y - cy, 2));
    }
    disp = Math.sqrt(disp / M);
    return { cx, cy, disp, n: open.length, offset: Math.hypot(cx - 0.5, cy - 0.53) };
  }

  function verdictText(c) {
    if (!c) return 'An empty canvas. Begin anywhere.';
    if (c.offset > 0.15) {
      const dirX = c.cx < 0.5 ? 'left' : 'right';
      const dirY = c.cy < 0.53 ? 'top' : 'bottom';
      const dir = Math.abs(c.cx - 0.5) > Math.abs(c.cy - 0.53) ? dirX : dirY;
      return `Off balance. Too much pressure on the ${dir}.`;
    }
    if (c.disp > 0.33) return 'Scattered. The composition is losing focus.';
    if (c.offset < 0.06) return 'Balanced. Good flow.';
    return 'Almost balanced. A small shift would settle it.';
  }

  function openBalance() {
    closeSheets();
    const c = composition();
    const w = stage.clientWidth, h = stage.clientHeight;
    const svg = $('#balanceSvg');
    let inner = `
      <line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h}" stroke="${INK}" stroke-width="1" opacity="0.28"/>
      <line x1="0" y1="${h * 0.53}" x2="${w}" y2="${h * 0.53}" stroke="${INK}" stroke-width="1" opacity="0.28"/>
      <circle cx="${w / 2}" cy="${h * 0.53}" r="26" fill="none" stroke="${INK}" stroke-width="1" opacity="0.35"/>`;
    if (c) {
      inner += `
      <line x1="${w / 2}" y1="${h * 0.53}" x2="${c.cx * w}" y2="${c.cy * h}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.55"/>
      <circle cx="${c.cx * w}" cy="${c.cy * h}" r="9" fill="${INK}" opacity="0.75"/>
      <circle cx="${c.cx * w}" cy="${c.cy * h}" r="17" fill="none" stroke="${INK}" stroke-width="1.4" opacity="0.6"/>`;
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = inner;
    $('#balanceVerdict').textContent = verdictText(c);
    $('#harmonize').disabled = !c;
    balanceVeil.hidden = false;
  }

  function harmonize() {
    const c = composition();
    if (!c) return;
    const dx = (0.5 - c.cx) * 0.85;
    const dy = (0.53 - c.cy) * 0.85;
    const pull = c.disp > 0.3 ? 0.16 : 0;
    for (const t of tasks.filter((x) => isVisible(x) && !x.done)) {
      t.x = clamp(t.x + dx + (c.cx - t.x) * pull, 0.08, 0.92);
      t.y = clamp(t.y + dy + (c.cy - t.y) * pull, 0.12, 0.86);
      const el = markEls.get(t.id);
      if (el) { el.classList.add('settling'); positionMark(el, t); }
    }
    saveTasks();
    setTimeout(() => {
      document.querySelectorAll('.mark.settling').forEach((el) => el.classList.remove('settling'));
      buildRings();
      openBalance();
    }, 950);
    ringsEl.textContent = '';
  }

  $('#balanceBtn').addEventListener('click', () => {
    if (!balanceVeil.hidden) { balanceVeil.hidden = true; return; }
    openBalance();
  });
  $('#balanceClose').addEventListener('click', () => { balanceVeil.hidden = true; });
  $('#harmonize').addEventListener('click', harmonize);

  // ---------- focus ----------

  $('#focusBtn').addEventListener('click', () => {
    focusOn = !focusOn;
    stage.classList.toggle('focus', focusOn);
    $('#focusBtn').classList.toggle('active', focusOn);
    if (focusOn) {
      for (const t of tasks.filter(isVisible)) {
        const el = markEls.get(t.id);
        if (el) markClasses(el, t);
      }
      const n = tasks.filter((t) => isVisible(t) && pullsFocus(t)).length;
      showToast(n ? `Focus. ${n} element${n === 1 ? '' : 's'} pull${n === 1 ? 's' : ''} the day.` : 'Focus. Nothing is urgent. Breathe.');
    }
  });

  // ---------- view sheet ----------

  function computeNotices() {
    const open = tasks.filter((t) => !t.done && isVisible(t));
    const out = [];
    const overdue = open.find((t) => t.due && t.due < localISO(0));
    if (overdue) out.push(`The ${overdue.color} ${overdue.shape} slipped past its date.`);
    const tomorrow = open.find((t) => t.due === localISO(1));
    if (tomorrow) out.push(`The ${tomorrow.color} ${tomorrow.shape} is due tomorrow.`);
    const drifting = open.filter((t) => t.x < 0.14 || t.x > 0.86 || t.y < 0.16 || t.y > 0.84);
    if (drifting.length >= 2) out.push(`${drifting.length} tasks are drifting to the edges.`);
    const c = composition();
    if (c && c.n >= 3) {
      if (c.offset < 0.06) out.push('Your composition is balanced.');
      else if (c.offset < 0.11) out.push('Your composition is almost balanced.');
      else out.push(`The weight is pulling ${c.cx < 0.5 ? 'left' : 'right'}.`);
    }
    return out;
  }

  function buildViewSheet() {
    const tg = $('#toneGrid');
    tg.innerHTML = TONES.map((t) => `
      <button class="tone-pick ${t.id === toneId ? 'on' : ''}" data-tone="${t.id}">
        <span class="tone-swatch" style="background:linear-gradient(135deg, ${t.wash[0]}, ${t.wash[1]} 55%, ${t.wash[2]})"></span>
        ${t.name}
      </button>`).join('');
    tg.querySelectorAll('[data-tone]').forEach((b) =>
      b.addEventListener('click', () => {
        toneId = b.dataset.tone;
        localStorage.setItem(LS.tone, toneId);
        paintBackground();
        tg.querySelectorAll('[data-tone]').forEach((x) => x.classList.toggle('on', x === b));
        showToast(`${TONES.find((t) => t.id === toneId).name}. The canvas adapts.`);
      }));

    const ul = $('#notices');
    ul.textContent = '';
    const ns = computeNotices();
    if (!ns.length) {
      ul.innerHTML = '<li class="quiet">All quiet. The composition rests.</li>';
    } else {
      for (const n of ns) {
        const li = document.createElement('li');
        li.innerHTML = '<i></i>';
        li.appendChild(document.createTextNode(n));
        ul.appendChild(li);
      }
    }

    $('#legend').innerHTML = [
      ...Object.entries(COLOR_MEANING).map(([c, m]) =>
        `<span><i style="background:${COLORS[c]};border-radius:50%"></i>${m}</span>`),
      ...SHAPES.map((s) => `<span><i style="color:${INK}">${shapeIcon(s).replace('width="28"', 'width="11"')}</i>${s} — ${SHAPE_META[s]}</span>`),
    ].join('');
  }

  // ---------- sheets ----------

  function openSheet(sheet) {
    closeSheets();
    if (mode === 'lasso') exitLasso();
    balanceVeil.hidden = true;
    if (sheet === layersSheet) buildLayersSheet();
    if (sheet === viewSheet) buildViewSheet();
    backdrop.hidden = false;
    sheet.hidden = false;
  }
  function closeSheets() {
    backdrop.hidden = true;
    nameSheet.hidden = true;
    inspect.hidden = true;
    layersSheet.hidden = true;
    viewSheet.hidden = true;
  }
  $('#layersBtn').addEventListener('click', () => openSheet(layersSheet));
  $('#viewBtn').addEventListener('click', () => openSheet(viewSheet));
  backdrop.addEventListener('click', () => {
    if (pendingCreate) cancelCreate();
    else closeSheets();
  });
  document.querySelectorAll('#layersSheet [data-close], #viewSheet [data-close]').forEach((b) =>
    b.addEventListener('click', closeSheets));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pendingCreate) cancelCreate();
      closeSheets();
      balanceVeil.hidden = true;
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
    const mk = (title, shape, color, layer, x, y, size, extra = {}) => ({
      id: crypto.randomUUID(),
      title, shape, color, layer, x, y, size,
      angle: extra.angle ?? 0,
      path: extra.path ?? null,
      seed: Math.floor(Math.random() * 2 ** 31),
      due: extra.due ?? null,
      priority: extra.priority ?? 'med',
      subs: extra.subs ?? [],
      done: extra.done ?? false,
      doneAt: extra.done ? Date.now() : null,
      group: extra.group ?? null,
      createdAt: Date.now() - 2 * 864e5,
    });
    const g = crypto.randomUUID();
    return [
      mk('Write proposal', 'circle', 'purple', 'work', 0.32, 0.24, 96, {
        priority: 'high', due: localISO(2), group: g,
        subs: [{ t: 'Prepare outline', done: true }, { t: 'Draft intro', done: false }, { t: 'Review with team', done: false }],
      }),
      mk('Quarterly numbers', 'square', 'blue', 'work', 0.68, 0.35, 58, { due: localISO(1), group: g }),
      mk('Pay studio rent', 'triangle', 'red', 'today', 0.72, 0.62, 54, { priority: 'high', due: localISO(0) }),
      mk('Buy groceries', 'point', 'yellow', 'personal', 0.24, 0.55, 16),
      mk('Evening run', 'curve', 'green', 'health', 0.45, 0.72, 74, {
        angle: -0.5, path: [[0, 0.75], [0.22, 0.2], [0.5, 0.75], [0.78, 0.2], [1, 0.55]],
      }),
      mk('Learn piano', 'dots', 'gray', 'someday', 0.82, 0.16, 52),
      mk('Morning pages', 'line', 'purple', 'today', 0.18, 0.36, 66, { angle: -0.35, priority: 'low' }),
      mk('Call the framer', 'circle', 'yellow', 'personal', 0.55, 0.5, 34, { done: true }),
    ];
  }

  // ---------- boot ----------

  function load() {
    try {
      const raw = localStorage.getItem(LS.tasks);
      if (raw) { tasks = JSON.parse(raw); return; }
    } catch { /* fall through */ }
    tasks = sampleTasks();
    saveTasks();
  }

  const d = new Date();
  $('#dayDate').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  load();
  paintBackground();
  sizeScratch();
  renderMarks();
  window.addEventListener('resize', () => { sizeScratch(); buildRings(); });
  pulse();
})();
