// P0-5: run files in IndexedDB, the rest in localStorage (web/store.js). Node has no IndexedDB, so a small in-memory
// stand-in implements the calls store.js uses (open, transaction, objectStore get/put/delete/getAll/getAllKeys).
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import { extent } from "../web/charts.js";

function fakeIndexedDb({ failOpen = false } = {}) {
  const data = new Map();
  const later = f => setTimeout(f, 0);
  const store = tx => ({
    put: (v, k) => { tx.ops.push(() => data.set(k, v)); return {}; },
    delete: k => { tx.ops.push(() => data.delete(k)); return {}; },
    getAll: () => { const r = {}; tx.ops.push(() => { r.result = [...data.values()]; }); return r; },
    getAllKeys: () => { const r = {}; tx.ops.push(() => { r.result = [...data.keys()]; }); return r; },
  });
  const db = { transaction: () => { const tx = { ops: [] }; tx.objectStore = () => store(tx); later(() => { tx.ops.forEach(f => f()); tx.oncomplete?.(); }); return tx; } };
  return { data, api: { open: () => { const r = {}; later(() => { if (failOpen) { r.error = new Error("no"); r.onerror?.(); return; } r.result = { ...db, createObjectStore() {} }; r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } } };
}
function fakeLocalStorage() {
  const mem = new Map();
  return { mem, api: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
    key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; } } };
}
let n = 0;
const freshStore = () => import(`../web/store.js?fresh=${++n}`); // a new module instance (store.js keeps state)
const bigRun = () => {
  const exp = C.newExperiment({ title: "big" }, "qa");
  const rows = ["Well,Sample,Target,Ct"]; for (let i = 0; i < 96; i++) rows.push(`${"ABCDEFGH"[Math.floor(i / 12)]}${i % 12 + 1},s${i % 8},T,${20 + (i % 7) / 3}`);
  exp.source = C.fileRecord({ name: "r.csv", text: rows.join("\n") + "\n", sha: "r", actor: "qa" });
  exp.amp = C.fileRecord({ name: "a.csv", text: "Cycle,A1\n" + "1,0.1\n".repeat(400000), sha: "a", actor: "qa" }); // ≈ 2.4 MB
  return exp;
};

test("files go to IndexedDB, localStorage keeps only the small rest; a reload reads them back", async () => {
  const ls = fakeLocalStorage(), idb = fakeIndexedDb(); globalThis.localStorage = ls.api; globalThis.indexedDB = idb.api;
  try {
    let S = await freshStore(); assert.deepEqual(await S.init(), { indexedDb: true, moved: 0 });
    const exp = bigRun(); S.save(exp, { status: "no_flags", label: "x" }); await S.flush();
    const stored = ls.mem.get(`assaylint.v1.exp.${exp.id}`);
    assert.ok(stored.length < 5000, `localStorage entry ${stored.length} chars`); assert.ok(!/"text":"/.test(stored));
    assert.equal(idb.data.get(`${exp.id}:amp`), exp.amp.text);
    // saving again without changing a file doesn't rewrite it
    let puts = 0; const orig = idb.data.set.bind(idb.data); idb.data.set = (k, v) => { puts++; return orig(k, v); };
    exp.title = "renamed"; S.save(exp, null); await S.flush(); assert.equal(puts, 0);
    idb.data.set = orig;
    // a new page: a fresh module reads the texts back
    S = await freshStore(); await S.init();
    const back = S.load(exp.id); assert.equal(back.amp.text, exp.amp.text); assert.equal(back.source.text, exp.source.text); assert.equal(back.title, "renamed");
    // deleting a run removes its files too
    S.remove(exp.id); await S.flush(); assert.ok(![...idb.data.keys()].some(k => k.startsWith(exp.id)));
  } finally { delete globalThis.localStorage; delete globalThis.indexedDB; }
});
test("runs saved before move their files to IndexedDB at start-up", async () => {
  const ls = fakeLocalStorage(), idb = fakeIndexedDb(); globalThis.localStorage = ls.api; globalThis.indexedDB = idb.api;
  try {
    const exp = bigRun();
    ls.api.setItem(`assaylint.v1.exp.${exp.id}`, JSON.stringify(exp)); // the old format: texts inline
    ls.api.setItem("assaylint.v1.index", JSON.stringify([{ id: exp.id, title: "old", status: "no_flags", label: "x" }]));
    const S = await freshStore(); assert.deepEqual(await S.init(), { indexedDb: true, moved: 1 });
    assert.ok(ls.mem.get(`assaylint.v1.exp.${exp.id}`).length < 5000);
    assert.equal(S.load(exp.id).amp.text, exp.amp.text);
    assert.equal(S.index()[0].status, "no_flags"); // the list entry is untouched
  } finally { delete globalThis.localStorage; delete globalThis.indexedDB; }
});
test("without IndexedDB everything stays in localStorage; unreadable files never make a run look damaged", async () => {
  const ls = fakeLocalStorage(); globalThis.localStorage = ls.api;
  try {
    let S = await freshStore(); assert.deepEqual(await S.init(), { indexedDb: false, moved: 0 });
    const exp = C.newExperiment({ title: "small" }, "qa"); exp.source = C.fileRecord({ name: "r", text: "Well,Ct\nA1,20\n", sha: "r", actor: "qa" });
    S.save(exp, null); assert.match(ls.mem.get(`assaylint.v1.exp.${exp.id}`), /"text":"Well,Ct/); assert.equal(S.load(exp.id).source.text, "Well,Ct\nA1,20\n");
    // files in IndexedDB, but this session can't open it (a private window, say)
    globalThis.indexedDB = fakeIndexedDb({ failOpen: true }).api;
    ls.api.setItem(`assaylint.v1.exp.${exp.id}`, JSON.stringify({ ...exp, source: { ...exp.source, text: undefined, textInDb: true } }));
    S = await freshStore(); await S.init();
    assert.equal(S.load(exp.id), null); assert.equal(S.filesUnavailable(exp.id), true);
  } finally { delete globalThis.localStorage; delete globalThis.indexedDB; }
});
test("chart extent handles hundreds of thousands of points (was a stack overflow)", () => {
  const xs = Array.from({ length: 400000 }, (_, i) => Math.sin(i) * 3);
  const [lo, hi] = extent(xs); assert.ok(lo < -2.99 && hi > 2.99);
});
