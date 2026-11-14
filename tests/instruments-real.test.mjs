// Real instrument exports deposited on Figshare (CC BY 4.0), read the way the app reads an upload. Each check compares
// PlateCheck with the instrument's own numbers in the same deposit. Sources: testdata/published/README.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as C from "../web/core.js";
import { readWorkbook } from "../web/excel.js";

const P = n => new URL(`../testdata/published/${n}`, import.meta.url), txt = n => readFileSync(P(n), "utf8");
const quiet = async f => { const e = console.error; console.error = () => {}; try { return await f(); } finally { console.error = e; } };

// ABI 7500 Fast, SDS v1.3 (Nature Communications 2025 mtDNA copy number; Figshare 28152689).
test("SDS 1.3 'Ct' export: every detector block is read and equals the same run's results export", () => {
  for (const run of ["20240407_CF93J9R5", "20240408_CF93J9R4"]) {
    const ct = C.parseResults(txt(`sds/${run}_ct.csv`), { plateSize: 96 }), res = C.parseResults(txt(`sds/${run}_res.csv`));
    assert.equal(ct.rows.length, 72); assert.equal(ct.format, "abi-sds");
    assert.deepEqual([...new Set(ct.rows.map(r => r.target))], [...new Set(res.rows.map(r => r.target))]); // detector names = the results export's
    assert.ok(ct.warnings.some(w => /3 detector blocks/.test(w)));
    const byKey = new Map(res.rows.map(r => [`${r.key}|${r.target}`, r]));
    for (const r of ct.rows) {
      const o = byKey.get(`${r.key}|${r.target}`); assert.ok(o, `${run} ${r.key}`);
      if (C.ctNum(r.ct) === null) assert.equal(C.ctNum(o.ct), null); else assert.ok(Math.abs(C.ctNum(r.ct) - C.ctNum(o.ct)) < 0.006, `${run} ${r.key} ${r.ct} vs ${o.ct}`);
    }
    const first = txt(`sds/${run}_ct.csv`).split(/\r?\n/), r0 = ct.rows.at(-1); // line numbers point at the file's own lines
    assert.equal(first[r0.line - 1].split(",")[0], String((r0.key.charCodeAt(0) - 65) * 12 + Number(r0.key.slice(1))));
  }
});
test("SDS 1.3 melt export (row-wise): PlateCheck's peak Tm equals the instrument's Tm column within one reading step", () => {
  let n = 0, close = 0;
  for (const run of ["20240407_CF93J9R5", "20240408_CF93J9R4"]) {
    const e = C.newExperiment({ title: run }, "qa"); e.source = C.fileRecord({ name: "r", text: txt(`sds/${run}_res.csv`), sha: "x", actor: "qa" });
    e.melt = C.fileRecord({ name: "m", text: txt(`sds/${run}_melt.csv`), sha: "x", actor: "qa", valueType: "derivative" }); e.ruleset.values.meltChecks = true;
    const r = C.analyze(e);
    assert.equal(Object.keys(r.melt.stats).length, 72);
    // A well that never amplified has only noise to melt, so only amplified wells are compared.
    for (const row of r.rows) { const s = r.melt.stats[`${row.key}|${row.target}`], tm = C.ctNum(row.tm); if (!s?.main || tm === null || C.ctNum(row.ct) === null) continue; n++; if (Math.abs(s.main.t - tm) <= 0.35) close++; }
  }
  assert.ok(n >= 120 && close / n >= 0.97, `${close}/${n}`);
});

// Bio-Rad CFX, workbook exports (Figshare 34873065).
test("CFX workbooks: Cq, amplification and melt sheets are recognised; main melt peaks match CFX's peak table", async () => {
  const wb = async n => quiet(() => readWorkbook(`${n}.xlsx`, readFileSync(P(`cfx/${n}.xlsx`))));
  const cq = (await wb("Quantification Cq Results")).best.results, amp = (await wb("Quantification Amplification Results")).best.amp;
  const der = (await wb("Melt Curve Derivative Results")).best.melt, peaks = (await wb("Melt Curve Peak Results")).all[0];
  assert.ok(cq && amp && der);
  const e = C.newExperiment({ title: "cfx" }, "qa"); e.source = C.fileRecord({ name: "cq", text: cq.text, sha: "x", actor: "qa" });
  e.amp = C.fileRecord({ name: "a", text: amp.text, sha: "x", actor: "qa" });
  e.melt = C.fileRecord({ name: "m", text: der.text, sha: "x", actor: "qa", valueType: "derivative" }); e.ruleset.values.meltChecks = true;
  const r = C.analyze(e);
  assert.equal(r.rows.length, 96); assert.equal(r.rows.filter(x => C.ctNum(x.ct) !== null).length, 90);
  const L = peaks.text.split(/\r?\n/).map(l => l.split("\t")), h = L.findIndex(c => c.includes("Melt Temperature")), ix = k => L[h].indexOf(k), top = {};
  for (const c of L.slice(h + 1)) { const k = C.wellKey(c[ix("Well")]); if (k && (!top[k] || +c[ix("Peak Height")] > top[k].h)) top[k] = { t: +c[ix("Melt Temperature")], h: +c[ix("Peak Height")] }; }
  let n = 0, same = 0;
  for (const [k, p] of Object.entries(top)) { const s = Object.entries(r.melt.stats).find(([key]) => key.startsWith(k + "|"))?.[1]; if (!s?.main) continue; n++; if (Math.abs(s.main.t - p.t) <= 0.5) same++; }
  assert.ok(n === 96 && same >= 89, `${same}/${n}`);
});

// Roche LightCycler 480, 384-well text output with Include / Color / Pos / Target / Name / Cp (Figshare 12221069).
test("LightCycler 480 384-well output: positions to P, targets read, Include = FALSE treated as omitted", () => {
  const p = C.parseResults(txt("lc480/cts_named.txt"));
  assert.equal(p.rows.length, 294); assert.equal(p.columns.ct, "Cp");
  assert.deepEqual([...new Set(p.rows.map(r => r.target))].sort(), ["Dmoj", "Spiro"]);
  assert.ok(p.rows.some(r => r.key?.startsWith("P"))); assert.ok(!p.rows.some(r => r.omit));
  const ex = C.parseResults("Include\tColor\tPos\tTarget\tName\tCp\nTRUE\t255\tA1\tg\ts1\t20.1\nFALSE\t255\tA2\tg\ts1\t25.3\n");
  assert.deepEqual(ex.rows.map(r => r.omit), [false, true]);
});

// QuantStudio Design & Analysis workbook (Figshare 30833918), fetched by testdata/fetch-public.mjs.
const QS = new URL("../testdata/public/figshare__30833918/Greenland_Tb_qPCR results.xlsx", import.meta.url);
test("QuantStudio workbook without Quantity on 'Results': standards' sheet used, curve equals QuantStudio's", { skip: !existsSync(QS) && "public data not downloaded" }, async () => {
  const b = await quiet(() => readWorkbook("qs.xlsx", readFileSync(QS)));
  assert.equal(b.best.results.sheet, "Standard Curve Result"); assert.match(b.best.results.why, /no Quantity column/);
  const e = C.newExperiment({ title: "qs" }, "qa"); e.source = C.fileRecord({ name: "r", text: b.best.results.text, sha: "x", actor: "qa" });
  const c = C.analyze(e).stdCurves.find(x => x.target === "Tb18s");
  assert.equal(c.r2, 0.9992037701758552); assert.ok(Math.abs(c.efficiency - 101.81779845305185) < 1e-9); // QuantStudio's own values in the sheet
  assert.equal(c.slope.toFixed(4), "-3.2791"); assert.equal(c.intercept.toFixed(4), "38.5156");
});
