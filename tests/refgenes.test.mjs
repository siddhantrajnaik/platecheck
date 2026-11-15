// Reference-gene stability (web/refgenes.js) vs the Bioconductor package NormqPCR on the datasets it ships: the geNorm
// paper's data (Vandesompele et al. 2002) and the NormFinder paper's bladder data (Andersen et al. 2004).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as G from "../web/refgenes.js";
import * as C from "../web/core.js";
import * as M from "../web/miqe.js";
import { analyzeRun } from "../web/analysis.js";

const P = n => new URL(`../testdata/published/refgenes/${n}`, import.meta.url);
const ref = JSON.parse(readFileSync(P("ref.json"), "utf8"));
const csv = f => { const L = readFileSync(P(f), "utf8").trim().split(/\r?\n/).map(l => l.split(",").map(s => s.replace(/"/g, ""))); return { head: L[0], rows: L.slice(1) }; };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} vs ${b}`);

test("geNorm M, ranking and V equal NormqPCR for all five tissues of the geNorm paper", () => {
  const g = csv("genorm_data.csv"), genes = g.head.slice(2);
  for (const t of ["BM", "FIB", "LEU", "NB", "POOL"]) {
    const x = g.rows.filter(r => r[1] === t).map(r => r.slice(2).map(v => Math.log2(+v))), res = G.genorm(x, genes), R = ref[t];
    assert.deepEqual(res.ranking, R.ranking, t);
    for (const k of genes) close(res.M[k], R.M[k], `${t} M ${k}`);
    Object.values(R.V).forEach((v, i) => close(res.V[i].value, v, `${t} V ${res.V[i].label}`));
    res.steps.forEach((s, i) => close(s.meanM, R.meanM[String(genes.length - i)], `${t} meanM with ${genes.length - i} genes`)); // R names them by gene count
  }
});
test("NormFinder ρ, best gene and best pair equal NormqPCR on the bladder data", () => {
  const b = csv("bladder_data.csv"), genes = b.head.slice(2), x = b.rows.map(r => r.slice(2).map(v => Math.log2(+v))), grp = b.rows.map(r => r[1]);
  const n = G.normfinder(x, grp);
  genes.forEach((k, j) => close(n.rho[j], ref.bladder.rho[k], `rho ${k}`));
  assert.deepEqual(n.bestPair.map(j => genes[j]), ref.bladder.ranking); close(n.bestPairRho, ref.bladder.rhoPair[1], "pair");
  // the NormFinder paper's own conclusion for bladder (Andersen et al. 2004, abstract): HSPCB, TEGT and ATP5B
  assert.deepEqual(genes.map((g, j) => [g, n.rho[j]]).sort((p, q) => p[1] - q[1]).slice(0, 3).map(p => p[0]), ["HSPCB", "TEGT", "ATP5B"]);
  const one = G.normfinder(x, x.map(() => "all"));
  genes.forEach((k, j) => close(one.variance[j], ref.bladder.noGroupVar[k], `variance ${k}`));
});
test("from a PlateCheck plate: Cts, technical replicates averaged, give the same NormFinder ρ; summary and MIQE 5.15", () => {
  const b = csv("bladder_data.csv"), genes = b.head.slice(2);
  const L = ["Well,Sample,Target,Ct,Group"]; let w = 0;
  for (const r of b.rows) genes.forEach((g, j) => { const ct = 40 - Math.log2(+r[j + 2]); for (const d of [-0.05, 0.05]) { const k = w++; L.push(`W${k},${r[0]},${g},${ct + d},${r[1]}`); } });
  const e = C.newExperiment({ title: "bladder" }, "qa"); e.source = C.fileRecord({ name: "b", text: L.join("\n").replace(/W(\d+)/g, (_, k) => `${"ABCDEFGHIJKLMNOP"[Math.floor(k / 24) % 16]}${k % 24 + 1}`), sha: "x", actor: "qa" });
  // more than 384 wells: give every row its own position via plate-free keys; analyse the rows directly instead
  const rows = L.slice(1).map((l, i) => { const [, s, t, ct, g] = l.split(","); return { role: "sample", target: t, ct, bio_unit: s, sample: s, group: g, key: `K${i}` }; });
  const r = G.stability(rows, genes);
  genes.forEach((k, j) => close(r.normfinder.rho[j], ref.bladder.rho[k], `plate rho ${k}`));
  assert.equal(r.units.length, 28);
  const text = G.summaryText(r); assert.match(text, /NormFinder .*best pair HSPCB and RPS13/); assert.match(text, /geNorm .*ranking/);
  // missing a candidate in one unit: that unit is left out and listed
  const r2 = G.stability(rows.filter(x => !(x.bio_unit === b.rows[0][0] && x.target === genes[0])), genes);
  assert.equal(r2.units.length, 27); assert.match(r2.warnings[0], /left out/);
  assert.match(G.stability(rows, genes.slice(0, 2)).warnings[0], /at least three/);
});
test("MIQE 5.15 is answered from the stability results when candidates are chosen", () => {
  const L = ["Well,Sample,Target,Ct,Group"]; let w = 0; const well = () => { const k = w++; return `${"ABCDEFGH"[Math.floor(k / 12)]}${k % 12 + 1}`; };
  const base = { A: 18, B: 20, C: 22, T: 25 };
  ["c1", "c2", "c3", "k1", "k2", "k3"].forEach((s, i) => Object.entries(base).forEach(([g, ct]) => L.push(`${well()},${s},${g},${ct + ((i * 7 + g.charCodeAt(0)) % 5) / 10},${s[0] === "c" ? "ctrl" : "kd"}`)));
  const e = C.newExperiment({ title: "m" }, "qa"); e.source = C.fileRecord({ name: "m", text: L.join("\n") + "\n", sha: "x", actor: "qa" });
  e.analysis = C.cleanAnalysisSettings({ on: true, refs: ["A"], control: "ctrl", refCandidates: ["A", "B", "C"] });
  const res = C.analyze(e), row = M.checklist(e, res, analyzeRun(e, res)).find(x => x.id === "5.15");
  assert.equal(row.provided, "yes"); assert.match(row.text, /geNorm/); assert.match(row.text, /NormFinder/);
});
