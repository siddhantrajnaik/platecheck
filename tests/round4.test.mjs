// Bugs found by the fourth round of stress tests on real published data (2026-11-22; platecheck-qa/round4/*), each pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import * as L from "../web/linreg.js";
import * as R from "../web/rdml.js";
import { rank } from "../web/combat.js";
import { reportPdfDoc, PDF_MAX_FINDINGS } from "../web/report-pdf.js";

const exp = (results, amp, melt) => {
  const e = C.newExperiment({ title: "x" }, "qa");
  e.source = C.fileRecord({ name: "r", text: results, sha: "a", actor: "qa" });
  if (amp) e.amp = C.fileRecord({ name: "a", text: amp, sha: "b", actor: "qa" });
  if (melt) { e.melt = C.fileRecord({ name: "m", text: melt, sha: "c", actor: "qa", valueType: "derivative" }); e.ruleset.values.meltChecks = true; }
  return e;
};
const rules = res => res.findings.map(f => f.rule);

// ---- file mutations (platecheck-qa/round4/mutations)
test("a header repeated mid-table no longer ends the table: the rows after it are read, duplicates flagged, and it is said", () => {
  const p = C.parseResults("Well,Sample,Target,Cq\nA1,s,G,20\nA2,s,G,21\nWell,Sample,Target,Cq\nA1,s,G,22\nA2,s,G,23\n");
  assert.equal(p.rows.length, 4); assert.match(p.warnings.join(" "), /header line appears again at line 4/);
  const q = C.parseResults("Well,Sample,Target,Cq\nA1,s,G,20\nA2,s,G,21\nWell,Cq,Other\nB1,20,x\n");
  assert.equal(q.rows.length, 2); assert.match(q.warnings.join(" "), /second table with different columns starts at line 4/);
});
test("a file cut off mid-row: a short last row is left out, a cut inside the last value is warned about", () => {
  const full = "Well,Sample,Target,Cq,Tm\nA1,s,G,24.31,80.1\nA2,s,G,24.37,80.2\nA3,s,G,24.35,80.0\n";
  const inLast = C.parseResults(full.slice(0, full.lastIndexOf("80.0") + 2)); // "…,24.35,80"
  assert.equal(inLast.rows.length, 3); assert.match(inLast.warnings.join(" "), /ends in the middle of a line/);
  const short = C.parseResults(full.slice(0, full.indexOf("24.35") + 2)); // "A3,s,G,24": a cell missing
  assert.deepEqual(short.rows.map(r => r.key), ["A1", "A2"]); assert.match(short.malformed[0].reason, /cut off/);
  assert.equal(C.parseResults(full).warnings.some(w => /middle of a line/.test(w)), false);
});
test("decimal-comma files: scientific quantities (1,25E+05) are read, not dropped", () => {
  assert.equal(C.toNum("1,25E+05", true), 125000);
  const res = C.analyze(exp("Well;Sample;Target;Task;Quantity;Cq\nA1;s1;G;Standard;1,00E+06;16,69\nA2;s2;G;Standard;1,00E+05;20,01\nA3;s3;G;Standard;1,00E+04;23,35\n"));
  assert.deepEqual(res.rows.map(r => C.toNum(r.quantity, r.dcq)), [1e6, 1e5, 1e4]); assert.equal(res.stdCurves.length, 1);
});
test("a comma-separated curve file with quoted decimal commas is read; one with mostly unreadable values is refused", () => {
  const ok = C.parseCurves('Well,Temperature,Fluorescence\nA1,"60,5","132,51"\nA1,"61,0","130,00"\nA1,"61,5","128,90"\n', "melt");
  assert.deepEqual(ok.series["A1|"], [[60.5, 132.51], [61, 130], [61.5, 128.9]]);
  assert.throws(() => C.parseCurves("Well,Cycle,Fluorescence\nA1,1,x\nA1,2,y\nA1,3,z\nA1,4,1\n", "amp"), /Only 1 of 4 curve values/);
});
test("more spellings of 'no Ct' are read as no Ct", () => {
  for (const v of ["Undet.", "Undet", "ND", "n.d.", "N.A.", "Not detected", "--", "—", "#N/A"]) assert.equal(C.isNoAmp(v), true, v);
  assert.equal(C.isNoAmp("#VALUE!"), false); // a spreadsheet error is not a result
});
test("an unzipped RDML file saved as UTF-16 is read", async () => {
  const e = exp("Well,Sample,Target,Task,Cq\nA1,s,G,Unknown,21\nA2,s,G,Unknown,21.2\n"), res = C.analyze(e);
  const xml = R.rdmlXml(e, res), b = new Uint8Array(2 + xml.length * 2);
  b[0] = 0xff; b[1] = 0xfe; for (let i = 0; i < xml.length; i++) { const c = xml.charCodeAt(i); b[2 + 2 * i] = c & 255; b[3 + 2 * i] = c >> 8; }
  assert.equal((await R.readRdml("x.rdml", b)).rdml.runs[0].reactions, 2);
});

// ---- end-to-end papers (platecheck-qa/round4/e2e-papers)
test("a study of several plates: each target is normalised to the reference on its own plate, so an unrelated plate can't move it", () => {
  const rec = (unit, target, plate, ct, group) => ({ unit, target, plate, ct, tech: [], group });
  const p1 = [], p2 = [];
  for (let i = 0; i < 6; i++) {
    const g = i < 3 ? "ctrl" : "trt", u = `u${i}`;
    p1.push(rec(u, "GAPDH", "P1", 18 + (i % 3) * 0.2, g), rec(u, "TBX21", "P1", (g === "trt" ? 24 : 25) + (i % 3) * 0.3, g));
    p2.push(rec(u, "GAPDH", "P2", 19 + (i % 2) * 0.4, g), rec(u, "RORG", "P2", 27 + (i % 2) * 0.1, g));
  }
  const s = { on: true, refs: ["GAPDH"], control: "ctrl" }, fold = r => r.rows.filter(x => x.target === "TBX21").map(x => x.fold.toFixed(10));
  assert.deepEqual(fold(A.compute([...p1, ...p2], s, { plates: ["P1", "P2"] })), fold(A.compute(p1, s, { plates: ["P1"] })));
});

// ---- curve checks against labelled data (platecheck-qa/round4/curve-qc)
const sig = (mid, top, n = 45) => Array.from({ length: n }, (_, i) => 0.5 + ((i * 7919) % 13) / 100 + top / (1 + Math.exp(-(i + 1 - mid) / 1.6)));
test("strong early curves (Ct around 10) are not called flat", () => {
  const curves = { A1: sig(12, 8000), A2: sig(12.2, 8000), A3: sig(27, 8000), A4: sig(27.3, 8000) };
  const amp = "Well,Target,Cycle,Fluorescence\n" + Object.entries(curves).flatMap(([w, ys]) => ys.map((y, i) => `${w},G,${i + 1},${y.toFixed(3)}`)).join("\n") + "\n";
  const res = C.analyze(exp("Well,Sample,Target,Cq\nA1,s1,G,10\nA2,s2,G,10.2\nA3,s3,G,25\nA4,s4,G,25.3\n", amp));
  assert.equal(rules(res).filter(r => r === "amp_ct_without_rise").length, 0, rules(res).join(","));
});
test("a dim channel next to a bright one in the same wells is judged on its own", () => {
  const amp = "Well,Target,Cycle,Fluorescence\n" + ["A1", "A2", "A3"].flatMap((w, k) => [["FAM", 10000], ["CY5", 300]].flatMap(([t, top]) => sig(22 + k, top).map((y, i) => `${w},${t},${i + 1},${y.toFixed(3)}`))).join("\n") + "\n";
  const res = C.analyze(exp("Well,Sample,Target,Cq\n" + ["A1", "A2", "A3"].flatMap((w, k) => [`${w},s${k},FAM,${20 + k}`, `${w},s${k},CY5,${20 + k}`]).join("\n") + "\n", amp));
  assert.equal(rules(res).filter(r => r === "amp_ct_without_rise").length, 0);
});
test("melt: a sloping dye background with wiggles is not a second product; a separate peak with a dip is", () => {
  const T = Array.from({ length: 81 }, (_, i) => 60 + i * 0.4);
  const one = t => 0.4 * Math.exp(-(t - 60) / 12) + Math.exp(-(((t - 84) / 0.9) ** 2)) + 0.004 * Math.sin(t * 3);
  const two = t => one(t) + 0.45 * Math.exp(-(((t - 76) / 0.8) ** 2));
  const melt = "Well,Target,Temperature,Derivative\n" + [["A1", one], ["A2", one], ["A3", two]].flatMap(([w, f]) => T.map(t => `${w},G,${t.toFixed(1)},${f(t).toFixed(5)}`)).join("\n") + "\n";
  const res = C.analyze(exp("Well,Sample,Target,Cq\nA1,s1,G,22\nA2,s2,G,22.1\nA3,s3,G,22.2\n", null, melt));
  assert.deepEqual(res.findings.filter(f => f.rule === "melt_multiple_peaks").flatMap(f => f.wells), ["A3"]);
});

// ---- scale (platecheck-qa/round4/scale)
test("ComBat's rank check handles a 64-plate design without overflowing the call stack", () => {
  const n = 6080, P = 65, X = Array.from({ length: n }, (_, i) => Array.from({ length: P }, (_, c) => (c === i % 64 || (c === 64 && Math.floor(i / 64) % 2) ? 1 : 0)));
  assert.equal(rank(X), P);
});
test("wells left out in the settings are kept beyond 100, and the warning lists each well once", () => {
  const wells = Array.from({ length: 150 }, (_, i) => `${"ABCDEFGHIJKLMNOP"[Math.floor(i / 24)]}${(i % 24) + 1}`);
  assert.equal(C.cleanAnalysisSettings({ on: true, excluded: wells }).excluded.length, 150);
  const res = C.analyze(exp("Well,Sample,Target,Cq,Group\nA1,s1,G,20,c\nA1,s1,R,18,c\nA2,s2,G,21,c\nA2,s2,R,18,c\nA3,s3,G,22,t\nA3,s3,R,18,t\nA4,s4,G,22,t\nA4,s4,R,18,t\n"));
  const w = A.plateRecords(res, C.cleanAnalysisSettings({ on: true, refs: ["R"], control: "c", excluded: ["A1"] })).warnings.join(" ");
  assert.match(w, /Left out 1 well\(s\) you chose to exclude: A1\./);
});
test("LinRegPCR is not refitted after a click when the curves and their targets are unchanged", () => {
  const amp = "Well,Target,Cycle,Fluorescence\n" + ["A1", "A2", "A3", "A4"].flatMap((w, k) => sig(20 + k, 5000).map((y, i) => `${w},G,${i + 1},${(y + 800).toFixed(3)}`)).join("\n") + "\n";
  const e = exp("Well,Sample,Target,Cq\nA1,s1,G,18\nA2,s2,G,19\nA3,s3,G,20\nA4,s4,G,21\n", amp);
  const a = L.forRun(C.analyze(e)), b = L.forRun(C.analyze(e));
  assert.notEqual(a, b); assert.deepEqual(a.rows.map(r => r.eff), b.rows.map(r => r.eff));
  a.rows[0].sample = "changed"; assert.equal(b.rows[0].sample, "s1"); // each result gets its own rows
});
test("the PDF of a very large run summarises the findings beyond the first ones instead of building thousands of pages", () => {
  const rows = Array.from({ length: 400 }, (_, i) => `${"ABCDEFGHIJKLMNOP"[Math.floor(i / 24)]}${(i % 24) + 1},s${i},G,abc`);
  const e = exp("Well,Sample,Target,Cq\n" + rows.join("\n") + "\n"), res = C.analyze(e);
  assert.ok(res.findings.length > PDF_MAX_FINDINGS);
  const doc = JSON.stringify(reportPdfDoc(e, res, { generatedAt: "2026-11-22T00:00:00Z" }).content);
  assert.match(doc, /more findings, by kind/);
});
