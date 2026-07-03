/* Mondrian / Todo — every rectangle is a task. */
(() => {
  'use strict';

  // ---------- constants ----------

  const LS = {
    layers: 'mond.layers',
    layer: 'mond.layer',
    struct: 'mond.struct',
  };

  const CATS = {
    red: { hex: '#d92311', label: 'urgent' },
    blue: { hex: '#1a4ba0', label: 'work / project' },
    yellow: { hex: '#f2c500', label: 'personal / quick' },
    white: { hex: '#f6f3ec', label: 'open / neutral' },
  };

  const LAYER_META = [
    { id: 'today', name: 'Today' },
    { id: 'work', name: 'Work' },
    { id: 'home', name: 'Home' },
    { id: 'ideas', name: 'Ideas' },
    { id: 'waiting', name: 'Waiting' },
  ];

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

  let layers = null; // { layerId: tree }
  let layerId = localStorage.getItem(LS.layer) || 'today';
  let structId = localStorage.getItem(LS.struct) || 'structured';
  let tree = null;
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
  const layersCard = $('#layersCard');
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
    localStorage.setItem(LS.layers, JSON.stringify(layers));
    localStorage.setItem(LS.layer, layerId);
    localStorage.setItem(LS.struct, structId);
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
      el.className = 'block'
        + (t ? (t.done ? ' done' : ` ${t.color}`) : ' open')
        + (sizeClass ? ' ' + sizeClass : '');
      el.style.left = `calc(${rect.x * 100}% + 3px)`;
      el.style.top = `calc(${rect.y * 100}% + 3px)`;
      el.style.width = `calc(${rect.w * 100}% - 6px)`;
      el.style.height = `calc(${rect.h * 100}% - 6px)`;
      el.innerHTML = blockContent(t, sizeClass);
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

  // ---------- layers ----------

  function setLayer(id, rerender = true) {
    layerId = id;
    tree = layers[id];
    $('#layerTitle').textContent = LAYER_META.find((l) => l.id === id)?.name || id;
    if (rerender) {
      blockEls.forEach((el) => el.remove());
      divEls.forEach((el) => el.remove());
      blockEls.clear();
      divEls.clear();
      render(false);
    }
    save();
  }

  function buildLayersCard() {
    const ul = $('#layerList');
    ul.textContent = '';
    for (const Lm of LAYER_META) {
      const open = allTaskLeaves(layers[Lm.id]).filter((n) => !n.task.done).length;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'layer-row' + (Lm.id === layerId ? ' current' : '');
      const sw = document.createElement('span');
      sw.className = 'layer-sw';
      // mini color: dominant category of the layer
      const cats = allTaskLeaves(layers[Lm.id]).filter((n) => !n.task.done).map((n) => n.task.color);
      const dom = ['red', 'blue', 'yellow'].map((c) => [c, cats.filter((x) => x === c).length])
        .sort((a, b) => b[1] - a[1])[0];
      sw.style.background = dom && dom[1] ? CATS[dom[0]].hex : CATS.white.hex;
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = Lm.name;
      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = open || '';
      btn.append(sw, name, count);
      if (Lm.id === layerId) {
        const chk = document.createElement('span');
        chk.className = 'layer-check';
        chk.textContent = '✓';
        btn.appendChild(chk);
      }
      btn.addEventListener('click', () => { setLayer(Lm.id); closeCards(); });
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

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
    else { layers[layerId] = internal; tree = internal; }
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
      layers[layerId] = JSON.parse(pending.revert);
      tree = layers[layerId];
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
    else { layers[layerId] = sibling; tree = sibling; }
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
    else { layers[layerId] = merged; tree = merged; }
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
    layers[layerId] = newTree;
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
    for (const Lm of LAYER_META) {
      const n = allTaskLeaves(layers[Lm.id])
        .filter((x) => !x.task.done && x.task.due && x.task.due < localISO(0)).length;
      if (n) out.push({ text: `${n} ${Lm.name.toLowerCase()} ${n === 1 ? 'block is' : 'blocks are'} overdue. Review and reprioritize.` });
    }
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
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.block');
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
    if (card === layersCard) buildLayersCard();
    if (card === menuCard) buildMenuCard();
    backdrop.hidden = false;
    card.hidden = false;
  }
  function closeCards() {
    backdrop.hidden = true;
    nameCard.hidden = true;
    inspect.hidden = true;
    layersCard.hidden = true;
    menuCard.hidden = true;
  }
  $('#layersBtn').addEventListener('click', () => openCard(layersCard));
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
  document.querySelectorAll('#layersCard [data-close], #menuCard [data-close]').forEach((b) =>
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

  // ---------- samples ----------

  function sampleLayers() {
    return {
      today: V(0.6,
        H(0.44,
          L(mkTask('Client Presentation', 'red', { due: localISO(0), priority: 'high' })),
          H(0.52,
            L(mkTask('Gym', 'yellow', { due: localISO(0) })),
            L(mkTask('Design Review', 'blue', {
              due: localISO(0),
              subs: [{ t: 'Collect feedback', done: false }, { t: 'Revise slides', done: false }, { t: 'Share with team', done: false }],
            })))),
        H(0.34,
          L(mkTask('Project Research', 'blue', { due: localISO(2) })),
          H(0.5,
            L(mkTask('Email Inbox', 'white', { priority: 'low' })),
            V(0.48,
              L(mkTask('Call Sam', 'white', { priority: 'low' })),
              L(mkTask('Grocery Run', 'yellow')))))),
      work: H(0.55,
        V(0.6,
          L(mkTask('Quarterly report', 'blue', { due: localISO(-1), priority: 'high' })),
          L(mkTask('1:1 prep', 'blue', { due: localISO(-2) }))),
        V(0.4,
          L(mkTask('Ship landing page', 'blue', { due: localISO(3) })),
          L(null))),
      home: V(0.6,
        H(0.55, L(mkTask('Fix the tap', 'yellow')), L(null)),
        H(0.45, L(mkTask('Plant the herbs', 'yellow')), L(null))),
      ideas: V(0.6,
        H(0.55, L(mkTask('App with no lists', 'blue')), L(null)),
        H(0.45, L(null), L(mkTask('Paint the hallway', 'yellow')))),
      waiting: H(0.55,
        V(0.6, L(mkTask('Passport renewal', 'red', { due: localISO(14) })), L(null)),
        V(0.4, L(null), L(null))),
    };
  }

  // ---------- boot ----------

  function load() {
    try {
      const raw = localStorage.getItem(LS.layers);
      if (raw) {
        layers = JSON.parse(raw);
        if (LAYER_META.every((l) => layers[l.id])) return;
      }
    } catch { /* fall through */ }
    layers = sampleLayers();
  }

  load();
  setLayer(layers[layerId] ? layerId : 'today');
  save();
  window.addEventListener('resize', () => render(false));
  pulse();
})();
