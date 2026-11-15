// Per-well PCR efficiency, N0 and Cq from raw amplification curves: the LinRegPCR method (Ruijter et al. 2009,
// Nucleic Acids Res 37:e45; Untergasser et al. 2021, BMC Bioinformatics 22:398). A step-for-step port of
// Run.linRegPCR in rdmlpython 1.7.2 (MIT licence, Andreas Untergasser) with its defaults: wells without a plateau
// are left out of the mean efficiency, and outlying efficiencies are removed (skewness test, then Grubbs' test).
// Validated against rdmlpython on the RDML example files (platecheck-qa/papers/linreg; tests/linreg.test.mjs).
//
// Per well: a constant baseline is found by making the log-linear phase straight (lower and upper half of equal
// slope); per target, a window of linearity is chosen where the efficiencies vary least; each well's efficiency is
// the slope of log10(fluorescence) in that window; Cq is where the line reaches the common threshold using the
// target's mean efficiency; N0 = threshold / meanEff^Cq (in fluorescence units).
import { tQuantile } from "./stats.js";

const isnan = Number.isNaN, log10 = Math.log10;
const g = (a, i) => a[i < 0 ? i + a.length : i] ?? NaN; // Python indexing: negative counts from the end
const clean = a => a.map(v => (v > 1e-8 ? v : NaN)); // numpy: nan → 0, then ≤ 1e-8 → nan
const rint = v => { const f = Math.floor(v), d = v - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); }; // np.round: half to even
const finite = v => Number.isFinite(v);
const nanmin = a => { let m = NaN; for (const v of a) if (!isnan(v) && !(v >= m)) m = v; return m; };
const nanmax = a => { let m = NaN; for (const v of a) if (!isnan(v) && !(v <= m)) m = v; return m; };
const nanmean = a => { let s = 0, n = 0; for (const v of a) if (!isnan(v)) { s += v; n++; } return n ? s / n : NaN; };
const nanstd0 = a => { const m = nanmean(a); let s = 0, n = 0; for (const v of a) if (!isnan(v)) { s += (v - m) ** 2; n++; } return n ? Math.sqrt(s / n) : NaN; };
const nanmedian = a => { const v = [...a].filter(x => !isnan(x)).sort((x, y) => x - y), n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : NaN; };

// slope of y on cycle (1..n), ignoring NaN (rdmlpython _lrp_linReg)
function slopeOf(y) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < y.length; i++) if (!isnan(y[i])) { const x = i + 1; sx += x; sy += y[i]; sxx += x * x; sxy += x * y[i]; n++; }
  return (sxy - (sx * sy) / n) / (sxx - (sx * sx) / n);
}

function findStopCyc(f) {
  const n = f.length;
  let v = 3;
  while (v <= n && (isnan(g(f, v - 1)) || isnan(g(f, v - 2)) || isnan(g(f, v - 3)))) v++;
  const fd = new Float64Array(n); fd[0] = NaN;
  for (let i = 1; i < n; i++) fd[i] = f[i] - f[i - 1];
  let best = -1, bv = -Infinity;
  for (let i = 0; i < n; i++) if (!isnan(fd[i]) && (best < 0 || fd[i] > bv)) { bv = fd[i]; best = i; }
  if (!fd.some(finite)) return n;
  let fdMax = best + 1;
  const sd = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) sd[i] = fd[i + 1] - fd[i];
  sd[n - 1] = NaN;
  if (fdMax + 2 <= n) {
    const a = f[fdMax - 1], b = f[fdMax], c = f[fdMax + 1];
    if (!isnan(a) && !isnan(b) && !isnan(c) && c > b && b > a) fdMax += 2;
  } else fdMax = n;
  let maxMeanSD = 0, stop = n;
  for (let c = v; c < fdMax; c++) {
    const m = (sd[c - 2] + sd[c - 1] + sd[c]) / 3;
    if (!isnan(m) && m - maxMeanSD > 1e-12) { maxMeanSD = m; stop = c; }
  }
  return stop + 2 >= n ? n : stop;
}

function findStartCyc(f, stop) {
  let s = stop - 1, fnn = 1;
  while (isnan(g(f, fnn - 1)) && fnn < s) fnn++;
  while (s > fnn && isnan(g(f, s - 1))) s--;
  while (s > fnn && stop - s < 11 && !isnan(g(f, s - 2)) && g(f, s - 2) <= g(f, s - 1)) s--;
  let fix = s;
  const a = g(f, s), b = g(f, s - 1), c = g(f, stop - 1), d = g(f, stop - 2);
  if (!isnan(a) && !isnan(b) && !isnan(c) && !isnan(d) && log10(a) - log10(b) > 1.1 * (log10(c) - log10(d))) fix++;
  return [s, fix];
}

// slopes of log10 fluorescence for the lower and upper half of [fix, stop]
function testSlopes(f, stop, fix) {
  const ls = [fix, stop], le = [fix, stop];
  for (;;) {
    ls[1]--; le[0]++;
    while (ls[1] - le[0] > 1 && isnan(g(f, ls[1] - 1))) ls[1]--;
    while (ls[1] - le[0] > 1 && isnan(g(f, le[1] - 1))) le[0]++; // sic: tests le[1], as rdmlpython does
    if (ls[1] - le[0] <= 1) break;
  }
  const slope = [0, 0];
  for (let j = 0; j < 2; j++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let i = ls[j]; i <= le[j]; i++) {
      const v = g(f, i - 1);
      if (!isnan(v)) { const l = log10(v); sx += i; sy += l; sxx += i * i; sxy += i * l; n++; }
    }
    slope[j] = n ? (sxy - (sx * sy) / n) / (sxx - (sx * sx) / n) : -999.9;
  }
  return slope;
}

function startStopInWindow(f, up, low) {
  let sw = 0, ew = 0;
  const stop = findStopCyc(f), [s, fix] = findStartCyc(f, stop);
  let mx = -1, bv = -Infinity;
  for (let i = fix - 1; i < f.length; i++) if (!isnan(f[i]) && (mx < 0 || f[i] > bv)) { bv = f[i]; mx = i; }
  if (mx < 0 || !f.slice(Math.max(0, fix - 1)).some(finite)) return [s, s, true];
  const stopMax = mx + 1;
  if (g(f, s - 1) > up || g(f, stopMax - 1) < low) {
    if (g(f, s - 1) > up) sw = ew = s;
    if (g(f, stopMax - 1) < low) sw = ew = stopMax;
    return [sw, ew, true];
  }
  if (g(f, stopMax - 1) < up) ew = stopMax;
  else for (let i = stopMax; i > s; i--) if (g(f, i - 1) > up && up > g(f, i - 2)) ew = i - 1;
  if (g(f, fix - 1) > low) sw = fix;
  else for (let i = stopMax; i > s; i--) if (g(f, i - 1) > low && low > g(f, i - 2)) sw = i;
  return [sw, ew, false];
}

// regression of log10 fluorescence on cycle for the part of the curve inside the window
function paramInWindow(f, up, low) {
  const [sw, ew, notIn] = startStopInWindow(f, up, low);
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0, ssx = 0, ssy = 0, cxy = 0;
  for (let i = sw; i <= ew; i++) {
    const v = g(f, i - 1);
    if (!isnan(v)) { const l = log10(v); sx += i; sy += l; sxx += i * i; syy += l * l; sxy += i * l; n++; }
  }
  if (n > 1) { ssx = sxx - (sx * sx) / n; ssy = syy - (sy * sy) / n; cxy = sxy - (sx * sy) / n; }
  const ninclu = notIn ? 0 : ew - sw + 1;
  if (!(ssx > 0 && ssy > 0 && n > 0)) return [NaN, NaN, NaN, NaN, ninclu, NaN];
  const slope = cxy / ssx, ic = sy / n - (slope * sx) / n;
  return [sx / n, sy / n, 10 ** slope, 10 ** ic, ninclu, cxy / Math.sqrt(ssx * ssy)];
}

// normal upper tail (scipy t.sf with df = 1e10, as rdmlpython uses): series for small x, continued fraction beyond
function normSf(x) {
  const z = x / Math.SQRT2;
  if (z < 3) { let term = z, sum = z; for (let k = 1; k < 200; k++) { term *= (-z * z) / k; const t = term / (2 * k + 1); sum += t; if (Math.abs(t) < 1e-17 * Math.abs(sum)) break; } return 0.5 * (1 - (2 / Math.sqrt(Math.PI)) * sum); }
  let f = z, C = z, D = 0; // erfc(z) = exp(-z²)/√π · 1/(z + 1/2/(z + 1/(z + 3/2/(z + …))))
  for (let k = 1; k < 300; k++) { const a = k / 2; D = z + a * D; D = 1 / D; C = z + a / C; const d = C * D; f *= d; if (Math.abs(d - 1) < 1e-16) break; }
  return 0.5 * Math.exp(-z * z) / Math.sqrt(Math.PI) / f;
}

// skewness test then Grubbs' test, removing one value at a time (rdmlpython _lrp_removeOutlier)
function removeOutlier(data, noPlat, alpha = 0.05) {
  const o = Float64Array.from(data), out = new Array(o.length).fill(false);
  for (;;) {
    const v = [...o].filter(x => !isnan(x)), n = v.length;
    if (n < 3) break;
    const m = v.reduce((a, b) => a + b, 0) / n, std = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
    const m2 = v.reduce((a, b) => a + (b - m) ** 2, 0) / n, m3 = v.reduce((a, b) => a + (b - m) ** 3, 0) / n;
    const skew = (m3 / m2 ** 1.5) * Math.sqrt(n * (n - 1)) / (n - 2);
    const se = Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3))), p = normSf(Math.abs(skew) / se) * 2;
    if (!(p < alpha / 2)) break;
    const t = tQuantile(1 - alpha / n / 2, n - 2), crit = ((n - 1) / Math.sqrt(n)) * Math.sqrt(t * t / (n - 2 + t * t));
    let pos = -1;
    for (let i = 0; i < o.length; i++) if (!isnan(o[i]) && (pos < 0 || (skew > 0 ? o[i] > o[pos] : o[i] < o[pos]))) pos = i;
    const res = skew > 0 ? (o[pos] - m) / std : (m - o[pos]) / std;
    if (res > crit || noPlat[pos]) { o[pos] = NaN; out[pos] = true; } else break;
  }
  return out;
}

const NEG = new Set(["ntc", "nac", "ntp", "nrt", "opt"]);
const PROBE = new Set(["hydrolysis probe", "labelled reverse primer", "DNA-zyme probe"]);
const CRIT_EFF = [28, 28, 19, 16, 14, 12, 11, 11, 10, 10, 9], CRIT_N0 = [40, 40, 27, 19, 16, 13, 12, 11, 10, 9, 9];

// curves: [{ key, target, type ("unkn" | "std" | "pos" | "ntc" | "nac" | "ntp" | "nrt" | "opt"), excluded,
//            chemistry (RDML dyeChemistry, default "non-saturating DNA binding dye"), nucleotide ("cDNA"), fluor: [cycle 1, 2, …] }]
// Missing points are NaN or absent. Fluorescence must be raw (not baseline-corrected).
export function linRegPCR(curves, { effRange = 0.05 } = {}) {
  const R = curves.length;
  if (!R) return null;
  const n = Math.max(...curves.map(c => c.fluor.length));
  if (n < 10) return null;
  const raw = curves.map(c => { const a = new Float64Array(n).fill(NaN); c.fluor.forEach((v, i) => { if (v !== null && v !== undefined && v !== "") a[i] = +v; }); return a; });
  const type = curves.map(c => c.type || "unkn"), chem = curves.map(c => c.chemistry || "non-saturating DNA binding dye"), nucl = curves.map(c => c.nucleotide || "cDNA");
  const warnings = [];
  const negShift = new Float64Array(R);
  if (nanmin(raw.map(nanmin)) < 0) {
    warnings.push("Some fluorescence values are negative: these look like baseline-corrected data. LinRegPCR needs raw fluorescence; with baseline-subtracted data the efficiencies are wrong unless the subtracted baseline was a constant.");
    raw.forEach((a, r) => { const mn = nanmin(a); if (mn < 0) { negShift[r] = (nanmax(a) - mn) / 100 - mn; for (let i = 0; i < n; i++) a[i] += negShift[r]; } });
  }
  const B = () => new Array(R).fill(false);
  const noAmp = B(), baseErr = B(), instable = B(), noPlat = B(), noisy = B(), skip = B(), short = B(), shifting = B(), usedWoL = B(), outlier = B(), lowCqEff = B(), lowCqN0 = B();
  const stop = new Array(R).fill(0), start = new Array(R).fill(0), fix = new Array(R).fill(0);
  const pcrEff = new Array(R).fill(1), nNulls = new Array(R).fill(1), nInclu = new Array(R).fill(0), correl = new Array(R).fill(0);
  const mX = new Array(R).fill(NaN), mY = new Array(R).fill(NaN);
  const targets = [...new Set(curves.map(c => c.target ?? ""))], tarOf = curves.map(c => targets.indexOf(c.target ?? "") + 1), T = targets.length;
  const upWin = new Array(T + 1).fill(0), lowWin = new Array(T + 1).fill(0), threshold = new Array(T + 1).fill(1);
  const inTar = (t, r) => t === null || t === tarOf[r];

  // first quality check: is there enough amplification?
  const rawMod = raw.map(clean), slopeAmp = rawMod.map(a => slopeOf(a.map(log10)));
  const minF = rawMod.map(nanmin), bg = minF.map(v => 0.99 * v), defBg = bg.slice();
  const minCor = rawMod.map((a, r) => clean(a.map(v => v - bg[r])));
  for (let r = 0; r < R; r++) {
    const m = minCor[r], cnt = m.filter(v => !isnan(v)).length;
    if (slopeAmp[r] < 0 || slopeOf(m.map(log10)) < log10(7) / cnt) noAmp[r] = true;
    let pc = 0, p0 = 0, p1 = 0, p8 = 0, p9 = 0;
    for (let i = 0; i < n; i++) if (!isnan(m[i])) { if (pc === 0) p0 = i; if (pc === 1) p1 = i; if (pc === 8) p8 = i; if (pc === 9) p9 = i; if (pc > 9) break; pc++; }
    if ((m[p8] + m[p9]) / 2 / ((m[p0] + m[p1]) / 2) < 2 && m[n - 1] / nanmean(m.slice(p0, p9 + 1)) < 7) noAmp[r] = true;
    if (!noAmp[r]) { stop[r] = findStopCyc(m); [start[r], fix[r]] = findStartCyc(m, stop[r]); }
    else { skip[r] = true; stop[r] = n; start[r] = 1; fix[r] = 1; }
    let k = 0, pm1 = 0, pm2 = 0;
    for (let rp = stop[r] - 2; rp > 0; rp--) if (!isnan(g(m, rp - 1))) { if (k === 0) pm1 = rp + 1; if (k > 0) { pm2 = rp + 1; break; } k++; }
    if (!(g(m, stop[r] - 1) > g(m, pm1 - 1) && g(m, pm1 - 1) > g(m, pm2 - 1))) noAmp[r] = skip[r] = true;
    if (noAmp[r] || baseErr[r] || stop[r] === n) noPlat[r] = true;
  }
  const lastCycMeanMax = F => { const mx = F.map((a, r) => (skip[r] || noPlat[r] ? NaN : nanmax(a.slice(Math.max(0, n - 11))))), m = nanmean(mx); return isnan(m) ? nanmax(mx) : m; };
  let lc = lastCycMeanMax(minCor);
  upWin[0] = 0.1 * lc; lowWin[0] = (0.1 * lc) / 16;

  // baseline per well
  const baseCor = new Array(R);
  for (let r = 0; r < R; r++) {
    const rw = raw[r], sub = b => clean(rw.map(v => v - b));
    let bc = null, lastSlope = -1;
    if (!noAmp[r]) {
      baseErr[r] = true;
      let st = stop[r], fnn = 1;
      const bc0 = r > 0 ? clean(rw) : rw; // rdmlpython cleans the whole matrix while processing the first row
      while (isnan(g(bc0, fnn - 1)) && fnn < stop[r]) fnn++;
      let left = 5;
      while (left > 0 && st > fnn) { st--; if (!isnan(g(rw, st - 1))) left--; }
      bg[r] = 0.99 * g(rw, st - 1);
      bc = sub(bg[r]);
      // 1. baseline certainly too high: lower it until the lower half is less steep than the upper half
      let trials = 0, slopeHigh = 0, slopeLow = 0;
      for (;;) {
        trials++;
        stop[r] = findStopCyc(bc); [start[r], fix[r]] = findStartCyc(bc, stop[r]);
        if (stop[r] - fix[r] > 0) { [slopeLow, slopeHigh] = testSlopes(bc, stop[r], fix[r]); defBg[r] = bg[r]; } else break;
        if (slopeLow >= slopeHigh) { bg[r] *= 0.99; bc = sub(bg[r]); }
        if (slopeLow < slopeHigh || slopeHigh < log10(1.2) || bg[r] <= 0 || trials > 1000) break;
      }
      if (slopeLow < slopeHigh) baseErr[r] = false;
      // 2. fine-tune until both halves have the same slope
      const stepVal = 0.005 * bg[r];
      let baseStep = 1, curDiff = 10, curSign = 0, shifted = false, toShift = 0;
      trials = 0;
      for (;;) {
        trials++; toShift++;
        if (toShift > 10 && !shifted) { baseStep *= 2; toShift = 0; }
        const lastSign = curSign, lastDiff = curDiff;
        defBg[r] = bg[r]; lastSlope = slopeHigh;
        bc = sub(bg[r]);
        stop[r] = findStopCyc(bc); [start[r], fix[r]] = findStartCyc(bc, stop[r]);
        if (stop[r] - fix[r] > 0) {
          [slopeLow, slopeHigh] = testSlopes(bc, stop[r], fix[r]);
          curDiff = Math.abs(slopeLow - slopeHigh); curSign = slopeLow - slopeHigh > 0 ? 1 : -1;
          if (slopeLow < slopeHigh) bg[r] += baseStep * stepVal;
          else { bg[r] -= baseStep * stepVal * 2; baseStep /= 2; shifted = true; }
        } else break;
        if ((Math.abs(curDiff - lastDiff) < 0.00001 && curSign === lastSign && shifted) || Math.abs(curDiff) < 0.0001 || slopeHigh < log10(1.2) || trials > 1000) break;
      }
      if (curDiff < 0.0001) baseErr[r] = false;
      // 3. a log-linear phase spanning less than 20-fold is short
      if (g(bc, stop[r] - 1) / g(bc, fix[r] - 1) < 20) short[r] = true;
      pcrEff[r] = 10 ** lastSlope;
    }
    if (noAmp[r] || baseErr[r]) {
      skip[r] = true; defBg[r] = 0.99 * minF[r]; bc = sub(defBg[r]);
      stop[r] = n; start[r] = fix[r] = n + 1; pcrEff[r] = NaN;
    }
    if (NEG.has(type[r])) skip[r] = true;
    baseCor[r] = bc;
  }
  const back = defBg;

  const meanPcrEff = t => {
    let cnt = 0, s = 0, s2 = 0;
    for (let r = 0; r < R; r++) if (inTar(t, r) && !(skip[r] || noPlat[r] || short[r]) && pcrEff[r] > 1) { cnt++; s += pcrEff[r]; s2 += pcrEff[r] * pcrEff[r]; }
    return cnt > 1 ? [s / cnt, (s2 - (s * s) / cnt) / (cnt - 1)] : [1, 100];
  };
  // is Cq stable when the baseline is moved ±5%?
  {
    const checkBase = log10(upWin[0]) - log10(meanPcrEff(null)[0]);
    let prevFinite = false;
    const cqAt = (f) => { const [x, y, e] = paramInWindow(f, upWin[0], lowWin[0]); return e > 1.000000000001 ? x + (checkBase - y) / log10(e) : 0; };
    for (let r = 0; r < R; r++) if (short[r] && !noAmp[r] && !baseErr[r]) {
      let cf = clean(raw[r].map(v => v - 1.05 * back[r]));
      const up = cqAt(prevFinite || cf.some(finite) ? cf : baseCor[r]);
      cf = clean(raw[r].map(v => v - 0.95 * back[r])); prevFinite ||= cf.some(finite);
      const down = cqAt(cf);
      if (Math.abs(up - down) > 1) { instable[r] = true; baseErr[r] = skip[r] = shifting[r] = true; }
    }
  }
  curves.forEach((c, r) => { if (c.excluded) skip[r] = true; });
  lc = lastCycMeanMax(baseCor);
  upWin[0] = 0.1 * lc; lowWin[0] = (0.1 * lc) / 16;
  const maxTot = nanmax(baseCor.map(nanmax));
  let minTot = nanmin(baseCor.map(nanmin));
  if (minTot < maxTot / 10000) minTot = maxTot / 10000;

  const meanStopFluor = t => {
    let mm = 0, mf = 0.0000001, cnt = 0;
    for (let r = 0; r < R; r++) if (inTar(t, r) && !skip[r]) {
      if (!noPlat[r]) { cnt++; mm += g(baseCor[r], stop[r] - 1); } else for (const v of baseCor[r]) if (v > mf) mf = v;
    }
    return cnt > 0 ? mm / cnt : mf;
  };
  const maxStartFluor = t => { let m = -10; for (let r = 0; r < R; r++) if (inTar(t, r) && !skip[r] && g(baseCor[r], start[r] - 1) > m) m = g(baseCor[r], start[r] - 1); return 0.999 * m; };
  const logStepStop = t => {
    let cnt = 0, s = 0;
    for (let r = 0; r < R; r++) if (inTar(t, r) && !(skip[r] || noPlat[r])) { cnt++; s += log10(g(baseCor[r], stop[r] - 1)) - log10(g(baseCor[r], stop[r] - 2)); }
    return cnt > 0 ? s / cnt : log10(1.8);
  };
  const setLogWin = (t, newUp, fold) => {
    const clamp = v => Math.max(Math.min(v, maxTot), minTot);
    upWin[t ?? 0] = clamp(10 ** (rint(1000 * newUp) / 1000)); lowWin[t ?? 0] = clamp(10 ** (rint(1000 * (newUp - fold)) / 1000));
  };
  const allParamInWindow = t => {
    for (let r = 0; r < R; r++) if (inTar(t, r)) {
      if (!(noAmp[r] || baseErr[r])) [mX[r], mY[r], pcrEff[r], nNulls[r], nInclu[r], correl[r]] = paramInWindow(baseCor[r], upWin[t ?? 0], lowWin[t ?? 0]);
      else { correl[r] = mX[r] = mY[r] = pcrEff[r] = nNulls[r] = NaN; nInclu[r] = 0; }
    }
  };
  const P = 4; // points in the window of linearity

  // noisy samples (rdmlpython checks this over all targets at once)
  {
    let skipG = false, maxLim = meanStopFluor(null), cme = 1;
    if (maxLim > 0) maxLim = log10(maxLim); else skipG = true;
    if (!skipG) { setLogWin(null, maxLim, P * logStepStop(null)); allParamInWindow(null); cme = meanPcrEff(null)[0]; if (cme < 1.001) skipG = true; }
    if (!skipG) {
      const fold = log10(cme ** P);
      setLogWin(null, maxLim, fold);
      const lowLim = maxLim - fold + 0.0043;
      for (let r = 0; r < R; r++) if (!skip[r]) {
        const f = baseCor[r], [sw, ew] = startStopInWindow(f, upWin[0], lowWin[0]);
        let ms = sw - 1; while (isnan(g(f, ms - 1)) && ms > 1) ms--;
        let me = ew - 1; while (isnan(g(f, me - 1)) && me > 2) me--;
        let msf = g(f, ms - 1); if (isnan(msf)) msf = 0.00001;
        const startStep = log10(g(f, sw - 1)) - log10(msf), stopStep = log10(g(f, ew - 1)) - log10(g(f, me - 1));
        if (log10(msf) > lowLim && !((msf < g(f, sw - 1) && startStep < 1.2 * stopStep) || sw - ms > 1.2)) noisy[r] = skip[r] = true;
      }
    }
  }

  // window of linearity per target
  const setWoL = t => {
    let skipG = false, maxW = meanStopFluor(t), minLim = maxStartFluor(t), cme = 1;
    if (maxW > 0) maxW = log10(maxW); else skipG = true;
    if (minLim > 0) minLim = log10(minLim); else skipG = true;
    if (!skipG) { setLogWin(t, maxW, P * logStepStop(t)); allParamInWindow(t); cme = meanPcrEff(t)[0]; if (cme < 1.001) skipG = true; }
    if (skipG) { threshold[t] = (0.5 * rint(1000 * upWin[t])) / 1000; return; }
    const memVar = new Float64Array(64), memUp = new Float64Array(64), memFold = new Float64Array(64);
    let fold = log10(cme ** P), counter = -1, maxVar = 0, maxVarStep = -1, lastUp = 2 + maxW, newUp, cve;
    for (;;) {
      counter++;
      newUp = maxW - counter * 0.2 * log10(cme);
      if (newUp < lastUp) {
        setLogWin(t, newUp, fold); allParamInWindow(t); cme = meanPcrEff(t)[0];
        fold = log10(cme ** P); if (fold < 0.5) fold = 0.5;
        setLogWin(t, newUp, fold); allParamInWindow(t); [cme, cve] = meanPcrEff(t);
        memVar[counter] = cve > 0 ? Math.sqrt(cve) / cme : 0;
        if (cve > maxVar) { maxVar = cve; maxVarStep = counter; }
        memUp[counter] = newUp; memFold[counter] = fold; lastUp = newUp;
      } else cve = 0;
      if (counter >= 60 || newUp - fold / (P / 2) < minLim || cve < 0.00000000001) break;
    }
    let valid = -1;
    do valid++; while (!(memVar[valid] < 0.000001));
    valid--;
    let minSmooth = memVar[0], minStep = 0;
    if (valid > 0 && valid < 4) for (let k = 0; k <= valid; k++) if (memVar[k] < minSmooth) { minSmooth = memVar[k]; minStep = k; }
    if (valid >= 4) for (let k = 1; ; k++) {
      const s = (memVar[k - 1] + memVar[k] + memVar[k + 1]) / 3;
      if (s < minSmooth) { minSmooth = s; minStep = k; }
      if (k >= valid - 1 || k > maxVarStep) break;
    }
    setLogWin(t, memUp[minStep], memFold[minStep]);
    threshold[t] = (0.5 * rint(1000 * upWin[t])) / 1000;
    allParamInWindow(t);
    for (let r = 0; r < R; r++) if (tarOf[r] === t) usedWoL[r] = !(skip[r] || noPlat[r] || short[r]) && pcrEff[r] > 1;
  };
  for (let t = 1; t <= T; t++) { upWin[t] = upWin[0]; lowWin[t] = lowWin[0]; }
  for (let r = 0; r < R; r++) noPlat[r] = noAmp[r] || baseErr[r] || stop[r] === n;
  for (let t = 1; t <= T; t++) {
    setWoL(t);
    let again = false;
    for (let r = 0; r < R; r++) if (tarOf[r] === t && !(noAmp[r] || baseErr[r] || noPlat[r]) && (nNulls[r] * pcrEff[r] ** n) / baseCor[r][n - 1] < 5) { noPlat[r] = true; again = true; }
    if (again) setWoL(t);
  }
  threshold[0] = 10 ** (threshold.slice(1).reduce((a, v) => a + log10(v), 0) / T);
  const th = threshold[0];

  // Cq too low for reliable results with probe chemistries
  for (let r = 0; r < R; r++) if (PROBE.has(chem[r])) {
    let off = 0;
    const dna = ["DNA", "genomic DNA"].includes(nucl[r]);
    if (chem[r] === "labelled reverse primer" && dna) off = 1;
    if (chem[r] === "DNA-zyme probe") off = dna ? 4 : ["cDNA", "RNA"].includes(nucl[r]) ? 6 : 0;
    if (!isnan(pcrEff[r]) && pcrEff[r] > 1.0001 && threshold[tarOf[r]] > 0.0001 && !(noAmp[r] || baseErr[r])) {
      const ei = Math.min(10, Math.max(0, Math.trunc(10 * pcrEff[r] + 1 - 10))), cq = mX[r] + (log10(th) - mY[r]) / log10(pcrEff[r]);
      if (cq > 0) { if (cq < CRIT_EFF[ei] + off) lowCqEff[r] = true; if (cq < CRIT_N0[ei] + off) lowCqN0[r] = true; }
    }
  }

  // mean efficiency per target (no-plateau wells and outliers left out), Cq and N0
  const skipPlat = skip.map((s, r) => s || noPlat[r]);
  const meanEff = new Array(R).fill(NaN), sdEff = new Array(R).fill(NaN), cq = new Array(R).fill(NaN), n0 = new Array(R).fill(NaN), indivCq = new Array(R).fill(NaN);
  const perTarget = {};
  for (let t = 1; t <= T; t++) {
    const e = pcrEff.map((v, r) => (lowCqEff[r] || skip[r] || !(v >= 1.001) || tarOf[r] !== t || skipPlat[r] ? NaN : v));
    removeOutlier(e, noPlat).forEach((o, r) => { if (o) outlier[r] = true; });
    const kept = e.map((v, r) => (outlier[r] ? NaN : v)), me = nanmean(kept), sd = nanstd0(kept);
    perTarget[targets[t - 1]] = { meanEff: me, sdEff: sd, n: kept.filter(v => !isnan(v)).length, median: nanmedian(kept), threshold: threshold[t], lower: lowWin[t], upper: upWin[t] };
    for (let r = 0; r < R; r++) if (tarOf[r] === t) {
      meanEff[r] = me; sdEff[r] = sd;
      const zyme = chem[r] === "DNA-zyme probe", corr = E => (zyme ? -1 + log10(1 / (1 - 1 / E)) / log10(E) : PROBE.has(chem[r]) ? -1 : 0);
      if (!isnan(pcrEff[r]) && pcrEff[r] > 1.0001 && threshold[t] > 0.0001 && !(noAmp[r] || baseErr[r])) indivCq[r] = mX[r] + (log10(th) - mY[r]) / log10(pcrEff[r]) + corr(pcrEff[r]);
      if (!isnan(pcrEff[r]) && pcrEff[r] > 1 && !isnan(me) && me > 1.001) {
        cq[r] = mX[r] + (log10(th) - mY[r]) / log10(me) + corr(me);
        if (indivCq[r] > 0 && indivCq[r] < 2 * n) n0[r] = th / me ** cq[r];
      }
      if (noPlat[r] && outlier[r]) n0[r] = NaN;
    }
  }

  const rows = curves.map((c, r) => {
    const nLog = stop[r] - fix[r] + 1, notes = [], excl = [], ty = type[r], amp = !noAmp[r], plat = !noPlat[r], q = cq[r];
    const effNotes = () => {
      if (q > -0.0001 && q < 10) notes.push("Cq < 10;N0 unreliable");
      if (q > 34) notes.push("Cq > 34;N0 unreliable");
      if (ty === "unkn" && q > 35 && !plat) notes.push("Cq too high");
      if (nLog < 5) notes.push(`only ${nLog} values in log phase`);
      if (pcrEff[r] < 1.7) notes.push(`indiv PCR eff is ${pcrEff[r].toFixed(3)} < 1.7`);
      if (outlier[r]) {
        if (!finite(pcrEff[r])) notes.push("no indiv PCR eff can be calculated");
        else { const d = pcrEff[r] - meanEff[r]; notes.push("PCR efficiency outlier", `indiv PCR eff is ${d > 0 ? "higher" : "lower"} than mean PCR eff by ${Math.abs(d).toFixed(3)}`); }
      }
    };
    if (["ntc", "nac", "ntp", "nrt"].includes(ty)) {
      if (q > 0 || amp) excl.push("amplification in negative control");
      if (baseErr[r]) excl.push("baseline error");
      if (plat) notes.push("plateau in negative control");
    }
    if (ty === "std" || ty === "pos") {
      if (!(q > 0) || !amp) excl.push("no amplification in positive control");
      if (baseErr[r]) excl.push("baseline error in positive control");
      if (instable[r]) excl.push("instable baseline in positive control");
      if (!plat) notes.push("no plateau in positive control");
      if (noisy[r]) notes.push("noisy sample in positive control");
      effNotes();
    }
    if (ty === "unkn") {
      if (!amp) notes.push("no amplification");
      if (baseErr[r]) notes.push("baseline error");
      if (instable[r]) notes.push("instable baseline");
      if (!plat) notes.push("no plateau");
      if (noisy[r]) notes.push("noisy sample");
      effNotes();
    }
    const fin = v => (finite(v) ? v : null);
    return {
      key: c.key, target: c.target, baseline: fin(back[r] - negShift[r]), nLog, lastLogCycle: stop[r], nIncluded: nInclu[r],
      eff: fin(pcrEff[r]), r2: fin(correl[r] * correl[r]), meanEff: fin(meanEff[r]), sdEff: fin(sdEff[r]),
      cq: finite(q) && q >= 0 && q <= 1000 ? q : null, n0: fin(n0[r]), indivCq: fin(indivCq[r]),
      amplification: amp, baselineError: baseErr[r], instableBaseline: instable[r], plateau: plat, noisy: noisy[r], shortLogLin: short[r],
      outlier: outlier[r], tooLowCqEff: lowCqEff[r], tooLowCqN0: lowCqN0[r], usedInWoL: usedWoL[r], excl, notes,
    };
  });
  return { rows, threshold: th, targets: perTarget, cycles: n, warnings };
}

// Curves for linRegPCR from PlateCheck's analysis: res.amp.series ("well|target" → [[cycle, y]]) and res.rows (roles, omit).
const ROLE_TYPE = { sample: "unkn", ntc: "ntc", nrt: "nrt", positive: "pos", standard: "std" };
// Chemistry names as RDML writes them; "TaqMan"/"SYBR" style values from other exports are mapped onto them.
const CHEM = [[/hydrolysis|taqman|5'?.?nuclease/i, "hydrolysis probe"], [/reverse primer|plexor|lux/i, "labelled reverse primer"], [/zyme/i, "DNA-zyme probe"],
  [/saturating|sybr|eva ?green|lc ?green|syto|resolight|binding dye/i, null]];
const chemOf = s => { for (const [re, c] of CHEM) if (re.test(s || "")) return c ?? (/^saturating/i.test(s) ? "saturating DNA binding dye" : "non-saturating DNA binding dye"); return undefined; };
export function curvesFrom(res, { chemistry = {} } = {}) {
  const series = res?.amp?.series;
  if (!series) return [];
  const byKey = new Map();
  for (const r of res.rows || []) if (r.key) byKey.set(`${r.key}|${r.target ?? ""}`, r);
  return Object.entries(series).map(([k, pts]) => {
    const [well, ...t] = k.split("|"), target = t.join("|"), row = byKey.get(k) || byKey.get(`${well}|`);
    const fluor = [];
    for (const [x, y] of pts) { const i = Math.ceil(x) - 1; if (i >= 0 && i < 1000) fluor[i] = y; }
    for (let i = 0; i < fluor.length; i++) if (fluor[i] === undefined) fluor[i] = NaN;
    return { key: well, target, type: ROLE_TYPE[row?.role] || "unkn", excluded: !!row?.omit, chemistry: chemistry[target] ?? chemOf(row?.chemistry), fluor };
  });
}

// LinRegPCR for an analysed run, cached per analysis result (about 0.1 s for a 384-well plate). null without curves.
// Adds what the app needs to judge the input: whether the curves look baseline-subtracted (ΔRn), and the instrument Cq.
const CACHE = new WeakMap();
export function forRun(res) {
  if (!res?.amp?.series) return null;
  if (CACHE.has(res)) return CACHE.get(res);
  const curves = curvesFrom(res).filter(c => c.fluor.some(v => Number.isFinite(v)));
  let out = null;
  try { out = curves.length ? linRegPCR(curves) : null; } catch { out = null; }
  if (out) {
    if (/delta|δ|Δ|norm|baseline/i.test(res.amp.yName || "") && !out.warnings.length) out.warnings.push(`The curve values are “${res.amp.yName}”, which is usually baseline-subtracted. LinRegPCR sets its own baseline and needs raw fluorescence (Rn or RFU before baseline correction); on subtracted data the efficiencies come out wrong. Export the raw (multicomponent or “Rn”) values if your software allows.`);
    const ct = new Map((res.rows || []).map(r => [`${r.key}|${r.target ?? ""}`, r]));
    for (const w of out.rows) { const r = ct.get(`${w.key}|${w.target}`); w.sample = r?.sample ?? ""; w.instrumentCt = r ? (Number.isFinite(+r.ct) && String(r.ct).trim() !== "" ? +r.ct : null) : null; }
  }
  CACHE.set(res, out);
  return out;
}
// Short reason a well was not used for its target's mean efficiency ("" when it was).
export function whyNotUsed(w) {
  if (!w.amplification) return "no amplification";
  if (w.baselineError) return w.instableBaseline ? "baseline unstable" : "baseline could not be set";
  if (w.noisy) return "noisy curve";
  if (!w.plateau) return "no plateau";
  if (w.outlier) return "efficiency outlier";
  if (w.tooLowCqEff) return "Cq too early for this chemistry";
  if (w.eff === null || w.eff < 1.001) return "no efficiency";
  return "";
}
export function linregCsv(out, toCsv) {
  const f = (v, d) => (v === null || v === undefined ? "" : (+v).toFixed(d));
  return toCsv([["Well", "Sample", "Target", "Efficiency (individual)", "R2", "Points in window", "Log-linear points", "Baseline", "Mean efficiency of target", "SD of target efficiency",
    "Cq (LinRegPCR)", "Cq (instrument)", "N0 (fluorescence units)", "Common threshold", "Used for mean efficiency", "Notes"],
    ...out.rows.map(w => [w.key, w.sample ?? "", w.target, f(w.eff, 4), f(w.r2, 5), w.nIncluded, w.nLog, f(w.baseline, 4), f(w.meanEff, 4), f(w.sdEff, 4),
      f(w.cq, 3), f(w.instrumentCt, 3), w.n0 === null ? "" : w.n0.toExponential(4), f(out.threshold, 4), whyNotUsed(w) || "yes", [...w.excl, ...w.notes].join("; ")])]);
}
// Per-target efficiency factors for the Pfaffl correction (analysis.js): { target: { E, n } }, pooled over runs by well count.
export function targetEfficiencies(list) {
  const acc = {};
  for (const o of list) if (o) for (const [t, v] of Object.entries(o.targets)) if (Number.isFinite(v.meanEff) && v.n > 0) { const a = (acc[t] ||= { s: 0, n: 0 }); a.s += v.meanEff * v.n; a.n += v.n; }
  return Object.fromEntries(Object.entries(acc).map(([t, a]) => [t, { E: a.s / a.n, n: a.n }]));
}
