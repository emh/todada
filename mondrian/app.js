/* Mondrian / Todo — every rectangle is a task. */
(() => {
  'use strict';

  // ---------- constants ----------

  const LS = {
    tree: 'mond.tree',
    vis: 'mond.vis',
    struct: 'mond.struct',
  };

  // storage schema v2 (zero state) — wipe any pre-v2 data, e.g. old sample seeds
  const LS_VER = '2';
  if (localStorage.getItem('mond.v') !== LS_VER) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('mond.')) localStorage.removeItem(k);
    }
    localStorage.setItem('mond.v', LS_VER);
  }

  const CATS = {
    red: { hex: '#d92311', label: 'urgent' },
    blue: { hex: '#1a4ba0', label: 'work / project' },
    yellow: { hex: '#f2c500', label: 'personal / quick' },
    white: { hex: '#f6f3ec', label: 'open / neutral' },
  };

  const PRI_W = { high: 3, med: 2, low: 1 };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- tree helpers ----------
  // internal node: { id, dir: 'v'|'h', ratio, kids: [a, b] }
  // leaf: { id, task: {...} | null }

  const uid = () => crypto.randomUUID();
  const L = (task = null) => ({ id: uid(), task });
  const V = (ratio, a, b) => ({ id: uid(), dir: 'v', ratio, kids: [a, b] });
  const H = (ratio, a, b) => ({ id: uid(), dir: 'h', ratio, kids: [a, b] });

  const STRUCTS = {
    structured: {
      name: 'Structured', desc: 'Balanced mix of focus and flexibility.',
      make: () => V(0.62, H(0.42, L(), H(0.55, L(), L())), H(0.35, L(), H(0.5, L(), V(0.45, L(), L())))),
    },
    focused: {
      name: 'Focused', desc: 'Fewer blocks. Deep work friendly.',
      make: () => H(0.55, V(0.6, L(), L()), V(0.4, L(), L())),
    },
    sparse: {
      name: 'Sparse', desc: 'Minimal plan. Room to breathe.',
      make: () => V(0.6, H(0.55, L(), L()), H(0.45, L(), L())),
    },
    intensive: {
      name: 'Intensive', desc: 'Max density for busy days.',
      make: () => V(0.5,
        H(0.36, V(0.55, L(), L()), H(0.5, L(), V(0.5, L(), L()))),
        H(0.42, V(0.5, L(), L()), H(0.55, V(0.5, L(), L()), L()))),
    },
  };

  function walk(node, rect, leaves, divs, rects) {
    rects[node.id] = rect;
    if (!node.kids) { leaves.push({ node, rect }); return; }
    const { x, y, w, h } = rect;
    if (node.dir === 'v') {
      walk(node.kids[0], { x, y, w: w * node.ratio, h }, leaves, divs, rects);
      walk(node.kids[1], { x: x + w * node.ratio, y, w: w * (1 - node.ratio), h }, leaves, divs, rects);
      divs.push({ node, line: { x: x + w * node.ratio, y, len: h }, dir: 'v', rect });
    } else {
      walk(node.kids[0], { x, y, w, h: h * node.ratio }, leaves, divs, rects);
      walk(node.kids[1], { x, y: y + h * node.ratio, w, h: h * (1 - node.ratio) }, leaves, divs, rects);
      divs.push({ node, line: { x, y: y + h * node.ratio, len: w }, dir: 'h', rect });
    }
  }

  function findLeaf(node, id) {
    if (node.id === id) return node.kids ? null : node;
    if (!node.kids) return null;
    return findLeaf(node.kids[0], id) || findLeaf(node.kids[1], id);
  }
  function findParent(node, id, parent = null) {
    if (node.id === id) return parent;
    if (!node.kids) return null;
    return findParent(node.kids[0], id, node) || findParent(node.kids[1], id, node);
  }
  function allTaskLeaves(node, out = []) {
    if (!node.kids) { if (node.task) out.push(node); return out; }
    allTaskLeaves(node.kids[0], out);
    allTaskLeaves(node.kids[1], out);
    return out;
  }
  function allLeaves(node, out = []) {
    if (!node.kids) { out.push(node); return out; }
    allLeaves(node.kids[0], out);
    allLeaves(node.kids[1], out);
    return out;
  }
  function replaceChild(parent, oldId, newNode) {
    const i = parent.kids[0].id === oldId ? 0 : 1;
    parent.kids[i] = newNode;
  }

  // ---------- state ----------

  let structId = localStorage.getItem(LS.struct) || 'structured';
  let tree = null;
  let vis = { red: true, blue: true, yellow: true, white: true, done: true };
  let splitMode = false;
  let pending = null; // { type: 'split'|'fill'|'merge', leafId, revert, presetSubs, prefillColor }
  const blockEls = new Map();
  const divEls = new Map();
  const toastShown = new Set();

  // ---------- dom ----------

  const $ = (s) => document.querySelector(s);
  const grid = $('#grid');
  const frame = $('#frame');
  const backdrop = $('#backdrop');
  const nameCard = $('#nameCard');
  const nameInput = $('#nameInput');
  const inspect = $('#inspect');
  const filterCard = $('#filterCard');
  const menuCard = $('#menuCard');
  const dragGhost = $('#dragGhost');
  const toastEl = $('#toast');

  // ---------- utils ----------

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
    return `${MONTHS[m - 1]} ${d}`;
  }
  function save() {
    localStorage.setItem(LS.tree, JSON.stringify(tree));
    localStorage.setItem(LS.struct, structId);
  }
  function saveVis() {
    localStorage.setItem(LS.vis, JSON.stringify(vis));
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function mkTask(title, color, extra = {}) {
    return {
      id: uid(), title, color,
      due: extra.due ?? null,
      priority: extra.priority ?? 'med',
      notes: extra.notes ?? '',
      subs: extra.subs ?? [],
      done: extra.done ?? false,
      createdAt: Date.now(),
    };
  }

  // a filtered-out block rests as open space — the composition keeps its shape
  const isVisible = (t) => vis[t.color] !== false && (!t.done || vis.done !== false);

  // ---------- render ----------

  function computeLayout() {
    const leaves = [], divs = [], rects = {};
    walk(tree, { x: 0, y: 0, w: 1, h: 1 }, leaves, divs, rects);
    return { leaves, divs, rects };
  }

  function blockContent(t, sizeClass) {
    if (!t) return '';
    const due = fmtDue(t.due);
    const overdue = t.due && t.due < localISO(0) && !t.done;
    let html = `<span class="b-title">${escapeHtml(t.title)}</span>`;
    if (t.done) html += `<span class="b-check">${sizeClass ? '✓' : '✓ COMPLETE'}</span>`;
    else if (due && sizeClass !== 'tiny') html += `<span class="b-due">${overdue ? '⚠ ' : ''}${due}</span>`;
    if (t.priority === 'high' && !t.done) html += '<span class="b-flag"></span>';
    return html;
  }

  function render(animate = true) {
    if (!animate) grid.classList.add('no-anim');
    const { leaves, divs } = computeLayout();
    const gw = grid.clientWidth, gh = grid.clientHeight;
    const seen = new Set();

    for (const { node, rect } of leaves) {
      seen.add(node.id);
      let el = blockEls.get(node.id);
      if (!el) {
        el = document.createElement('div');
        el.dataset.id = node.id;
        el.classList.add('new-block');
        grid.appendChild(el);
        blockEls.set(node.id, el);
        setTimeout(() => el.classList.remove('new-block'), 450);
      }
      const pw = rect.w * gw, ph = rect.h * gh;
      const sizeClass = (pw * ph < 5200 || pw < 62 || ph < 44) ? 'tiny'
        : (pw * ph < 11000 || pw < 92 || ph < 62) ? 'small' : '';
      const t = node.task;
      const filtered = t && !isVisible(t);
      el.className = 'block'
        + (t && !filtered ? (t.done ? ' done' : ` ${t.color}`) : ' open')
        + (filtered ? ' filtered' : '')
        + (sizeClass ? ' ' + sizeClass : '');
      el.style.left = `calc(${rect.x * 100}% + 3px)`;
      el.style.top = `calc(${rect.y * 100}% + 3px)`;
      el.style.width = `calc(${rect.w * 100}% - 6px)`;
      el.style.height = `calc(${rect.h * 100}% - 6px)`;
      el.innerHTML = filtered ? '' : blockContent(t, sizeClass);
    }
    for (const [id, el] of blockEls) {
      if (!seen.has(id)) { el.remove(); blockEls.delete(id); }
    }

    const seenDivs = new Set();
    for (const d of divs) {
      seenDivs.add(d.node.id);
      let el = divEls.get(d.node.id);
      if (!el) {
        el = document.createElement('div');
        el.dataset.node = d.node.id;
        grid.appendChild(el);
        divEls.set(d.node.id, el);
      }
      el.className = `divider ${d.dir}`;
      if (d.dir === 'v') {
        el.style.left = `calc(${d.line.x * 100}% - 8px)`;
        el.style.top = d.line.y * 100 + '%';
        el.style.width = '16px';
        el.style.height = d.line.len * 100 + '%';
      } else {
        el.style.left = d.line.x * 100 + '%';
        el.style.top = `calc(${d.line.y * 100}% - 8px)`;
        el.style.width = d.line.len * 100 + '%';
        el.style.height = '16px';
      }
    }
    for (const [id, el] of divEls) {
      if (!seenDivs.has(id)) { el.remove(); divEls.delete(id); }
    }

    if (!animate) requestAnimationFrame(() => grid.classList.remove('no-anim'));
  }

  // ---------- filter ----------

  function buildFilterCard() {
    const row = $('#filterRow');
    row.innerHTML = Object.keys(CATS).map((c) =>
      `<button class="cat-pick ${vis[c] !== false ? 'on' : ''}" data-c="${c}" style="background:${CATS[c].hex}" title="${CATS[c].label}" aria-label="${c} — ${CATS[c].label}"></button>`).join('');
    row.querySelectorAll('[data-c]').forEach((b) =>
      b.addEventListener('click', () => {
        vis[b.dataset.c] = vis[b.dataset.c] === false;
        b.classList.toggle('on', vis[b.dataset.c] !== false);
        saveVis();
        render();
      }));
    $('#filterDone').classList.toggle('on', vis.done !== false);
  }

  $('#filterDone').addEventListener('click', () => {
    vis.done = vis.done === false;
    $('#filterDone').classList.toggle('on', vis.done !== false);
    saveVis();
    render();
  });

  // ---------- split / fill / merge / remove ----------

  function splitLeaf(leaf) {
    const { rects } = computeLayout();
    const rect = rects[leaf.id];
    const gw = grid.clientWidth, gh = grid.clientHeight;
    const pw = rect.w * gw, ph = rect.h * gh;
    if (pw < 110 && ph < 96) {
      showToast('Too small to divide. Merge something first.');
      return;
    }
    const revert = JSON.stringify(tree);
    const dir = pw >= ph ? 'v' : 'h';
    const newLeaf = L(null);
    const kept = { id: leaf.id, task: leaf.task };
    const internal = { id: uid(), dir, ratio: 0.55, kids: [kept, newLeaf] };
    const parent = findParent(tree, leaf.id);
    if (parent) replaceChild(parent, leaf.id, internal);
    else tree = internal;
    render();
    openNameCard({ type: 'split', leafId: newLeaf.id, revert });
  }

  function openNameCard(p, prefill = '') {
    pending = p;
    $('#nameCardTitle').textContent = p.type === 'merge' ? 'Name the Project' : 'New Task';
    nameInput.value = prefill;
    nameInput.placeholder = p.type === 'merge' ? 'What is this now?' : 'What is it?';
    const cr = $('#catRow');
    const def = p.prefillColor || 'blue';
    cr.innerHTML = Object.keys(CATS).map((c) =>
      `<button class="cat-pick ${c === def ? 'on' : ''}" data-cat="${c}" style="background:${CATS[c].hex}" title="${CATS[c].label}" aria-label="${c} — ${CATS[c].label}"></button>`).join('');
    pending.color = def;
    cr.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        pending.color = b.dataset.cat;
        cr.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      }));
    backdrop.hidden = false;
    nameCard.hidden = false;
    setTimeout(() => nameInput.focus(), 40);
  }

  function commitName() {
    if (!pending) return;
    const title = nameInput.value.trim();
    if (!title) { cancelPending(); return; }
    const leaf = findLeaf(tree, pending.leafId);
    if (leaf) {
      leaf.task = mkTask(title, pending.color, { subs: pending.presetSubs || [] });
    }
    pending = null;
    save();
    closeCards();
    render();
    pulse();
  }

  function cancelPending() {
    if (pending && pending.revert) {
      tree = JSON.parse(pending.revert);
      render();
    }
    pending = null;
    closeCards();
  }

  function removeToOpenSpace(leaf) {
    leaf.task = null;
    save();
    render();
  }

  function collapseSpace(leaf) {
    const parent = findParent(tree, leaf.id);
    if (!parent) { showToast('The last block holds the canvas.'); return; }
    const sibling = parent.kids[0].id === leaf.id ? parent.kids[1] : parent.kids[0];
    const grand = findParent(tree, parent.id);
    if (grand) replaceChild(grand, parent.id, sibling);
    else tree = sibling;
    save();
    render();
  }

  function mergeWithSibling(leaf) {
    const parent = findParent(tree, leaf.id);
    if (!parent) return;
    const sib = parent.kids[0].id === leaf.id ? parent.kids[1] : parent.kids[0];
    if (sib.kids || !sib.task || !leaf.task) return;
    const revert = JSON.stringify(tree);
    const a = leaf.task, b = sib.task;
    const merged = L(null);
    const grand = findParent(tree, parent.id);
    if (grand) replaceChild(grand, parent.id, merged);
    else tree = merged;
    render();
    openNameCard({
      type: 'merge',
      leafId: merged.id,
      revert,
      prefillColor: a.color,
      presetSubs: [
        { t: a.title, done: a.done }, { t: b.title, done: b.done },
        ...a.subs, ...b.subs,
      ],
    }, '');
  }

  // ---------- complete ----------

  function completeTask(leaf) {
    const t = leaf.task;
    t.done = true;
    t.doneAt = Date.now();
    save();
    render();
    showToast('Complete. Open space restores calm.', 'Undo', () => {
      t.done = false;
      t.doneAt = null;
      save();
      render();
    });
    pulse();
  }

  // ---------- structures / redistribute ----------

  function structThumb(id) {
    const t = STRUCTS[id].make();
    const leaves = [], divs = [], rects = {};
    walk(t, { x: 0, y: 0, w: 1, h: 1 }, leaves, divs, rects);
    const cols = ['#d92311', '#1a4ba0', '#f2c500', '#f6f3ec', '#1a4ba0', '#f6f3ec', '#f2c500', '#f6f3ec', '#d92311', '#f6f3ec'];
    const rectsSvg = leaves
      .sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h))
      .map(({ rect }, i) =>
        `<rect x="${rect.x * 36 + 0.8}" y="${rect.y * 42 + 0.8}" width="${rect.w * 36 - 1.6}" height="${rect.h * 42 - 1.6}" fill="${cols[i % cols.length]}"/>`)
      .join('');
    return `<svg class="struct-thumb" viewBox="-1 -1 38 44" xmlns="http://www.w3.org/2000/svg"><rect x="-1" y="-1" width="38" height="44" fill="#14120e"/>${rectsSvg}</svg>`;
  }

  function applyStructure(id) {
    structId = id;
    const taskLeaves = allTaskLeaves(tree);
    const open = taskLeaves.filter((n) => !n.task.done)
      .sort((a, b) => (PRI_W[b.task.priority] - PRI_W[a.task.priority]) || ((a.task.due || '9') < (b.task.due || '9') ? -1 : 1));
    const done = taskLeaves.filter((n) => n.task.done);
    const tasks = [...open, ...done].map((n) => n.task);

    let newTree = STRUCTS[id].make();
    // grow the template until every task has a slot
    const slots = () => {
      const leaves = [], divs = [], rects = {};
      walk(newTree, { x: 0, y: 0, w: 1, h: 1 }, leaves, divs, rects);
      return leaves.sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
    };
    let s = slots();
    while (s.length < tasks.length) {
      const big = s[0];
      const dir = big.rect.w >= big.rect.h ? 'v' : 'h';
      const internal = { id: uid(), dir, ratio: 0.5, kids: [{ id: big.node.id, task: null }, L(null)] };
      const parent = findParent(newTree, big.node.id);
      if (parent) replaceChild(parent, big.node.id, internal);
      else newTree = internal;
      s = slots();
    }
    s.forEach((slot, i) => { slot.node.task = tasks[i] || null; });
    tree = newTree;
    save();
    blockEls.forEach((el) => el.remove());
    divEls.forEach((el) => el.remove());
    blockEls.clear();
    divEls.clear();
    render(false);
  }

  // ---------- balance & notices ----------

  function balance() {
    const { leaves } = computeLayout();
    const active = leaves.filter((l) => l.node.task && !l.node.task.done);
    if (!active.length) return null;
    let M = 0, mx = 0, my = 0;
    for (const { node, rect } of active) {
      const m = rect.w * rect.h * (PRI_W[node.task.priority] || 2);
      M += m;
      mx += m * (rect.x + rect.w / 2);
      my += m * (rect.y + rect.h / 2);
    }
    return { cx: mx / M, cy: my / M, n: active.length };
  }

  function computeNotices() {
    const out = [];
    const b = balance();
    if (b && b.n >= 3 && (Math.abs(b.cx - 0.5) > 0.15 || b.cy > 0.62)) {
      out.push({
        text: 'Your composition is becoming unbalanced. Consider redistributing your tasks.',
        action: 'Redistribute',
        run: () => { applyStructure(structId); closeCards(); showToast('Redistributed. Balanced and clear.'); },
      });
    }
    const n = allTaskLeaves(tree)
      .filter((x) => !x.task.done && x.task.due && x.task.due < localISO(0)).length;
    if (n) out.push({ text: `${n} ${n === 1 ? 'block is' : 'blocks are'} overdue. Review and reprioritize.` });
    return out;
  }

  function buildMenuCard() {
    $('#structs').innerHTML = Object.entries(STRUCTS).map(([id, s]) => `
      <button class="struct-pick ${id === structId ? 'on' : ''}" data-struct="${id}">
        ${structThumb(id)}
        <span><span class="struct-name">${s.name}</span><br/><span class="struct-desc">${s.desc}</span></span>
      </button>`).join('');
    document.querySelectorAll('[data-struct]').forEach((b) =>
      b.addEventListener('click', () => {
        applyStructure(b.dataset.struct);
        closeCards();
        showToast(`${STRUCTS[b.dataset.struct].name}. The grid adapts to your day.`);
      }));

    const ul = $('#notices');
    ul.textContent = '';
    const ns = computeNotices();
    if (!ns.length) {
      ul.innerHTML = '<li class="quiet">All clear. The composition holds.</li>';
    } else {
      for (const n of ns) {
        const li = document.createElement('li');
        if (!n.action) li.className = 'calm';
        li.innerHTML = '<i></i>';
        li.appendChild(document.createTextNode(n.text));
        if (n.action) {
          const btn = document.createElement('button');
          btn.textContent = n.action;
          btn.addEventListener('click', n.run);
          li.appendChild(btn);
        }
        ul.appendChild(li);
      }
    }
  }

  // ---------- inspect ----------

  function openInspect(leaf, refocusSub = false) {
    closeCards();
    const t = leaf.task;
    const dueTxt = fmtDue(t.due);
    const overdue = t.due && t.due < localISO(0) && !t.done;
    const parent = findParent(tree, leaf.id);
    const sib = parent ? (parent.kids[0].id === leaf.id ? parent.kids[1] : parent.kids[0]) : null;
    const canMerge = sib && !sib.kids && sib.task && !t.done && !sib.task.done;
    inspect.innerHTML = `
      <div class="insp-head">
        <span class="insp-cat" style="background:${CATS[t.color].hex}"></span>
        <div class="insp-title" id="inspTitle">${escapeHtml(t.title)}</div>
        <button class="card-x" data-close aria-label="Close">✕</button>
      </div>
      <p class="card-label">Subtasks</p>
      <ul class="subtasks" id="subList">
        ${t.subs.map((s, i) => `
          <li class="subtask ${s.done ? 'done' : ''}">
            <input type="checkbox" id="sub${i}" data-sub="${i}" ${s.done ? 'checked' : ''} />
            <label for="sub${i}">${escapeHtml(s.t)}</label>
            <button class="sub-x" data-subx="${i}" aria-label="Remove">✕</button>
          </li>`).join('')}
      </ul>
      <input class="sub-add" id="subAdd" type="text" placeholder="+ Add subtask" maxlength="60" />
      <div class="insp-row">
        <span class="insp-label">Due</span>
        <button class="insp-due" id="inspDue">${dueTxt ? (overdue ? `<span class="overdue">${dueTxt} — overdue</span>` : dueTxt) : 'No date'}</button>
        <input type="date" class="insp-date" id="inspDate" value="${t.due || ''}" />
      </div>
      <div class="insp-row">
        <span class="insp-label">Priority</span>
        <div class="chip-row">
          ${['low', 'med', 'high'].map((p) => `<button class="chip ${t.priority === p ? 'on' : ''}" data-pri="${p}">${p === 'med' ? 'Medium' : p[0].toUpperCase() + p.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="insp-row">
        <span class="insp-label">Category</span>
        <div class="mini-cats">
          ${Object.keys(CATS).map((c) => `<button class="cat-pick ${t.color === c ? 'on' : ''}" data-cat="${c}" style="background:${CATS[c].hex}" aria-label="${c}"></button>`).join('')}
        </div>
      </div>
      <textarea class="insp-notes" id="inspNotes" rows="2" placeholder="Notes">${escapeHtml(t.notes || '')}</textarea>
      <div class="insp-actions">
        <button class="btn-solid" id="inspDone">${t.done ? 'Restore' : '✓ Complete'}</button>
        ${canMerge ? `<button class="btn-plain" id="inspMerge">Merge with “${escapeHtml(sib.task.title.slice(0, 14))}${sib.task.title.length > 14 ? '…' : ''}”</button>` : ''}
        <button class="danger" id="inspDelete">Remove — leave open space</button>
      </div>
    `;
    backdrop.hidden = false;
    inspect.hidden = false;

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
        save();
        render();
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } });
      input.addEventListener('blur', commit);
    });

    inspect.querySelectorAll('[data-sub]').forEach((cb) =>
      cb.addEventListener('change', () => {
        t.subs[+cb.dataset.sub].done = cb.checked;
        cb.closest('.subtask').classList.toggle('done', cb.checked);
        save();
      }));
    inspect.querySelectorAll('[data-subx]').forEach((b) =>
      b.addEventListener('click', () => {
        t.subs.splice(+b.dataset.subx, 1);
        save();
        openInspect(leaf);
      }));
    $('#subAdd').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = $('#subAdd').value.trim();
        if (!v) return;
        t.subs.push({ t: v, done: false });
        save();
        openInspect(leaf, true);
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
      save();
      $('#inspDue').textContent = fmtDue(t.due) || 'No date';
      render();
    });

    inspect.querySelectorAll('[data-pri]').forEach((b) =>
      b.addEventListener('click', () => {
        t.priority = b.dataset.pri;
        inspect.querySelectorAll('[data-pri]').forEach((x) => x.classList.toggle('on', x === b));
        save();
        render();
      }));
    inspect.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        t.color = b.dataset.cat;
        inspect.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
        $('.insp-cat').style.background = CATS[t.color].hex;
        save();
        render();
      }));

    $('#inspNotes').addEventListener('change', () => {
      t.notes = $('#inspNotes').value.trim();
      save();
    });

    $('#inspDone').addEventListener('click', () => {
      closeCards();
      if (t.done) { t.done = false; t.doneAt = null; save(); render(); }
      else completeTask(leaf);
    });
    const mg = $('#inspMerge');
    if (mg) mg.addEventListener('click', () => {
      closeCards();
      mergeWithSibling(leaf);
    });
    $('#inspDelete').addEventListener('click', () => {
      closeCards();
      removeToOpenSpace(leaf);
      showToast('Removed. Open space improves balance.');
    });
    inspect.querySelector('[data-close]').addEventListener('click', closeCards);
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

  frame.addEventListener('contextmenu', (e) => e.preventDefault());

  frame.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    const divEl = e.target.closest('.divider');
    const blockEl = e.target.closest('.block');

    if (divEl) {
      const nodeId = divEl.dataset.node;
      const { rects } = computeLayout();
      const node = (function find(n) {
        if (n.id === nodeId) return n;
        if (!n.kids) return null;
        return find(n.kids[0]) || find(n.kids[1]);
      })(tree);
      gest = { type: 'divider', id: e.pointerId, node, rect: rects[nodeId] };
      grid.classList.add('no-anim');
      try { frame.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      return;
    }
    if (!blockEl) return;
    const leaf = findLeaf(tree, blockEl.dataset.id);
    if (!leaf) return;
    if (leaf.task && !isVisible(leaf.task)) return; // filtered blocks rest untouched
    gest = {
      type: 'block',
      id: e.pointerId,
      leaf, el: blockEl,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      t0: performance.now(),
      sub: null, // 'swipe' | 'drag'
      path: 0,
      overEl: null,
    };
    try { frame.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });

  frame.addEventListener('pointermove', (e) => {
    if (!gest || e.pointerId !== gest.id) return;

    if (gest.type === 'divider') {
      const gr = grid.getBoundingClientRect();
      const { node, rect } = gest;
      if (node.dir === 'v') {
        const x = (e.clientX - gr.left) / gr.width;
        const minR = 56 / (rect.w * gr.width);
        node.ratio = clamp((x - rect.x) / rect.w, Math.min(minR, 0.45), 1 - Math.min(minR, 0.45));
      } else {
        const y = (e.clientY - gr.top) / gr.height;
        const minR = 44 / (rect.h * gr.height);
        node.ratio = clamp((y - rect.y) / rect.h, Math.min(minR, 0.45), 1 - Math.min(minR, 0.45));
      }
      render();
      return;
    }

    const dx = e.clientX - gest.lastX, dy = e.clientY - gest.lastY;
    gest.path += Math.hypot(dx, dy);
    gest.lastX = e.clientX; gest.lastY = e.clientY;
    const dist = Math.hypot(e.clientX - gest.startX, e.clientY - gest.startY);

    if (!gest.sub && dist > 12) {
      const fast = performance.now() - gest.t0 < 110;
      const t = gest.leaf.task;
      if (fast && t && !t.done) {
        gest.sub = 'swipe';
        gest.el.classList.add('swiping');
      } else if (t) {
        gest.sub = 'drag';
        gest.el.classList.add('drag-src');
        dragGhost.textContent = t.title;
        dragGhost.hidden = false;
      } else {
        gest.sub = 'none';
      }
    }
    if (gest.sub === 'swipe') {
      gest.el.style.translate = `${e.clientX - gest.startX}px 0`;
      gest.el.style.opacity = String(clamp(1 - Math.abs(e.clientX - gest.startX) / 260, 0.4, 1));
    } else if (gest.sub === 'drag') {
      dragGhost.style.left = e.clientX + 'px';
      dragGhost.style.top = e.clientY + 'px';
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.block:not(.filtered)');
      if (gest.overEl && gest.overEl !== under) gest.overEl.classList.remove('drag-over');
      if (under && under !== gest.el) {
        under.classList.add('drag-over');
        gest.overEl = under;
      } else {
        gest.overEl = null;
      }
    }
  });

  function endGesture(e, cancelled) {
    if (!gest || e.pointerId !== gest.id) return;
    const g = gest;
    gest = null;

    if (g.type === 'divider') {
      grid.classList.remove('no-anim');
      save();
      return;
    }

    dragGhost.hidden = true;
    g.el.classList.remove('drag-src', 'swiping');
    g.el.style.translate = '';
    g.el.style.opacity = '';
    if (g.overEl) g.overEl.classList.remove('drag-over');

    if (cancelled) return;

    if (g.sub === 'swipe') {
      const swept = Math.abs(g.lastX - g.startX);
      if (swept > g.el.offsetWidth * 0.45) {
        completeTask(g.leaf);
        swallowNextClick();
      }
      return;
    }
    if (g.sub === 'drag') {
      if (g.overEl) {
        const other = findLeaf(tree, g.overEl.dataset.id);
        if (other) {
          const tmp = g.leaf.task;
          g.leaf.task = other.task;
          other.task = tmp;
          save();
          render();
          swallowNextClick();
        }
      }
      return;
    }
    if (g.sub === 'none') return;

    // plain tap
    if (splitMode) {
      exitSplitMode();
      splitLeaf(g.leaf);
      swallowNextClick();
      return;
    }
    if (g.leaf.task) {
      openInspect(g.leaf);
    } else {
      openNameCard({ type: 'fill', leafId: g.leaf.id, revert: null, canCollapse: true });
    }
    swallowNextClick();
  }

  frame.addEventListener('pointerup', (e) => endGesture(e, false));
  frame.addEventListener('pointercancel', (e) => endGesture(e, true));

  // ---------- split mode ----------

  function enterSplitMode() {
    splitMode = true;
    frame.classList.add('splitting');
    $('#splitBtn').classList.add('active');
    $('#splitHint').hidden = false;
    closeCards();
  }
  function exitSplitMode() {
    splitMode = false;
    frame.classList.remove('splitting');
    $('#splitBtn').classList.remove('active');
    $('#splitHint').hidden = true;
  }
  $('#splitBtn').addEventListener('click', () => {
    if (splitMode) exitSplitMode();
    else enterSplitMode();
  });

  // ---------- cards ----------

  function openCard(card) {
    closeCards();
    exitSplitMode();
    if (card === filterCard) buildFilterCard();
    if (card === menuCard) buildMenuCard();
    backdrop.hidden = false;
    card.hidden = false;
  }
  function closeCards() {
    backdrop.hidden = true;
    nameCard.hidden = true;
    inspect.hidden = true;
    filterCard.hidden = true;
    menuCard.hidden = true;
  }
  $('#filterBtn').addEventListener('click', () => openCard(filterCard));
  $('#menuBtn').addEventListener('click', () => openCard(menuCard));
  $('#nameSave').addEventListener('click', commitName);
  $('#nameCancel').addEventListener('click', cancelPending);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitName(); }
    if (e.key === 'Escape') cancelPending();
  });
  backdrop.addEventListener('click', () => {
    if (pending) cancelPending();
    else closeCards();
  });
  document.querySelectorAll('#filterCard [data-close], #menuCard [data-close]').forEach((b) =>
    b.addEventListener('click', closeCards));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pending) cancelPending();
      else closeCards();
      exitSplitMode();
    }
  });

  $('#clearDone').addEventListener('click', () => {
    let n = 0;
    for (const leaf of allLeaves(tree)) {
      if (leaf.task && leaf.task.done) { leaf.task = null; n++; }
    }
    save();
    render();
    closeCards();
    showToast(n ? `${n} ${n === 1 ? 'block' : 'blocks'} cleared into open space.` : 'Nothing completed yet.');
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
      if (!toastShown.has(n.text)) {
        toastShown.add(n.text);
        setTimeout(() => showToast(n.text), 700);
        return;
      }
    }
  }

  // ---------- boot ----------

  // give a task the largest open slot, splitting the largest block if none is free
  function placeTask(task) {
    const leaves = [], divs = [], rects = {};
    walk(tree, { x: 0, y: 0, w: 1, h: 1 }, leaves, divs, rects);
    leaves.sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
    const open = leaves.find((l) => !l.node.task);
    if (open) { open.node.task = task; return; }
    const big = leaves[0];
    const dir = big.rect.w >= big.rect.h ? 'v' : 'h';
    const internal = { id: uid(), dir, ratio: 0.5, kids: [{ id: big.node.id, task: big.node.task }, L(task)] };
    const parent = findParent(tree, big.node.id);
    if (parent) replaceChild(parent, big.node.id, internal);
    else tree = internal;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS.tree);
      if (raw) tree = JSON.parse(raw);
    } catch { /* fall through */ }
    if (!tree) {
      // migrate pre-filter data: layers were separate compositions — fold them into one
      try {
        const old = JSON.parse(localStorage.getItem('mond.layers'));
        if (old && typeof old === 'object') {
          tree = old[localStorage.getItem('mond.layer')] || old.today || Object.values(old)[0];
          for (const t of Object.values(old)) {
            if (t === tree) continue;
            for (const leaf of allTaskLeaves(t)) placeTask(leaf.task);
          }
        }
      } catch { /* fall through */ }
    }
    if (!tree) tree = L(null);
    localStorage.removeItem('mond.layers');
    localStorage.removeItem('mond.layer');
    try {
      const v = JSON.parse(localStorage.getItem(LS.vis));
      if (v && typeof v === 'object') {
        for (const k of Object.keys(vis)) if (typeof v[k] === 'boolean') vis[k] = v[k];
      }
    } catch { /* ignore */ }
  }

  // ---------- onboarding ----------

  const OB_KEY = 'mond.seen';
  const onboard = $('#onboard');
  if (onboard && !localStorage.getItem(OB_KEY)) {
    onboard.hidden = false;
    $('#onboardGo').addEventListener('click', () => {
      localStorage.setItem(OB_KEY, '1');
      onboard.hidden = true;
    });
  }

  load();
  save();
  saveVis();
  render(false);
  window.addEventListener('resize', () => render(false));
  pulse();
})();
