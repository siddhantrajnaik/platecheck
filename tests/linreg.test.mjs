// Per-well efficiency (web/linreg.js, LinRegPCR). Reference: rdmlpython 1.7.2's Run.linRegPCR with its defaults on the
// example RDML files (testdata/published/rdml/linregpcr_reference.json, made by platecheck-qa/papers/linreg/ref.py).
// Here the curves go through PlateCheck's own RDML import, as in the app.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as R from "../web/rdml.js";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import * as L from "../web/linreg.js";

const P = n => new URL(`../testdata/published/rdml/${n}`, import.meta.url), PUB = n => new URL(`../testdata/public/rdml-tools/${n}`, import.meta.url);
const ref = JSON.parse(readFileSync(P("linregpcr_reference.json"), "utf8"));
const FLAGS = ["amplification", "baselineError", "instableBaseline", "plateau", "noisy", "outlier", "shortLogLin", "tooLowCqEff", "tooLowCqN0", "usedInWoL"];
const runOf = async (file, sheet) => {
  const url = existsSync(P(file)) ? P(file) : PUB(file);
  if (!existsSync(url)) return null;
  const b = await R.readRdml(file, readFileSync(url)), item = b.all.find(i => i.kind === "results" && i.sheet === sheet), amp = b.all.find(i => i.kind === "amp" && i.sheet === sheet);
  const e = C.newExperiment({ title: file }, "qa");
  e.source = C.fileRecord({ name: file, text: item.text, sha: "x", actor: "qa" });
  if (amp) e.amp = C.fileRecord({ name: "amp", text: amp.text, sha: "x", actor: "qa" });
  return { e, res: C.analyze(e) };
};

test("every reaction agrees with rdmlpython: efficiency, R², baseline, mean efficiency, Cq, N0, window and flags", async () => {
  let n = 0;
  for (const [key, v] of Object.entries(ref)) {
    if (key.startsWith("_")) continue;
    const [file, ex, run] = key.split("|"), r = await runOf(file, `${ex} / ${run}`);
    if (!r) continue;
    const out = L.linRegPCR(L.curvesFrom(r.res).filter(c => c.fluor.some(Number.isFinite)));
    const mine = new Map(out.rows.map(w => [`${w.key}|${w.target}`, w]));
    assert.ok(Math.abs(out.threshold - v.thCommon) < 1e-9 * v.thCommon, `${key} threshold`);
    for (const [well, target, type, eff, r2, baseline, meanEff, sdEff, cq, n0, nIncl, nLog, flags] of v.rows) {
      if (type === "opt") continue; // optical calibrators are left out on import
      const w = mine.get(`${well}|${target}`);
      if (!w) { assert.equal(eff, null, `${key} ${well} has no curve here`); continue; }
      n++;
      const close = (a, b, what, tol = 1e-9) => assert.ok(a === null ? b === null : b !== null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${key} ${well} ${target} ${what}: ${a} vs ${b}`);
      close(w.eff, eff, "eff"); close(w.r2, r2, "R²"); close(w.baseline, baseline, "baseline"); close(w.meanEff, meanEff, "mean eff"); close(w.sdEff, sdEff, "SD eff");
      close(w.cq, cq, "Cq"); close(w.n0, n0, "N0");
      assert.deepEqual([w.nIncluded, w.nLog, FLAGS.map(f => (w[f] ? 1 : 0)).join("")], [nIncl, nLog, flags], `${key} ${well} ${target} window/flags`);
    }
  }
  assert.ok(n >= 417, `${n} reactions`); // 417 in the committed files; 1904 with the downloaded rdml-tools files
});

test("synthetic curves: recovers the efficiency that made them, whatever the baseline", () => {
  const curve = (E, n0, bg, slope = 0) => Array.from({ length: 45 }, (_, i) => { const c = i + 1, x = n0 * E ** c; return bg + slope * c + x / (1 + (x / 5000) ** 4) ** 0.25; }); // sharp plateau: exponential until near it
  const curves = [];
  for (const [t, E] of [["A", 1.95], ["B", 1.82]]) for (let k = 0; k < 8; k++) curves.push({ key: `${t}${k + 1}`, target: t, type: "unkn", fluor: curve(E, 1e-6 * 3 ** k, 800 + 50 * k) });
  curves.push({ key: "N1", target: "A", type: "ntc", fluor: Array.from({ length: 45 }, (_, i) => 810 + ((i * 7) % 5)) });
  const out = L.linRegPCR(curves);
  assert.ok(Math.abs(out.targets.A.meanEff - 1.95) < 0.01, `A ${out.targets.A.meanEff}`);
  assert.ok(Math.abs(out.targets.B.meanEff - 1.82) < 0.01, `B ${out.targets.B.meanEff}`);
  for (const w of out.rows.filter(w => w.type !== "ntc" && w.key !== "N1")) assert.ok(w.r2 > 0.999 && Math.abs(w.baseline - (800 + 50 * (+w.key.slice(1) - 1))) < 5, `${w.key} baseline ${w.baseline}`);
  const ntc = out.rows.find(w => w.key === "N1");
  assert.equal(ntc.amplification, false); assert.equal(ntc.cq, null);
  // threefold more template is log(3)/log(E) cycles earlier
  const a = out.rows.filter(w => w.target === "A");
  for (let k = 1; k < 8; k++) assert.ok(Math.abs(a[k - 1].cq - a[k].cq - Math.log(3) / Math.log(1.95)) < 0.05, `A${k} spacing`);
  assert.ok(Math.abs(a[1].n0 / a[0].n0 - 3) < 0.15);
  // baseline-subtracted input (negative values) is shifted and warned about
  const neg = L.linRegPCR(curves.map(c => ({ ...c, fluor: c.fluor.map(v => v - 900) })));
  assert.match(neg.warnings[0], /baseline-corrected/);
});

test("raw-only RDML gets Cq from LinRegPCR on import, as rdmlpython computes it", async () => {
  const b = await R.readRdml("m.rdml", readFileSync(P("py_matrix_gaps.rdml"))), run = b.rdml.runs[0];
  assert.match(run.warnings[0], /worked out Cq from the raw curves with LinRegPCR/);
  const rows = C.parseResults(run.results).rows, refRows = ref["py_matrix_gaps.rdml|Experiment 1|Run 1"].rows;
  assert.equal(rows.length, refRows.length);
  rows.forEach((r, i) => { const q = refRows[i][8], c = C.ctNum(r.ct); assert.ok(q === null ? c === null : Math.abs(c - q) < 6e-4, `${r.key} ${c} vs ${q}`); }); // written with 3 decimals
});

test("Pfaffl correction can take each target's LinRegPCR mean efficiency", async () => {
  const r = await runOf("py_own_mix_a.rdml", "Own Mix A / Run 1"), L0 = L.forRun(r.res);
  assert.ok(L0 && L.forRun(r.res) === L0, "cached per analysis");
  const pooled = L.targetEfficiencies([L0, L0]);
  for (const [t, v] of Object.entries(L0.targets)) if (v.n) assert.deepEqual([+pooled[t].E.toFixed(12), pooled[t].n], [+v.meanEff.toFixed(12), 2 * v.n]);
  const eff = A.compute([], C.cleanAnalysisSettings({ on: true, efficiency: true, effSource: "linreg", refs: ["x"], control: "c" }), { linreg: { x: { E: 1.9, n: 5 } } });
  assert.equal(eff.ok, false); // no records: needs inputs, but the setting itself survives
  assert.equal(C.cleanAnalysisSettings({ effSource: "linreg" }).effSource, "linreg");
  assert.equal(C.cleanAnalysisSettings({ effSource: "nonsense" }).effSource, "std");
  const csv = L.linregCsv(L0, C.toCsv);
  assert.match(csv.split("\n")[0], /Efficiency \(individual\)/); assert.equal(csv.trim().split("\n").length, L0.rows.length + 1);
});
