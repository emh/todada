(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const LS_TASKS = 'vd.todo.tasks';
const LS_THEME = 'vd.todo.theme';

const THEMES = ['basquiat', 'bauhaus', 'brutalist', 'kandinsky', 'mondrian', 'pollock'];
const THEME_META_COLOR = {
  basquiat: '#12100d',
  bauhaus: '#f4edda',
  brutalist: '#d9d7d0',
  kandinsky: '#f3ecdd',
  mondrian: '#f5f5f2',
  pollock: '#ece4cf',
};
const TAG_LABEL = { work: 'Work', personal: 'Personal', health: 'Health' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- state ---------------- */

let tasks = loadTasks();
let filter = 'all';
let view = 'tasks';
let editingId = null;

function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function sampleTasks() {
  const mk = (title, tag, offset) => ({
    id: crypto.randomUUID(),
    title,
    tag,
    due: offset === null ? null : localISO(offset),
    done: false,
    createdAt: Date.now(),
  });
  return [
    mk('Design homepage mockups', 'work', 0),
    mk('Reply to email from Sarah', 'work', 0),
    mk('Buy groceries', 'personal', 1),
    mk('Workout', 'health', 1),
    mk('Read book for 30 minutes', 'personal', 3),
    mk('Prepare presentation', 'work', 4),
    mk('Call Mom', 'personal', 4),
  ];
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(LS_TASKS);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to samples */ }
  return sampleTasks();
}

function saveTasks() {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
}

/* ---------------- dates ---------------- */

function fmtDue(due) {
  if (!due) return '';
  if (due === localISO(0)) return 'Today';
  if (due === localISO(1)) return 'Tomorrow';
  if (due === localISO(-1)) return 'Yesterday';
  const [, m, d] = due.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function dueState(t) {
  if (!t.due || t.done) return '';
  if (t.due < localISO(0)) return 'overdue';
  if (t.due === localISO(0)) return 'today';
  return '';
}

/* ---------------- rendering ---------------- */

const listEl = $('#list');
const emptyEl = $('#empty');

const FILTERS = {
  all: (t) => !t.done,
  today: (t) => !t.done && t.due !== null && t.due <= localISO(0),
  upcoming: (t) => !t.done && t.due !== null && t.due > localISO(0),
  completed: (t) => t.done,
};

const EMPTY_TEXT = {
  all: 'Nothing to do. Enjoy the blank canvas.',
  today: 'Nothing due today.',
  upcoming: 'Nothing on the horizon.',
  completed: 'Nothing finished yet.',
};

function byDue(a, b) {
  if (a.due === b.due) return a.createdAt - b.createdAt;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  return a.due < b.due ? -1 : 1;
}

function taskNode(t, i) {
  const li = document.createElement('li');
  li.className = 'task' + (t.done ? ' done' : '');
  li.dataset.id = t.id;
  li.style.setProperty('--i', i);

  const check = document.createElement('button');
  check.className = 'check';
  check.setAttribute('aria-label', t.done ? 'Mark as not done' : 'Mark as done');
  check.setAttribute('aria-pressed', String(t.done));
  check.textContent = '✓';

  const body = document.createElement('div');
  body.className = 'task-body';

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = t.title;

  const tag = document.createElement('div');
  tag.className = 'task-tag';
  tag.dataset.tag = t.tag;
  const dot = document.createElement('i');
  dot.className = 'dot';
  dot.dataset.tag = t.tag;
  tag.append(dot, document.createTextNode(TAG_LABEL[t.tag] || t.tag));

  body.append(title, tag);

  const due = document.createElement('div');
  due.className = ('task-due ' + dueState(t)).trim();
  due.textContent = fmtDue(t.due);

  li.append(check, body, due);
  return li;
}

function groupNode(label) {
  const li = document.createElement('li');
  li.className = 'group';
  li.textContent = label;
  return li;
}

function render() {
  $('#tabs').hidden = view !== 'tasks';
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
  $$('.navitem').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  listEl.innerHTML = '';
  let count = 0;
  let i = 0;

  if (view === 'tasks') {
    const items = tasks.filter(FILTERS[filter]).sort(byDue);
    items.forEach((t) => listEl.appendChild(taskNode(t, i++)));
    count = items.length;
    emptyEl.textContent = EMPTY_TEXT[filter];
  } else if (view === 'calendar') {
    const open = tasks.filter((t) => !t.done).sort(byDue);
    let lastLabel = null;
    open.forEach((t) => {
      const label = t.due
        ? (t.due < localISO(0) ? 'Overdue' : fmtDue(t.due))
        : 'No date';
      if (label !== lastLabel) {
        listEl.appendChild(groupNode(label));
        lastLabel = label;
      }
      listEl.appendChild(taskNode(t, i++));
    });
    count = open.length;
    emptyEl.textContent = 'Nothing scheduled.';
  } else {
    for (const key of Object.keys(TAG_LABEL)) {
      const items = tasks.filter((t) => !t.done && t.tag === key).sort(byDue);
      if (!items.length) continue;
      listEl.appendChild(groupNode(`${TAG_LABEL[key]} · ${items.length}`));
      items.forEach((t) => listEl.appendChild(taskNode(t, i++)));
      count += items.length;
    }
    emptyEl.textContent = 'No tagged tasks.';
  }

  emptyEl.hidden = count > 0;
}

/* ---------------- sheets ---------------- */

const backdrop = $('#backdrop');
let openSheetEl = null;

function openSheet(sheet) {
  closeSheet();
  openSheetEl = sheet;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  });
}

function closeSheet() {
  if (!openSheetEl) return;
  openSheetEl.classList.remove('open');
  backdrop.classList.remove('open');
  const el = openSheetEl;
  openSheetEl = null;
  setTimeout(() => {
    if (!openSheetEl) backdrop.hidden = true;
  }, 260);
}

backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ---------------- task form ---------------- */

const form = $('#taskForm');

function openTaskSheet(task) {
  editingId = task ? task.id : null;
  $('#taskSheetTitle').textContent = task ? 'Edit task' : 'New task';
  $('#fTitle').value = task ? task.title : '';
  $('#fDue').value = task ? task.due || '' : '';
  const tag = task ? task.tag : 'work';
  form.querySelectorAll('input[name="tag"]').forEach((r) => (r.checked = r.value === tag));
  $('#fDelete').hidden = !task;
  openSheet($('#taskSheet'));
  if (!task) setTimeout(() => $('#fTitle').focus(), 300);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#fTitle').value.trim();
  if (!title) return;
  const tag = form.querySelector('input[name="tag"]:checked').value;
  const due = $('#fDue').value || null;

  if (editingId) {
    const t = tasks.find((t) => t.id === editingId);
    if (t) Object.assign(t, { title, tag, due });
  } else {
    tasks.push({ id: crypto.randomUUID(), title, tag, due, done: false, createdAt: Date.now() });
  }
  saveTasks();
  render();
  closeSheet();
});

$('#fDelete').addEventListener('click', () => {
  tasks = tasks.filter((t) => t.id !== editingId);
  saveTasks();
  render();
  closeSheet();
});

/* ---------------- list interaction ---------------- */

// does this task belong in the currently visible list?
function shouldShow(t) {
  if (view === 'tasks') return FILTERS[filter](t);
  return !t.done;
}

function updateEmpty() {
  emptyEl.hidden = listEl.querySelector('.task') !== null;
}

const LINGER_MS = 700;
const rowTimers = new WeakMap();

// fade the row out, then FLIP-slide the remaining rows into the gap —
// no re-render, so nothing else re-animates
function removeRowAnimated(li) {
  li.classList.add('leaving-out');

  const finish = () => {
    clearTimeout(fallback);
    if (!li.isConnected) return;

    // an orphaned group header (calendar/tags views) leaves with its last row
    const toRemove = [li];
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    if (prev && prev.classList.contains('group') && (!next || next.classList.contains('group'))) {
      toRemove.push(prev);
    }

    const rest = [...listEl.children].filter((el) => !toRemove.includes(el));
    const before = rest.map((el) => el.getBoundingClientRect().top);
    toRemove.forEach((el) => el.remove());
    updateEmpty();

    rest.forEach((el, i) => {
      const delta = before[i] - el.getBoundingClientRect().top;
      if (!delta) return;
      const base = getComputedStyle(el).transform;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)${base !== 'none' ? ' ' + base : ''}`;
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      rest.forEach((el) => {
        el.style.transition = 'transform 0.3s cubic-bezier(0.33, 1, 0.5, 1)';
        el.style.transform = '';
      });
      setTimeout(() => rest.forEach((el) => {
        el.style.transition = '';
      }), 360);
    }));
  };

  li.addEventListener('transitionend', finish, { once: true });
  const fallback = setTimeout(finish, 350);
}

listEl.addEventListener('click', (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  const task = tasks.find((t) => t.id === li.dataset.id);
  if (!task) return;

  if (e.target.closest('.check')) {
    if (li.classList.contains('leaving-out')) return; // already on its way out

    task.done = !task.done;
    saveTasks();

    // update the row in place — the checkmark shows immediately
    li.classList.toggle('done', task.done);
    const check = li.querySelector('.check');
    check.setAttribute('aria-pressed', String(task.done));
    check.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');

    // clicking again during the linger cancels the removal
    const pending = rowTimers.get(li);
    if (pending) {
      clearTimeout(pending);
      rowTimers.delete(li);
    }
    if (!shouldShow(task)) {
      rowTimers.set(li, setTimeout(() => {
        rowTimers.delete(li);
        removeRowAnimated(li);
      }, LINGER_MS));
    }
  } else if (e.target.closest('.task-body')) {
    openTaskSheet(task);
  }
});

/* ---------------- tabs / nav / buttons ---------------- */

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  filter = tab.dataset.filter;
  render();
});

$('.bottomnav').addEventListener('click', (e) => {
  const item = e.target.closest('.navitem');
  if (!item) return;
  view = item.dataset.view;
  render();
});

$('#fab').addEventListener('click', () => openTaskSheet(null));
$('#themeBtn').addEventListener('click', () => openSheet($('#themeSheet')));
$('#menuBtn').addEventListener('click', () => openSheet($('#menuSheet')));

$('#clearDone').addEventListener('click', () => {
  tasks = tasks.filter((t) => !t.done);
  saveTasks();
  render();
  closeSheet();
});

$('#restoreSamples').addEventListener('click', () => {
  tasks = sampleTasks();
  saveTasks();
  render();
  closeSheet();
});

/* ---------------- themes ---------------- */

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'bauhaus';
  document.documentElement.dataset.theme = name;
  localStorage.setItem(LS_THEME, name);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_META_COLOR[name]);
  $$('.theme-pick').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.pick === name))
  );
  ensurePaintedBg(name);
}

$('#themeGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-pick');
  if (!btn) return;
  applyTheme(btn.dataset.pick);
  closeSheet();
});

/* ---------------- painted backgrounds (Basquiat / Pollock) ---------------- */

const painted = {};

function ensurePaintedBg(theme) {
  if (theme === 'pollock' && !painted.pollock) {
    painted.pollock = true;
    document.documentElement.style.setProperty('--pollock-bg', `url(${paintPollock()})`);
  }
  if (theme === 'basquiat' && !painted.basquiat) {
    painted.basquiat = true;
    document.documentElement.style.setProperty('--basq-bg', `url(${paintBasquiat()})`);
  }
}

// deterministic PRNG so the artwork is stable across loads
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(r, weighted) {
  let x = r();
  for (const [v, w] of weighted) {
    if ((x -= w) <= 0) return v;
  }
  return weighted[weighted.length - 1][0];
}

function paintPollock() {
  const W = 900, H = 1600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const r = mulberry32(20260702);

  x.fillStyle = '#ece4cf';
  x.fillRect(0, 0, W, H);

  // soft aged blotches
  for (let i = 0; i < 14; i++) {
    x.fillStyle = `rgba(${190 + r() * 30 | 0}, ${172 + r() * 25 | 0}, ${135 + r() * 25 | 0}, 0.16)`;
    x.beginPath();
    x.ellipse(r() * W, r() * H, 70 + r() * 190, 50 + r() * 150, r() * Math.PI, 0, Math.PI * 2);
    x.fill();
  }

  const colors = [
    ['#17150f', 0.46], ['#d7442c', 0.13], ['#e2a72e', 0.13],
    ['#2456a0', 0.1], ['#8f2740', 0.07], ['#57683f', 0.06], ['#f7f2e2', 0.05],
  ];

  const drop = (px, py, rad, col, alpha) => {
    x.globalAlpha = alpha;
    x.fillStyle = col;
    x.beginPath();
    x.arc(px, py, rad, 0, Math.PI * 2);
    x.fill();
  };

  // flung strokes: chained quadratic curves with drift
  for (let i = 0; i < 230; i++) {
    const col = pick(r, colors);
    let px = r() * W, py = r() * H;
    let ang = r() * Math.PI * 2;
    x.strokeStyle = col;
    x.lineCap = 'round';
    x.globalAlpha = 0.75 + r() * 0.25;
    x.lineWidth = 1.4 + r() * r() * 8;
    x.beginPath();
    x.moveTo(px, py);
    const segs = 2 + (r() * 3 | 0);
    for (let s = 0; s < segs; s++) {
      const len = 80 + r() * 320;
      ang += (r() - 0.5) * 1.6;
      const mx = px + Math.cos(ang + (r() - 0.5)) * len * 0.5;
      const my = py + Math.sin(ang + (r() - 0.5)) * len * 0.5;
      px += Math.cos(ang) * len;
      py += Math.sin(ang) * len;
      x.quadraticCurveTo(mx, my, px, py);
      // droplets shed along the throw
      if (r() < 0.8) drop(px + (r() - 0.5) * 50, py + (r() - 0.5) * 50, 1.5 + r() * 5.5, col, 0.6 + r() * 0.4);
    }
    x.stroke();
  }

  // standalone spatter bursts
  for (let i = 0; i < 220; i++) {
    const col = pick(r, colors);
    const bx = r() * W, by = r() * H;
    drop(bx, by, 2 + r() * r() * 9, col, 0.6 + r() * 0.4);
    const sat = 1 + r() * 6 | 0;
    for (let s = 0; s < sat; s++) {
      drop(bx + (r() - 0.5) * 70, by + (r() - 0.5) * 70, 0.8 + r() * 3, col, 0.5 + r() * 0.5);
    }
  }

  x.globalAlpha = 1;
  return c.toDataURL('image/jpeg', 0.82);
}

function paintBasquiat() {
  const W = 900, H = 1600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const r = mulberry32(1988);

  x.fillStyle = '#100e0b';
  x.fillRect(0, 0, W, H);

  // ragged paint mass built from many jittered, tilted strokes
  const patch = (cx, cy, w, h, col) => {
    x.fillStyle = col;
    for (let i = 0; i < 40; i++) {
      x.globalAlpha = 0.4 + r() * 0.4;
      const pw = w * (0.25 + r() * 0.55);
      const ph = h * (0.2 + r() * 0.5);
      x.save();
      x.translate(cx + (r() - 0.5) * w * 0.55, cy + (r() - 0.5) * h * 0.5);
      x.rotate((r() - 0.5) * 0.22);
      x.fillRect(-pw / 2, -ph / 2, pw, ph);
      x.restore();
    }
    x.globalAlpha = 1;
  };

  patch(430, 260, 640, 420, '#e8a71a');     // yellow mass, upper center
  patch(90, 170, 260, 420, '#1c48cf');      // blue, top-left
  patch(880, 120, 220, 320, '#1c48cf');     // blue, top-right
  patch(850, 700, 240, 700, '#cf1f3f');     // red, right edge
  patch(40, 780, 200, 520, '#cf1f3f');      // red, left mid
  patch(190, 1300, 300, 260, '#e8a71a');    // yellow, lower-left
  patch(700, 1450, 320, 240, '#1c48cf');    // blue, bottom
  patch(460, 900, 700, 300, '#15120e');     // re-darken the middle band

  // speckle
  for (let i = 0; i < 900; i++) {
    x.globalAlpha = 0.25 + r() * 0.5;
    x.fillStyle = pick(r, [['#efe6d4', 0.4], ['#12100d', 0.3], ['#cf1f3f', 0.15], ['#1c48cf', 0.15]]);
    x.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
  }
  x.globalAlpha = 1;

  const scrawl = (col, w) => {
    x.strokeStyle = col;
    x.lineWidth = w;
    x.lineCap = 'round';
    x.lineJoin = 'round';
  };

  const crown = (cx, cy, s, col) => {
    scrawl(col, 5 + r() * 3);
    x.beginPath();
    x.moveTo(cx - s, cy + s * 0.55);
    x.lineTo(cx - s * 0.85, cy - s * 0.4);
    x.lineTo(cx - s * 0.42, cy + s * 0.1);
    x.lineTo(cx, cy - s * 0.65);
    x.lineTo(cx + s * 0.42, cy + s * 0.1);
    x.lineTo(cx + s * 0.85, cy - s * 0.4);
    x.lineTo(cx + s, cy + s * 0.55);
    x.closePath();
    x.stroke();
    x.beginPath();
    x.moveTo(cx - s, cy + s * 0.8);
    x.lineTo(cx + s, cy + s * 0.78);
    x.stroke();
  };

  const asterisk = (cx, cy, s, col) => {
    scrawl(col, 4 + r() * 3);
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + (r() - 0.5) * 0.3;
      x.beginPath();
      x.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s);
      x.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
      x.stroke();
    }
  };

  const scratchGrid = (cx, cy, w, h, col) => {
    scrawl(col, 3);
    for (let i = 0; i < 4; i++) {
      x.beginPath();
      x.moveTo(cx + (r() - 0.5) * 8, cy + (h / 3) * i);
      x.lineTo(cx + w + (r() - 0.5) * 8, cy + (h / 3) * i + (r() - 0.5) * 6);
      x.stroke();
    }
    for (let i = 0; i < 3; i++) {
      x.beginPath();
      x.moveTo(cx + (w / 2) * i + (r() - 0.5) * 6, cy - 4);
      x.lineTo(cx + (w / 2) * i + (r() - 0.5) * 6, cy + h + 4);
      x.stroke();
    }
  };

  const squiggle = (cx, cy, col) => {
    scrawl(col, 4 + r() * 2);
    x.beginPath();
    x.moveTo(cx, cy);
    let px = cx, py = cy;
    for (let i = 0; i < 6; i++) {
      px += 14 + r() * 26;
      py += (r() - 0.5) * 34;
      x.lineTo(px, py);
    }
    x.stroke();
  };

  crown(300, 120, 55, '#12100d');
  crown(620, 1180, 40, '#efe6d4');
  crown(140, 1480, 46, '#e8a71a');
  asterisk(790, 420, 46, '#12100d');
  asterisk(120, 620, 34, '#efe6d4');
  asterisk(700, 1520, 30, '#12100d');
  scratchGrid(660, 130, 130, 70, '#efe6d4');
  scratchGrid(60, 1080, 110, 60, '#12100d');
  squiggle(90, 380, '#12100d');
  squiggle(560, 1330, '#efe6d4');
  squiggle(680, 720, '#12100d');

  // heart, lower right — Basquiat kept one in most canvases
  scrawl('#cf1f3f', 6);
  x.beginPath();
  x.moveTo(780, 1290);
  x.bezierCurveTo(755, 1258, 715, 1272, 722, 1305);
  x.bezierCurveTo(728, 1330, 762, 1348, 780, 1362);
  x.bezierCurveTo(798, 1345, 830, 1328, 835, 1302);
  x.bezierCurveTo(840, 1270, 802, 1258, 780, 1290);
  x.stroke();

  return c.toDataURL('image/jpeg', 0.82);
}

/* ---------------- boot ---------------- */

applyTheme(localStorage.getItem(LS_THEME) || 'bauhaus');
render();
saveTasks();

})();
