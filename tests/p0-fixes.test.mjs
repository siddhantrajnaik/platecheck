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

// P0-3: no syntax that Safari before 16.4 rejects (regex lookbehind), no import map needed, and a fallback notice.
import { readFileSync, readdirSync } from "node:fs";
test("app code has no regex lookbehind and needs no import map; the page explains a failed start", () => {
  const dir = new URL("../web/", import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith(".js")).concat(["vendor/OrbitControls.js"]))
    assert.ok(!/\(\?<[=!]/.test(readFileSync(new URL(f, dir), "utf8")), `${f} uses a lookbehind`);
  const html = readFileSync(new URL("index.html", dir), "utf8");
  assert.ok(!/type="importmap"/.test(html)); assert.match(html, /__plateCheckStarted/);
  assert.match(readFileSync(new URL("app.js", dir), "utf8"), /window\.__plateCheckStarted = true/);
  // behaviour of the rewritten no-RT name matcher on the documented examples
  for (const [s, base] of [["c1 -RT", "c1"], ["c1 RT-", "c1"], ["c1_noRT", "c1"], ["NRT c1", "c1"], ["c1 no-RT control", "c1"], ["c1 minus RT", "c1"], ["xnrt", "xnrt"], ["kd-2 -RT", "kd-2"]])
    assert.equal(C.nrtBaseName(s), base, s);
});

// P0-1: a review decision follows the flag (well + target), never a file line, and is not applied to different values.
const mkRun = (ntcWell, ntcCt = "30.5", extra = "") => ["Well,Sample Name,Target Name,Task,Cq", "A1,s1,GAPDH,UNKNOWN,20.1", "A2,s1,GAPDH,UNKNOWN,20.2",
  `${ntcWell},NTC,GAPDH,NTC,${ntcCt}`, "B1,s2,GAPDH,UNKNOWN,21", extra].filter(Boolean).join("\n");
const load = (exp, text, sha) => { exp.source = C.fileRecord({ name: sha, text, sha, actor: "qa" }); return C.analyze(exp); };
const decide = (exp, f, note) => { exp.reviews[f.id] = { disposition: "accepted", note, by: "qa", at: "2026-11-15T00:00:00Z", rule: f.rule, rule_version: f.rule_version, title: f.title, description: f.description }; };
test("a decision on A3 is not applied to H12 when the file is replaced (audit reproduction)", () => {
  const exp = C.newExperiment({ title: "rev" }, "qa");
  let r = load(exp, mkRun("A3"), "a"); const f = r.findings.find(x => x.rule === "ntc_amplification");
  assert.equal(f.id, "ntc_amplification:A3|GAPDH"); assert.equal(r.summary.status, "review_needed");
  decide(exp, f, "pipetting splash in A3");
  assert.notEqual(C.analyze(exp).summary.status, "review_needed");
  r = load(exp, mkRun("H12"), "b"); const g = r.findings.find(x => x.rule === "ntc_amplification");
  assert.equal(g.id, "ntc_amplification:H12|GAPDH"); assert.equal(C.reviewOf(exp.reviews, g), null);
  assert.equal(r.summary.status, "review_needed");
});
test("the same flag keeps its decision when lines move; different values make it stale", () => {
  const exp = C.newExperiment({ title: "rev2" }, "qa");
  let f = load(exp, mkRun("A3"), "a").findings.find(x => x.rule === "ntc_amplification"); decide(exp, f, "ok");
  // same well, same values, different line (an extra row before it)
  const moved = ["Well,Sample Name,Target Name,Task,Cq", "C9,s3,GAPDH,UNKNOWN,22", "A1,s1,GAPDH,UNKNOWN,20.1", "A2,s1,GAPDH,UNKNOWN,20.2", "A3,NTC,GAPDH,NTC,30.5", "B1,s2,GAPDH,UNKNOWN,21"].join("\n");
  let r = load(exp, moved, "c"); f = r.findings.find(x => x.rule === "ntc_amplification");
  assert.equal(C.reviewOf(exp.reviews, f)?.note, "ok");
  // same well, different Ct: the decision was about other values, so it's stale
  r = load(exp, mkRun("A3", "25.0"), "d"); f = r.findings.find(x => x.rule === "ntc_amplification");
  assert.equal(C.staleReview(exp.reviews, f), true); assert.equal(C.reviewOf(exp.reviews, f), null); assert.equal(r.summary.status, "review_needed");
});
test("saved runs: line-keyed decisions move to the new IDs only when made on the same values", () => {
  const exp = C.newExperiment({ title: "old" }, "qa"); let r = load(exp, mkRun("A3"), "a");
  const f = r.findings.find(x => x.rule === "ntc_amplification"); assert.equal(f.legacyId, "ntc_amplification:4");
  exp.reviews = { "ntc_amplification:4": { disposition: "accepted", note: "old", by: "qa", at: "x", description: f.description } };
  r = C.analyze(exp); assert.equal(r.reviewsMigrated, 1); assert.equal(exp.reviews["ntc_amplification:A3|GAPDH"].note, "old"); assert.ok(!exp.reviews["ntc_amplification:4"]);
  // an old decision whose line now holds a different well is not moved
  const e2 = C.newExperiment({ title: "old2" }, "qa"); r = load(e2, mkRun("H12"), "b");
  e2.reviews = { "ntc_amplification:4": { disposition: "accepted", note: "A3 splash", by: "qa", at: "x", description: "Well A3 something else" } };
  r = C.analyze(e2); assert.ok(!e2.reviews["ntc_amplification:H12|GAPDH"]); assert.equal(r.summary.status, "review_needed");
});
test("two flags of one rule on the same well and target get distinct IDs", () => {
  const exp = C.newExperiment({ title: "dup" }, "qa");
  const r = load(exp, ["Well,Sample Name,Target Name,Task,Cq", "A1,s1,GAPDH,UNKNOWN,abc", "A1,s1,GAPDH,UNKNOWN,xyz", "A2,s1,GAPDH,UNKNOWN,20"].join("\n"), "e");
  const ids = r.findings.map(f => f.id); assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("non_numeric_ct:A1|GAPDH") && ids.includes("non_numeric_ct:A1|GAPDH#2"));
});
test("a decision goes stale when the evidence values change even if the description doesn't (duplicate well)", () => {
  const dup = ct => ["Well,Sample Name,Target Name,Task,Cq", "C3,s1,GAPDH,UNKNOWN,24.22", "A1,s2,GAPDH,UNKNOWN,20", `C3,s1,GAPDH,UNKNOWN,${ct}`].join("\n");
  const exp = C.newExperiment({ title: "dupv" }, "qa");
  let f = load(exp, dup("24.05"), "a").findings.find(x => x.rule === "duplicate_well_assignment");
  exp.reviews[f.id] = { disposition: "accepted", by: "qa", at: "x", description: f.description, evidence: C.evidenceKey(f) };
  assert.ok(!/source line/.test(C.evidenceKey(f)) && /24\.22/.test(C.evidenceKey(f)));
  f = load(exp, "\n" + dup("24.05"), "b").findings.find(x => x.rule === "duplicate_well_assignment"); // lines moved, same values
  assert.ok(C.reviewOf(exp.reviews, f));
  f = load(exp, dup("24.61"), "c").findings.find(x => x.rule === "duplicate_well_assignment");   // same description, other Ct
  assert.equal(C.staleReview(exp.reviews, f), true);
});
