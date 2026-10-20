// Motor: modelo del cuerpo, costo de cada movimiento, grado estimado, generador y calibración.
//
// Un boulder es { handSeq, startCount, startFeet, feet }:
//   handSeq    ids de presas de mano en orden (inicio primero, top al final)
//   startCount 1 (inicio juntando manos en una presa) o 2
//   startFeet  ids de las presas de pie del inicio (hasta 2)
//   feet       null = pies libres después del inicio (lo normal). Una lista limita los pies
//              a esas presas (boulders guardados con la primera versión).
// Cualquier presa sirve de pie.

import { wallPoints } from './model.js';

export const DEFAULT_FIT = { a: 0.9, b: -0.8 };
export const REF_CLIMBER = { heightCm: 175, wingspanCm: 175 };

export function bodyModel(climber) {
  const H = climber.heightCm / 100;
  const W = climber.wingspanCm / 100;
  return {
    H, W,
    reach: 0.55 * W,                   // mano a mano, estático al límite
    lanceMax: 0.8 * W,                 // más allá no se propone
    startMin: 0.6,                     // altura de las presas de mano del inicio
    startMax: 1.15 * H,
    startFootMax: 0.9,                 // pies del inicio, desde el piso
    footHighest: 0.2 * H,              // pie más alto, medido bajo la mano más baja
    footLowest: 0.38 * W + 0.76 * H,   // pie más bajo (brazos estirados)
    footSide: 0.45 * H,                // separación lateral máxima del centro de las manos
    wide: 0.42 * W,                    // manos así de separadas y a la misma altura = compresión
    side: 0.6 * W,                     // una presa nueva no se va más lejos que esto del centro de las manos
    climbMin: 1.2,                     // el top queda al menos esto sobre la mano más alta del inicio
  };
}

// Reglas para que el boulder suba: la presa nueva queda sobre la mano más baja y,
// a lo más, un poco bajo la mano más alta.
export const RISE = { overLow: 0.1, underHigh: 0.25 };

const f1 = x => x.toLocaleString('es-CL', { maximumFractionDigits: 1 });
const angleMult = angle => 1 + (angle || 0) / 45 * 0.7;

// Los dos mejores pies disponibles para una posición de manos a (izq.) y b (der.).
function feetFor(pool, B, a, b) {
  const low = Math.min(a.h, b.h), mid = (a.x + b.x) / 2;
  const c = [];
  for (const p of pool) {
    if (p.id === a.id || p.id === b.id) continue;
    const below = low - p.h;
    if (below < B.footHighest || below > B.footLowest || p.h < 0.03) continue;
    if (Math.abs(p.x - mid) > B.footSide) continue;
    c.push(p);
  }
  c.sort((u, v) => u.foot - v.foot);
  return c.slice(0, 2);
}

function footPenalty(feet) {
  if (feet.length === 0) return 1.8;
  if (feet.length === 1) return 0.6 + 0.3 * feet[0].foot;
  return 0.15 * (feet[0].foot + feet[1].foot);
}

// Mover la mano `moving` ('L' o 'R') a la presa T. Con strict se descartan movimientos
// que el generador no debería proponer; sin strict se evalúa cualquier cosa (boulders del armador).
function moveInfo(B, am, a, b, moving, T, pen, strict) {
  const S = moving === 'L' ? b : a;   // mano que se queda
  const O = moving === 'L' ? a : b;   // de dónde sale la mano que se mueve
  if (T.id === S.id || T.id === O.id) return null;
  const d = Math.hypot(T.x - S.x, T.h - S.h);
  const cross = moving === 'R' ? T.x < S.x - 0.05 : T.x > S.x + 0.05;
  const lance = d > B.reach;
  if (strict) {
    const low = Math.min(a.h, b.h), high = Math.max(a.h, b.h);
    if (d < 0.15 || d > B.lanceMax) return null;
    if (Math.hypot(T.x - O.x, T.h - O.h) < 0.2) return null;
    if (T.h < low + RISE.overLow || T.h < high - RISE.underHigh) return null;
    if (Math.abs(T.x - (a.x + b.x) / 2) > B.side) return null;
    if (cross && d > 0.85 * B.reach) return null;
    if (lance && T.h < S.h - 0.05) return null;
  }
  const nl = moving === 'L' ? T : a, nr = moving === 'R' ? T : b;
  const comp = !cross && Math.abs(nl.x - nr.x) >= B.wide && Math.abs(nl.h - nr.h) <= 0.35;
  const r = d / B.reach;
  let cost = 1.2 * r * r + T.hand + 0.5 * S.hand + pen;
  if (lance) cost += 1.0 + 1.5 * (r - 1);
  if (cross) cost += 0.5;
  if (comp) cost += 0.6;
  return { moving, from: O.id, to: T.id, stay: S.id, d, cross, lance, comp, cost: cost * am };
}

// Dificultad del boulder: manda el movimiento más duro, con algo de peso del resto y del largo.
export function difficulty(costs) {
  if (!costs.length) return 0;
  const c = [...costs].sort((u, v) => v - u);
  const top = c.slice(0, 3);
  const mean = top.reduce((s, x) => s + x, 0) / top.length;
  return 0.6 * c[0] + 0.4 * mean + 0.08 * Math.max(0, costs.length - 4);
}

export const toV = (D, fit) => fit.a * D + fit.b;

function countTags(moves) {
  const t = { cruce: 0, lance: 0, compresion: 0, sinPies: 0 };
  for (const m of moves) {
    if (m.cross) t.cruce++;
    if (m.lance) t.lance++;
    if (m.comp) t.compresion++;
    if (!m.feet.length) t.sinPies++;
  }
  return t;
}

// Evalúa un boulder con la beta más fácil: en cada presa nueva mueve la mano que cuesta menos.
// En el primer movimiento los pies son los del inicio; después, cualquier presa.
export function evaluateProblem(problem, wall, climber, fit = DEFAULT_FIT) {
  const pts = wallPoints(wall);
  if (!pts) return null;
  const seq = problem.handSeq.filter(id => pts.has(id));
  if (seq.length < 2) return null;
  const two = problem.startCount === 2 && seq.length >= 3;
  const B = bodyModel(climber);
  const am = angleMult(wall.angle);
  const startFeet = (problem.startFeet || []).map(id => pts.get(id)).filter(Boolean);
  const pool = problem.feet
    ? [...new Set([...problem.feet, ...seq, ...startFeet.map(p => p.id)])].map(id => pts.get(id)).filter(Boolean)
    : [...pts.values()];
  let a = pts.get(seq[0]), b = two ? pts.get(seq[1]) : a;
  if (b.x < a.x) [a, b] = [b, a];
  const moves = [];
  for (const id of seq.slice(two ? 2 : 1)) {
    const T = pts.get(id);
    const feet = !moves.length && startFeet.length ? startFeet : feetFor(pool, B, a, b);
    const pen = footPenalty(feet);
    const mL = moveInfo(B, am, a, b, 'L', T, pen, false);
    const mR = moveInfo(B, am, a, b, 'R', T, pen, false);
    // La beta más fácil, pero entre las que se alcanzan: un movimiento fuera de alcance solo
    // se elige si no queda otra (boulders del armador marcados con otro cuerpo).
    const far = m => m.d > B.lanceMax;
    const m = !mL ? mR : !mR ? mL
      : far(mL) !== far(mR) ? (far(mL) ? mR : mL)
      : (mL.cost <= mR.cost ? mL : mR);
    if (!m) continue;
    m.feet = feet.map(f => f.id);
    moves.push(m);
    if (m.moving === 'L') a = T; else b = T;
  }
  const D = difficulty(moves.map(m => m.cost));
  return { moves, D, V: toV(D, fit), tags: countTags(moves) };
}

function jaccard(s, t) {
  let i = 0;
  for (const x of s) if (t.has(x)) i++;
  return i / (s.size + t.size - i);
}

// Inicios posibles: 1 o 2 presas de mano a una altura que se alcanza parado, con 2 pies bajos
// debajo, y con muro suficiente arriba para que el boulder suba de verdad.
export function startOptions(pts, B) {
  const all = [...pts.values()].filter(p => p.h > 0);
  const maxH = Math.max(...all.map(p => p.h));
  const hiStart = Math.min(B.startMax, maxH - B.climbMin);
  const low = all.filter(p => p.h >= B.startMin && p.h <= hiStart);
  const feetPool = all.filter(p => p.h <= B.startFootMax);
  const out = [];
  const add = hands => {
    const a = hands[0], b = hands[1] || hands[0];
    const feet = feetFor(feetPool, B, a.x <= b.x ? a : b, a.x <= b.x ? b : a);
    if (feet.length === 2) out.push({ hands, feet });
  };
  for (const p of low) if (p.hand <= 1.2) add([p]);
  for (let i = 0; i < low.length; i++) {
    for (let j = i + 1; j < low.length; j++) {
      const p = low[i], q = low[j];
      const d = Math.hypot(p.x - q.x, p.h - q.h);
      if (d >= 0.15 && d <= 0.7 && Math.abs(p.h - q.h) <= 0.4) add([p, q]);
    }
  }
  return { starts: out, maxH, hiStart };
}

// opts: { targetV, moves, wanted: { cruce, lance, compresion }, count, budgetMs, maxAttempts }
export function generate(wall, climber, fit, opts, rng = Math.random) {
  const pts = wallPoints(wall);
  if (!pts) return { error: 'Primero calibra la escala en la pestaña Escala.' };
  const B = bodyModel(climber);
  const am = angleMult(wall.angle);
  const all = [...pts.values()].filter(p => p.h > 0);
  if (all.length < 8) return { error: 'Marca al menos 8 presas en la pestaña Presas.' };

  const { starts, maxH, hiStart } = startOptions(pts, B);
  if (hiStart < B.startMin) {
    return { error: `Según la escala, la presa más alta está a ${f1(maxH)} m del piso. Es muy poco muro para un boulder: revisa la escala y el piso.` };
  }
  if (!starts.length) {
    return { error: `No encontré un inicio: hacen falta presas de mano entre ${f1(B.startMin)} y ${f1(hiStart)} m del piso, con dos presas de pie bajo ${f1(B.startFootMax)} m. Revisa la escala y el piso.` };
  }
  const topMin = maxH - 0.6;

  const want = opts.wanted || {};
  const Dt = (opts.targetV - fit.b) / fit.a;
  const minSteps = Math.max(2, opts.moves - 2), maxSteps = opts.moves + 2;
  const found = [];
  const t0 = performance.now();
  for (let it = 0; it < (opts.maxAttempts ?? 8000) && performance.now() - t0 < (opts.budgetMs ?? 1500); it++) {
    const st = starts[Math.floor(rng() * starts.length)];
    let a = st.hands[0], b = st.hands[1] || st.hands[0];
    if (b.x < a.x) [a, b] = [b, a];
    const used = new Set([...st.hands, ...st.feet].map(p => p.id));
    const seq = st.hands.map(p => p.id);
    const startHigh = Math.max(a.h, b.h);
    const need = { cruce: want.cruce || 0, lance: want.lance || 0, compresion: want.compresion || 0 };
    let last = null, steps = 0, done = false;
    while (steps < maxSteps) {
      const feet = steps === 0 ? st.feet : feetFor(all, B, a, b);
      const pen = footPenalty(feet);
      const goal = Dt * (0.55 + 0.45 * rng());
      const high = Math.max(a.h, b.h);
      const cands = [];
      let total = 0;
      for (const hand of ['L', 'R']) {
        for (const T of all) {
          if (used.has(T.id)) continue;
          const m = moveInfo(B, am, a, b, hand, T, pen, true);
          if (!m) continue;
          let w = Math.exp(-1.2 * Math.abs(m.cost - goal));
          w *= 1 + 2 * Math.min(Math.max(T.h - high, 0), 0.8);
          if (hand === last) w *= 0.4;
          if (m.cross && need.cruce > 0) w *= 4;
          if (m.lance && need.lance > 0) w *= 4;
          if (m.comp && need.compresion > 0) w *= 4;
          if (T.h >= topMin && steps + 1 < minSteps) w *= 0.05;
          cands.push([m, T, w]);
          total += w;
        }
      }
      if (!cands.length || !(total > 0)) break;
      let x = rng() * total, pick = cands[cands.length - 1];
      for (const c of cands) { x -= c[2]; if (x <= 0) { pick = c; break; } }
      const [m, T] = pick;
      if (m.cross) need.cruce--;
      if (m.lance) need.lance--;
      if (m.comp) need.compresion--;
      used.add(T.id);
      seq.push(T.id);
      last = m.moving;
      steps++;
      if (m.moving === 'L') a = T; else b = T;
      // Se termina en una presa de la parte alta, que sea la más alta del boulder.
      const isTop = T.h >= topMin && T.h >= startHigh + B.climbMin
        && seq.every(id => id === T.id || pts.get(id).h < T.h);
      if (isTop && steps >= minSteps) { done = true; break; }
    }
    if (!done) continue;
    const prob = { handSeq: seq, startCount: st.hands.length, startFeet: st.feet.map(p => p.id), feet: null };
    const ev = evaluateProblem(prob, wall, climber, fit);
    if (!ev || ev.moves.some(m => m.d > B.lanceMax)) continue;
    let score = Math.abs(ev.V - opts.targetV) + 0.15 * Math.abs(ev.moves.length - opts.moves);
    for (const k of ['cruce', 'lance', 'compresion']) score += 1.2 * Math.max(0, (want[k] || 0) - ev.tags[k]);
    found.push({ ...prob, ev, score });
  }

  found.sort((u, v) => u.score - v.score);
  const out = [];
  for (const f of found) {
    const s = new Set(f.handSeq);
    if (out.some(o => jaccard(s, new Set(o.handSeq)) >= 0.5)) continue;
    out.push(f);
    if (out.length >= (opts.count || 3)) break;
  }
  if (!out.length) return { error: 'No encontré boulders con esas condiciones. Prueba con menos movimientos o sin pedir movimientos específicos.' };
  return { results: out, tried: found.length };
}

// Ajusta V = a·D + b con los boulders del armador de todos los muros.
// Se evalúan con un cuerpo de referencia, porque el armador gradúa para el escalador promedio.
// La pendiente se encoge hacia el valor por defecto mientras haya pocos datos.
export function calibrateAll(walls) {
  const pts = [];
  for (const w of walls) {
    for (const p of w.problems) {
      if (p.source !== 'gym' || p.gradeSetter == null) continue;
      const ev = evaluateProblem(p, w, REF_CLIMBER, DEFAULT_FIT);
      if (ev && ev.moves.length) pts.push([ev.D, p.gradeSetter]);
    }
  }
  const n = pts.length;
  if (!n) return { ...DEFAULT_FIT, n: 0, mae: null };
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  const aLS = sxx > 1e-6 ? sxy / sxx : DEFAULT_FIT.a;
  const k = 3;
  const a = Math.min(2.5, Math.max(0.3, (n * aLS + k * DEFAULT_FIT.a) / (n + k)));
  const b = my - a * mx;
  const mae = pts.reduce((s, [x, y]) => s + Math.abs(a * x + b - y), 0) / n;
  return { a, b, n, mae };
}
