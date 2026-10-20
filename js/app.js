import { HOLD_TYPES, SIZES, GRADES, gradeLabel, cmPerPx, holdRadiusPx, migrateWall } from './model.js';
import { evaluateProblem, generate, calibrateAll, REF_CLIMBER } from './engine.js';
import { drawScene, renderShareImage, ROLE_COLORS } from './render.js';
import * as store from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmtDate = t => new Date(t).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
const dpr = () => window.devicePixelRatio || 1;

const MOVE_TAGS = { cruce: 'Cruce', lance: 'Lance', compresion: 'Compresión' };
const FEEL = { facil: 'más fácil que el grado', justo: 'justo', dificil: 'más difícil que el grado' };

let S = store.load();
if (S.walls.map(migrateWall).some(Boolean)) store.save(S);
const ui = {
  wall: null, img: null, imgUrl: null, tab: 'presas',
  view: { s: 1, ox: 0, oy: 0 }, zoomed: false,
  holdType: 'regleta', holdSize: 'M', sel: null, lastAdded: [],
  pending: null,     // 'A' | 'B' | 'floor' mientras se marca la escala
  draft: null,       // boulder del armador que se está marcando
  gen: { targetV: 2, moves: 6, wanted: { cruce: 0, lance: 0, compresion: 0 } },
  results: [], resultIdx: 0, genMsg: '', busy: false,
  show: null,        // id del boulder guardado que se está mirando
  logDraft: null,
};

function save() {
  if (!store.save(S)) toast('No se pudo guardar: el navegador está sin espacio o en modo privado.');
}
const fit = () => calibrateAll(S.walls);
const ready = w => !!cmPerPx(w) && w.floorY != null;
const findProblem = id => ui.wall?.problems.find(p => p.id === id) || null;

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('formato de imagen no soportado'));
    im.src = src;
  });
}

async function downscale(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(im, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const blobToDataURL = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

// ---------------------------------------------------------------- Inicio

const thumbs = new Map();

function renderHome() {
  closeWall();
  showScreen('home');
  const list = $('#wallList');
  const walls = [...S.walls].sort((a, b) => b.createdAt - a.createdAt);
  list.innerHTML = walls.length ? walls.map(w => `
    <li><button class="item" data-wall="${w.id}">
      <img data-thumb="${w.id}" alt="">
      <span><b>${esc(w.name)}</b><small>${w.holds.length} presas · ${w.problems.length} boulders · ${fmtDate(w.createdAt)}</small></span>
    </button></li>`).join('') : '<li class="empty">Todavía no hay muros. Parte sacando una foto.</li>';
  for (const im of list.querySelectorAll('img[data-thumb]')) {
    const id = im.dataset.thumb;
    if (thumbs.has(id)) { im.src = thumbs.get(id); continue; }
    store.getImage(id).then(b => {
      if (!b) return;
      const u = URL.createObjectURL(b);
      thumbs.set(id, u);
      im.src = u;
    });
  }
}

$('#wallList').addEventListener('click', e => {
  const b = e.target.closest('[data-wall]');
  if (b) openWall(b.dataset.wall);
});

$('#fileNew').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const { blob, w, h } = await downscale(f, 1600);
    const wall = {
      id: uid(), name: 'Muro ' + new Date().toLocaleDateString('es-CL'), createdAt: Date.now(),
      imgW: w, imgH: h, scale: { cm: 122 }, floorY: null, angle: 0, holds: [], problems: [],
    };
    await store.putImage(wall.id, blob);
    S.walls.push(wall);
    save();
    store.askPersistence();
    openWall(wall.id, 'escala');
  } catch (err) {
    alert('No pude abrir esa imagen: ' + err.message);
  }
});

// ---------------------------------------------------------------- Perfil y respaldo

$('#btnProfile').addEventListener('click', openProfile);

function openProfile() {
  $('#inHeight').value = S.climber.heightCm;
  $('#inWingspan').value = S.climber.wingspanCm;
  $('#dlgProfile').showModal();
}

$('#dlgProfile').addEventListener('close', () => {
  const h = +$('#inHeight').value, w = +$('#inWingspan').value;
  if (h >= 100 && h <= 230) S.climber.heightCm = h;
  if (w >= 100 && w <= 240) S.climber.wingspanCm = w;
  save();
  if (ui.wall) { renderPanel(); draw(); }
});

$('#btnExport').addEventListener('click', async () => {
  const images = {};
  for (const w of S.walls) {
    const b = await store.getImage(w.id);
    if (b) images[w.id] = await blobToDataURL(b);
  }
  const data = { app: 'boulder-lab', version: 1, exportedAt: new Date().toISOString(), climber: S.climber, walls: S.walls, images };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `boulder-lab-${new Date().toISOString().slice(0, 10)}.json`);
});

$('#fileImport').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'boulder-lab' || !Array.isArray(d.walls)) throw new Error('no es un respaldo de Boulder Lab');
    const clash = d.walls.filter(w => S.walls.some(x => x.id === w.id)).length;
    const replace = clash ? confirm(`${clash} muro(s) del respaldo ya están en este teléfono. ¿Reemplazarlos con la versión del respaldo?`) : false;
    let added = 0, replaced = 0;
    for (const w of d.walls) {
      w.holds ||= [];
      w.problems ||= [];
      migrateWall(w);
      const i = S.walls.findIndex(x => x.id === w.id);
      if (i >= 0 && !replace) continue;
      if (i >= 0) { S.walls[i] = w; replaced++; } else { S.walls.push(w); added++; }
      if (d.images?.[w.id]) await store.putImage(w.id, await (await fetch(d.images[w.id])).blob());
      thumbs.delete(w.id);
    }
    save();
    $('#dlgProfile').close();
    renderHome();
    alert(`Listo: ${added} muro(s) nuevos y ${replaced} reemplazados.`);
  } catch (err) {
    alert('No pude importar: ' + err.message);
  }
});

// ---------------------------------------------------------------- Muro

async function openWall(id, tab) {
  const w = S.walls.find(x => x.id === id);
  if (!w) return;
  closeWall();
  Object.assign(ui, {
    wall: w, sel: null, lastAdded: [], pending: null, draft: null,
    results: [], resultIdx: 0, genMsg: '', show: null, logDraft: null, zoomed: false,
  });
  ui.tab = tab || (!ready(w) ? 'escala' : w.holds.length < 8 ? 'presas' : 'generar');
  $('#wallName').textContent = w.name;
  showScreen('wall');
  renderPanel();
  resize();
  const blob = await store.getImage(id);
  if (blob && ui.wall === w) {
    ui.imgUrl = URL.createObjectURL(blob);
    ui.img = await loadImg(ui.imgUrl);
  }
  if (!blob) toast('Este muro no tiene foto guardada en este teléfono.');
  fitView();
  draw();
}

function closeWall() {
  if (ui.imgUrl) URL.revokeObjectURL(ui.imgUrl);
  ui.wall = null;
  ui.img = null;
  ui.imgUrl = null;
}

$('#btnBack').addEventListener('click', renderHome);

$('#btnRename').addEventListener('click', async () => {
  const w = ui.wall;
  const n = prompt('Nombre del muro (escribe BORRAR para eliminarlo):', w.name);
  if (n == null) return;
  if (n.trim().toUpperCase() === 'BORRAR') {
    if (!confirm(`¿Borrar "${w.name}" con todas sus presas y boulders?`)) return;
    S.walls = S.walls.filter(x => x !== w);
    save();
    await store.deleteImage(w.id);
    thumbs.delete(w.id);
    renderHome();
    return;
  }
  if (n.trim()) {
    w.name = n.trim();
    save();
    $('#wallName').textContent = w.name;
  }
});

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  ui.tab = b.dataset.tab;
  ui.pending = null;
  ui.sel = null;
  ui.show = null;
  ui.logDraft = null;
  if (ui.tab !== 'gym') ui.draft = null;
  renderPanel();
  draw();
});

// ---------------------------------------------------------------- Canvas: vista, zoom y toques

const cv = $('#cv');
const ctx = cv.getContext('2d');

function resize() {
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr())), h = Math.max(1, Math.round(r.height * dpr()));
  if (cv.width === w && cv.height === h) return false;
  const v = ui.view;
  const cx = (cv.width / 2 - v.ox) / v.s, cy = (cv.height / 2 - v.oy) / v.s;
  cv.width = w;
  cv.height = h;
  ui.view = { s: v.s, ox: w / 2 - cx * v.s, oy: h / 2 - cy * v.s };
  return true;
}

const minScale = () => ui.img ? Math.min(cv.width / ui.img.width, cv.height / ui.img.height) : 1;

function fitView() {
  if (!ui.img) return;
  const s = minScale();
  ui.view = { s, ox: (cv.width - ui.img.width * s) / 2, oy: (cv.height - ui.img.height * s) / 2 };
  ui.zoomed = false;
}

new ResizeObserver(() => {
  if (!ui.wall || !resize()) return;
  if (!ui.zoomed) fitView();
  draw();
}).observe($('#stage'));

let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (!ui.wall) return;
    drawScene(ctx, cv.width, cv.height, ui.img, ui.view, ui.wall, {
      mode: ui.tab, selected: ui.sel, problem: currentProblem(), showAll: ui.tab === 'gym' && !!ui.draft,
    });
  });
}

function currentProblem() {
  if (ui.tab === 'gym' && ui.draft) return draftProblem();
  if (ui.tab === 'generar' && ui.results.length) return ui.results[ui.resultIdx];
  if (ui.show) return findProblem(ui.show);
  return null;
}

function zoomAt(k, cx, cy) {
  const v = ui.view;
  const s = clamp(v.s * k, minScale() * 0.8, minScale() * 12);
  const ix = (cx - v.ox) / v.s, iy = (cy - v.oy) / v.s;
  ui.view = { s, ox: cx - ix * s, oy: cy - iy * s };
  ui.zoomed = true;
  draw();
}

$('.zoom').addEventListener('click', e => {
  const z = e.target.closest('[data-z]')?.dataset.z;
  if (!z) return;
  if (z === 'fit') { fitView(); draw(); } else zoomAt(z === 'in' ? 1.6 : 1 / 1.6, cv.width / 2, cv.height / 2);
});

function pos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * dpr(), y: (e.clientY - r.top) * dpr() };
}

cv.addEventListener('wheel', e => {
  e.preventDefault();
  const p = pos(e);
  zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
}, { passive: false });

// Un dedo: toque o arrastre. Dos dedos: pellizco para zoom.
const ptrs = new Map();
let gesture = null;

cv.addEventListener('pointerdown', e => {
  try { cv.setPointerCapture(e.pointerId); } catch {}
  ptrs.set(e.pointerId, pos(e));
  if (ptrs.size === 1) {
    gesture = { type: 'tap', start: pos(e), view: { ...ui.view } };
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...ui.view } };
  }
});

cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !gesture) return;
  const p = pos(e);
  ptrs.set(e.pointerId, p);
  if (gesture.type === 'tap' || gesture.type === 'pan') {
    const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
    if (gesture.type === 'tap' && Math.hypot(dx, dy) > 10 * dpr()) gesture.type = 'pan';
    if (gesture.type === 'pan') {
      ui.view = { ...gesture.view, ox: gesture.view.ox + dx, oy: gesture.view.oy + dy };
      ui.zoomed = true;
      draw();
    }
  } else if (gesture.type === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const v = gesture.view;
    const s = clamp(v.s * d / gesture.d, minScale() * 0.8, minScale() * 12);
    const ix = (gesture.mid.x - v.ox) / v.s, iy = (gesture.mid.y - v.oy) / v.s;
    ui.view = { s, ox: mid.x - ix * s, oy: mid.y - iy * s };
    ui.zoomed = true;
    draw();
  }
});

function endPointer(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (gesture?.type === 'tap' && e.type === 'pointerup') {
    const v = ui.view;
    onTap({ x: (gesture.start.x - v.ox) / v.s, y: (gesture.start.y - v.oy) / v.s });
  }
  if (ptrs.size === 0) gesture = null;
  else if (gesture) gesture.type = 'none';
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

function hitHold(p) {
  const tol = 14 * dpr() / ui.view.s;
  let best = null, bd = Infinity;
  for (const h of ui.wall.holds) {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= Math.max(holdRadiusPx(ui.wall, h), tol) && d < bd) { best = h; bd = d; }
  }
  return best;
}

function onTap(p) {
  const w = ui.wall;
  if (!w || !ui.img || p.x < 0 || p.y < 0 || p.x > ui.img.width || p.y > ui.img.height) return;
  p = { x: Math.round(p.x), y: Math.round(p.y) };

  if (ui.tab === 'escala') {
    if (ui.pending === 'A') {
      w.scale = { cm: w.scale?.cm ?? 122, a: p, b: null };
      ui.pending = 'B';
      toast('Ahora toca el segundo punto');
    } else if (ui.pending === 'B') {
      w.scale.b = p;
      ui.pending = w.floorY == null ? 'floor' : null;
      toast(ui.pending ? 'Bien. Ahora toca el piso' : 'Escala lista');
    } else if (ui.pending === 'floor') {
      w.floorY = p.y;
      ui.pending = null;
      toast('Piso marcado');
    } else {
      toast('Elige en el panel qué quieres marcar');
      return;
    }
    save();
  } else if (ui.tab === 'presas') {
    const hit = hitHold(p);
    if (hit) ui.sel = ui.sel === hit.id ? null : hit.id;
    else if (ui.sel) ui.sel = null;
    else {
      const h = { id: uid(), x: p.x, y: p.y, type: ui.holdType, size: ui.holdSize };
      w.holds.push(h);
      ui.lastAdded.push(h.id);
      save();
    }
  } else if (ui.tab === 'gym' && ui.draft) {
    const hit = hitHold(p);
    if (!hit) { toast('Toca una presa marcada. Si falta, agrégala en Presas.'); return; }
    const d = ui.draft;
    if (d.mode === 'manos') {
      const i = d.handSeq.indexOf(hit.id);
      if (i >= 0) d.handSeq.splice(i, 1);
      else {
        d.handSeq.push(hit.id);
        d.startFeet = d.startFeet.filter(x => x !== hit.id);
      }
    } else {
      if (d.handSeq.includes(hit.id)) { toast('Esa ya es de mano'); return; }
      const i = d.startFeet.indexOf(hit.id);
      if (i >= 0) d.startFeet.splice(i, 1);
      else {
        d.startFeet.push(hit.id);
        if (d.startFeet.length > 2) d.startFeet.shift();
      }
    }
  } else {
    return;
  }
  renderPanel();
  draw();
}

// ---------------------------------------------------------------- Paneles

function renderPanel() {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === ui.tab);
  const fn = { escala: panelEscala, presas: panelPresas, gym: panelGym, generar: panelGenerar, registro: panelRegistro }[ui.tab];
  $('#panel').innerHTML = fn();
}

const chip = (act, v, label, on, extra = '') => `<button class="chip ${on ? 'on' : ''}" data-act="${act}" data-v="${v}" ${extra}>${label}</button>`;

// Después del inicio los pies son libres. El amarillo solo aparece en boulders guardados
// con la primera versión, que limitaban los pies a ciertas presas.
const legend = p => `<div class="legend">
  <span><i style="--c:${ROLE_COLORS.start}"></i>Inicio (I manos, P pies)</span><span><i style="--c:${ROLE_COLORS.hand}"></i>Mano</span>
  <span><i style="--c:${ROLE_COLORS.top}"></i>Top</span>${p?.feet ? `<span><i style="--c:${ROLE_COLORS.foot}"></i>Pie</span>` : ''}</div>`;

const needScale = () => `
  <p class="status warn">Primero marca la escala y el piso.</p>
  <div class="row"><button class="btn" data-act="goto" data-v="escala">Ir a Escala</button></div>`;

function tagText(ev) {
  if (!ev) return '';
  const t = ev.tags, out = [];
  if (t.cruce) out.push(t.cruce > 1 ? `${t.cruce} cruces` : 'cruce');
  if (t.lance) out.push(t.lance > 1 ? `${t.lance} lances` : 'lance');
  if (t.compresion) out.push('compresión');
  if (t.sinPies) out.push('sin pies');
  return out.join(', ') || 'estático';
}

const holdName = h => {
  const t = HOLD_TYPES[h.type], z = SIZES[h.size];
  return `${t.label.toLowerCase()} ${t.fem ? z.label.toLowerCase() : z.masc}`;
};

function movesList(ev) {
  if (!ev || !ev.moves.length) return '';
  const byId = new Map(ui.wall.holds.map(h => [h.id, h]));
  return `<ol class="moves">${ev.moves.map(m => {
    const h = byId.get(m.to);
    const b = [];
    if (m.cross) b.push('cruce');
    if (m.lance) b.push('lance');
    if (m.comp) b.push('compresión');
    if (!m.feet.length) b.push('sin pies');
    return `<li>${m.moving === 'L' ? 'Izquierda' : 'Derecha'} a ${holdName(h)}, a ${Math.round(m.d * 100)} cm de la otra mano${b.map(x => `<span class="badge">${x}</span>`).join('')}</li>`;
  }).join('')}</ol>`;
}

function panelEscala() {
  const w = ui.wall, k = cmPerPx(w);
  const picking = ui.pending === 'A' || ui.pending === 'B';
  const m = k && w.floorY != null ? w.floorY * k / 100 : null;
  const tall = m != null ? m.toLocaleString('es-CL', { maximumFractionDigits: 1 }) : null;
  const odd = m != null && (m < 2 || m > 8);
  return `
    <div class="step ${k ? 'ok' : ''}">
      <b>1. Distancia conocida</b>
      <p>Toca dos puntos del muro cuya distancia conozcas, por ejemplo los bordes de un terciado (122 cm) o dos pernos. Haz zoom para marcar más preciso.</p>
      <div class="row">
        <button class="btn ${picking ? 'on' : ''}" data-act="pickA">${picking ? (ui.pending === 'A' ? 'Toca el punto 1…' : 'Toca el punto 2…') : k ? 'Volver a marcar' : 'Marcar puntos'}</button>
        <label class="inline">Distancia <input type="number" inputmode="decimal" min="10" step="1" data-field="scaleCm" value="${w.scale?.cm ?? 122}"> cm</label>
      </div>
    </div>
    <div class="step ${w.floorY != null ? 'ok' : ''}">
      <b>2. Piso</b>
      <p>Toca donde el muro se junta con el piso o la colchoneta.</p>
      <button class="btn ${ui.pending === 'floor' ? 'on' : ''}" data-act="pickFloor">${ui.pending === 'floor' ? 'Toca el piso…' : w.floorY != null ? 'Volver a marcar' : 'Marcar piso'}</button>
    </div>
    <div class="step ok">
      <b>3. Ángulo del muro</b>
      <div class="chips">${[0, 10, 20, 30, 40, 50].map(a => chip('angle', a, a === 0 ? 'Vertical' : `${a}° desplome`, (w.angle || 0) === a)).join('')}</div>
    </div>
    <p class="status ${tall && !odd ? 'ok' : 'warn'}">${!tall ? 'Falta marcar la escala y el piso.'
      : odd ? `Según la escala, la foto muestra ${tall} m de muro sobre el piso. Un muro de boulder suele tener entre 3 y 5 m: revisa la distancia en cm y que los dos puntos estén bien marcados.`
      : `Según la escala, la foto muestra unos ${tall} m de muro sobre el piso. Si no calza con la realidad, vuelve a marcar.`}</p>
    ${tall ? '<div class="row"><button class="btn primary" data-act="goto" data-v="presas">Seguir con las presas</button></div>' : ''}`;
}

function panelPresas() {
  const w = ui.wall;
  const h = ui.sel ? w.holds.find(x => x.id === ui.sel) : null;
  const type = h ? h.type : ui.holdType, size = h ? h.size : ui.holdSize;
  const n = w.holds.length;
  return `
    <p class="hint">${h ? 'Presa seleccionada: cambia su tipo o tamaño, o bórrala.' : 'Elige tipo y tamaño, y toca cada presa en la foto, también las chicas de abajo: cualquier presa sirve de pie. Pellizca o usa + para hacer zoom.'}</p>
    <div class="chips">${Object.entries(HOLD_TYPES).map(([k, t]) => chip('type', k, t.label, type === k, `style="--c:${t.color}"`)).join('')}</div>
    <div class="chips">${Object.entries(SIZES).map(([k, z]) => chip('size', k, z.label, size === k)).join('')}</div>
    <div class="row">
      ${h ? '<button class="btn danger" data-act="delHold">Borrar presa</button><button class="btn" data-act="deselect">Listo</button>'
          : `<button class="btn" data-act="undo" ${w.holds.length ? '' : 'disabled'}>Deshacer</button>`}
      <span class="count">${n} presas</span>
    </div>
    ${!h && n >= 8 && ready(w) ? '<div class="row"><button class="btn primary" data-act="goto" data-v="generar">Generar boulders</button></div>' : ''}`;
}

function panelGym() {
  const w = ui.wall;
  if (!ready(w)) return needScale();
  if (ui.draft) return panelDraft();
  if (ui.show) return panelDetail();
  const F = fit();
  const gym = w.problems.filter(p => p.source === 'gym');
  return `
    <div class="row"><button class="btn primary" data-act="newGym">+ Boulder del armador</button></div>
    <p class="hint">Registra los boulders que dejó el gimnasio con el grado del armador. Con ellos se calibran los grados que estima la app.</p>
    <p class="status ${F.n ? 'ok' : 'warn'}">${F.n ? `Calibrado con ${F.n} boulder${F.n > 1 ? 's' : ''} del armador (todos los muros). Error medio ±${F.mae.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} grados.` : 'Sin calibrar todavía: los grados que estima la app son aproximados.'}</p>
    <ul class="list">${gym.map(p => problemItem(p, F)).join('') || '<li class="empty">No hay boulders del armador en este muro.</li>'}</ul>`;
}

const draftProblem = () => {
  const d = ui.draft;
  return { handSeq: d.handSeq, startCount: d.startCount, startFeet: d.startFeet, feet: d.feet };
};

function panelDraft() {
  const d = ui.draft, prob = draftProblem();
  const okLen = d.handSeq.length >= (d.startCount === 2 ? 3 : 2);
  const ev = okLen ? evaluateProblem(prob, ui.wall, REF_CLIMBER, fit()) : null;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `
    <h3>${d.id ? 'Editar' : 'Nuevo'} boulder del armador</h3>
    <div class="row">
      <input type="text" class="grow" data-field="draftName" placeholder="Nombre o color, ej. Rosado" value="${esc(d.name)}">
      <select data-field="draftGrade" aria-label="Grado del armador">${GRADES.map(g => `<option value="${g}" ${g === d.gradeSetter ? 'selected' : ''}>${gradeLabel(g)}</option>`).join('')}</select>
    </div>
    <div class="chips">${chip('draftMode', 'manos', 'Manos en orden', d.mode === 'manos')}${chip('draftMode', 'pies', 'Pies de inicio', d.mode === 'pies')}</div>
    <div class="chips">${chip('draftStart', 1, 'Inicio en 1 presa', d.startCount === 1)}${chip('draftStart', 2, 'Inicio en 2 presas', d.startCount === 2)}</div>
    <p class="hint">${d.mode === 'manos' ? 'Toca las presas de mano en orden: las de inicio primero, el top al final. Toca de nuevo para quitar.' : 'Toca las 2 presas donde van los pies al partir. Después los pies quedan libres.'}</p>
    ${legend(prob)}
    <p class="status">${plural(d.handSeq.length, 'mano', 'manos')} · ${plural(d.startFeet.length, 'pie', 'pies')} de inicio${ev ? ` · la app estima ${gradeLabel(ev.V)}` : ''}</p>
    <div class="row">
      <button class="btn primary" data-act="saveDraft" ${okLen ? '' : 'disabled'}>Guardar</button>
      <button class="btn" data-act="cancelDraft">Cancelar</button>
    </div>`;
}

function problemItem(p, F) {
  const gym = p.source === 'gym';
  const ev = evaluateProblem(p, ui.wall, gym ? REF_CLIMBER : S.climber, F);
  const sent = p.log.some(l => l.sent);
  const tries = p.log.length ? ` · ${p.log.length} registro${p.log.length > 1 ? 's' : ''}${sent ? ', encadenado ✓' : ''}` : '';
  const sub = gym ? `App estima ${gradeLabel(ev?.V)} · ${ev?.moves.length ?? 0} mov` : `${ev?.moves.length ?? 0} mov · ${tagText(ev)}`;
  return `<li><button class="item" data-act="openProblem" data-id="${p.id}">
    <span><b>${esc(p.name)}</b><small>${sub}${tries}</small></span>
    <span class="grade">${gradeLabel(gym ? p.gradeSetter : ev?.V)}</span></button></li>`;
}

function panelGenerar() {
  const w = ui.wall;
  if (!ready(w)) return needScale();
  const g = ui.gen, F = fit();
  const nHands = w.holds.length;
  let html = `
    <div class="row">
      <label class="inline">Grado <select data-field="genV">${GRADES.slice(1, 12).map(v => `<option value="${v}" ${v === g.targetV ? 'selected' : ''}>${gradeLabel(v)}</option>`).join('')}</select></label>
      <label class="inline grow">Movimientos <b id="genMovesOut">${g.moves}</b><input type="range" min="3" max="10" class="grow" data-field="genMoves" value="${g.moves}"></label>
    </div>
    <div class="chips">${Object.entries(MOVE_TAGS).map(([k, l]) => chip('want', k, l + (g.wanted[k] > 1 ? ' ×' + g.wanted[k] : ''), g.wanted[k] > 0)).join('')}</div>
    <p class="hint">Toca un movimiento para pedirlo (dos toques = dos veces, tres = quitar). Grados para tu cuerpo: ${S.climber.heightCm} cm de altura y ${S.climber.wingspanCm} cm de envergadura${F.n ? '' : ', sin calibrar todavía'}. <a href="#" data-act="profile">Cambiar</a></p>
    <div class="row">
      <button class="btn primary" data-act="generate" ${ui.busy || nHands < 8 ? 'disabled' : ''}>${ui.busy ? 'Buscando…' : 'Generar'}</button>
      ${nHands < 8 ? `<span class="hint">Marca al menos 8 presas (llevas ${nHands}).</span>` : ''}
    </div>`;
  if (ui.genMsg) html += `<p class="status warn">${esc(ui.genMsg)}</p>`;
  if (ui.results.length) {
    html += `<ul class="list">${ui.results.map((r, i) => `<li><button class="item ${i === ui.resultIdx ? 'on' : ''}" data-act="pickResult" data-i="${i}">
      <span><b>Opción ${i + 1}</b><small>${r.ev.moves.length} mov · ${tagText(r.ev)}</small></span>
      <span class="grade">${gradeLabel(r.ev.V)}</span></button></li>`).join('')}</ul>`;
    const r = ui.results[ui.resultIdx];
    html += legend(r) + movesList(r.ev) + `
      <div class="row">
        <button class="btn primary" data-act="saveResult" ${r.savedId ? 'disabled' : ''}>${r.savedId ? 'Guardado ✓' : 'Guardar'}</button>
        <button class="btn" data-act="shareResult">Compartir imagen</button>
      </div>`;
  }
  return html;
}

function panelRegistro() {
  if (ui.show) return panelDetail();
  const F = fit();
  const last = p => Math.max(p.createdAt, ...p.log.map(l => l.at));
  const ps = [...ui.wall.problems].sort((a, b) => last(b) - last(a));
  return `
    <p class="hint">Boulders guardados en este muro. Toca uno para verlo y registrar intentos.</p>
    <ul class="list">${ps.map(p => problemItem(p, F)).join('') || '<li class="empty">Todavía no hay boulders guardados. Genera uno o registra los del armador.</li>'}</ul>`;
}

function panelDetail() {
  const p = findProblem(ui.show);
  if (!p) { ui.show = null; return ui.tab === 'gym' ? panelGym() : panelRegistro(); }
  const ev = evaluateProblem(p, ui.wall, S.climber, fit());
  const logs = [...p.log].reverse().map(l => `<li>${fmtDate(l.at)} · ${l.sent ? 'Encadenado' : 'No encadenado'} en ${l.tries} intento${l.tries > 1 ? 's' : ''}${l.feel ? ' · ' + FEEL[l.feel] : ''}${l.stars ? ' · ' + '★'.repeat(l.stars) : ''}${l.avoid ? ' · se puede evitar el movimiento clave' : ''}${l.note ? ' · ' + esc(l.note) : ''}</li>`).join('');
  return `
    <div class="row">
      <button class="btn" data-act="closeDetail">← Lista</button>
      <b class="grow">${esc(p.name)}</b>
      ${p.source === 'gym' ? `<span class="grade" title="Grado del armador">${gradeLabel(p.gradeSetter)}</span>` : ''}
    </div>
    <p class="hint">${p.source === 'gym' ? `Armador: ${gradeLabel(p.gradeSetter)}. ` : ''}Para tu cuerpo la app estima ${gradeLabel(ev?.V)}${p.feet ? ', con los pies marcados' : ''}.</p>
    ${legend(p)}${movesList(ev)}
    <div class="row">
      <button class="btn primary" data-act="logOpen">Registrar intento</button>
      <button class="btn" data-act="shareProblem">Compartir imagen</button>
      ${p.source === 'gym' ? '<button class="btn" data-act="editGym">Editar</button>' : ''}
      <button class="btn danger" data-act="delProblem">Borrar</button>
    </div>
    ${ui.logDraft ? panelLog() : ''}
    ${logs ? `<ul class="logs">${logs}</ul>` : ''}`;
}

function panelLog() {
  const l = ui.logDraft;
  return `<div class="logform">
    <div class="chips">${chip('logSent', 1, 'Encadené', l.sent === true)}${chip('logSent', 0, 'Todavía no', l.sent === false)}</div>
    <label class="field">Intentos en esta sesión <input type="number" min="1" max="99" data-field="logTries" value="${l.tries}"></label>
    <div class="chips">${chip('logFeel', 'facil', 'Más fácil', l.feel === 'facil')}${chip('logFeel', 'justo', 'Justo', l.feel === 'justo')}${chip('logFeel', 'dificil', 'Más difícil', l.feel === 'dificil')}</div>
    <div class="chips">${[1, 2, 3].map(n => chip('logStars', n, '★'.repeat(n), l.stars === n)).join('')}</div>
    <label class="check"><input type="checkbox" data-field="logAvoid" ${l.avoid ? 'checked' : ''}> Se puede evitar el movimiento clave</label>
    <textarea data-field="logNote" placeholder="Comentario (opcional)">${esc(l.note)}</textarea>
    <div class="row">
      <button class="btn primary" data-act="saveLog" ${l.sent == null ? 'disabled' : ''}>Guardar intento</button>
      <button class="btn" data-act="logCancel">Cancelar</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Acciones del panel

async function share(problem, title, subtitle) {
  if (!ui.img) return;
  const blob = await renderShareImage(ui.img, ui.wall, problem, title, subtitle);
  const name = (title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'boulder') + '.jpg';
  const file = new File([blob], name, { type: 'image/jpeg' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  download(blob, name);
}

function runGenerate() {
  const g = ui.gen;
  ui.busy = true;
  ui.genMsg = '';
  renderPanel();
  setTimeout(() => {
    const out = generate(ui.wall, S.climber, fit(), { targetV: g.targetV, moves: g.moves, wanted: g.wanted, count: 3 });
    ui.busy = false;
    ui.resultIdx = 0;
    if (out.error) {
      ui.results = [];
      ui.genMsg = out.error;
    } else {
      ui.results = out.results;
      const best = out.results[0].ev.V;
      ui.genMsg = Math.abs(best - g.targetV) > 0.75
        ? `Con estas presas lo más cercano a ${gradeLabel(g.targetV)} que encontré es ${gradeLabel(best)}.`
        : '';
    }
    renderPanel();
    draw();
  }, 30);
}

$('#panel').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  e.preventDefault();
  const w = ui.wall, v = b.dataset.v;
  const hold = ui.sel ? w.holds.find(x => x.id === ui.sel) : null;
  const d = ui.draft, l = ui.logDraft, p = findProblem(ui.show);

  switch (b.dataset.act) {
    case 'goto': ui.tab = v; ui.show = null; ui.draft = null; break;
    case 'profile': openProfile(); return;
    case 'pickA': ui.pending = 'A'; toast('Toca el primer punto'); break;
    case 'pickFloor': ui.pending = 'floor'; toast('Toca la línea del piso'); break;
    case 'angle': w.angle = +v; save(); break;

    case 'type': if (hold) { hold.type = v; save(); } else ui.holdType = v; break;
    case 'size': if (hold) { hold.size = v; save(); } else ui.holdSize = v; break;
    case 'delHold': w.holds = w.holds.filter(x => x !== hold); ui.sel = null; save(); break;
    case 'deselect': ui.sel = null; break;
    case 'undo': {
      const id = ui.lastAdded.pop() ?? w.holds[w.holds.length - 1]?.id;
      w.holds = w.holds.filter(x => x.id !== id);
      save();
      break;
    }

    case 'newGym':
      ui.draft = { name: '', gradeSetter: 2, startCount: 2, handSeq: [], startFeet: [], feet: null, mode: 'manos' };
      break;
    case 'draftMode': d.mode = v; break;
    case 'draftStart': d.startCount = +v; break;
    case 'cancelDraft': ui.show = d.id || null; ui.draft = null; break;
    case 'saveDraft': {
      const prob = d.id ? findProblem(d.id) : { id: uid(), source: 'gym', createdAt: Date.now(), log: [] };
      Object.assign(prob, {
        name: d.name.trim() || `Armador ${gradeLabel(d.gradeSetter)}`, gradeSetter: d.gradeSetter,
        handSeq: [...d.handSeq], startCount: d.startCount, startFeet: [...d.startFeet], feet: d.feet,
      });
      if (!d.id) w.problems.push(prob);
      save();
      ui.draft = null;
      ui.show = prob.id;
      toast('Boulder guardado');
      break;
    }
    case 'editGym':
      ui.draft = {
        id: p.id, name: p.name, gradeSetter: p.gradeSetter, startCount: p.startCount, handSeq: [...p.handSeq],
        startFeet: [...(p.startFeet || [])], feet: p.feet ? [...p.feet] : null, mode: 'manos',
      };
      ui.show = null;
      ui.logDraft = null;
      ui.tab = 'gym';
      break;

    case 'openProblem': ui.show = b.dataset.id; ui.logDraft = null; break;
    case 'closeDetail': ui.show = null; ui.logDraft = null; break;
    case 'delProblem':
      if (!confirm(`¿Borrar "${p.name}" y sus registros?`)) return;
      w.problems = w.problems.filter(x => x !== p);
      ui.show = null;
      save();
      break;
    case 'shareProblem': {
      const ev = evaluateProblem(p, w, S.climber, fit());
      const grade = p.source === 'gym' ? `armador ${gradeLabel(p.gradeSetter)}` : `estimado ${gradeLabel(ev?.V)}`;
      share(p, p.name, `${w.name} · ${grade} · ${tagText(ev)}`);
      return;
    }

    case 'logOpen': ui.logDraft = { sent: null, tries: 1, feel: null, stars: null, avoid: false, note: '' }; break;
    case 'logSent': l.sent = v === '1'; break;
    case 'logFeel': l.feel = l.feel === v ? null : v; break;
    case 'logStars': l.stars = l.stars === +v ? null : +v; break;
    case 'logCancel': ui.logDraft = null; break;
    case 'saveLog':
      p.log.push({ at: Date.now(), sent: l.sent, tries: clamp(l.tries | 0, 1, 99), feel: l.feel, stars: l.stars, avoid: l.avoid, note: l.note.trim() });
      ui.logDraft = null;
      save();
      toast('Intento registrado');
      break;

    case 'want': ui.gen.wanted[v] = (ui.gen.wanted[v] + 1) % 3; break;
    case 'generate': runGenerate(); return;
    case 'pickResult': ui.resultIdx = +b.dataset.i; break;
    case 'saveResult': {
      const r = ui.results[ui.resultIdx], g = ui.gen;
      const n = w.problems.filter(x => x.source === 'gen').length + 1;
      const prob = {
        id: uid(), source: 'gen', createdAt: Date.now(), log: [], gradeSetter: null,
        name: `Generado ${n} · ${gradeLabel(r.ev.V)}`,
        handSeq: [...r.handSeq], startCount: r.startCount, startFeet: [...r.startFeet], feet: null,
        request: { targetV: g.targetV, moves: g.moves, wanted: { ...g.wanted } },
      };
      w.problems.push(prob);
      r.savedId = prob.id;
      save();
      toast('Guardado. Lo encuentras en Registro.');
      break;
    }
    case 'shareResult': {
      const r = ui.results[ui.resultIdx];
      share(r, `Boulder ${gradeLabel(r.ev.V)}`, `${w.name} · ${r.ev.moves.length} movimientos · ${tagText(r.ev)}`);
      return;
    }
    default: return;
  }
  renderPanel();
  draw();
});

// Campos de texto y números: se actualizan sin redibujar el panel para no perder el foco.
$('#panel').addEventListener('input', e => {
  const f = e.target.dataset.field, t = e.target;
  if (f === 'scaleCm') {
    const cm = parseFloat(t.value);
    if (cm > 0) { ui.wall.scale = { ...(ui.wall.scale || {}), cm }; save(); draw(); }
  } else if (f === 'draftName') ui.draft.name = t.value;
  else if (f === 'genMoves') { ui.gen.moves = +t.value; $('#genMovesOut').textContent = t.value; }
  else if (f === 'logTries') ui.logDraft.tries = parseInt(t.value, 10) || 1;
  else if (f === 'logNote') ui.logDraft.note = t.value;
});

$('#panel').addEventListener('change', e => {
  const f = e.target.dataset.field, t = e.target;
  if (f === 'draftGrade') ui.draft.gradeSetter = +t.value;
  else if (f === 'genV') ui.gen.targetV = +t.value;
  else if (f === 'logAvoid') ui.logDraft.avoid = t.checked;
  else if (f !== 'scaleCm') return;
  renderPanel();
  draw();
});

renderHome();
