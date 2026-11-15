// Regression tests for the P0 problems found in the 2026-11-15 audit (platecheck-qa/AUDIT-2026-11-15.md).
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as R from "../web/report.js";

// P0-6: text a spreadsheet would run as a formula is exported as text, in every CSV.
test("CSV exports neutralise formula-like text but keep numbers", () => {
  for (const [v, want] of [["=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\""], ["+cmd", "'+cmd"], ["-A1", "'-A1"], ["@SUM(1)", "'@SUM(1)"],
    ["-0.684", "-0.684"], ["+1e3", "+1e3"], ["-", "-"], ["-.5", "-.5"], ["Undetermined", "Undetermined"]]) assert.equal(C.csvCell(v), want, v);
  const text = "Well,Sample,Target,Ct\nA1,=HYPERLINK(\"http://x\"),GAPDH,20.1\nA2,ok,-cmd,21\n";
  const e = C.newExperiment({ title: "csv" }, "qa"); e.source = C.fileRecord({ name: "c", text, sha: "x", actor: "qa" });
  const res = C.analyze(e), csv = R.wellsCsv(res);
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv) && /'=HYPERLINK/.test(csv) && /'-cmd/.test(csv));
});

// P0-2: MSRE with a methylation-dependent enzyme and a fully methylated calibrator (audit reproduction).
import * as A from "../web/assays.js";
function assay(type, wells, params) {
  const rows = [], labels = {};
  wells.forEach(([set, role, target, ct], i) => { const id = i + 2;
    rows.push({ id, line: id, well: `W${i}`, key: String.fromCharCode(65 + Math.floor(i / 12)) + ((i % 12) + 1), sample: `${set} ${role}`, target, group: null, ct: ct == null ? "Undetermined" : String(ct), role: "sample" });
    labels[id] = { role, set, fraction: "" }; });
  return A.runAssay({ assaySetup: { type, params, wells: labels }, ruleset: { values: { sdThreshold: 0.3 } } }, rows);
}
test("MSRE, dependent enzyme with a fully methylated control: 100 × (1 − f) / (1 − f_control)", () => {
  const w = [["S", "digested", "T", 25], ["S", "mock", "T", 24], ["M", "digested", "T", 29], ["M", "mock", "T", 24]];
  const dep = assay("msre", w, { enzyme: "dependent", calibratorSet: "M" }), r = dep.rows.find(x => x.set === "S" && x.target === "T");
  assert.ok(Math.abs(r.pctMeth - 100 * 0.5 / (1 - 1 / 32)) < 1e-9, String(r.pctMeth)); // 51.6%, was −1500%
  assert.equal(r.ddCt, null);
  assert.ok(!dep.warnings.some(x => /outside 0–100%/.test(x.text)));
  // a fully methylated sample digested like the control reads 100%
  const full = assay("msre", [...w.slice(2), ["F", "digested", "T", 29], ["F", "mock", "T", 24]], { enzyme: "dependent", calibratorSet: "M" });
  assert.ok(Math.abs(full.rows.find(x => x.set === "F").pctMeth - 100) < 1e-9);
  // sensitive enzyme unchanged: ΔΔCt form
  const sen = assay("msre", [["S", "digested", "T", 25], ["S", "mock", "T", 24], ["M", "digested", "T", 24.2], ["M", "mock", "T", 24]], { enzyme: "sensitive", calibratorSet: "M" });
  const s = sen.rows.find(x => x.set === "S"); assert.ok(Math.abs(s.ddCt - 0.8) < 1e-9 && Math.abs(s.pctMeth - 100 * 2 ** -0.8) < 1e-9);
  // control not cut at all with a dependent enzyme: warned, not scaled
  const nc = assay("msre", [["S", "digested", "T", 25], ["S", "mock", "T", 24], ["M", "digested", "T", 24], ["M", "mock", "T", 24]], { enzyme: "dependent", calibratorSet: "M" });
  assert.ok(nc.warnings.some(x => /was not cut/.test(x.text))); assert.ok(Math.abs(nc.rows.find(x => x.set === "S").pctMeth - 50) < 1e-9);
});
