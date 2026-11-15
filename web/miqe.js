// MIQE 2.0 checklist (Bustin et al., Clin Chem 2025;71:634–651, Table 1, doi:10.1093/clinchem/hvaf043): 53 items in
// five sections, each answered Yes/No with where the information is (or why it's missing). The item labels here are
// PlateCheck's own short wording of the table's items; the paper's Table 1 (and its editable Supplemental Table 1) is the
// reference. Items PlateCheck can see in the run get a suggested answer; the user's own answers (exp.miqe) win.
// Pure functions, no DOM.
import { APP_VERSION, BUILD, PARSER_VERSION, toCsv } from "./core.js";
import * as Q from "./absquant.js";
import * as RG from "./refgenes.js";

export const MIQE_SOURCE = "Bustin SA, Ruijter JM, van den Hoff MJB, et al. MIQE 2.0: Revision of the Minimum Information for Publication of Quantitative Real-Time PCR Experiments Guidelines. Clin Chem 2025;71(6):634–651. doi:10.1093/clinchem/hvaf043 (Table 1).";
export const SECTIONS = ["Reagent preparation", "Sample preparation", "Reverse transcription", "qPCR protocol", "Data analysis"];
// [id, section index, label]
const ITEMS = [
  ["1.1", 0, "Assay design: software, version and settings"], ["1.2", 0, "Gene symbol, species and sequence accession"], ["1.3", 0, "Where the amplicon lies"],
  ["1.4", 0, "Amplicon length"], ["1.5", 0, "Primer and probe sequences"], ["1.6", 0, "Oligo modifications: where and which"],
  ["1.7", 0, "Who made the oligonucleotides"], ["1.8", 0, "Optimisation done"],
  ["2.1", 1, "Sample types and numbers"], ["2.2", 1, "How samples were taken (and time to storage)"], ["2.3", 1, "Aliquoting, storage conditions and duration"],
  ["2.4", 1, "Extraction method and amount of sample used"], ["2.5", 1, "Spike-in nucleic acids: source and amount"], ["2.6", 1, "Elution / resuspension volume"],
  ["2.7", 1, "Number of extraction replicates"], ["2.8", 1, "Extraction blanks and percent yield"], ["2.9", 1, "How nucleic acid quality and quantity were assessed"],
  ["2.10", 1, "Storage of nucleic acids (temperature, concentration, time, buffer, aliquots)"], ["2.11", 1, "Dilution steps to the working template"],
  ["2.12", 1, "Template modification (digestion, sonication, pre-amplification, DNase …)"], ["2.13", 1, "Clean-up after modification"],
  ["3.1", 2, "cDNA priming method and primer concentration"], ["3.2", 2, "One- or two-step protocol (two-step: reaction details)"], ["3.3", 2, "RNA amount per reaction"],
  ["3.4", 2, "RT reaction components and conditions"], ["3.5", 2, "Estimated copies with and without RT (no-RT control)"], ["3.6", 2, "RT reagents: maker, catalogue and lot numbers"],
  ["3.7", 2, "cDNA storage (temperature, dilution, time, buffer, aliquots)"],
  ["4.1", 3, "Template treatment (initial heating, chemical denaturation)"], ["4.2", 3, "Primer and probe concentrations and source"],
  ["4.3", 3, "Polymerase, Mg²⁺ and dNTP concentrations"], ["4.4", 3, "Buffer / kit: maker, catalogue and lot numbers"],
  ["4.5", 3, "Full cycling programme and reaction volume"], ["4.6", 3, "qPCR instrument: maker and model"],
  ["5.1", 4, "Raw fluorescence data stored / submitted (RDES or RDML)"], ["5.2", 4, "Standards: identity and how they were quantified"],
  ["5.3", 4, "Baseline correction and Cq method"], ["5.4", 4, "Analysis software and version"], ["5.5", 4, "Positive and negative controls"],
  ["5.6", 4, "How often negative controls amplified, and their Cq"], ["5.7", 4, "Examples of positive and negative results"],
  ["5.8", 4, "PCR efficiency and how it was estimated"], ["5.9", 4, "How target quantities were calculated (efficiency-corrected)"],
  ["5.10", 4, "Replicates"], ["5.11", 4, "Repeatability (within experiment)"], ["5.12", 4, "Reproducibility (between experiments, users, labs)"],
  ["5.13", 4, "Limit of detection"], ["5.14", 4, "Dynamic range (limits of quantification)"], ["5.15", 4, "How reference genes were validated"],
  ["5.16", 4, "Normalisation method"], ["5.17", 4, "Statistical methods"], ["5.18", 4, "Significance level and statistical power"],
  ["5.19", 4, "Specificity (rare mutations, pathogen sequences …)"],
];
export const ITEM_COUNT = ITEMS.length;
export const ANSWERS = { yes: "Yes", no: "No", na: "Not applicable" };

const fmt = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const list = xs => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const ctx = (exp, k) => (exp.context?.[k] || "").trim();

// What PlateCheck can say about each item from the run: { provided: "yes" | "" , text }. provided "yes" only when the
// run itself shows it; otherwise text is a starting point for the user. a: the analysis (analysis.js analyzeRun) or null.
function suggestions(exp, res, a) {
  const S = {}, put = (id, text, provided = "yes") => { if (text) S[id] = { text, provided }; };
  const meta = res?.parsed?.metadata || {}, instr = ctx(exp, "instrument") || Object.entries(meta).find(([k]) => /instrument/i.test(k))?.[1] || "";
  // 1.2 genes
  const genes = Object.entries(exp.targets || {}).filter(([, t]) => t.symbol)
    .map(([name, t]) => `${name}: ${t.symbol}${t.species ? `, ${t.species}` : ""}${t.hgncId ? `, ${t.hgncId}` : ""}${t.entrez ? `, Entrez ${t.entrez}` : ""}${t.ensembl ? `, ${t.ensembl}` : ""}`);
  if (genes.length) put("1.2", `${genes.join("; ")} (from the gene lookup in PlateCheck).`);
  const assay = ctx(exp, "assay_details");
  if (assay) for (const id of ["1.3", "1.4", "1.5"]) put(id, `See the assay details recorded with the run: ${assay}`, "");
  if (ctx(exp, "reagent_lots")) { put("3.6", `Recorded lots: ${ctx(exp, "reagent_lots")}`, ""); put("4.4", `Recorded lots: ${ctx(exp, "reagent_lots")}`, ""); }
  if (ctx(exp, "run_settings")) { put("4.5", ctx(exp, "run_settings"), ""); put("5.3", `Run settings recorded: ${ctx(exp, "run_settings")}`, ""); }
  if (instr) put("4.6", instr);
  if (!res?.rows?.length) return S;
  // 5.1 raw data
  const curves = [exp.amp && `amplification curves (${exp.amp.name})`, exp.melt && `melt curves (${exp.melt.name})`].filter(Boolean);
  put("5.1", curves.length ? `The run's ${list(curves)} are kept with the PlateCheck run and its packet export, and can be shared as RDML (Report → Other formats).` : "No raw fluorescence was imported into PlateCheck; only Cq values.", "");
  // 5.2 / 5.8 / 5.14 standard curves
  const d = (res.stdCurves || []).map(c => Q.curveDetails(c)).filter(Boolean);
  if (d.length) {
    put("5.2", d.map(x => `${x.target}: ${x.n}-well standard curve over ${x.levels} levels`).join("; ") + ". Identity of the standards (synthetic, plasmid, gDNA …) and how they were quantified: add here.", "");
    put("5.8", d.map(x => `${x.target}: ${fmt(x.efficiency, 1)}% (95% CI ${fmt(x.effLow, 1)}–${fmt(x.effHigh, 1)}%), slope ${fmt(x.slope, 3)}, R² ${fmt(x.r2, 4)}`).join("; ") + ". From a standard curve of log10 quantity vs Cq on the plate (E = 10^(−1/slope) − 1).");
    put("5.14", "Not determined by PlateCheck. For reference, the standards span " + d.map(x => `${x.target}: ${Q.fmtQ(10 ** x.minX)} to ${Q.fmtQ(10 ** x.maxX)} (${fmt(x.maxX - x.minX, 1)} log10 units)`).join("; ") + ". That is the range tested, not a limit of detection or quantification; give those from replicate dilutions near the bottom of the range.", "");
  } else put("5.8", a?.settings?.efficiency ? "" : "No standard curve in this run; efficiency assumed 100% (2 per cycle). Add your validation data here.", "");
  // 5.4 software
  const sw = /software|version|\bv(er)?\.?\s?\d|\d+\.\d+/i.test(instr || "");
  put("5.4", `Cq values from the instrument software${sw ? ` (${instr})` : ": name and version not recorded, add them here"}; checks and analysis in PlateCheck ${APP_VERSION} (build ${BUILD}, parser ${PARSER_VERSION}), https://siddhantrajnaik.github.io/platecheck/.`, sw ? "yes" : "");
  // 5.5 / 5.6 / 3.5 controls
  const ctr = res.controls || [], present = ctr.filter(c => c.wells.length);
  if (present.length) put("5.5", [...new Set(present.map(c => c.label))].map(l => { const cs = present.filter(c => c.label === l); return `${l}: ${cs.reduce((n, c) => n + c.wells.length, 0)} wells for ${cs.map(c => c.target).join(", ")}`; }).join("; ") + ".");
  const neg = present.filter(c => c.role === "ntc" || c.role === "nrt");
  if (neg.length) put("5.6", neg.map(c => `${c.label}, ${c.target}: ${c.amplified.length} of ${c.wells.length} wells amplified${c.amplified.length ? `: ${c.amplified.join(", ")}` : ""}`).join("; ") + ".");
  const nrt = present.filter(c => c.role === "nrt");
  if (nrt.length) put("3.5", `No-RT controls: ${nrt.map(c => `${c.target}: ${c.amplified.length ? c.amplified.join(", ") : "no amplification"} in ${c.wells.length} well(s)`).join("; ")}. Convert to copies with your standard curve if needed.`, "");
  // 5.10 / 5.11 replicates
  const reps = (res.replicateGroups || []).filter(g => g.role === "sample");
  if (reps.length) {
    const units = new Set(reps.map(g => g.unit)), groups = new Set(reps.map(g => g.group || "")), ks = reps.map(g => g.n);
    const guessed = (res.findings || []).some(f => f.rule === "replicate_structure_inferred");
    put("5.10", `${units.size} biological unit(s)${groups.size > 1 || [...groups][0] ? ` in ${groups.size} group(s)` : ""}; ${Math.min(...ks) === Math.max(...ks) ? ks[0] : `${Math.min(...ks)}–${Math.max(...ks)}`} technical replicate well(s) per unit and target in this file. Statistics use biological units as n.` + (guessed ? " The biological units were taken from the sample names because the file doesn't label them; confirm the design here." : ""), guessed ? "" : "yes");
    const sds = reps.filter(g => g.sd != null);
    if (sds.length) put("5.11", `Technical replicate SD of Cq: median ${fmt(median(sds.map(g => g.sd)), 3)}, largest ${fmt(Math.max(...sds.map(g => g.sd)), 3)} cycles over ${sds.length} replicate sets; ${sds.filter(g => g.over).length} above PlateCheck's limit (${exp.ruleset?.values?.sdThreshold ?? 0.3} cycles).`);
  }
  // 5.9 / 5.15 / 5.16 / 5.17 / 5.18 analysis
  const quant = d.length && Q.quantify(res.rows, res.stdCurves).units.length ? "Absolute quantities of unknowns read off the standard curves at the mean Cq, with 95% prediction intervals. " : "";
  if (a?.ok !== false && a?.settings?.on) {
    put("5.9", quant + (a.settings.efficiency ? (a.settings.effSource === "linreg" ? "Relative quantities efficiency-corrected (Pfaffl 2001) with each target's mean efficiency from its amplification curves (LinRegPCR; Ruijter et al. 2009)." : "Relative quantities efficiency-corrected with each target's standard-curve efficiency (Pfaffl 2001).") : "Relative quantities by 2^−ΔΔCq assuming 100% efficiency (Livak & Schmittgen 2001); MIQE 2.0 asks for efficiency-corrected quantities, so state the efficiencies or switch on efficiency correction."), a.settings.efficiency || quant ? "yes" : "");
    const stab = RG.forRun(res, a.settings).r, stabText = RG.summaryText(stab);
    if (stabText) put("5.15", stabText + (a.refStability?.length ? " References were also checked for a shift between groups (Analysis step)." : ""));
    else if (a.refStability?.length) put("5.15", a.refStability.map(r => `${r.target}: Cq differs between groups by ${fmt(r.range, 2)} cycles${r.p != null ? ` (${r.test}, p = ${r.p < 0.001 ? r.p.toExponential(1) : fmt(r.p, 3)})` : ""}${r.flagged ? ", flagged" : ""}`).join("; ") + ". PlateCheck checks that references don't shift between groups; stability ranking (geNorm / NormFinder) is not done.", "");
    // The analysis methods paragraph: normalisation up to "Statistics on …", the statistics from there on.
    if (a.method) { const i = a.method.indexOf(" Statistics on "); put("5.16", (i > 0 ? a.method.slice(0, i) : a.method).trim()); if (i > 0) put("5.17", a.method.slice(i + 1).trim()); }
    put("5.18", "Two-sided tests at α = 0.05; statistical power was not calculated in PlateCheck.", "");
  } else if (quant) put("5.9", quant.trim());
  // 5.19 specificity: melt
  if (res.melt) { const n = Object.keys(res.melt.stats || {}).length, multi = res.findings.filter(f => f.rule === "melt_multiple_peaks").length;
    put("5.19", `Melt curves checked for ${n} well(s): ${multi} with more than one peak flagged. Add assay specificity evidence (e.g. gel, sequencing) here.`, ""); }
  return S;
}

// The checklist with the user's answers (exp.miqe) over PlateCheck's suggestions.
export function checklist(exp, res, analysis = null) {
  const sug = suggestions(exp, res, analysis), mine = exp.miqe || {};
  return ITEMS.map(([id, s, label]) => {
    const u = mine[id] || {}, g = sug[id] || null;
    const provided = u.provided || g?.provided || "", text = (u.text ?? "").trim() || g?.text || "";
    return { id, section: SECTIONS[s], label, provided, text, suggested: g, edited: !!(u.provided || (u.text ?? "").trim()) };
  });
}
export function summary(rows) {
  return { total: rows.length, yes: rows.filter(r => r.provided === "yes").length, no: rows.filter(r => r.provided === "no").length,
    na: rows.filter(r => r.provided === "na").length, open: rows.filter(r => !r.provided).length, auto: rows.filter(r => r.suggested?.provided === "yes" && !r.edited).length };
}
// Keeps only well-formed answers (saved runs and packets can be edited by hand).
export function cleanMiqe(v) {
  const out = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const ids = new Set(ITEMS.map(i => i[0]));
  for (const [id, a] of Object.entries(v)) {
    if (!ids.has(id) || !a || typeof a !== "object") continue;
    const r = {};
    if (a.provided in ANSWERS) r.provided = a.provided;
    if (typeof a.text === "string" && a.text.trim()) r.text = a.text.slice(0, 4000);
    if (Object.keys(r).length) out[id] = r;
  }
  return out;
}

export function miqeCsv(rows) {
  return toCsv([["item", "section", "item_label_platecheck", "provided", "description_or_justification", "source"],
    ...rows.map(r => [r.id, r.section, r.label, r.provided ? ANSWERS[r.provided] : "", r.text, r.edited ? "you" : r.suggested ? "PlateCheck (from the run)" : ""]),
    [], ["Checklist: " + MIQE_SOURCE + " Labels are PlateCheck's short wording of the items; see the paper's Table 1 for the full text."]]);
}
// A document Word, LibreOffice and browsers open (HTML saved as .doc), for filling in and attaching to a submission.
export function miqeDoc(exp, rows, esc) {
  const sum = summary(rows);
  const body = SECTIONS.map((s, i) => `<h2>${i + 1}. ${esc(s)}</h2><table><thead><tr><th style="width:6%">Item</th><th style="width:34%">What to report</th><th style="width:10%">Provided</th><th>Description / location, or why not</th></tr></thead><tbody>` +
    rows.filter(r => r.section === s).map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.label)}</td><td>${r.provided ? esc(ANSWERS[r.provided]) : ""}</td><td>${esc(r.text)}</td></tr>`).join("") + "</tbody></table>").join("");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><meta name="ProgId" content="Word.Document">
<title>MIQE 2.0 checklist: ${esc(exp.title)}</title><style>body{font:11pt Arial,sans-serif}table{border-collapse:collapse;width:100%;margin:0 0 12pt}th,td{border:1px solid #888;padding:4pt;vertical-align:top;text-align:left;font-size:10pt}h1{font-size:15pt}h2{font-size:12pt;margin:14pt 0 4pt}.sub{color:#555;font-size:9pt}</style></head><body>
<h1>MIQE 2.0 checklist</h1><p>Experiment: ${esc(exp.title)} (${esc(exp.id)}). Prepared with PlateCheck ${esc(APP_VERSION)} (build ${esc(BUILD)}) on ${esc(new Date().toISOString().slice(0, 10))}.</p>
<p class="sub">${sum.yes} Yes, ${sum.no} No, ${sum.na} not applicable, ${sum.open} still open, of ${sum.total} items. Answers marked by PlateCheck come from the run itself; check them before submitting. Item labels are PlateCheck's short wording; the full checklist is Table 1 of ${esc(MIQE_SOURCE)}</p>
${body}</body></html>`;
}
