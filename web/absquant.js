// Absolute quantity of unknowns read off a standard curve, with intervals (MIQE 2.0: "method of target quantity
// calculation"; confidence interval of the efficiency and prediction interval of interpolated quantities).
// Pure functions, no DOM. The curve itself is fitted in core.js (res.stdCurves: Ct = intercept + slope · log10 quantity).
//
// Unknown with k replicate wells, mean Ct y0, read off a curve fitted to n standard wells (Massart et al. 1997, ch. 8;
// the formula R's chemCal::inverse.predict uses, unweighted):
//   x̂  = (y0 − b) / m                                   x = log10 quantity
//   s_x̂ = (s / |m|) · √(1/k + 1/n + (y0 − ȳ)² / (m² · Sxx))   s = residual SD of the fit, df = n − 2
//   interval on x: x̂ ± t(0.975, n − 2) · s_x̂, then quantity = 10^x (so the interval is not symmetric)
// Efficiency E = 10^(−1/m) − 1; its CI comes from the slope's CI, m ± t · s/√Sxx (E is monotone in m).
import { tQuantile } from "./stats.js";

const fin = x => typeof x === "number" && Number.isFinite(x);
const num = v => { if (v === null || v === undefined) return null; const x = Number(String(v).trim().replace(",", ".")); return Number.isFinite(x) ? x : null; };
const eff = m => (10 ** (-1 / m) - 1) * 100;

// Regression details of one standard curve (from its points: x = log10 quantity, y = Ct).
export function curveDetails(c, level = 0.95) {
  const pts = (c?.points || []).filter(p => fin(p.x) && fin(p.y)), n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0; for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  if (!(sxx > 0)) return null;
  const m = sxy / sxx, b = my - m * mx;
  const rss = pts.reduce((a, p) => a + (p.y - (b + m * p.x)) ** 2, 0), df = n - 2, s = Math.sqrt(rss / df);
  const t = tQuantile(0.5 + level / 2, df), seM = s / Math.sqrt(sxx);
  const mLo = m - t * seM, mHi = m + t * seM;
  // E falls as m rises towards 0 from below, so the slope's ends map to the efficiency's ends swapped. A slope interval
  // that reaches 0 or above means the curve doesn't fix the efficiency at all.
  const effCi = mHi < 0 ? [eff(mLo), eff(mHi)] : [null, null];
  return { target: c.target, n, levels: c.levels, slope: m, intercept: b, r2: c.r2, efficiency: eff(m), effLow: effCi[0], effHigh: effCi[1],
    slopeSe: seM, slopeLow: mLo, slopeHigh: mHi, residualSd: s, df, t, meanX: mx, meanY: my, sxx, minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)) };
}

// Quantity of one unknown from its replicate Cts.
export function inversePredict(d, cts) {
  const ys = cts.filter(fin), k = ys.length;
  if (!d || !k) return null;
  const y0 = ys.reduce((a, y) => a + y, 0) / k, x = (y0 - d.intercept) / d.slope;
  const se = (d.residualSd / Math.abs(d.slope)) * Math.sqrt(1 / k + 1 / d.n + (y0 - d.meanY) ** 2 / (d.slope ** 2 * d.sxx));
  return { k, meanCt: y0, log10q: x, se, q: 10 ** x, qLow: 10 ** (x - d.t * se), qHigh: 10 ** (x + d.t * se),
    extrapolated: x < d.minX - 1e-9 ? "below" : x > d.maxX + 1e-9 ? "above" : null };
}

// Every unknown (sample or positive-control wells of a target with a curve), per biological unit, plus each well.
// rows: core.analyze(…).rows; stdCurves: res.stdCurves.
export function quantify(rows, stdCurves, { level = 0.95 } = {}) {
  const out = { level, targets: [], units: [], wells: [], warnings: [] };
  const curves = new Map((stdCurves || []).map(c => [c.target, curveDetails(c, level)]).filter(([, d]) => d));
  for (const c of stdCurves || []) if (!curves.has(c.target)) out.warnings.push(`${c.target}: the standard curve has fewer than 3 usable points, so no quantities or intervals are given.`);
  for (const d of curves.values()) out.targets.push(d);
  const groups = new Map();
  for (const r of rows || []) {
    if (!["sample", "positive"].includes(r.role) || !r.target || !curves.has(r.target)) continue;
    const unit = r.bio_unit || r.sample || r.key || r.well, key = `${r.target}\u0000${unit}`;
    if (!groups.has(key)) groups.set(key, { target: r.target, unit, group: r.group || "", wells: [], cts: [], missing: [] });
    const g = groups.get(key), ct = num(r.ct);
    g.wells.push(r.key || r.well);
    if (ct === null) g.missing.push(r.key || r.well); else g.cts.push(ct);
    const d = curves.get(r.target), one = ct === null ? null : inversePredict(d, [ct]);
    out.wells.push({ well: r.key || r.well, target: r.target, unit, ct: r.ct, quantity: one?.q ?? null, extrapolated: one?.extrapolated ?? null });
  }
  for (const g of groups.values()) {
    const d = curves.get(g.target), p = inversePredict(d, g.cts);
    // QuantStudio's "Quantity Mean" (and many papers) average the wells' quantities instead; given for comparison.
    // The quantity at the mean Ct is the geometric mean of the wells' quantities, the basis of the interval.
    const qWellMean = g.cts.length ? g.cts.reduce((a, ct) => a + 10 ** ((ct - d.intercept) / d.slope), 0) / g.cts.length : null;
    out.units.push({ ...g, n: g.cts.length, ...(p || { meanCt: null, q: null, qLow: null, qHigh: null, extrapolated: null }), qWellMean,
      note: !g.cts.length ? "not detected (no Ct)" : p.extrapolated ? `extrapolated: ${p.extrapolated === "below" ? "below the lowest" : "above the highest"} standard` : g.missing.length ? `${g.missing.length} replicate(s) without a Ct left out` : "" });
  }
  const ext = out.units.filter(u => u.extrapolated);
  if (ext.length) out.warnings.push(`${ext.length} unknown(s) fall outside the range of the standards. Their quantities are extrapolated from the curve and less reliable; dilute or concentrate them into range if the number matters.`);
  out.units.sort((a, b) => a.target.localeCompare(b.target, "en") || a.unit.localeCompare(b.unit, "en", { numeric: true }));
  return out;
}

// Short number for quantities that span many orders of magnitude: 3 significant figures, scientific outside 0.01–99,999.
export const fmtQ = x => (x == null || !fin(x) ? "—" : Math.abs(x) >= 1e5 || (Math.abs(x) < 0.01 && x !== 0) ? x.toExponential(2) : String(+x.toPrecision(3)));
const csvNum = x => (fin(x) ? String(+x.toPrecision(10)) : "");
// CSV: one row per unknown (quantity at the mean Ct with its interval), then one row per well, then the curves.
export function quantCsv(q, toCsv) {
  const pct = Math.round(q.level * 100);
  return toCsv([
    ["target", "biological_unit", "group", "wells_with_ct", "mean_ct", "quantity", `pi${pct}_low`, `pi${pct}_high`, "mean_of_well_quantities", "extrapolated", "note"],
    ...q.units.map(u => [u.target, u.unit, u.group, u.n, csvNum(u.meanCt), csvNum(u.q), csvNum(u.qLow), csvNum(u.qHigh), csvNum(u.qWellMean), u.extrapolated || "", u.note]),
    [], ["well", "target", "biological_unit", "ct_raw", "quantity", "extrapolated"],
    ...q.wells.map(w => [w.well, w.target, w.unit, w.ct ?? "", csvNum(w.quantity), w.extrapolated || ""]),
    [], ["target", "standard_wells", "slope", "slope_se", "intercept", "r2", "efficiency_pct", `efficiency_ci${pct}_low`, `efficiency_ci${pct}_high`, "residual_sd", "log10_quantity_min", "log10_quantity_max"],
    ...q.targets.map(d => [d.target, d.n, csvNum(d.slope), csvNum(d.slopeSe), csvNum(d.intercept), csvNum(d.r2), csvNum(d.efficiency), csvNum(d.effLow), csvNum(d.effHigh), csvNum(d.residualSd), csvNum(d.minX), csvNum(d.maxX)]),
  ]);
}
