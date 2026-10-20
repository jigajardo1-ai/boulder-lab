// Tipos de presa, tallas, grados y conversión de la foto a metros.

// hand / foot: costo base de usar la presa con la mano o con el pie (más alto = peor).
// Cualquier presa sirve de mano y de pie.
export const HOLD_TYPES = {
  cazo:    { label: 'Cazo',    short: 'C',  hand: 0.2, foot: 0.2, color: '#30d158' },
  pinza:   { label: 'Pinza',   short: 'P',  fem: true, hand: 1.3, foot: 0.6, color: '#ff9f0a' },
  regleta: { label: 'Regleta', short: 'R',  fem: true, hand: 1.6, foot: 0.6, color: '#ff453a' },
  bidedo:  { label: 'Bidedo',  short: 'B',  hand: 1.7, foot: 0.8, color: '#64d2ff' },
  romo:    { label: 'Romo',    short: 'Ro', hand: 1.9, foot: 0.9, color: '#bf5af2' },
  volumen: { label: 'Volumen', short: 'V',  hand: 1.1, foot: 0.3, color: '#98989d' },
};

// La primera versión tenía un tipo "pie" (solo para pisar). Esas presas pasan a regletas chicas,
// que es lo más parecido a un chip de pie usado con la mano.
export function migrateWall(wall) {
  let changed = false;
  for (const h of wall.holds) {
    if (!HOLD_TYPES[h.type]) { h.type = 'regleta'; h.size = 'S'; changed = true; }
    if (!SIZES[h.size]) { h.size = 'M'; changed = true; }
  }
  for (const p of wall.problems) {
    if (!p.startFeet) { p.startFeet = []; changed = true; }
    p.log ||= [];
  }
  return changed;
}

// cm: radio aproximado de la presa. px: radio de dibujo cuando todavía no hay escala.
export const SIZES = {
  S: { label: 'Chica',  masc: 'chico',  hand: 1.35, foot: 1.3, cm: 2.5, px: 12 },
  M: { label: 'Media',  masc: 'medio',  hand: 1.0,  foot: 1.0, cm: 4.5, px: 20 },
  L: { label: 'Grande', masc: 'grande', hand: 0.7, foot: 0.8, cm: 8,   px: 32 },
};

export const GRADES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function gradeLabel(v) {
  if (v == null || Number.isNaN(v)) return '–';
  const r = Math.round(v);
  return r <= -1 ? 'VB' : 'V' + Math.min(r, 17);
}

export function cmPerPx(wall) {
  const s = wall.scale;
  if (!s || !s.a || !s.b || !(s.cm > 0)) return null;
  const d = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  return d > 5 ? s.cm / d : null;
}

// Presas en metros: x horizontal desde el borde izquierdo de la foto, h altura sobre el piso.
// Supone foto de frente y muro plano (versión 0).
export function wallPoints(wall) {
  const k = cmPerPx(wall);
  if (!k) return null;
  const floor = wall.floorY ?? wall.imgH;
  const pts = new Map();
  for (const h of wall.holds) {
    const t = HOLD_TYPES[h.type] || HOLD_TYPES.regleta, z = SIZES[h.size] || SIZES.M;
    pts.set(h.id, {
      id: h.id, type: h.type, size: h.size,
      x: h.x * k / 100,
      h: (floor - h.y) * k / 100,
      hand: t.hand * z.hand,
      foot: t.foot * z.foot,
    });
  }
  return pts;
}

export function holdRadiusPx(wall, hold) {
  const k = cmPerPx(wall);
  return k ? Math.max(6, SIZES[hold.size].cm / k) : SIZES[hold.size].px;
}
