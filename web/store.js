// Browser storage (localStorage). Nothing leaves the device; see PRIVACY.md.
import { normalizeExperiment, cleanAnalysisSettings, newId } from "./core.js";

const P = "assaylint.v1.";
const ls = () => globalThis.localStorage;
const read = (k, d) => { try { const s = ls().getItem(P + k); return s ? JSON.parse(s) : d; } catch { return d; } };
const write = (k, v) => ls().setItem(P + k, JSON.stringify(v)); // throws when storage is full or disabled

// The list of runs, ignoring anything that isn't a proper entry (storage can be damaged or edited by hand).
export function index() {
  const v = read("index", []);
  return (Array.isArray(v) ? v : []).filter(e => e && typeof e === "object" && typeof e.id === "string" && e.id)
    .map(e => ({ id: e.id, title: typeof e.title === "string" && e.title ? e.title : "Untitled run", date: typeof e.date === "string" ? e.date : "",
      updated: typeof e.updated === "string" ? e.updated : "", status: typeof e.status === "string" ? e.status : "no_data", label: typeof e.label === "string" ? e.label : "" }));
}
// ---- File texts in IndexedDB
// The imported files (results, amplification, melt) are most of a run: a 384-well, 4-dye run with curves is about 6 MB
// of text, while localStorage holds about 5 MB per site. So the texts live in IndexedDB under "<run id>:<file>", and
// the rest of each run stays in localStorage. init() reads the stored texts into memory once at start-up, so load() and
// save() stay synchronous for the rest of the app; save() writes a text to IndexedDB only when it changed (a click no
// longer rewrites megabytes). Without IndexedDB (some private modes, tests) everything stays in localStorage, as before.
const FILES = ["source", "amp", "melt"];
const texts = new Map(), pending = new Set();
let db = null, dbFailed = false, onError = null;
const tkey = (id, k) => `${id}:${k}`;
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const tx = db.transaction("texts", mode), req = fn(tx.objectStore("texts"));
  tx.oncomplete = () => resolve(req?.result); tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction failed"));
});
function queue(key, text) {
  const p = idb("readwrite", s => (text === undefined ? s.delete(key) : s.put(text, key)))
    .catch(err => onError?.(err)).finally(() => pending.delete(p));
  pending.add(p);
}
export const setErrorHandler = f => { onError = f; };
export const hasPendingWrites = () => pending.size > 0;
export const flush = () => Promise.all([...pending]);
export const usingIndexedDb = () => !!db;
export async function init() {
  if (db || !globalThis.indexedDB) return { indexedDb: !!db, moved: 0 };
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("platecheck", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("texts");
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error("blocked"));
    });
    const [keys, vals] = await Promise.all([idb("readonly", s => s.getAllKeys()), idb("readonly", s => s.getAll())]);
    keys.forEach((k, i) => texts.set(k, vals[i]));
  } catch { db = null; dbFailed = true; return { indexedDb: false, moved: 0 }; }
  // Runs saved before this keep their files in localStorage: move them over, which frees localStorage.
  let moved = 0;
  for (const { id } of index()) {
    const e = read("exp." + id, null);
    if (e && FILES.some(k => typeof e[k]?.text === "string")) { try { writeRun(e); moved++; } catch { /* left as it was */ } }
  }
  await flush();
  return { indexedDb: true, moved };
}
// The run without its file texts goes to localStorage; changed texts are queued for IndexedDB.
function writeRun(exp) {
  if (!db) return write("exp." + exp.id, exp);
  const meta = { ...exp };
  for (const k of FILES) {
    const key = tkey(exp.id, k);
    if (typeof exp[k]?.text === "string") {
      if (texts.get(key) !== exp[k].text) { texts.set(key, exp[k].text); queue(key, exp[k].text); }
      meta[k] = { ...exp[k], text: undefined, textInDb: true };
    } else if (texts.has(key)) { texts.delete(key); queue(key, undefined); }
  }
  write("exp." + exp.id, meta);
}
// True when a run's files are in IndexedDB but couldn't be read this time; the run must not be treated as damaged.
export function filesUnavailable(id) {
  const e = read("exp." + id, null);
  return !!(e && FILES.some(k => e[k]?.textInDb && typeof texts.get(tkey(id, k)) !== "string"));
}
export function load(id) {
  try {
    const e = read("exp." + id, null);
    if (!e) return null;
    for (const k of FILES) if (e[k]?.textInDb) {
      const t = texts.get(tkey(id, k));
      if (typeof t !== "string") return null;
      e[k] = { ...e[k], text: t }; delete e[k].textInDb;
    }
    return normalizeExperiment(e);
  } catch { return null; }
}
export function save(exp, summary) {
  writeRun(exp);
  const idx = index().filter(e => e.id !== exp.id);
  idx.unshift({ id: exp.id, title: exp.title, date: exp.date, updated: exp.updated, status: summary?.status || "no_data", label: summary?.label || "No data imported" });
  write("index", idx);
}
export function remove(id) {
  ls().removeItem(P + "exp." + id);
  write("index", index().filter(e => e.id !== id));
  if (db) for (const k of FILES) { const key = tkey(id, k); if (texts.has(key)) { texts.delete(key); queue(key, undefined); } }
}
export const indexedDbFailed = () => dbFailed;
export function profiles() {
  const v = read("profiles", []);
  return (Array.isArray(v) ? v : []).filter(p => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.versions) && p.versions.length
    && p.versions.every(x => x && typeof x === "object" && x.values && typeof x.values === "object"));
}
export const saveProfiles = list => write("profiles", list);
export const getSetting = k => { const v = read("settings", {}); return v && typeof v === "object" ? v[k] : undefined; };
export const setSetting = (k, v) => { const cur = read("settings", {}); write("settings", { ...(cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}), [k]: v }); };
// Studies: several saved runs analysed together (web/analysis.js). Stored like runs: an index plus one entry each.
const strList = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && x))].slice(0, 200) : []);
export function normalizeStudy(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const now = new Date().toISOString(), str = v => (typeof v === "string" ? v : "");
  const ex = s.excluded && typeof s.excluded === "object" && !Array.isArray(s.excluded) ? s.excluded : {};
  return { id: str(s.id) || newId().replace(/^AL-/, "ST-"), title: str(s.title).slice(0, 300) || "Untitled study", runs: strList(s.runs),
    settings: cleanAnalysisSettings(s.settings) || cleanAnalysisSettings({ on: true }), mode: ["calibrator", "centre", "none", "combat"].includes(s.mode) ? s.mode : "calibrator", combatMeanOnly: s.combatMeanOnly === true, // [combat]
    calibrators: strList(s.calibrators), excluded: Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, strList(v)]).filter(([, v]) => v.length)),
    created: str(s.created) || now, updated: str(s.updated) || now };
}
export function studies() {
  const v = read("studies", []);
  return (Array.isArray(v) ? v : []).filter(e => e && typeof e === "object" && typeof e.id === "string" && e.id)
    .map(e => ({ id: e.id, title: typeof e.title === "string" && e.title ? e.title : "Untitled study", updated: typeof e.updated === "string" ? e.updated : "",
      runs: Number.isInteger(e.runs) && e.runs >= 0 ? e.runs : 0 }));
}
export function loadStudy(id) {
  try { return normalizeStudy(read("study." + id, null)); } catch { return null; }
}
export function saveStudy(study) {
  const s = normalizeStudy(study);
  if (!s) return null;
  s.updated = new Date().toISOString();
  write("study." + s.id, s);
  write("studies", [{ id: s.id, title: s.title, updated: s.updated, runs: s.runs.length }, ...studies().filter(e => e.id !== s.id)]);
  return s;
}
export function removeStudy(id) {
  ls().removeItem(P + "study." + id);
  write("studies", studies().filter(e => e.id !== id));
}
export function usageBytes() {
  let n = 0;
  for (let i = 0; i < ls().length; i++) { const k = ls().key(i); if (k.startsWith(P)) n += k.length + (ls().getItem(k)?.length || 0); }
  for (const t of texts.values()) n += t.length; // file texts in IndexedDB
  return n * 2;
}
