// Bugs found by testing on published data (2026-11-15; platecheck-qa/papers/*-published/REPORT.md), each pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as L from "../web/linreg.js";
import * as A from "../web/analysis.js";
import * as Q from "../web/absquant.js";
import * as R from "../web/rdml.js";
import { reportHtml } from "../web/report.js";
import { combat } from "../web/combat.js";
import * as GS from "../web/gsea.js";
import * as S from "../web/stats.js";

const run = (results, amp) => {
  const e = C.newExperiment({ title: "x" }, "qa");
  e.source = C.fileRecord({ name: "r", text: C.toCsv(results), sha: "a", actor: "qa" });
  if (amp) e.amp = C.fileRecord({ name: "a", text: typeof amp === "string" ? amp : C.toCsv(amp), sha: "b", actor: "qa" });
  return { e, res: C.analyze(e) };
};
const curve = (E, n0, bg) => Array.from({ length: 40 }, (_, i) => { const x = n0 * E ** (i + 1); return bg + x / (1 + (x / 5000) ** 4) ** 0.25; });

test("LinRegPCR on a curve file without a target column (CFX wide): targets, NTCs and samples come from the results rows", () => {
  const wells = [], res = [["Well", "Sample", "Target", "Task", "Cq", "Group"]];
  for (let k = 0; k < 6; k++) { wells.push([`A${k + 1}`, curve(1.95, 1e-5 * 2 ** k, 800)]); res.push([`A${k + 1}`, `s${k % 3}`, "GENE", "Unknown", "25", k < 3 ? "ctl" : "trt"]); }
  for (let k = 0; k < 6; k++) { wells.push([`B${k + 1}`, curve(1.80, 1e-5 * 2 ** k, 900)]); res.push([`B${k + 1}`, `s${k % 3}`, "REF", "Unknown", "25", k < 3 ? "ctl" : "trt"]); }
  wells.push(["C1", Array.from({ length: 40 }, (_, i) => 850 + ((i * 7) % 5))]); res.push(["C1", "NTC", "GENE", "NTC", "Undetermined", ""]);
  const wide = [["Cycle", ...wells.map(w => w[0])], ...Array.from({ length: 40 }, (_, i) => [i + 1, ...wells.map(w => w[1][i].toFixed(3))])];
  const { e, res: an } = run(res, wide), lr = L.forRun(an);
  assert.deepEqual(Object.fromEntries(Object.entries(lr.targets).map(([t, v]) => [t, +v.meanEff.toFixed(2)])), { GENE: 1.95, REF: 1.8 }); // was one pooled "" target
  assert.equal(lr.rows.find(w => w.key === "A1").sample, "s0");
  const pf = A.analyzeRun(e, an, { on: true, efficiency: true, effSource: "linreg", refs: ["REF"], control: "ctl" });
  assert.match(pf.efficiency.REF.source, /^LinRegPCR/); // 80% is a normal LinRegPCR mean; it used to be refused
});

test("LinRegPCR uses Rn when a QuantStudio file has both ΔRn and Rn; LightCycler raw exports are read as exported", () => {
  const amp = [["Well", "Target Name", "Cycle", "Rn", "Delta Rn"]];
  for (let k = 0; k < 6; k++) curve(1.9, 1e-5 * 2 ** k, 1.0).forEach((v, i) => amp.push([`A${k + 1}`, "G", i + 1, v.toFixed(4), (v - 1).toFixed(4)]));
  const res = [["Well", "Sample", "Target Name", "Task", "Cq"], ...Array.from({ length: 6 }, (_, k) => [`A${k + 1}`, `s${k}`, "G", "UNKNOWN", "20"])];
  const { res: an } = run(res, amp);
  assert.equal(an.amp.yName, "Delta Rn"); assert.equal(an.amp.rawName, "Rn"); // ΔRn still drives the curve checks
  const lr = L.forRun(an);
  assert.match(lr.notes[0], /Used the “Rn” column/); assert.equal(lr.warnings.length, 0);
  const lc = "Raw Data \tExperiment\nSamplePos\tSampleName\tProg#\tSeg#\tCycle#\tTime\tTemp\t465-510\n" + [1, 2, 3].map(c => `A1\ts\t2\t2\t${c}\t0\t60\t${c + 0.5}`).join("\n") + "\n";
  const p = C.parseCurves(lc, "amp");
  assert.equal(p.yName, "465-510"); assert.deepEqual(p.series["A1|"], [[1, 1.5], [2, 2.5], [3, 3.5]]);
});

test("baseline-subtracted curves clipped at zero are warned about", () => {
  const curves = Array.from({ length: 6 }, (_, k) => ({ key: `A${k + 1}`, target: "G", type: "unkn", fluor: curve(1.9, 1e-5 * 2 ** k, 0).map((v, i) => (i < 5 ? 0 : v)) }));
  assert.match(L.linRegPCR(curves).warnings.join(" "), /cut off at zero/);
});

test("a Ct of 0 (or below) means no Ct, not a value: it no longer wrecks the standard curve", () => {
  assert.equal(C.ctNum("0"), null); assert.equal(C.ctNum("-1"), null); assert.equal(C.ctNum("0,00", true), null); assert.equal(C.ctNum("0.5"), 0.5);
  const rows = [["Well", "Sample", "Target", "Task", "Quantity", "Cq"]];
  [[1e5, 18], [1e4, 21.3], [1e3, 24.6], [1e2, 27.9], [10, 0]].forEach(([q, c], i) => rows.push([`A${i + 1}`, "std", "G", "STANDARD", q, c]));
  const { res } = run(rows);
  assert.ok(res.stdCurves[0].r2 > 0.999, `R² ${res.stdCurves[0].r2}`); // with Ct 0 as a value R² was 0.02
  assert.ok(res.findings.some(f => f.rule === "missing_ct" && f.wells.includes("A5")));
});

test("RDML round trip keeps biological units, groups that differ under one sample name, and wells without a target", async () => {
  const rows = [["Well", "Sample", "Target", "Task", "Cq", "Group", "Biological Unit"],
    ["A1", "S1", "G", "Unknown", "20", "RT", "mouse1"], ["A2", "S1", "G", "Unknown", "20.1", "RT", "mouse1"], ["A3", "S1", "G", "Unknown", "33", "No RT", "mouse1"],
    ["B1", "S2", "", "Unknown", "21", "RT", "mouse2"]];
  const { e, res } = run(rows), notes = R.rdmlNotes(e, res).join(" ");
  assert.match(notes, /“S1”/); assert.match(notes, /no target/);
  const back = await R.readRdml("x.rdml", await R.rdmlZip(e, res));
  const e2 = C.newExperiment({ title: "y" }, "qa"); e2.source = C.fileRecord({ name: "r", text: back.best.results.text, sha: "c", actor: "qa" });
  const r2 = C.analyze(e2).rows, by = k => r2.find(r => r.key === k);
  assert.equal(by("A3").group, "No RT"); assert.equal(by("A1").group, "RT"); // the third well used to take the first well's group
  assert.equal(by("A1").bio_unit, "mouse1"); assert.equal(by("B1").bio_unit, "mouse2");
  assert.equal(by("A3").role, "sample"); // the split sample's name must not read as a no-RT control
  assert.ok(by("B1"), "a well without a target is written, not dropped");
});

test("report: one line per kind of missing method detail, however many wells it concerns", () => {
  const rows = [["Well", "Sample", "Target", "Task", "Cq"], ...Array.from({ length: 30 }, (_, k) => [`A${(k % 12) + 1}`.replace(/^A/, "ABC"[Math.floor(k / 12)]), `s${k}`, "G", "Weird task", "20"])];
  const { e, res } = run(rows), html = reportHtml(e, res);
  const n = (html.match(/Role in file not recognised/g) || []).length;
  assert.ok(n >= 1 && n <= 3, `${n} mentions`); assert.match(html, /\(30 wells: A1, A2/);
});

// Second round (surface sweep over every real file, 2026-11-16; platecheck-qa/surface).
test("1536-well positions give one clear finding, not one per well", () => {
  const rows = [["Pos", "Name", "Target", "Cp"], ...Array.from({ length: 40 }, (_, k) => [`${"ABCD"[k % 4]}${"abcd"[k % 4]}${k + 1}`, `s${k}`, "G", "25"])];
  const f = run(rows).res.findings.filter(x => x.rule === "invalid_well_coordinate");
  assert.equal(f.length, 1); assert.match(f[0].description, /40 wells .*1536-well plate/);
});
test("CFX's literal NaN quantity is read as no quantity", () => {
  const { res } = run([["Well", "Sample", "Target", "Content", "Starting Quantity (SQ)", "Cq"], ["A1", "s", "G", "Unkn", "NaN", "21.07"]]);
  assert.equal(res.rows[0].quantity, null);
});
test("an uncompressed RDML file (rdml_data.xml on its own) is read", async () => {
  const { e, res } = run([["Well", "Sample", "Target", "Task", "Cq"], ["A1", "s", "G", "Unknown", "21"], ["A2", "s", "G", "Unknown", "21.2"]]);
  const b = await R.readRdml("x.xml", new TextEncoder().encode(R.rdmlXml(e, res)));
  assert.equal(b.rdml.runs[0].reactions, 2);
  assert.equal(await R.readRdml("x.xml", new TextEncoder().encode("<html>no</html>")), null);
});
test("RDML notes mention curves that have no well in the results file", () => {
  const amp = [["Well", "Target", "Cycle", "Fluorescence"]]; for (const w of ["A1", "A2"]) for (let c = 1; c <= 3; c++) amp.push([w, "G", c, c]);
  const { e, res } = run([["Well", "Sample", "Target", "Task", "Cq"], ["A1", "s", "G", "Unknown", "21"]], amp);
  assert.match(R.rdmlNotes(e, res).join(" "), /1 amplification curve\(s\) have no well in the results file .*A2 G/);
});
test("LinRegPCR target summary has null, not NaN, when no well qualifies", () => {
  const flat = Array.from({ length: 4 }, (_, k) => ({ key: `A${k + 1}`, target: "G", type: "unkn", fluor: Array.from({ length: 40 }, (_, i) => 100 + ((i * 7 + k) % 3)) }));
  const o = L.linRegPCR(flat);
  assert.equal(o.targets.G.meanEff, null); assert.equal(o.targets.G.sdEff, null); assert.equal(o.targets.G.n, 0);
});

// Third round (new published data, 2026-11-21; platecheck-qa/papers/{multiplate,stats-gsea,instruments-r3}*).
test("ComBat leaves a target with tied values on a plate alone in every variant, as sva::ComBat does", () => {
  const plate = ["A", "A", "A", "A", "B", "B", "B", "B"], grp = ["c", "t", "c", "t", "c", "t", "c", "t"];
  const data = [[1, 1, 1, 1, 2, 3, 2.5, 4], [5, 6, 5.5, 6.2, 7, 8, 7.4, 8.1], [3, 2.2, 3.1, 2.6, 4, 3.3, 4.4, 3.9], [9, 9.6, 8.8, 9.9, 10.2, 11, 10.5, 11.4]];
  for (const opts of [{}, { meanOnly: true }, { group: grp }, { group: grp, meanOnly: true }]) {
    const r = combat(data, plate, opts);
    assert.deepEqual(r.data[0], data[0], JSON.stringify(opts));
    assert.ok(r.notes.some(n => /feature 1: identical values on A/.test(n)), JSON.stringify(opts));
  }
});
test("GSEA p counts permutation ties on both sides: a set and its mirror image get the same p", () => {
  const N = 20, ranked = Array.from({ length: N }, (_, i) => ({ gene: `g${i}`, value: 3 - i * 0.3 }));
  const mirror = ranked.map((r, i) => ({ gene: r.gene, value: -ranked[N - 1 - i].value }));
  const p = (rk, genes) => GS.gseaPreranked(rk, [{ name: "S", genes }], { nperm: 20000, seed: 7 })[0].p;
  const up = p(ranked, ["g0", "g2", "g5"]), down = p(mirror, ["g19", "g17", "g14"]);
  assert.ok(Math.abs(up - 0.0945) < 0.01 && Math.abs(down - 0.0945) < 0.01, `${up} ${down}`); // exact: 0.0945 (all 1140 sets); was 0.069 for the down set
});
test("rank tests treat values equal in the data as ties and zero differences as zeros, despite floating-point noise", () => {
  const a = 7.08 + 1e-15, b = 7.08 - 2e-15;
  assert.deepEqual(S.rank([a, b, 5]).ranks, [2.5, 2.5, 1]);
  const x = [24.31, 22.5, 23.1, 25.0, 21.7, 22.9, 23.3], y = x.map((v, i) => (i === 0 ? v - (24.31 - 18.21) + 6.1 : v - 1 - i / 10));
  const w = S.wilcoxon(x, y);
  assert.equal(w.zeros, 1); assert.equal(w.p, 0.03125);
});
test("amplification sheets that number their wells (ViiA 7 / QuantStudio .xls, MxPro) are read, not dropped", () => {
  const viia = ["Well\tCycle\tTarget Name\tRn\tDelta Rn", ...[1, 2, 13].flatMap(w => [1, 2, 3].map(c => `${w}\t${c}\tb-actin\t${(1 + c / 100).toFixed(4)}\t${(c / 100).toFixed(4)}`))].join("\n");
  assert.equal(C.detectFileKind(viia).kind, "amp");
  assert.deepEqual(Object.keys(C.parseCurves(viia, "amp").series).sort(), ["A1|b-actin", "A2|b-actin", "B1|b-actin"]);
  assert.deepEqual(Object.keys(C.parseCurves(viia, "amp", { plateSize: 384 }).series).sort(), ["A13|b-actin", "A1|b-actin", "A2|b-actin"]);
});
test("a Bio-Rad CFX .rdml (zip starting with the PK 07 08 spanning marker) is a zip, not an unknown binary", () => {
  assert.deepEqual(C.decodeBytes(new Uint8Array([0x50, 0x4b, 7, 8, 0x50, 0x4b, 3, 4, 0, 0, 0, 0])), { binary: "zip" });
});
test("RDML 1.0 (StepOne Software: free-format pcrFormat, well names as react ids) is read", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rdml xmlns="http://www.rdml.org" version="1.0">
 <sample id="NTC_R"><type>ntc</type></sample><sample id="STD_R"><type>std</type><quantity><value>10000.0</value><unit>other</unit></quantity></sample>
 <target id="RNase P"><type>toi</type></target>
 <experiment id="E"><run id="R1"><pcrFormat>free format</pcrFormat>
  <react id="A1"><sample id="NTC_R"/><data><tar id="RNase P"/><cq>-1</cq></data></react>
  <react id="B7"><sample id="STD_R"/><data><tar id="RNase P"/><cq>27.71</cq></data></react>
 </run></experiment></rdml>`;
  const b = await R.readRdml("stepone.rdml", new TextEncoder().encode(xml));
  assert.deepEqual(b.best.results.parsed.rows.map(r => r.key), ["A1", "B7"]);
  assert.equal(b.best.results.parsed.rows[1].quantity, "10000.0");
});
test("Agilent AriaMx / MxPro Cq column names are recognised", () => {
  for (const h of ["Cq (∆R)", "Cq (ΔR)", "Cq (dR)", "Ct (dRn)"]) {
    const p = C.parseResults(`Well\tReplicate\t${h}\nA1\t1\t24.83\nA2\t1\t25.12\n`);
    assert.deepEqual(p.rows.map(r => r.ct), ["24.83", "25.12"], h);
  }
  assert.throws(() => C.parseResults("Well\tCt Mean\nA1\t24.83\n")); // summary columns are still never the Ct column
});
test("a settings footer whose value looks like a well (Reference Sample b1) is a footer, not bad rows", () => {
  const data = n => Array.from({ length: n }, (_, i) => `${i + 1}\tA${i + 1}\tFALSE\tb1\tb-actin\tUNKNOWN\t${(15.6 + i / 100).toFixed(2)}`);
  const foot = ["Analysis Type\tSingleplex", "Endogenous Control\tb-actin", "RQ Min/Max Confidence Level\t95.0", "Reference Sample\tb1"];
  for (const n of [6, 3]) {
    const p = C.parseResults(["Well\tWell Position\tOmit\tSample Name\tTarget Name\tTask\tCT", ...data(n), ...foot].join("\n"));
    assert.equal(p.rows.length, n); assert.equal(p.footerLines, 4); assert.equal(p.malformed.length, 0);
  }
});
test("decimal commas are read in tab-separated tables too", () => {
  const p = C.parseResults("Well\tSample\tTarget\tCq\nA1\ts\tG\t21,13\nA2\ts\tG\t20,76\n");
  assert.equal(p.decimalComma, true); assert.equal(C.ctNum(p.rows[0].ct, p.rows[0].dc), 21.13);
  const q = C.parseCurves("Well\tCycle\tFluorescence\nA1\t1\t0,5\nA1\t2\t1,25\n", "amp");
  assert.deepEqual(q.series["A1|"], [[1, 0.5], [2, 1.25]]);
  const pt = C.parseCurves("Well\tCycle\tFluorescence\nA1\t1\t12,963\nA1\t2\t1.5\n", "amp"); // a point-decimal file keeps thousands separators
  assert.deepEqual(pt.series["A1|"], [[1, 12963], [2, 1.5]]);
});
