// Todo queda en el navegador: datos en localStorage y fotos en IndexedDB.
// Si IndexedDB no está disponible (modo incógnito en algunos navegadores) las fotos viven en memoria.

const KEY = 'boulderlab.v1';
const fresh = () => ({ climber: { heightCm: 175, wingspanCm: 175 }, walls: [] });

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.walls)) return { ...fresh(), ...s };
  } catch {}
  return fresh();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function askPersistence() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch {}
}

const mem = new Map();
let dbp = null;

function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('boulderlab', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('images', mode);
    const req = fn(t.objectStore('images'));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export async function putImage(id, blob) {
  mem.set(id, blob);
  try { await tx('readwrite', s => s.put(blob, id)); } catch {}
}

export async function getImage(id) {
  if (mem.has(id)) return mem.get(id);
  try {
    const b = await tx('readonly', s => s.get(id));
    if (b) mem.set(id, b);
    return b;
  } catch {
    return null;
  }
}

export async function deleteImage(id) {
  mem.delete(id);
  try { await tx('readwrite', s => s.delete(id)); } catch {}
}
