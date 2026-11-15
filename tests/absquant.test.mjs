// Absolute quantity of unknowns from a standard curve (web/absquant.js). References: R 4.3.2 lm() + chemCal 0.2.3
// inverse.predict (platecheck-qa/papers/absquant/ref_small.R), and QuantStudio's own quantities (Figshare 30833918).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as C from "../web/core.js";
import * as Q from "../web/absquant.js";
import * as R from "../web/report.js";
import { readWorkbook } from "../web/excel.js";

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} expected ${b}, got ${a}`);
const q = [1e6, 1e5, 1e4, 1e3, 1e2].flatMap(x => [x, x, x]);
const stdCt = [15.02, 15.10, 14.95, 18.41, 18.33, 18.50, 21.80, 21.72, 21.95, 25.20, 25.31, 25.12, 28.70, 28.55, 28.90];
const unknowns = [["u1", [20.10, 20.25, 20.02]], ["u2", [26.4]], ["u3", [30.5, 30.9]], ["nd", ["Undetermined", "Undetermined"]]];
function run() {
  const L = ["Well,Sample,Target,Task,Quantity,Ct"]; let w = 0; const well = () => { const k = w++; return `${"ABCDEFGH"[Math.floor(k / 12)]}${k % 12 + 1}`; };
  stdCt.forEach((ct, i) => L.push(`${well()},std,GENE,STANDARD,${q[i]},${ct}`));
  for (const [u, cts] of unknowns) for (const ct of cts) L.push(`${well()},${u},GENE,UNKNOWN,,${ct}`);
  const e = C.newExperiment({ title: "abs" }, "qa"); e.source = C.fileRecord({ name: "a.csv", text: L.join("\n") + "\n", sha: "x", actor: "qa" });
  return C.analyze(e);
}

test("curve statistics and efficiency CI equal R's lm()/confint()", () => {
  const res = run(), d = Q.curveDetails(res.stdCurves[0]);
  close(d.slope, -3.418333333333, 1e-10); close(d.intercept, 35.510666666667, 1e-10);
  close(d.residualSd, 0.106268889724, 1e-10); close(d.slopeSe, 0.019401956021, 1e-10);
  close(d.effLow, 94.5344706065, 1e-7); close(d.effHigh, 97.7752144637, 1e-7);
});
test("quantities and 95% prediction intervals equal chemCal::inverse.predict", () => {
  const out = Q.quantify(run().rows, run().stdCurves), u = n => out.units.find(x => x.unit === n);
  for (const [n, x, lo, hi] of [["u1", 4.501413944417, 4.458494695237, 4.544333193598], ["u2", 2.665236470015, 2.593967736606, 2.736505203423],
    ["u3", 1.407313505607, 1.347591437663, 1.467035573551]]) {
    close(Math.log10(u(n).q), x, 1e-9, n); close(Math.log10(u(n).qLow), lo, 1e-9, n); close(Math.log10(u(n).qHigh), hi, 1e-9, n);
  }
  assert.equal(u("u1").n, 3); assert.equal(u("u1").extrapolated, null);
  assert.equal(u("u3").extrapolated, "below");                  // 10^1.41 copies < the lowest standard (100)
  assert.ok(out.warnings.some(w => /outside the range of the standards/.test(w)));
  assert.equal(u("nd").q, null); assert.match(u("nd").note, /not detected/);
  // QuantStudio-style mean of the wells' quantities is never below the quantity at the mean Ct (AM ≥ GM)
  assert.ok(u("u1").qWellMean >= u("u1").q);
});
test("CSV and report carry the quantities, intervals and efficiency CI", () => {
  const res = run(), out = Q.quantify(res.rows, res.stdCurves), csv = Q.quantCsv(out, C.toCsv);
  assert.match(csv, /^target,biological_unit,group,wells_with_ct,mean_ct,quantity,pi95_low,pi95_high/);
  assert.match(csv, /efficiency_ci95_low/);
  const e = C.newExperiment({ title: "abs" }, "qa"); e.source = C.fileRecord({ name: "a.csv", text: "x", sha: "x", actor: "qa" });
  const html = R.reportHtml ? R.reportHtml(e, res) : "";
  if (html) { assert.match(html, /Absolute quantity of unknowns/); assert.match(html, /95% CI of efficiency/); }
});

const QS = new URL("../testdata/public/figshare__30833918/Greenland_Tb_qPCR results.xlsx", import.meta.url);
test("real QuantStudio run: per-well quantities equal QuantStudio's Quantity column", { skip: !existsSync(QS) && "public data not downloaded" }, async () => {
  const err = console.error; console.error = () => {};
  const b = await readWorkbook("qs.xlsx", readFileSync(QS)); console.error = err;
  const e = C.newExperiment({ title: "qs" }, "qa"); e.source = C.fileRecord({ name: "r", text: b.best.results.text, sha: "x", actor: "qa" });
  const res = C.analyze(e), out = Q.quantify(res.rows, res.stdCurves);
  const L = b.best.results.text.split(/\r?\n/), h = L.findIndex(l => /^Well\t/.test(l)), H = L[h].split("\t"), ix = k => H.indexOf(k), qs = {};
  for (const l of L.slice(h + 1)) { const c = l.split("\t"); if (c[ix("Task")] === "UNKNOWN" && c[ix("Quantity")]) qs[c[ix("Well Position")]] = +c[ix("Quantity")]; }
  let n = 0; for (const w of out.wells) if (w.quantity && qs[w.well]) { n++; close(w.quantity / qs[w.well], 1, 2e-4, w.well); } // QuantStudio rounds slope/intercept to 4 dp
  assert.equal(n, 72);
  // the authors' "molecules per reaction" (Data sheet) is QuantStudio's mean of well quantities: fish 4 = 558.008894
  close(out.units.find(u => u.unit === "4").qWellMean, 558.008894, 0.12);
});
