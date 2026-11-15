// Reference-gene stability: geNorm M and pairwise variation V (Vandesompele et al. 2002) and NormFinder ρ (Andersen et
// al. 2004), ported line by line from the Bioconductor package NormqPCR (stabMeasureM, stabMeasureRho, selectHKs;
// Perkins et al. 2012), and checked against it on the datasets it ships (tests/refgenes.test.mjs). Pure functions.
//
// Input: a samples × genes matrix on the log2 quantity scale, x[s][g] = −Ct · log2(E_g), with null for missing.
// geNorm M of gene j: the mean, over the other genes k, of the SD across samples of x_j − x_k (= log2 of their ratio).
// geNorm drops the gene with the largest M, recomputes M, and repeats down to two genes; V(n−1/n) is the SD across
// samples of the change in the normalisation factor (mean of x over the genes still in) when that gene goes.
// NormFinder ρ: per group, each gene's variance after removing sample and gene effects (corrected for the number of
// genes), plus the gene's systematic shift between groups shrunk towards 0; ρ = mean over groups of |shift| + √(var/n).
const isNum = v => typeof v === "number" && Number.isFinite(v);
const mean = a => { const v = a.filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const sdOf = a => { const v = a.filter(isNum), n = v.length; if (n < 2) return null; const m = v.reduce((s, x) => s + x, 0) / n; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)); };
const col = (x, j) => x.map(r => r[j]);

// geNorm M for every gene (NormqPCR stabMeasureM, log = TRUE).
export function genormM(x) {
  const n = x[0]?.length ?? 0;
  if (n < 2) return null;
  return Array.from({ length: n }, (_, j) => {
    const sds = [];
    for (let k = 0; k < n; k++) if (k !== j) sds.push(sdOf(x.map(r => (isNum(r[j]) && isNum(r[k]) ? r[j] - r[k] : null))));
    return n > 2 ? mean(sds) : sds[0];
  });
}
// Stepwise geNorm (NormqPCR selectHKs, method "geNorm"): ranking from most to least stable, M at each step, V.
export function genorm(x, genes, minNr = 2) {
  if (genes.length < 3) return null;
  let cur = x.map(r => [...r]), names = [...genes];
  const steps = [], ranking = new Array(genes.length).fill(null), V = [];
  for (let i = genes.length; i >= minNr; i--) {
    const M = genormM(cur), ind = M.indexOf(Math.max(...M));
    steps.push({ genes: [...names], M: Object.fromEntries(names.map((g, k) => [g, M[k]])), meanM: mean(M), excluded: i > minNr ? names[ind] : null });
    if (i === minNr) names.forEach((g, k) => { ranking[k] = g; });
    else ranking[i - 1] = names[ind];
    if (i > 2) {
      const old = cur.map(r => mean(r)), nw = cur.map(r => mean(r.filter((_, k) => k !== ind)));
      V.push({ label: `${i - 1}/${i}`, n: i - 1, value: sdOf(old.map((o, s) => (isNum(o) && isNum(nw[s]) ? nw[s] - o : null))) });
    }
    cur = cur.map(r => r.filter((_, k) => k !== ind)); names = names.filter((_, k) => k !== ind);
  }
  return { ranking, steps, V, M: steps[0].M };
}

// NormFinder as its authors' R code does it (Andersen et al. 2004; MOMA r.NormOldStab5): a negative within-group
// variance estimate is replaced by the gene's smallest pairwise variance / 4 (NormqPCR sets it to 0, which can change
// the best gene), and the best pair is searched over all pairs of candidates (genes under 0.25 on the natural-log
// scale, or the 4 most stable). Checked against the 80 values published in PeerJ 10.7717/peerj.14221
// (platecheck-qa/papers/quant-refgenes-published). groups: one label per sample (row). Values on the log2 scale.
const pairVarMin = (rows, j, k) => { let best = Infinity; for (let h = 0; h < k; h++) if (h !== j) { const dd = rows.map(r => r[j] - r[h]).filter(isNum), mu = mean(dd); if (dd.length > 1) best = Math.min(best, dd.reduce((a, y) => a + (y - mu) ** 2, 0) / (dd.length - 1)); } return best; };
const fixNeg = (vals, rows, k) => vals.map((v, j) => (v < 0 ? pairVarMin(rows, j, k) / 4 : v));
export function normfinder(x, groups) {
  const k = x[0]?.length ?? 0, levels = [...new Set(groups)].sort(), m = levels.length;
  if (k < 3) return null;
  const mej = x.map(r => mean(r)); // per sample, over genes
  if (m === 1) { // no groups: only the variance estimates
    const mei = Array.from({ length: k }, (_, j) => mean(col(x, j))), me = mean(mej);
    const a = Array.from({ length: k }, (_, j) => { const v = x.map((r, s) => (isNum(r[j]) ? (r[j] - mej[s] - mei[j] + me) ** 2 : null)).filter(isNum); return v.reduce((s, y) => s + y, 0) / (v.length - 1); });
    const b = a.reduce((s, y) => s + y, 0);
    return { groups: levels, variance: fixNeg(a.map(v => (v - b / (k * (k - 1))) / (1 - 2 / k)), x, k) };
  }
  const idx = levels.map(l => groups.map((g, s) => (g === l ? s : -1)).filter(s => s >= 0)), ngr = idx.map(i => i.length);
  const meigr = idx.map(rows => Array.from({ length: k }, (_, j) => mean(rows.map(s => x[s][j]))));
  const megr = meigr.map(r => mean(r));
  const vg = idx.map((rows, i) => {
    const a = Array.from({ length: k }, (_, j) => { const v = rows.map(s => (isNum(x[s][j]) ? (x[s][j] - meigr[i][j] - mej[s] + megr[i]) ** 2 : null)).filter(isNum); return v.reduce((s, y) => s + y, 0) / (v.length - 1); });
    const b = a.reduce((s, y) => s + y, 0);
    return fixNeg(a.map(v => (v - b / (k * (k - 1))) / (1 - 2 / k)), rows.map(r => x[r]), k);
  });
  const m1i = Array.from({ length: k }, (_, j) => mean(meigr.map(r => r[j]))), m1j = meigr.map(r => mean(r)), m1 = mean(m1j);
  const dif = Array.from({ length: k }, (_, j) => levels.map((_, i) => meigr[i][j] - m1j[i] - m1i[j] + m1)); // genes × groups
  const va = vg.map((r, i) => r.map(v => v / ngr[i])); // groups × genes
  const tau = Math.max(dif.flat().reduce((s, d) => s + d * d, 0) / ((m - 1) * (k - 1)) - mean(va.flat()), 0);
  const d = dif.map((r, j) => r.map((v, i) => (tau + va[i][j] > 0 ? v * tau / (tau + va[i][j]) : 0)));
  const v = Array.from({ length: k }, (_, j) => levels.map((_, i) => va[i][j] + (tau + va[i][j] > 0 ? tau * va[i][j] / (tau + va[i][j]) : 0)));
  const rho = d.map((r, j) => mean(r.map((dv, i) => Math.abs(dv) + Math.sqrt(v[j][i]))));
  // best pair: every pair of candidate genes (stability < 0.25 in natural-log units, else the 4 most stable)
  const sorted = [...rho].sort((a, b) => a - b), lim = 0.25 / Math.LN2;
  let cand = rho.map((r, j) => j).filter(j => rho[j] < lim);
  if (cand.length < 4) cand = rho.map((r, j) => j).filter(j => rho[j] <= sorted[Math.min(3, k - 1)]);
  let bestPair = null, best = Infinity;
  for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
    const g1 = cand[a], g2 = cand[b];
    const r = mean(levels.map((_, i) => (Math.abs(d[g1][i] + d[g2][i]) / 2) * Math.sqrt(k / (k - 2)) + Math.sqrt(v[g1][i] + v[g2][i]) / 2));
    if (r < best) { best = r; bestPair = rho[g1] <= rho[g2] ? [g1, g2] : [g2, g1]; }
  }
  return { groups: levels, rho, d, v, tau, bestPair, bestPairRho: best };
}

// From PlateCheck rows: per biological unit, the mean Ct of each candidate gene (technical replicates averaged), on the
// log2 quantity scale with each gene's efficiency. Units missing a candidate are left out (complete cases), and listed.
export function stability(rows, candidates, { efficiency = {}, minUnits = 3 } = {}) {
  const out = { candidates, units: [], dropped: [], warnings: [] };
  if (candidates.length < 3) { out.warnings.push("Choose at least three candidate reference genes: geNorm and NormFinder compare each gene with the others."); return out; }
  const byUnit = new Map();
  for (const r of rows || []) {
    if (r.role !== "sample" || !candidates.includes(r.target)) continue;
    const ct = Number(String(r.ct ?? "").trim()); if (!Number.isFinite(ct) || String(r.ct ?? "").trim() === "") continue;
    const u = r.bio_unit || r.sample || r.key; if (!u) continue;
    if (!byUnit.has(u)) byUnit.set(u, { unit: u, group: r.group || "", cts: {} });
    (byUnit.get(u).cts[r.target] ||= []).push(ct);
  }
  for (const u of byUnit.values()) {
    const missing = candidates.filter(g => !u.cts[g]?.length);
    if (missing.length) { out.dropped.push({ unit: u.unit, missing }); continue; }
    out.units.push({ unit: u.unit, group: u.group, ct: Object.fromEntries(candidates.map(g => [g, mean(u.cts[g])])) });
  }
  if (out.dropped.length) out.warnings.push(`${out.dropped.length} biological unit(s) without a Ct for every candidate were left out: ${out.dropped.slice(0, 6).map(d => `${d.unit} (no ${d.missing.join(", ")})`).join("; ")}${out.dropped.length > 6 ? " …" : ""}.`);
  if (out.units.length < minUnits) { out.warnings.push(`Only ${out.units.length} unit(s) have every candidate; at least ${minUnits} are needed.`); return out; }
  const lg = g => Math.log2(efficiency[g] || 2);
  const x = out.units.map(u => candidates.map(g => -u.ct[g] * lg(g)));
  out.genorm = genorm(x, candidates);
  const groups = out.units.map(u => u.group || "all");
  out.normfinder = normfinder(x, groups);
  // geNorm's V: the smallest number of genes whose V(n/n+1) is below 0.15 (Vandesompele et al. 2002).
  const ok = (out.genorm?.V || []).filter(v => isNum(v.value) && v.value < 0.15).map(v => v.n);
  out.recommendedN = ok.length ? Math.min(...ok) : null;
  return out;
}

// For one run and its analysis settings: candidates (ticked, else the analysis references if three or more), each
// gene's efficiency factor from its standard curve when efficiency correction is on, and the stability results.
export function forRun(res, s) {
  const cands = (s?.refCandidates?.length ? s.refCandidates : (s?.refs?.length ?? 0) >= 3 ? s.refs : []).filter(Boolean);
  const eff = {};
  if (s?.efficiency) for (const c of res?.stdCurves || []) if (Number.isFinite(c.efficiency) && c.efficiency > 0) eff[c.target] = 1 + c.efficiency / 100;
  return { cands, r: cands.length && res?.rows ? stability(res.rows, cands, { efficiency: eff }) : null, eff };
}
// One-paragraph summary (report, MIQE checklist item 5.15).
export function summaryText(r) {
  if (!r?.genorm && !r?.normfinder) return "";
  const g = r.genorm, n = r.normfinder, f = x => (Number.isFinite(x) ? x.toFixed(3) : "—");
  const parts = [`Candidate references ${r.candidates.join(", ")} in ${r.units.length} biological units.`];
  if (g) parts.push(`geNorm (Vandesompele et al. 2002): ranking ${g.ranking.join(" > ")} (most to least stable; M of all candidates ${r.candidates.map(c => `${c} ${f(g.M[c])}`).join(", ")}); ${r.recommendedN ? `V(${r.recommendedN}/${r.recommendedN + 1}) = ${f(g.V.find(v => v.n === r.recommendedN)?.value)} < 0.15, so ${r.recommendedN} references suffice` : "no pairwise variation V below 0.15"}.`);
  if (n?.rho) { const best = n.rho.indexOf(Math.min(...n.rho)); parts.push(`NormFinder (Andersen et al. 2004; groups ${n.groups.join(", ")}): most stable ${r.candidates[best]} (ρ ${f(n.rho[best])}), best pair ${n.bestPair.map(j => r.candidates[j]).join(" and ")} (ρ ${f(n.bestPairRho)}).`); }
  return parts.join(" ");
}
