// PlateCheck on real lab data deposited with three open-access PLOS papers (CC BY 4.0; see testdata/published/README.md).
// The authors' own computed columns and SciPy 1.18.1 on the same numbers are the references.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import { readWorkbook } from "../web/excel.js";

const P = n => new URL(`../testdata/published/plos/${n}`, import.meta.url);
const authors = JSON.parse(readFileSync(P("authors.json"), "utf8")), scipy = JSON.parse(readFileSync(P("scipy_ref.json"), "utf8"));
const well = k => `${"ABCDEFGHIJKLMNOP"[Math.floor(k / 24)]}${k % 24 + 1}`;
function run(name, ref, control, test) {
  const rows = readFileSync(P(name + ".csv"), "utf8").trim().split(/\r?\n/).map(l => l.split(",")), h = rows[0], ix = k => h.indexOf(k);
  const L = ["Well,Sample,Target,Ct,Group,Biological unit"];
  rows.slice(1).forEach((c, k) => L.push(`${well(k)},${c[ix("unit")]},${c[ix("target")]},${c[ix("ct")]},${c[ix("group")]},${c[ix("unit")]}`));
  const e = C.newExperiment({ title: name }, "qa"); e.source = C.fileRecord({ name, text: L.join("\n") + "\n", sha: "x", actor: "qa", format: "generic-ct-csv" });
  const res = C.analyze(e); e.analysis = C.cleanAnalysisSettings({ on: true, refs: [ref], control, test });
  const target = [...new Set(rows.slice(1).map(c => c[ix("target")]))].find(t => t !== ref);
  return { res, a: A.analyzeRun(e, res), target };
}
const close = (x, y, rel) => Math.abs(x - y) <= rel * Math.abs(y);

// PLOS ONE 0339560: 3 mice x 3 technical wells per group, GAPDH reference, Student's t-test in Prism (paper: P < 0.05 for all four).
test("PLOS ONE 0339560: per-mouse ΔCt equals the authors', Student p equals SciPy, all four genes significant", () => {
  for (const g of ["NAMPT", "NFKB", "PRKCQ", "SLC40A"]) {
    const name = `pone0339560_${g}`, { a, target } = run(name, "GAPDH", "WT", "student"), au = authors[name];
    const units = a.rows.filter(r => r.target === target);
    if (g === "NAMPT") // the authors' Mean ΔCt column is shifted by one row within WT (WT1 shows WT2's mean, and so on)
      assert.deepEqual(units.filter(u => u.group === "WT").map(u => u.dct.toFixed(6)).sort(), ["WT1", "WT2", "WT3"].map(u => au[u].meanDct.toFixed(6)).sort());
    for (const u of units) if (g !== "NAMPT" || u.group === "SA") assert.ok(Math.abs(u.dct - au[u.unit].meanDct) < 1e-9, `${g} ${u.unit}`);
    const p = a.summary.find(r => r.target === target && r.group === "SA").p;
    assert.ok(close(p, scipy[name].student, 1e-9), `${g}: ${p} vs ${scipy[name].student}`); assert.ok(p < 0.05);
  }
});
test("PLOS ONE 0339560: the technical triplicates that disagree in the deposited data are flagged", () => {
  const flagged = g => { const { res } = run(`pone0339560_${g}`, "GAPDH", "WT", "student"), unit = new Map(res.rows.map(r => [r.key, r.sample]));
    return new Set(res.findings.filter(f => f.rule === "replicate_dispersion").flatMap(f => f.wells.map(w => unit.get(w)))); };
  assert.ok(flagged("NAMPT").has("SA2"));   // GAPDH 18.28 / 19.36 / 19.44
  const s = flagged("SLC40A"); assert.ok(s.has("WT2") && s.has("WT3")); // SLC40A1 32.86 / 31.94 / 31.38; GAPDH 26.16 / 24.38 / 24.35
});

// PLOS ONE 0353259: 3 biological replicates per group, RPS18 reference, one-way ANOVA (paper: model vs control p < 0.001;
// each named compound vs model p < 0.01). Tukey on ΔCt equals SciPy; the conclusions hold.
test("PLOS ONE 0353259: group ΔCt equals the authors' (except two slips in their sheet); Tukey equals SciPy", () => {
  for (const cell of ["RAW264.7", "BMDM"]) for (const g of ["DUSP6", "NOD2", "MAPKAPK2"]) {
    const name = `pone0353259_${cell}_${g}`, { a, target } = run(name, "RPS18", "Control", "tukey"), au = authors[name];
    for (const s of a.summary.filter(r => r.target === target)) {
      const mine = Object.entries(au).filter(([u]) => u.startsWith(s.group + "-")).map(([, v]) => v.dct), am = mine.reduce((x, y) => x + y, 0) / mine.length;
      if (s.group === "Paeoniflorin") assert.ok(Math.abs(s.meanDct - am) > 0.05, "authors used another group's RPS18 mean here");
      else assert.ok(Math.abs(s.meanDct - am) < 1e-9, `${name} ${s.group}`);
    }
    if (g === "MAPKAPK2") { const c = Object.entries(au).filter(([u]) => u.startsWith("Control-")).map(([, v]) => v.fold); assert.ok(Math.min(...c) > 4, "authors' MAPKAPK2 controls were normalised to NOD2's control mean"); }
    for (const [other, ref] of Object.entries(scipy[name].tukeyModel)) {
      const p = a.pairwise.find(r => r.target === target && new Set([r.a, r.b]).has("Model") && new Set([r.a, r.b]).has(other)).p;
      assert.ok(close(p, ref, ref > 1e-8 ? 1e-6 : 1e-2), `${name} Model vs ${other}: ${p} vs ${ref}`);
      assert.ok(p < (other === "Control" ? 0.001 : 0.01));
    }
  }
});

// PLOS Genetics 1011296 S23: a LightCycler export ("Pos", "Name", "Ct SYBR", every plate position listed, settings footer)
// and an SDS table with run-prefixed wells ("Exp2 A5") and a Tm column. All three sheets read as uploaded.
test("PLOS Genetics 1011296 workbook: LightCycler 'Ct SYBR', 'Exp2 A5' wells and the Tm column", async () => {
  const book = await readWorkbook("pgen.1011296.s023.xlsx", readFileSync(P("pgen.1011296.s023.xlsx")));
  const sheet = n => book.all.find(s => s.sheet === n), analyze = s => { const e = C.newExperiment({ title: s.sheet }, "qa"); e.source = C.fileRecord({ name: s.sheet, text: s.text, sha: "x", actor: "qa" }); return C.analyze(e); };
  const lc = analyze(sheet("USR RNA"));
  assert.equal(lc.parsed.columns.ct, "Ct SYBR"); assert.equal(lc.rows.filter(r => C.ctNum(r.ct) !== null).length, 36);
  assert.equal(lc.rows.find(r => r.key === "A1").role, "empty");
  assert.ok(!lc.findings.some(f => f.rule === "missing_ct" && f.wells.includes("A1")));
  assert.equal(lc.rows.find(r => r.key === "B5").role, "ntc"); // "USR no template"
  const sds = analyze(sheet("pl1 CDS RNA"));
  assert.equal(sds.rows.length, 64); assert.equal(sds.rows[0].key, "A5"); assert.ok(sds.parsed.warnings.some(w => /prefix \(“Exp2”\)/.test(w)));
  const tm = sds.findings.filter(f => f.rule === "melt_tm_deviation").flatMap(f => f.wells);
  for (const w of ["C11", "C12", "G9", "G12", "H5", "H8", "H9", "H10", "H11", "H12"]) assert.ok(tm.includes(w), w); // 65.5-84.5 °C vs median 87.7 °C
  assert.ok(!tm.includes("C5") && !tm.includes("A5"));
});
test("dye-named Ct columns are read; summary columns are not mistaken for Ct", () => {
  assert.equal(C.parseResults("Pos,Name,Cq FAM\nA1,s1,24.1\n").columns.ct, "Cq FAM");
  assert.equal(C.parseResults("Well,Sample,CT Value\nA1,s1,24.1\n").columns.ct, "CT Value");
  assert.throws(() => C.parseResults("Well,Sample,Ct Mean\nA1,s1,24.1\n"), /Ct\/Cq/);
  assert.throws(() => C.parseResults("Well,Sample,Ct Threshold\nA1,s1,0.2\n"), /Ct\/Cq/);
  const two = C.parseResults("Well,Sample,Ct\nRun1 A1,s1,24\nRun2 A1,s1,25\n");
  assert.ok(two.warnings.some(w => /split the file by prefix/.test(w)));
});
