// PlateCheck against published results.
// 1. Livak & Schmittgen 2001 c-myc/GAPDH brain vs kidney example, as printed in Ahmed & Kim, PeerJ 2018 (pcr package),
//    Table 2, doi:10.7717/peerj.4473: ΔCt brain 6.86, kidney 4.37, ΔΔCt -2.50, kidney relative to brain 5.6.
// 2. Same paper, Tables 4-5 (ct4, 12 control vs 12 treatment): estimate -0.6848; checked to 1e-6 against R 4.3.2 base
//    t.test (Welch and Student) and wilcox.test.
// 3. Auto-qPCR (Maussion et al., Sci Rep 2021) example QuantStudio export: PlateCheck fold changes vs the RQ values
//    QuantStudio itself wrote into the file (3 decimals). Skipped if the public file isn't downloaded.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";

const CT1 = [[30.72, 23.7], [30.34, 23.56], [30.58, 23.47], [30.34, 23.65], [30.5, 23.69], [30.43, 23.68],
  [27.06, 22.76], [27.03, 22.61], [27.03, 22.62], [27.1, 22.6], [26.99, 22.61], [26.94, 22.76]];
const CT4 = `19.7415,23.1102|19.494,22.9003|19.3906,22.8972|21.9838,26.5801|22.4435,26.2139|22.57,26.0606|24.8109,28.1125|24.4327,28.1899|24.2342,27.5949|26.7319,30.2772|26.8206,30.4667|26.822,30.7571|18.4468,21.7813|18.8227,21.7564|18.3061,21.641|21.2568,23.7965|21.0956,23.7571|20.8473,23.724|23.2322,26.3794|22.9577,26.2542|23.2415,25.9621|25.4817,28.5479|25.608,28.3894|25.5675,28.3416`; // copied from the pcr package's inst/extdata/ct4.csv
const run = (rows, genes, groups, refs, control, test = "welch") => {
  const L = ["Well,Sample,Target,Ct,Group"]; let w = 0;
  rows.forEach((r, i) => genes.forEach((g, j) => { const k = w++; L.push(`${"ABCDEFGH"[Math.floor(k / 12)]}${k % 12 + 1},${groups[i]}-${i + 1},${g},${r[j]},${groups[i]}`); }));
  const e = C.newExperiment({ title: "published" }, "qa"); e.source = C.fileRecord({ name: "p", text: L.join("\n") + "\n", sha: "x", actor: "qa", format: "generic-ct-csv" });
  e.analysis = C.cleanAnalysisSettings({ on: true, refs, control, test }); return A.analyzeRun(e, C.analyze(e)); };

test("Livak & Schmittgen 2001 example: kidney vs brain c-myc matches the published table", () => {
  const a = run(CT1, ["c_myc", "GAPDH"], [...Array(6).fill("brain"), ...Array(6).fill("kidney")], ["GAPDH"], "brain");
  const k = a.summary.find(r => r.target === "c_myc" && r.group === "kidney"), b = a.summary.find(r => r.target === "c_myc" && r.group === "brain");
  assert.equal(b.meanDct.toFixed(2), "6.86"); assert.ok(Math.abs(k.meanDct - 4.37) < 0.006); // 4.365, printed as 4.37
  assert.ok(Math.abs(k.meanDdct - -2.50) < 0.006);
  assert.equal(k.fold.toFixed(1), "5.6");
});
test("pcr ct4 (12 vs 12): estimate -0.6848 as published; p values and CI equal R's t.test / wilcox.test", () => {
  const rows = CT4.split("|").map(x => x.split(",").map(Number)), g = [...Array(12).fill("control"), ...Array(12).fill("treatment")];
  const w = run(rows, ["ref", "target"], g, ["ref"], "control", "welch").summary.find(r => r.group === "treatment" && r.target === "target");
  assert.equal(w.meanDdct.toFixed(4), "-0.6848");
  assert.ok(Math.abs(w.p - 3.4292e-05) < 1e-9); assert.ok(Math.abs(w.diffCiLow - -0.955952) < 1e-6 && Math.abs(w.diffCiHigh - -0.413698) < 1e-6);
  const s = run(rows, ["ref", "target"], g, ["ref"], "control", "student").summary.find(r => r.group === "treatment" && r.target === "target");
  assert.ok(Math.abs(s.p - 2.82932e-05) < 1e-9);
  const m = run(rows, ["ref", "target"], g, ["ref"], "control", "mannwhitney").summary.find(r => r.group === "treatment" && r.target === "target");
  assert.ok(Math.abs(m.p - 6.00576e-05) < 1e-9);
});
const AUTO = new URL("../testdata/public/neuroeddu__Auto-qPCR/RELATIVE_example.csv", import.meta.url);
test("Auto-qPCR example QuantStudio export: fold changes equal QuantStudio's own RQ column", { skip: !existsSync(AUTO) && "public data not downloaded" }, () => {
  const text = C.decodeBytes(readFileSync(AUTO)).text;
  const e = C.newExperiment({ title: "auto" }, "qa"); e.source = C.fileRecord({ name: "a", text, sha: "x", actor: "qa", format: C.parseResults(text).format });
  for (const r of C.analyze(e).rows) e.map[r.id] = { group: r.sample };
  e.analysis = C.cleanAnalysisSettings({ on: true, refs: ["ACTB", "GAPDH"], control: "AiW002-2-D0" });
  const a = A.analyzeRun(e, C.analyze(e)); let checked = 0;
  for (const l of text.split(/\r?\n/)) { const c = l.split(","); if (!/^\d+$/.test(c[0]) || !c[11] || ["ACTB", "GAPDH"].includes(c[4])) continue;
    const s = a.summary.find(r => r.target === c[4] && r.group === c[3]); assert.ok(Math.abs(s.fold - +c[11]) < Math.max(6e-4, 1e-3 * +c[11]), `${c[4]} ${c[3]}: ${s.fold} vs ${c[11]}`); checked++; }
  assert.ok(checked >= 30);
});

// 4. Yuan et al. 2006, BMC Bioinformatics, doi:10.1186/1471-2105-7-85, Table 3: the same 24 Ct pairs (MT7 target, ubiquitin
//    reference). Published t-test: ΔΔCt -0.6848, SE 0.1303, 95% CI (-0.955, -0.4147) — the Student (pooled) interval.
test("Yuan 2006 Table 3 t-test: estimate, standard error and CI as published", () => {
  const rows = CT4.split("|").map(x => x.split(",").map(Number)), g = [...Array(12).fill("control"), ...Array(12).fill("treatment")];
  const s = run(rows, ["ubiquitin", "MT7"], g, ["ubiquitin"], "control", "student").summary.find(r => r.group === "treatment" && r.target === "MT7");
  assert.equal(s.meanDdct.toFixed(4), "-0.6848");
  const se = Math.abs(s.meanDdct / s.t), h = 2.0738730679 * se; // pooled SE from Student's t; t(0.975, 22)
  assert.equal(se.toFixed(4), "0.1303");
  assert.equal((s.meanDdct - h).toFixed(3), "-0.955"); assert.equal((s.meanDdct + h).toFixed(4), "-0.4147");
  // PlateCheck's own "vs control" CI is Welch's (labelled so), as R's default t.test: (-0.9560, -0.4137).
});

const PUB = n => new URL(`../testdata/published/${n}`, import.meta.url);
const generic = (title, lines, settings) => {
  const e = C.newExperiment({ title }, "qa"); e.source = C.fileRecord({ name: title, text: lines.join("\n") + "\n", sha: "x", actor: "qa", format: "generic-ct-csv" });
  e.analysis = C.cleanAnalysisSettings({ on: true, ...settings }); return A.analyzeRun(e, C.analyze(e)); };
const well = k => `${"ABCDEFGHIJKLMNOP"[Math.floor(k / 24)]}${k % 24 + 1}`;

// 5. Lee et al. 2020, F1000Research, doi:10.12688/f1000research.23580.2; authors' raw data on Figshare. APOE vs GAPDH, 4 days,
//    3 biological x 2 technical replicates per lineage. ΔCt must equal the authors' column for every unit; one-way ANOVA on
//    unit ΔCt equals scipy.stats.f_oneway (SciPy 1.18.1). Authors' normalised values use an arithmetic D7 mean, so they differ
//    from PlateCheck's by a constant factor per lineage (checked: one factor per lineage, not asserted to a published value).
test("Lee 2020 raw data: ΔCt equals the authors' for all 36 units; ANOVA equals SciPy", () => {
  const lines = readFileSync(PUB("lee2020_raw_qpcr.csv"), "utf8").trim().split(/\r?\n/).slice(1).map(l => C.splitDelimited(l)[0].cells);
  const scipy = { DSi: 1.8071893668107062e-05, "DS-Wi": 6.419390796499844e-06, "DS-WHi": 0.0013640812714631769 };
  let units = 0;
  for (const lin of Object.keys(scipy)) {
    const L = ["Well,Sample,Target,Ct,Group,Biological unit"], authors = {}; let w = 0;
    for (const c of lines.filter(c => c[0].split("_")[0] === lin)) { const [, day, bio] = c[0].split("_"), unit = `${day} ${bio}`;
      for (const [t, ct] of [["APOE", c[1]], ["GAPDH", c[2]]]) L.push(`${well(w++)},${unit},${t},${ct},${day},${unit}`);
      if (c[9]) authors[unit] = { norm: +c[9], dct: +c[7] }; }
    const a = generic(lin, L, { refs: ["GAPDH"], control: "D7", test: "tukey" }), ratios = [];
    for (const r of a.rows.filter(r => r.target === "APOE")) {
      assert.ok(Math.abs(r.dct + authors[r.unit].dct) < 1e-9, `${lin} ${r.unit}`); ratios.push(authors[r.unit].norm / r.fold); units++; }
    assert.ok(Math.max(...ratios) - Math.min(...ratios) < 1e-6, `${lin}: one constant factor`);
    assert.ok(Math.abs(a.anova.find(x => x.target === "APOE").p / scipy[lin] - 1) < 1e-9, lin);
  }
  assert.equal(units, 36);
});

// 6. Heffer et al. 2020, PLOS ONE, doi:10.1371/journal.pone.0243626: 6 genes vs Gapdh, 4 groups of 4-5 eyes, one-way ANOVA +
//    Tukey. PlateCheck's Tukey on ΔCt equals scipy.stats.tukey_hsd. The paper's fold changes (~5, ~3, 2.3, 1.7, 4.7 for
//    Fn1, Col1a1, Acta2, TgfB, Tnfa) are arithmetic means of per-eye 2^-ΔΔCt (4.98, 3.07, 2.27, 1.74, 4.52 here) with Tukey on
//    that scale, so they are compared in papers/RESULTS.md, not here.
test("Heffer 2020: Tukey p values on ΔCt equal SciPy for every gene", () => {
  const raw = readFileSync(PUB("data_Heffer2020PlosOne.csv"), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).map(l => l.split(","));
  const genes = ["Fn1", "Col1a1", "Acta2", "TgfB", "Tnfa", "Mcp1", "Gapdh"], L = ["Well,Sample,Target,Ct,Group,Biological unit"]; let w = 0;
  for (const c of raw.slice(1)) for (const g of genes) L.push(`${well(w++)},${c[0]}-${c[1]},${g},${c[raw[0].indexOf("Ct." + g)]},${c[0]},${c[0]}-${c[1]}`);
  const a = generic("heffer", L, { refs: ["Gapdh"], control: "Uninjected", test: "tukey" });
  // scipy.stats.tukey_hsd on ΔCt (SciPy 1.18.1), DMSO+RPE vs uninjected and DMSO+RPE vs SNC+RPE
  const ref = { Fn1: [0.01064, 0.03514], Col1a1: [0.06339, 0.06138], Acta2: [0.1282, 0.2486], TgfB: [0.03872, 0.002732], Tnfa: [0.0007879, 0.3722], Mcp1: [0.0004637, 0.005339] };
  const p = (t, x, y) => a.pairwise.find(r => r.target === t && new Set([r.a, r.b]).has(x) && new Set([r.a, r.b]).has(y)).p;
  for (const [t, [u, s]] of Object.entries(ref)) {
    assert.equal(+p(t, "DMSORPE", "Uninjected").toPrecision(4), u, t); assert.equal(+p(t, "DMSORPE", "SNCRPE").toPrecision(4), s, t); }
  assert.equal(a.summary.find(r => r.target === "Fn1" && r.group === "DMSORPE").fold.toFixed(3), "4.145");
});

// 7. pcr ct3 dilution series (PeerJ 2018, Table 1 / Fig 1) as standards, ct1 brain/kidney as samples, one plate. Standard curves equal
//    base R lm(Ct ~ log10(amount)); the efficiency-corrected (Pfaffl) kidney/brain ratio equals R's E_t^ΔCt_t / E_r^ΔCt_r, and is
//    close to the paper's standard-curve result, 5.5 (Table 3; that method averages amounts arithmetically, R gives 5.461 for it).
test("pcr standard curves and Pfaffl ratio equal base R; ratio close to the paper's 5.5", () => {
  const ct3 = readFileSync(PUB("pcr_ct3.csv"), "utf8").trim().split(/\r?\n/).slice(1).map(l => l.split(","));
  const amt = [1, .5, .2, .1, .05, .02, .01].flatMap(a => [a, a, a]), L = ["Well,Sample,Target,Task,Quantity,Ct,Group"]; let w = 0;
  ct3.forEach((r, i) => [["c_myc", r[0]], ["GAPDH", r[1]]].forEach(([g, ct]) => L.push(`${well(w++)},STD-${amt[i]},${g},STANDARD,${amt[i]},${ct},`)));
  CT1.forEach((r, i) => [["c_myc", r[0]], ["GAPDH", r[1]]].forEach(([g, ct]) => L.push(`${well(w++)},${i < 6 ? "brain" : "kidney"}-${i + 1},${g},UNKNOWN,,${ct},${i < 6 ? "brain" : "kidney"}`)));
  const e = C.newExperiment({ title: "curves" }, "qa"); e.source = C.fileRecord({ name: "c", text: L.join("\n") + "\n", sha: "x", actor: "qa", format: "generic-ct-csv" });
  const res = C.analyze(e);
  const R = { c_myc: [-3.3880951819, 25.6966912801, 0.9965504211, 97.31090754], GAPDH: [-3.4145513738, 22.6822113565, 0.9990278221, 96.27466376] }; // R 4.3.2
  for (const [t, [sl, ic, r2, eff]] of Object.entries(R)) { const c = res.stdCurves.find(x => x.target === t);
    assert.ok(Math.abs(c.slope - sl) < 1e-9 && Math.abs(c.intercept - ic) < 1e-9 && Math.abs(c.r2 - r2) < 1e-9 && Math.abs(c.efficiency - eff) < 1e-7, t); }
  e.analysis = C.cleanAnalysisSettings({ on: true, refs: ["GAPDH"], control: "brain", efficiency: true });
  const k = A.analyzeRun(e, res).summary.find(r => r.target === "c_myc" && r.group === "kidney");
  assert.ok(Math.abs(k.fold - 5.4778330527) < 1e-9); assert.equal(k.fold.toFixed(1), "5.5");
});

// 8. Two-way ANOVA (group x second factor, with interaction) on a balanced design equals R 4.3.2 anova(lm(dCt ~ Concentration * Type)).
test("two-way ANOVA with interaction equals R on a balanced 3 x 2 design", () => {
  const rows = readFileSync(PUB("data_2factorBlock.csv"), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).map(l => l.split(","));
  const L = ["Well,Sample,Target,Ct,Group,Factor2,Biological unit"]; let w = 0;
  for (const c of rows) { const u = `${c[0]}-${c[1]}-${c[3]}`; for (const [g, ct] of [["PO", c[5]], ["GAPDH", c[7]]]) L.push(`${well(w++)},${u},${g},${ct},${c[1]},${c[0]},${u}`); }
  const tw = generic("2f", L, { refs: ["GAPDH"], control: "L0", twoWay: "factor2" }).twoWay.find(x => x.target === "PO");
  const R = { group: [12.95303333333, 41.39378, 4.117e-06], second: [3.05045, 19.49654, 0.00084222], interaction: [4.54543333333, 14.52576, 0.00062390] };
  for (const [k, [ss, F, p]] of Object.entries(R)) {
    assert.ok(Math.abs(tw[k].ss - ss) < 1e-9, k); assert.ok(Math.abs(tw[k].F - F) < 1e-5, k); assert.equal(+tw[k].p.toPrecision(4), +p.toPrecision(4), k); }
  assert.ok(Math.abs(tw.residual.ss - 1.87753333333) < 1e-9 && tw.residual.df === 12);
});
