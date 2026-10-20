// Dibujo de la foto, las presas y los boulders sobre un canvas.

import { HOLD_TYPES, holdRadiusPx } from './model.js';

export const ROLE_COLORS = { start: '#30d158', startFoot: '#30d158', hand: '#0a84ff', top: '#ff375f', foot: '#ffd60a' };
const DARK_TEXT = { start: true, startFoot: true, foot: true };

export function problemRoles(problem) {
  const roles = new Map();
  const seq = problem.handSeq;
  const nStart = problem.startCount === 2 && seq.length >= 3 ? 2 : 1;
  for (const id of problem.feet || []) roles.set(id, { role: 'foot' });
  for (const id of problem.startFeet || []) roles.set(id, { role: 'startFoot', label: 'P' });
  seq.forEach((id, i) => {
    if (i < nStart) roles.set(id, { role: 'start', label: 'I' });
    else if (i === seq.length - 1) roles.set(id, { role: 'top', label: 'T' });
    else roles.set(id, { role: 'hand', label: String(i - nStart + 1) });
  });
  return roles;
}

function ring(ctx, x, y, r, color, lw, u) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = lw + 2 * u;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function tag(ctx, x, y, text, bg, fg, u) {
  const fs = 13 * u;
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  const w = Math.max(ctx.measureText(text).width + 8 * u, fs + 6 * u), h = fs + 6 * u;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5 * u);
}

// u: unidades de imagen por píxel de pantalla, para que líneas y textos tengan tamaño fijo.
export function paint(ctx, img, wall, o, u) {
  if (o.problem) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, img.width, img.height);
    if (o.showAll) {
      for (const h of wall.holds) ring(ctx, h.x, h.y, holdRadiusPx(wall, h), 'rgba(255,255,255,0.45)', 1.2 * u, u);
    }
    const roles = problemRoles(o.problem);
    const labels = [];
    for (const h of wall.holds) {
      const r = roles.get(h.id);
      if (!r) continue;
      const R = holdRadiusPx(wall, h) + 3 * u;
      ring(ctx, h.x, h.y, R, ROLE_COLORS[r.role], 3.5 * u, u);
      if (r.label) labels.push([h.x + R * 0.75, h.y - R * 0.75, r.label, r.role]);
    }
    for (const [x, y, t, role] of labels) tag(ctx, x, y, t, ROLE_COLORS[role], DARK_TEXT[role] ? '#000' : '#fff', u);
  } else {
    const faint = o.mode !== 'presas';
    for (const h of wall.holds) {
      const t = HOLD_TYPES[h.type];
      const sel = h.id === o.selected;
      const r = holdRadiusPx(wall, h);
      ring(ctx, h.x, h.y, r, sel ? '#fff' : t.color, (sel ? 4 : faint ? 1.5 : 2.5) * u, u);
      if (sel) ring(ctx, h.x, h.y, r + 5 * u, t.color, 2 * u, u);
    }
  }

  if (o.mode === 'escala') {
    const s = wall.scale;
    ctx.setLineDash([]);
    if (s?.a && s?.b) {
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.lineWidth = 2.5 * u;
      ctx.strokeStyle = '#64d2ff';
      ctx.stroke();
      tag(ctx, (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, `${s.cm} cm`, '#64d2ff', '#000', u);
    }
    for (const p of [s?.a, s?.b]) if (p) ring(ctx, p.x, p.y, 7 * u, '#64d2ff', 3 * u, u);
    if (wall.floorY != null) {
      ctx.setLineDash([10 * u, 8 * u]);
      ctx.beginPath();
      ctx.moveTo(0, wall.floorY);
      ctx.lineTo(img.width, wall.floorY);
      ctx.lineWidth = 2.5 * u;
      ctx.strokeStyle = '#ff9f0a';
      ctx.stroke();
      ctx.setLineDash([]);
      tag(ctx, 40 * u, wall.floorY - 14 * u, 'piso', '#ff9f0a', '#000', u);
    }
  }
}

export function drawScene(ctx, cw, ch, img, view, wall, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, cw, ch);
  if (!img) return;
  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
  ctx.drawImage(img, 0, 0);
  paint(ctx, img, wall, o, (window.devicePixelRatio || 1) / view.s);
}

// Imagen para compartir: la foto completa con el boulder y una franja con el título.
export function renderShareImage(img, wall, problem, title, subtitle) {
  const band = Math.round(img.width * 0.11);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height + band;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#14181d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.translate(0, band);
  ctx.drawImage(img, 0, 0);
  paint(ctx, img, wall, { problem }, img.width / 420);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${band * 0.36}px system-ui, sans-serif`;
  ctx.fillText(title, band * 0.3, band * 0.38);
  ctx.fillStyle = '#9aa5b1';
  ctx.font = `500 ${band * 0.22}px system-ui, sans-serif`;
  ctx.fillText(subtitle, band * 0.3, band * 0.76);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}
