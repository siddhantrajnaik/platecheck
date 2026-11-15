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
