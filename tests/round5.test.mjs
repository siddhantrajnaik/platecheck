// Bugs found by the fifth round of tests on new published data (2026-11-23; platecheck-qa/round5/*), each pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import * as R from "../web/rdml.js";
import * as S from "../web/stats.js";

const exp = text => { const e = C.newExperiment({ title: "x" }, "qa"); e.source = C.fileRecord({ name: "r", text, sha: "a", actor: "qa" }); return e; };

test("LightCycler 96 RDML: Cq 100 (negative) is no Cq, sample names come from the description, targets drop the dye prefix", async () => {
  const U = ["0a1b2c3d-1111-2222-3333-444455556666", "0a1b2c3d-1111-2222-3333-444455557777"];
  const adp = [1, 2, 3, 4].map(c => `<adp><cyc>${c}</cyc><fluor>${c}</fluor></adp>`).join("");
  const xml = `<?xml version="1.0"?><rdml xmlns="http://www.rdml.org" version="1.1"><dye id="SYBR Green I"/>
 <sample id="${U[0]}"><description>Hm_1</description><type>unkn</type></sample><sample id="${U[1]}"><description>DIP_1</description><type>unkn</type></sample>
 <target id="SYBR Green I@hmuY"><type>toi</type><dyeId id="SYBR Green I"/></target>
 <experiment id="E"><run id="R"><pcrFormat><rows>8</rows><columns>12</columns><rowLabel>ABC</rowLabel><columnLabel>123</columnLabel></pcrFormat>
  <react id="1"><sample id="${U[0]}"/><data><tar id="SYBR Green I@hmuY"/><cq>2.5</cq>${adp}</data></react>
  <react id="2"><sample id="${U[1]}"/><data><tar id="SYBR Green I@hmuY"/><cq>100</cq>${adp}</data></react>
 </run></experiment></rdml>`;
  const b = await R.readRdml("x.lc96p", new TextEncoder().encode(xml)), rows = b.best.results.parsed.rows;
  assert.deepEqual(rows.map(r => [r.sample, r.target, r.ct]), [["Hm_1", "hmuY", "2.5"], ["DIP_1", "hmuY", "Undetermined"]]);
});
test("a well_position column (underscore) is the well, ahead of a numeric position column", () => {
  const p = C.parseResults("position,well_position,Sample,Target,Ct\n1,A1,s,G,20\n2,A2,s,G,21\n");
  assert.equal(p.columns.well, "well_position"); assert.deepEqual(p.rows.map(r => r.key), ["A1", "A2"]);
});
test("a Sample Type column gives the role", () => {
  const p = C.parseResults("Well,Sample name,Gene,Sample type,Ct\nA1,s,G,Unknown,20\nA2,ntc,G,NTC,33\n");
  assert.deepEqual(p.rows.map(r => r.role), ["sample", "ntc"]);
});
test("a file with only a 'Cq Mean' column says so, instead of claiming the Well column is missing", () => {
  assert.throws(() => C.parseResults("Experiment,x\nWell,Sample,Target,Cq Mean\nA1,s,G,20\n"), e => /Ct\/Cq\./.test(e.message) && !/Well,/.test(e.message) && /Cq Mean/.test(e.message));
});
test("a reported Tm2 of 0 is no second peak", () => {
  const res = C.analyze(exp("Well,Sample,Target,Cq,Tm1,Tm2\nA1,s1,G,20,80.1,0\nA2,s2,G,20.2,80.2,0\nA3,s3,G,20.1,80.0,72.5\n"));
  assert.deepEqual(res.findings.filter(f => f.rule === "melt_multiple_peaks").flatMap(f => f.wells), ["A3"]);
});
test("a multiplex export with no target names uses the dye as the target, not duplicate wells", () => {
  const res = C.analyze(exp("Well,Sample,Gene,Dye,Ct\nA1,s1,,FAM,20\nA1,s1,,VIC,25\nA2,s2,,FAM,21\nA2,s2,,VIC,26\n"));
  assert.deepEqual(res.rows.map(r => r.target), ["FAM", "VIC", "FAM", "VIC"]);
  assert.equal(res.findings.filter(f => f.rule === "duplicate_well_assignment").length, 0);
});
test("the same animal in several groups (a time course) is kept apart per group and paired by animal, not averaged", () => {
  const rows = ["Well,Sample,Target,Cq,Group,Biological Unit"];
  let w = 0; const well = () => { const i = w++; return `${"ABCDEFGH"[Math.floor(i / 12)]}${(i % 12) + 1}`; };
  for (const m of ["m0", "m1", "m2", "m3"]) for (const [g, d] of [["T0", 0], ["T1", -0.6], ["T2", -1]]) {
    rows.push(`${well()},${m}${g},GOI,${(25 + d + (m === "m1" ? 0.3 : 0)).toFixed(2)},${g},${m}`, `${well()},${m}${g},REF,18,${g},${m}`);
  }
  const e = exp(rows.join("\n") + "\n"), res = C.analyze(e), a = A.analyzeRun(e, res, { on: true, refs: ["REF"], control: "T0", test: "paired" });
  assert.deepEqual(a.summary.filter(r => r.target === "GOI").map(r => [r.group, r.n]), [["T0", 4], ["T1", 4], ["T2", 4]]);
  assert.match(a.warnings.join(" "), /appear in more than one group/);
  assert.ok(a.rows.some(r => r.unit === "m0 · T1"));
});
test("pair labels with an unpaired test, and the across-groups ANOVA with a paired test, are both pointed out", () => {
  const rows = ["Well,Sample,Target,Cq,Group,Pair"];
  let w = 0; const well = () => { const i = w++; return `${"ABCDEFGH"[Math.floor(i / 12)]}${(i % 12) + 1}`; };
  for (const [g, d] of [["c", 0], ["t", -1], ["u", -2]]) for (let k = 0; k < 3; k++) rows.push(`${well()},${g}${k},GOI,${25 + d + k * 0.2},${g},p${k}`, `${well()},${g}${k},REF,18,${g},p${k}`);
  const e = exp(rows.join("\n") + "\n"), res = C.analyze(e);
  assert.match(A.analyzeRun(e, res, { on: true, refs: ["REF"], control: "c", test: "welch" }).warnings.join(" "), /pair labels .* chosen test \(Welch t-test\)/);
  assert.match(A.analyzeRun(e, res, { on: true, refs: ["REF"], control: "c", test: "paired" }).warnings.join(" "), /not a repeated-measures test/);
});
// ---- real files through the UI (platecheck-qa/round5/ui-real)
test("StepOne CSV 'C_' column is the Ct; German CFX 'n. def.' is no Ct", () => {
  assert.deepEqual(C.parseResults("Well,Sample Name,Target Name,C_,Cт Mean\nA1,s,G,24.1,24.2\nA2,s,G,24.3,24.2\n").rows.map(r => r.ct), ["24.1", "24.3"]);
  assert.equal(C.isNoAmp("n. def."), true);
});
test("a QuantStudio 'export all' text with [Results] after line 500 is read", () => {
  const amp = Array.from({ length: 800 }, (_, i) => `${(i % 96) + 1}\t${Math.floor(i / 96) + 1}\tG\t${i}`).join("\n");
  const t = `* Block Type = 96-Well Block\n[Amplification Data]\nWell\tCycle\tTarget Name\tRn\n${amp}\n\n[Results]\nWell\tWell Position\tSample Name\tTarget Name\tCT\n1\tA1\ts\tG\t20\n2\tA2\ts\tG\t21\n`;
  assert.equal(C.detectFileKind(t).kind, "results"); assert.equal(C.parseResults(t).rows.length, 2);
});
test("a high-density chip with no plate positions (Biomark chamber ids) is refused with the reason, not checked row by row", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `A${i + 10}a${(i % 9) + 1},s${i},G,20`);
  assert.throws(() => C.parseResults("Well,Sample,Target,Ct\n" + rows.join("\n") + "\n"), /None of the 40 rows has a 96- or 384-well position .*Biomark/);
});
test("CFX ROX rows (passive reference, no Cq) next to the real reaction are left out", () => {
  const p = C.parseResults("Well,Fluor,Target,Content,Sample,Cq\nA1,SYBR,,Unkn,s1,20.1\nA1,ROX,,Unkn,s1,\nA2,SYBR,,Unkn,s2,21.3\nA2,ROX,,Unkn,s2,\n");
  assert.deepEqual(p.rows.map(r => [r.key, r.fluor]), [["A1", "SYBR"], ["A2", "SYBR"]]); assert.match(p.warnings.join(" "), /passive reference/);
});
test("a CFX derivative melt export (peak in the middle, higher at the start than the end) is read as a derivative; raw melt fluorescence is not", () => {
  const T = Array.from({ length: 61 }, (_, i) => 65 + i * 0.5);
  const der = t => 200 * Math.exp(-(t - 65) / 8) + 1800 * Math.exp(-(((t - 83) / 1.2) ** 2)) + 5;
  const raw = t => 9000 / (1 + Math.exp((t - 83) / 1.0)) + 1500 - 20 * (t - 65);
  const wide = f => "Temperature,A1,A2,A3\n" + T.map(t => [t, f(t), f(t) * 1.1, f(t) * 0.9].join(",")).join("\n") + "\n";
  assert.equal(C.parseCurves(wide(der), "melt").guessedValueType, "derivative");
  assert.equal(C.parseCurves(wide(raw), "melt").guessedValueType, "fluorescence");
});
test("a second factor that is already part of the group labels is explained, not reported as empty combinations", () => {
  const r = S.twoWayAnova([1, 2, 3, 4, 5, 6, 7, 8], ["WT-L", "WT-L", "WT-H", "WT-H", "M-L", "M-L", "M-H", "M-H"], ["L", "L", "H", "H", "L", "L", "H", "H"]);
  assert.equal(r.terms.length, 0); assert.match(r.reason, /already part of the group labels/);
});
