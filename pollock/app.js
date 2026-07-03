/* Pollock / Todo — throw tasks onto the canvas. */
(() => {
  'use strict';

  // ---------- constants ----------

  const LS = {
    tasks: 'pollock.tasks',
    layer: 'pollock.layer',
    ink: 'pollock.ink',
    mood: 'pollock.mood',
  };

  const COLORS = {
    black: '#181510',
    red: '#c8371f',
    blue: '#2c4f9e',
    yellow: '#d9a616',
    gray: '#8f8a80',
  };

  const LAYERS = [
    { id: 'today', name: 'Today', dot: '#f2eee2' },
    { id: 'work', name: 'Work', dot: COLORS.blue },
    { id: 'home', name: 'Home', dot: COLORS.red },
    { id: 'ideas', name: 'Ideas', dot: '#8a5fb8' },
    { id: 'waiting', name: 'Waiting', dot: COLORS.yellow },
    { id: 'done', name: 'Done', dot: COLORS.gray },
  ];

  const MOODS = [
    { id: 'controlled', name: 'Controlled', mult: 0.75 },
    { id: 'chaotic', name: 'Chaotic', mult: 1.45 },
    { id: 'heavy', name: 'Heavy', mult: 1.2 },
    { id: 'sparse', name: 'Sparse', mult: 0.6 },
    { id: 'frantic', name: 'Frantic', mult: 1.7 },
    { id: 'clear', name: 'Clear', mult: 0.5 },
  ];

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- state ----------

  let tasks = [];
  let currentLayer = localStorage.getItem(LS.layer) || 'today';
  let ink = localStorage.getItem(LS.ink) || 'black';
  let moodId = localStorage.getItem(LS.mood) || 'controlled';
  let pendingTask = null; // task awaiting a name
  let popoverTask = null;
  const markEls = new Map(); // task id -> element
  const toastShown = new Set();

  // ---------- dom ----------

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const marksEl = $('#marks');
  const hintEl = $('#hint');
  const layerTitle = $('#layerTitle');
  const bubble = $('#bubble');
  const bubbleInput = $('#bubbleInput');
  const popover = $('#popover');
  const backdrop = $('#backdrop');
  const layersSheet = $('#layersSheet');
  const moodSheet = $('#moodSheet');
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
  const mood = () => MOODS.find((m) => m.id === moodId) || MOODS[0];
  const layerOf = (id) => LAYERS.find((l) => l.id === id) || LAYERS[0];

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
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }

  function saveTasks() {
    localStorage.setItem(LS.tasks, JSON.stringify(tasks));
  }

  // ---------- paint: paper ----------

  function paintPaper() {
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 1400;
    const ctx = cv.getContext('2d');
    const rnd = mulberry32(7107);
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, 800, 1400);
    // large faint blotches
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(190,175,145,0.05)' : 'rgba(255,252,240,0.06)';
      ctx.beginPath();
      ctx.ellipse(rnd() * 800, rnd() * 1400, 60 + rnd() * 180, 40 + rnd() * 140, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // fibers
    ctx.strokeStyle = 'rgba(150,135,105,0.10)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 240; i++) {
      const x = rnd() * 800, y = rnd() * 1400, a = rnd() * Math.PI;
      const len = 3 + rnd() * 9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    // speckles — density follows the mood
    const n = Math.round(500 * mood().mult + 300);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rnd() < 0.7 ? 'rgba(120,105,80,0.14)' : 'rgba(90,78,58,0.10)';
      ctx.beginPath();
      ctx.arc(rnd() * 800, rnd() * 1400, 0.4 + rnd() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    stage.style.backgroundImage = `url(${cv.toDataURL('image/jpeg', 0.8)})`;
  }

  // ---------- paint: splatter marks ----------

  function markSize(t) {
    const e = t.energy;
    if (t.kind === 'press') return clamp(140 + e * 110, 120, 250);
    if (t.kind === 'flick') return clamp(140 + e * 90, 120, 230);
    return clamp(88 + e * 60, 80, 150);
  }

  function blob(ctx, x, y, r, rnd, alpha) {
    const n = 9 + Math.floor(rnd() * 4);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.62 + rnd() * 0.72);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
    for (let i = 0; i < n; i++) {
      const next = pts[(i + 1) % n];
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSplat(cv, t) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = markSize(t);
    cv.width = S * dpr; cv.height = S * dpr;
    cv.style.width = S + 'px'; cv.style.height = S + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(t.seed);
    const c = S / 2;
    if (t.done) { drawSmear(ctx, t, S, rnd); return; }

    const col = COLORS[t.color] || COLORS.black;
    const E = t.energy;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;

    // core blob + satellites
    const coreR = S * (0.13 + 0.06 * E);
    blob(ctx, c, c, coreR, rnd, 1);
    const nSub = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nSub; i++) {
      const a = rnd() * Math.PI * 2;
      const d = coreR * (0.5 + rnd() * 0.9);
      blob(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, coreR * (0.25 + rnd() * 0.45), rnd, 0.9);
    }

    // flick streaks along the throw direction
    if (t.kind === 'flick') {
      const nStreak = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < nStreak; i++) {
        const a = t.angle + (rnd() - 0.5) * 0.5;
        const len = S * (0.32 + rnd() * 0.16);
        const steps = 8;
        let px = c, py = c;
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          const wobble = (rnd() - 0.5) * 6;
          const nx = c + Math.cos(a) * len * f + Math.cos(a + Math.PI / 2) * wobble;
          const ny = c + Math.sin(a) * len * f + Math.sin(a + Math.PI / 2) * wobble;
          ctx.lineWidth = Math.max(0.5, coreR * 0.28 * (1 - f));
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          px = nx; py = ny;
        }
        ctx.beginPath();
        ctx.arc(px, py, 1 + rnd() * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // droplets with occasional tails
    const nDrops = Math.round(8 + E * 26 + rnd() * 8);
    for (let i = 0; i < nDrops; i++) {
      let a;
      if (t.kind === 'flick' && rnd() < 0.6) a = t.angle + (rnd() - 0.5) * 1.3;
      else a = rnd() * Math.PI * 2;
      const maxD = c - 4;
      const d = coreR * 1.05 + rnd() * rnd() * (maxD - coreR * 1.05);
      const x = c + Math.cos(a) * d;
      const y = c + Math.sin(a) * d;
      const r = Math.max(0.5, coreR * 0.2 * (1 - d / maxD) * (0.4 + rnd()));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (rnd() < 0.32 && r > 0.9) {
        const sx = c + Math.cos(a) * d * 0.45;
        const sy = c + Math.sin(a) * d * 0.45;
        ctx.lineWidth = r * 0.75;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }

    // fine specks
    const nSpecks = Math.round(14 + E * 24);
    ctx.save();
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < nSpecks; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, 0.3 + rnd() * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSmear(ctx, t, S, rnd) {
    const c = S / 2;
    const a = t.smearAngle ?? -0.4;
    // ghost of the original color underneath
    ctx.fillStyle = COLORS[t.color] || COLORS.black;
    blob(ctx, c, c, S * 0.15, rnd, 0.16);
    // dry-brush gray + scraped white strokes
    const nStrokes = 9 + Math.floor(rnd() * 5);
    for (let i = 0; i < nStrokes; i++) {
      const off = (rnd() - 0.5) * S * 0.42;
      const ox = Math.cos(a + Math.PI / 2) * off;
      const oy = Math.sin(a + Math.PI / 2) * off;
      const len = S * (0.3 + rnd() * 0.32);
      const x0 = c + ox - Math.cos(a) * len / 2;
      const y0 = c + oy - Math.sin(a) * len / 2;
      const white = rnd() < 0.4;
      ctx.strokeStyle = white ? 'rgba(240,234,218,0.85)' : `rgba(126,120,110,${0.3 + rnd() * 0.35})`;
      ctx.lineWidth = 1.5 + rnd() * 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(
        c + ox + (rnd() - 0.5) * 12, c + oy + (rnd() - 0.5) * 12,
        x0 + Math.cos(a) * len, y0 + Math.sin(a) * len
      );
      ctx.stroke();
    }
    // gray flecks
    ctx.fillStyle = 'rgba(126,120,110,0.5)';
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, 0.4 + rnd() * 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- marks on stage ----------

  function visibleTasks() {
    if (currentLayer === 'done') return tasks.filter((t) => t.done);
    return tasks.filter((t) => t.layer === currentLayer);
  }

  function positionMark(el, t) {
    el.style.left = t.x * 100 + '%';
    el.style.top = t.y * 100 + '%';
  }

  function buildMark(t, fresh = false) {
    const el = document.createElement('div');
    el.className = 'mark' + (t.done ? ' done' : '') + (fresh ? ' new' : '');
    el.dataset.id = t.id;
    const cv = document.createElement('canvas');
    drawSplat(cv, t);
    el.appendChild(cv);
    positionMark(el, t);
    marksEl.appendChild(el);
    markEls.set(t.id, el);
    if (fresh) setTimeout(() => el.classList.remove('new'), 400);
    return el;
  }

  function redrawMark(t) {
    const el = markEls.get(t.id);
    if (!el) return;
    drawSplat(el.querySelector('canvas'), t);
    el.classList.toggle('done', t.done);
  }

  function renderMarks() {
    marksEl.textContent = '';
    markEls.clear();
    for (const t of visibleTasks()) buildMark(t);
    updateHint();
  }

  function updateHint() {
    hintEl.hidden = marksEl.children.length > 0;
  }

  // ---------- creating tasks ----------

  function stageFrac(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return {
      x: clamp((clientX - r.left) / r.width, 0.06, 0.94),
      y: clamp((clientY - r.top) / r.height, 0.12, 0.88),
    };
  }

  function createTask(kind, clientX, clientY, angle, rawEnergy) {
    commitBubble(); // shouldn't happen, but never leave two pending
    const { x, y } = stageFrac(clientX, clientY);
    const t = {
      id: crypto.randomUUID(),
      title: '',
      color: ink,
      layer: currentLayer === 'done' ? 'today' : currentLayer,
      x, y,
      seed: Math.floor(Math.random() * 2 ** 31),
      kind,
      angle: angle || 0,
      energy: clamp(rawEnergy * mood().mult, 0.15, 1),
      due: null,
      done: false,
      doneAt: null,
      createdAt: Date.now(),
    };
    tasks.push(t);
    const el = buildMark(t, true);
    updateHint();
    pendingTask = t;
    openBubble(el);
  }

  // ---------- name-it bubble ----------

  function openBubble(markEl) {
    bubble.hidden = false;
    bubbleInput.value = '';
    const r = markEl.getBoundingClientRect();
    const bw = Math.min(window.innerWidth * 0.72, 300);
    let left = clamp(r.left + r.width / 2 - bw / 2, 10, window.innerWidth - bw - 10);
    let top = r.top - 62;
    bubble.classList.remove('tail-top');
    if (top < 70) { top = r.bottom + 14; bubble.classList.add('tail-top'); }
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.style.setProperty('--tail-x', clamp(r.left + r.width / 2 - left - 7, 12, bw - 26) + 'px');
    setTimeout(() => bubbleInput.focus(), 30);
  }

  function commitBubble() {
    if (!pendingTask) return;
    const t = pendingTask;
    pendingTask = null;
    bubble.hidden = true;
    const title = bubbleInput.value.trim();
    if (!title) { discardTask(t); return; }
    t.title = title;
    saveTasks();
    pulse();
  }

  function cancelBubble() {
    if (!pendingTask) return;
    const t = pendingTask;
    pendingTask = null;
    bubble.hidden = true;
    discardTask(t);
  }

  function discardTask(t) {
    tasks = tasks.filter((x) => x.id !== t.id);
    const el = markEls.get(t.id);
    if (el) {
      el.classList.add('fading');
      setTimeout(() => { el.remove(); markEls.delete(t.id); updateHint(); }, 320);
    }
    saveTasks();
  }

  bubbleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitBubble(); }
    if (e.key === 'Escape') cancelBubble();
  });
  $('#bubbleCancel').addEventListener('pointerdown', (e) => e.preventDefault());
  $('#bubbleCancel').addEventListener('click', cancelBubble);

  // ---------- gestures ----------

  const PRESS_MS = 350;
  const TAP_DIST = 14;
  let gest = null;

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  stage.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    // an open bubble or popover absorbs the tap
    if (pendingTask) { commitBubble(); return; }
    if (!popover.hidden) { closePopover(); return; }

    const markEl = e.target.closest('.mark');
    const task = markEl ? tasks.find((t) => t.id === markEl.dataset.id) : null;
    gest = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      t0: performance.now(),
      markEl, task,
      moved: false,
      path: 0,
      lastDx: 0, lastDy: 0,
      revX: 0, revY: 0,
      origX: task ? task.x : 0, origY: task ? task.y : 0,
      consumed: false,
      holdTimer: null,
      preview: null,
    };
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }

    if (!markEl) {
      gest.holdTimer = setTimeout(() => {
        if (!gest || gest.moved) return;
        const p = document.createElement('div');
        p.className = 'press-preview';
        p.style.left = ((gest.startX - stage.getBoundingClientRect().left) / stage.offsetWidth) * 100 + '%';
        p.style.top = ((gest.startY - stage.getBoundingClientRect().top) / stage.offsetHeight) * 100 + '%';
        p.style.color = COLORS[ink];
        stage.appendChild(p);
        gest.preview = p;
      }, PRESS_MS);
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!gest || e.pointerId !== gest.id || gest.consumed) return;
    const dx = e.clientX - gest.lastX;
    const dy = e.clientY - gest.lastY;
    gest.path += Math.hypot(dx, dy);
    gest.lastX = e.clientX; gest.lastY = e.clientY;
    const dist = Math.hypot(e.clientX - gest.startX, e.clientY - gest.startY);
    if (dist > TAP_DIST) {
      gest.moved = true;
      if (gest.preview) { gest.preview.remove(); gest.preview = null; }
      clearTimeout(gest.holdTimer);
    }

    if (gest.task && gest.moved && !gest.task.done) {
      // live drag
      gest.markEl.classList.add('dragging');
      const f = stageFrac(e.clientX, e.clientY);
      gest.task.x = f.x; gest.task.y = f.y;
      positionMark(gest.markEl, gest.task);
      // scrub detection: direction reversals mean "smear it done"
      if (Math.abs(dx) > 3) {
        if (gest.lastDx && Math.sign(dx) !== Math.sign(gest.lastDx)) gest.revX++;
        gest.lastDx = dx;
      }
      if (Math.abs(dy) > 3) {
        if (gest.lastDy && Math.sign(dy) !== Math.sign(gest.lastDy)) gest.revY++;
        gest.lastDy = dy;
      }
      if (Math.max(gest.revX, gest.revY) >= 3 && gest.path > 70) {
        gest.consumed = true;
        gest.markEl.classList.remove('dragging');
        gest.task.x = gest.origX; gest.task.y = gest.origY;
        positionMark(gest.markEl, gest.task);
        smearDone(gest.task, Math.atan2(dy, dx));
      }
    }
  });

  function endGesture(e, cancelled) {
    if (!gest || e.pointerId !== gest.id) return;
    const g = gest;
    gest = null;
    clearTimeout(g.holdTimer);
    if (g.preview) g.preview.remove();
    if (g.consumed || cancelled) {
      if (g.markEl) g.markEl.classList.remove('dragging');
      return;
    }

    const dt = performance.now() - g.t0;
    const dist = Math.hypot(g.lastX - g.startX, g.lastY - g.startY);

    if (g.task) {
      g.markEl.classList.remove('dragging');
      if (g.moved) {
        saveTasks(); // position already applied live
      } else {
        openPopover(g.task);
      }
      return;
    }

    // empty canvas: classify the throw
    if (dist > 40) {
      const v = dist / dt; // px per ms
      const angle = Math.atan2(g.lastY - g.startY, g.lastX - g.startX);
      const over = Math.min(70, dist * 0.35);
      createTask('flick',
        g.lastX + Math.cos(angle) * over,
        g.lastY + Math.sin(angle) * over,
        angle,
        clamp(0.35 + v * 0.5, 0.3, 1));
    } else if (dt >= PRESS_MS && dist <= TAP_DIST) {
      createTask('press', g.startX, g.startY, 0, 0.45 + Math.min(0.55, (dt - PRESS_MS) / 1400));
    } else if (dist <= TAP_DIST) {
      createTask('tap', g.startX, g.startY, 0, 0.3);
    }
  }

  stage.addEventListener('pointerup', (e) => endGesture(e, false));
  stage.addEventListener('pointercancel', (e) => endGesture(e, true));

  // ---------- completing ----------

  function smearDone(t, angle) {
    t.done = true;
    t.doneAt = Date.now();
    t.smearAngle = angle ?? -0.4;
    saveTasks();
    const el = markEls.get(t.id);
    if (el) {
      el.classList.add('smearing');
      setTimeout(() => {
        redrawMark(t);
        el.classList.remove('smearing');
        if (currentLayer === 'done') { /* already visible */ }
      }, 150);
    }
    showToast('Smeared. Part of the canvas now.', 'Undo', () => restoreTask(t));
    pulse();
  }

  function restoreTask(t) {
    t.done = false;
    t.doneAt = null;
    if (currentLayer === 'done') renderMarks();
    else redrawMark(t);
    saveTasks();
  }

  // ---------- inspect popover ----------

  const ICONS = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>',
    smear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 15c3-2 5 2 8 0s5 2 8 0M4 9c3-2 5 2 8 0s5 2 7 0"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h11a6 6 0 0 1 0 12h-3"/><path d="M7 6l-4 4 4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  };

  function openPopover(t) {
    popoverTask = t;
    const dueTxt = fmtDue(t.due);
    const overdue = t.due && t.due < localISO(0) && !t.done;
    popover.innerHTML = `
      <div class="pop-head">
        <div class="pop-title" id="popTitle">${escapeHtml(t.title || 'Untitled')}</div>
        <button class="pop-x" id="popClose" aria-label="Close">×</button>
      </div>
      <div class="pop-meta">
        <span class="dot" style="background:${COLORS[t.color]}"></span>
        <span>${layerOf(t.layer).name}</span>
        ${dueTxt ? `<span>·</span><span class="${overdue ? 'overdue' : ''}">${dueTxt}</span>` : ''}
        ${t.done ? '<span>·</span><span>Smeared</span>' : ''}
      </div>
      <div class="pop-colors">
        ${['black', 'red', 'blue', 'yellow'].map((c) =>
          `<button data-color="${c}" class="${t.color === c ? 'on' : ''}" style="background:${COLORS[c]}" aria-label="${c}"></button>`).join('')}
      </div>
      <div class="pop-actions">
        <button id="popDue" aria-label="Set due date">${ICONS.clock}</button>
        <button id="popRename" aria-label="Rename">${ICONS.pencil}</button>
        <button id="popDone" aria-label="${t.done ? 'Restore' : 'Smear done'}">${t.done ? ICONS.undo : ICONS.smear}</button>
        <button id="popDelete" class="danger" aria-label="Delete">${ICONS.trash}</button>
      </div>
      <input type="date" class="pop-date" id="popDate" value="${t.due || ''}" />
    `;
    popover.hidden = false;

    // position near the mark
    const markEl = markEls.get(t.id);
    const r = markEl.getBoundingClientRect();
    const pw = 250;
    const left = clamp(r.left + r.width / 2 - pw / 2, 10, window.innerWidth - pw - 10);
    popover.style.left = left + 'px';
    const ph = popover.offsetHeight;
    let top = r.top - ph - 12;
    if (top < 66) top = Math.min(r.bottom + 12, window.innerHeight - ph - 12);
    popover.style.top = top + 'px';

    $('#popClose').addEventListener('click', closePopover);
    popover.querySelectorAll('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        t.color = b.dataset.color;
        saveTasks();
        redrawMark(t);
        popover.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      }));
    const dateInput = $('#popDate');
    $('#popDue').addEventListener('click', () => {
      if (dateInput.showPicker) { try { dateInput.showPicker(); } catch { dateInput.click(); } }
      else dateInput.click();
    });
    dateInput.addEventListener('change', () => {
      t.due = dateInput.value || null;
      saveTasks();
      openPopover(t); // refresh meta
    });
    $('#popRename').addEventListener('click', () => startRename(t));
    $('#popDone').addEventListener('click', () => {
      closePopover();
      if (t.done) restoreTask(t);
      else smearDone(t);
    });
    $('#popDelete').addEventListener('click', () => {
      closePopover();
      discardTask(t);
      showToast('Scraped off the canvas.');
    });
  }

  function startRename(t) {
    const holder = $('#popTitle');
    const input = document.createElement('input');
    input.value = t.title;
    input.maxLength = 80;
    holder.textContent = '';
    holder.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim();
      if (v) { t.title = v; saveTasks(); }
      holder.textContent = t.title || 'Untitled';
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') holder.textContent = t.title || 'Untitled';
    });
    input.addEventListener('blur', commit);
  }

  function closePopover() {
    popover.hidden = true;
    popoverTask = null;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- layers ----------

  function setLayer(id) {
    currentLayer = id;
    localStorage.setItem(LS.layer, id);
    layerTitle.textContent = layerOf(id).name;
    renderMarks();
  }

  function drawLayerThumb(cv, layerId) {
    const w = 54, h = 38;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, w, h);
    const ts = layerId === 'done' ? tasks.filter((t) => t.done) : tasks.filter((t) => t.layer === layerId);
    for (const t of ts) {
      ctx.fillStyle = t.done ? COLORS.gray : COLORS[t.color];
      ctx.globalAlpha = t.done ? 0.55 : 0.9;
      ctx.beginPath();
      ctx.arc(t.x * w, t.y * h, 1.6 + t.energy * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function buildLayersSheet() {
    const ul = $('#layerList');
    ul.textContent = '';
    for (const L of LAYERS) {
      const open = L.id === 'done'
        ? tasks.filter((t) => t.done).length
        : tasks.filter((t) => t.layer === L.id && !t.done).length;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'layer-row' + (L.id === currentLayer ? ' current' : '');
      const thumb = document.createElement('canvas');
      thumb.className = 'layer-thumb';
      drawLayerThumb(thumb, L.id);
      btn.appendChild(thumb);
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = L.name;
      btn.appendChild(name);
      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = open || '';
      btn.appendChild(count);
      const dot = document.createElement('span');
      dot.className = 'layer-dot';
      dot.style.background = L.dot;
      btn.appendChild(dot);
      btn.addEventListener('click', () => { setLayer(L.id); closeSheets(); });
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  // ---------- mood ----------

  function drawMoodSquiggle(cv, id) {
    const w = cv.offsetWidth || 120, h = 24;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(242,238,226,0.9)';
    ctx.fillStyle = 'rgba(242,238,226,0.9)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    const rnd = mulberry32(id.length * 977 + id.charCodeAt(0));
    ctx.beginPath();
    if (id === 'controlled') {
      for (let x = 4; x <= w - 4; x += 2) {
        const y = h / 2 + Math.sin(x / 14) * 5;
        x === 4 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (id === 'chaotic') {
      ctx.moveTo(4, h / 2);
      for (let i = 0; i < 26; i++) ctx.lineTo(4 + rnd() * (w - 8), 3 + rnd() * (h - 6));
      ctx.stroke();
    } else if (id === 'heavy') {
      ctx.lineWidth = 3.4;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        ctx.moveTo(6, 5 + r * 7 + rnd() * 2);
        ctx.lineTo(w - 6, 5 + r * 7 + rnd() * 2);
        ctx.stroke();
      }
    } else if (id === 'sparse') {
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(10 + (i * (w - 20)) / 5, h / 2 + (rnd() - 0.5) * 8, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (id === 'frantic') {
      ctx.moveTo(4, h / 2);
      for (let x = 4; x <= w - 4; x += 5) ctx.lineTo(x, rnd() < 0.5 ? 3 : h - 3);
      ctx.stroke();
    } else { // clear
      ctx.lineWidth = 1;
      ctx.moveTo(4, h / 2);
      ctx.lineTo(w - 4, h / 2);
      ctx.stroke();
    }
  }

  function buildMoodSheet() {
    const ul = $('#moodList');
    ul.textContent = '';
    for (const m of MOODS) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'mood-row' + (m.id === moodId ? ' current' : '');
      const name = document.createElement('span');
      name.className = 'mood-name';
      name.textContent = m.name;
      btn.appendChild(name);
      const cv = document.createElement('canvas');
      btn.appendChild(cv);
      btn.addEventListener('click', () => {
        moodId = m.id;
        localStorage.setItem(LS.mood, m.id);
        paintPaper();
        closeSheets();
        showToast(`${m.name} day. The canvas is listening.`);
      });
      li.appendChild(btn);
      ul.appendChild(li);
      requestAnimationFrame(() => drawMoodSquiggle(cv, m.id));
    }
  }

  // ---------- sheets ----------

  function openSheet(sheet) {
    closePopover();
    if (pendingTask) commitBubble();
    backdrop.hidden = false;
    if (sheet === layersSheet) buildLayersSheet();
    if (sheet === moodSheet) buildMoodSheet();
    sheet.hidden = false;
  }

  function closeSheets() {
    backdrop.hidden = true;
    layersSheet.hidden = true;
    moodSheet.hidden = true;
  }

  $('#layersBtn').addEventListener('click', () => openSheet(layersSheet));
  $('#moodBtn').addEventListener('click', () => openSheet(moodSheet));
  backdrop.addEventListener('click', closeSheets);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheets(); closePopover(); cancelBubble(); }
  });

  $('#clearDone').addEventListener('click', () => {
    const n = tasks.filter((t) => t.done).length;
    if (!n) { closeSheets(); return; }
    tasks = tasks.filter((t) => !t.done);
    saveTasks();
    renderMarks();
    closeSheets();
    showToast(`${n} smeared ${n === 1 ? 'mark' : 'marks'} scraped off.`);
  });

  // ---------- toolbar ----------

  function setInk(c) {
    ink = c;
    localStorage.setItem(LS.ink, c);
    document.querySelectorAll('.ink').forEach((b) =>
      b.classList.toggle('selected', b.dataset.ink === c));
  }
  document.querySelectorAll('.ink').forEach((b) =>
    b.addEventListener('click', () => setInk(b.dataset.ink)));

  // ---------- toast / notifications ----------

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
    const open = tasks.filter((t) => !t.done);
    const checks = [
      ['heavy', open.length >= 10, 'The canvas is getting heavy.'],
      ['crowded', open.filter((t) => t.x > 0.33 && t.x < 0.67 && t.y > 0.3 && t.y < 0.7).length >= 5, 'The center is crowded.'],
      ['bleeding', open.filter((t) => t.due === localISO(1)).length >= 3,
        `${open.filter((t) => t.due === localISO(1)).length} marks are bleeding into tomorrow.`],
    ];
    for (const [key, cond, msg] of checks) {
      if (cond && !toastShown.has(key)) {
        toastShown.add(key);
        setTimeout(() => showToast(msg), 600);
        return;
      }
    }
  }

  // ---------- samples ----------

  function sampleTasks() {
    const mk = (title, color, layer, kind, x, y, energy, due, done) => ({
      id: crypto.randomUUID(),
      title, color, layer, kind, x, y, energy,
      angle: Math.random() * Math.PI * 2,
      seed: Math.floor(Math.random() * 2 ** 31),
      due: due || null,
      done: !!done,
      doneAt: done ? Date.now() : null,
      smearAngle: done ? -0.5 : undefined,
      createdAt: Date.now(),
    });
    return [
      mk('Client presentation', 'black', 'today', 'press', 0.44, 0.3, 0.85, localISO(1)),
      mk('Buy groceries', 'yellow', 'today', 'tap', 0.72, 0.52, 0.4, localISO(0)),
      mk('Call mom', 'red', 'today', 'flick', 0.26, 0.56, 0.7, localISO(0)),
      mk('Fix the login bug', 'blue', 'today', 'flick', 0.6, 0.72, 0.8),
      mk('Water the plants', 'yellow', 'today', 'tap', 0.32, 0.8, 0.3),
      mk('Emptied the inbox', 'gray', 'today', 'press', 0.78, 0.24, 0.6, null, true),
      mk('Quarterly review deck', 'blue', 'work', 'press', 0.5, 0.42, 0.75, localISO(3)),
      mk('App with no lists', 'black', 'ideas', 'flick', 0.42, 0.5, 0.9),
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

  load();
  paintPaper();
  setInk(ink);
  setLayer(currentLayer);
  pulse();
})();
