// The run report as a real PDF (vector text, embedded IBM Plex, running header and footer, watermark).
// reportPdfDoc() is pure: it turns a run into a pdfmake document definition (testable in Node). reportPdf() loads
// pdfmake (web/vendor/pdfmake.min.js, MIT) and the fonts on first use and returns the PDF as a Blob.
// Same content as report.js's HTML report, laid out for A4.
import {
  APP_VERSION, BUILD, PARSER_VERSION, RULES_REVIEW, DISPOSITION_LABEL, ROLE_LABEL, FORMATS, FIELD_LABEL, CONTEXT_FIELDS,
  RULESET_FIELDS, REFERENCES, rulesetChanges, referencesFor, reviewOf, wellKey,
} from "./core.js";
import { CREDIT } from "./credit.js";
import { LIMITATIONS, esc } from "./report.js";
import * as Q from "./absquant.js";
import * as RG from "./refgenes.js";
import { analysisReportHtml } from "./analysis.js";
import { assayReportHtml } from "./assays.js";
import { targetsReportHtml } from "./genes.js";

// ---- look
const INK = "#17201c", MUTE = "#5b6762", RULE = "#d3dad6", HAIR = "#e6ebe8", FILL = "#f4f6f5", ACCENT = "#0b6b5c";
const SEV = { high: "#b42318", medium: "#b25e09", low: "#7a6300", info: MUTE };
const STATUS = { review_needed: SEV.high, findings_present: SEV.medium, no_flags: "#1d6b3a" };
const when = iso => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const onoff = v => (v === true ? "on" : v === false ? "off" : String(v ?? ""));
const sentence = l => (l.length > 1 ? l.slice(0, -1).join(", ") + " and " + l.at(-1) : l[0] || "");
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : "");
const str = v => (v === null || v === undefined || v === "" ? "—" : String(v));

const LINES = { // hairlines between rows only, no verticals
  hLineWidth: (i, node) => (i === 0 ? 0 : i === node.table.headerRows ? 0.8 : 0.4), vLineWidth: () => 0,
  hLineColor: (i, node) => (i === node.table.headerRows ? RULE : HAIR),
  paddingLeft: i => (i === 0 ? 0 : 6), paddingRight: () => 6, paddingTop: () => 3.5, paddingBottom: () => 3.5,
};
function table(head, rows, { widths, mono = [], size = 8 } = {}) {
  if (!rows.length) return { text: "None.", style: "muted", margin: [0, 0, 0, 8] };
  return { table: { headerRows: 1, dontBreakRows: true, widths: widths || head.map(() => "auto"),
      body: [head.map(h => ({ text: h, style: "th" })), ...rows.map(r => r.map((c, i) => ({ text: str(c), fontSize: size, ...(mono.includes(i) ? { font: "Mono", fontSize: size - 0.5 } : {}) })))] },
    layout: LINES, margin: [0, 2, 0, 10] };
}
const kv = pairs => ({ table: { widths: [130, "*"], body: pairs.filter(Boolean).map(([k, v, mono]) => [{ text: k, style: "muted" }, { text: str(v || "Not recorded"), ...(mono ? { font: "Mono", fontSize: 7.5 } : {}) }]) },
  layout: { ...LINES, hLineWidth: () => 0, paddingTop: () => 2, paddingBottom: () => 2 }, margin: [0, 0, 0, 8] });
const bullets = items => (items.length ? { ul: items, margin: [0, 0, 0, 8], markerColor: MUTE } : { text: "None.", style: "muted", margin: [0, 0, 0, 8] });

// ---- small HTML → pdfmake converter for the sections other modules write as HTML (analysis, assays, targets).
// Handles what they use: h2/h3/p/ul/li/table/b/strong/small/span/div/br.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", minus: "−", times: "×" };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => ENT[e] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));
export function htmlToPdf(html, { section } = {}) {
  const toks = String(html).match(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</g) || [];
  const out = []; let inl = null, list = null, tbl = null, row = null, cell = null; const style = [];
  const flush = () => { if (inl && inl.some(t => (t.text || "").trim())) out.push(inl.kind === "p" ? { text: inl, margin: [0, 0, 0, 6] } : inl.kind === "li" ? null : null); inl = null; };
  const push = text => {
    const t = { text, ...(style.includes("b") ? { bold: true } : {}), ...(style.includes("small") ? { fontSize: 7.5, color: MUTE } : {}) };
    if (cell) cell.push(t); else (inl ||= Object.assign([], { kind: "p" })).push(t);
  };
  for (const tok of toks) {
    const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(tok);
    if (tok.startsWith("<!--")) continue;
    if (!m) { const t = unent(tok); if (t.trim() || (inl && inl.length) || cell) push(t.replace(/\s+/g, " ")); continue; }
    const [, close, tag0] = m, tag = tag0.toLowerCase();
    if (["b", "strong", "small"].includes(tag)) { if (close) style.splice(style.lastIndexOf(tag === "strong" ? "b" : tag), 1); else style.push(tag === "strong" ? "b" : tag); continue; }
    if (tag === "br") { push("\n"); continue; }
    if (tag === "h2" || tag === "h3") { if (!close) { flush(); inl = Object.assign([], { kind: "h" }); } else { const t = inl.map(x => x.text).join("").trim(); inl = null; out.push(tag === "h2" ? heading(t, section) : { text: t, style: "h3" }); } continue; }
    if (tag === "p" || tag === "div") { if (!close) flush(); else flush(); continue; }
    if (tag === "ul" || tag === "ol") { if (!close) { flush(); list = []; } else { out.push({ [tag]: list, margin: [0, 0, 0, 6], markerColor: MUTE }); list = null; } continue; }
    if (tag === "li") { if (!close) { inl = Object.assign([], { kind: "li" }); } else { if (list && inl) list.push({ text: inl }); inl = null; } continue; }
    if (tag === "table") { if (!close) { flush(); tbl = { head: null, rows: [] }; } else { const [h, ...r] = tbl.head ? [tbl.head, ...tbl.rows] : tbl.rows; const txt = c => c.map(y => y.text).join("").trim(); if (h) out.push(table(h.map(txt), r.map(x => x.map(txt)))); tbl = null; } continue; }
    if (tag === "tr") { if (!close) row = []; else if (tbl) { if (row.isHead && !tbl.head) tbl.head = row; else tbl.rows.push(row); row = null; } continue; }
    if (tag === "th" || tag === "td") { if (!close) { cell = []; if (tag === "th" && row) row.isHead = true; } else { row?.push(cell); cell = null; } continue; }
  }
  flush();
  return out.filter(Boolean);
}

// section headings: "3  Experiment" with the number in the accent colour and a rule above
function heading(text, counter) {
  const n = counter ? counter.next() : null;
  return { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.6, lineColor: RULE }] },
    { text: [n ? { text: `${n}   `, color: ACCENT } : "", text], style: "h2", tocItem: !!counter, tocMargin: [0, 0, 0, 0] }], margin: [0, 14, 0, 6], headlineLevel: 1 };
}

// plate overview: one circle per well; filled = has a Ct, open = no Ct; ring = in an open finding (colour = worst severity)
function plateSvg(res, exp) {
  const keys = res.rows.map(r => r.key).filter(Boolean), rc = k => [k.charCodeAt(0) - 65, +k.slice(1)];
  const big = keys.some(k => { const [r, c] = rc(k); return r > 7 || c > 12; });
  const R = big ? 16 : 8, Cn = big ? 24 : 12, step = big ? 19 : 38, rad = big ? 7 : 14, left = 22, top = 16;
  const rank = { high: 3, medium: 2, low: 1, info: 0 }, flag = {};
  for (const f of res.findings) {
    const r = reviewOf(exp.reviews || {}, f);
    if (f.severity === "info" || (r?.disposition && r.disposition !== "unreviewed")) continue;
    for (const w of f.wells || []) { const k = wellKey(w); if (k && (!flag[k] || rank[f.severity] > rank[flag[k]])) flag[k] = f.severity; }
  }
  const byKey = {};
  for (const r of res.rows) if (r.key) (byKey[r.key] ||= []).push(r);
  const W = left + Cn * step + 4, H = top + R * step + 4, fs = big ? 7 : 9;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (let c = 1; c <= Cn; c++) s += `<text x="${left + (c - 0.5) * step}" y="${top - 5}" font-size="${fs}" fill="${MUTE}" text-anchor="middle">${c}</text>`;
  for (let r = 0; r < R; r++) {
    const y = top + (r + 0.5) * step;
    s += `<text x="${left - 9}" y="${y + fs / 3}" font-size="${fs}" fill="${MUTE}" text-anchor="middle">${String.fromCharCode(65 + r)}</text>`;
    for (let c = 1; c <= Cn; c++) {
      const k = String.fromCharCode(65 + r) + c, x = left + (c - 0.5) * step, rows = byKey[k], f = flag[k];
      const hasCt = rows?.some(w => w.ct != null && String(w.ct).trim() !== "" && Number.isFinite(+w.ct)), ntc = rows?.some(w => w.role === "ntc" || w.role === "nrt");
      const fill = !rows ? "#ffffff" : hasCt ? (ntc ? "#e9d9c4" : "#d6e4de") : "#ffffff", stroke = f ? SEV[f] : rows ? "#9aa8a2" : HAIR;
      s += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${f ? (big ? 1.6 : 2.4) : 0.7}"${rows ? "" : ` stroke-dasharray="2,2"`}/>`;
    }
  }
  return s + "</svg>";
}

export function reportPdfDoc(exp, res, { generatedAt = new Date().toISOString() } = {}) {
  const s = res.summary, rv = exp.reviews || {}, rs = exp.ruleset, sev = s.bySeverity || {}, p = res.parsed;
  const main = res.findings.filter(f => f.category !== "missing_context" && f.severity !== "info");
  const missing = res.findings.filter(f => f.category === "missing_context");
  const info = res.findings.filter(f => f.severity === "info" && f.category !== "missing_context");
  const files = [["Results", exp.source], ["Amplification curves", exp.amp], ["Melt curves", exp.melt]].filter(([, f]) => f);
  const ids = new Set(res.findings.map(f => f.id));
  const orphan = Object.entries(rv).filter(([id, r]) => !ids.has(id) && r.disposition && r.disposition !== "unreviewed");
  let n = 0; const sec = { next: () => ++n };
  const draft = s.open > 0;

  const decision = f => {
    const r = reviewOf(rv, f);
    if (!r && rv[f.id]) return { text: "Needs re-review: an earlier decision was made on different values, so it isn't applied here.", style: "muted" };
    if (!r?.disposition || r.disposition === "unreviewed") return { text: [{ text: "Not reviewed yet.", color: SEV.high }], fontSize: 8 };
    return { text: [{ text: DISPOSITION_LABEL[r.disposition], bold: true }, ` by ${r.by} on ${when(r.at)}.`, r.note ? ` ${r.note}` : ""], fontSize: 8 };
  };
  const finding = (f, i) => ({ unbreakable: true, margin: [0, 0, 0, 10], stack: [
    { columns: [{ width: 26, text: `F${i + 1}`, font: "Mono", fontSize: 8, color: MUTE, margin: [0, 1.5, 0, 0] },
      { width: "*", text: [{ text: `${f.severity.toUpperCase()}   `, color: SEV[f.severity], fontSize: 7, bold: true, characterSpacing: 0.8 }, { text: f.title, bold: true, fontSize: 9.5 }] }] },
    { margin: [26, 3, 0, 0], stack: [
      { text: [f.description, f.wells.length ? { text: `  Wells: ${f.wells.join(", ")}.`, color: MUTE } : ""] },
      { table: { widths: ["*"], body: [[{ text: f.evidence, font: "Mono", fontSize: 7.5, color: INK }]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => FILL, paddingLeft: () => 7, paddingRight: () => 7, paddingTop: () => 4, paddingBottom: () => 4 }, margin: [0, 4, 0, 4] },
      { text: [f.why, " ", { text: "Check next. ", bold: true }, f.next_check] },
      { columns: [decision(f), { width: "auto", text: `rule ${f.rule} v${f.rule_version}`, font: "Mono", fontSize: 6.5, color: MUTE, margin: [8, 1, 0, 0] }], margin: [0, 4, 0, 0] }] }] });

  const counts = [["High", sev.high, SEV.high], ["Medium", sev.medium, SEV.medium], ["Low", sev.low, SEV.low], ["Informational", sev.info, MUTE], ["Reviewed", `${s.reviewed} of ${s.total}`, INK], ["Open", s.open, s.open ? SEV.high : INK]];
  const metaCell = (k, v, mono) => ({ stack: [{ text: k.toUpperCase(), fontSize: 6.5, color: MUTE, characterSpacing: 0.8 }, { text: str(v), fontSize: 9, ...(mono ? { font: "Mono", fontSize: 8.5 } : {}), margin: [0, 2, 0, 0] }] });
  const srcSha = exp.source?.sha256 ? exp.source.sha256.slice(0, 12) : "";

  const content = [
    // ---- first page
    { columns: [{ text: "qPCR RUN REVIEW", fontSize: 7.5, color: MUTE, characterSpacing: 1.6 }, { text: [{ text: "Plate", bold: true }, { text: "Check", color: ACCENT, bold: true }], alignment: "right", fontSize: 10 }] },
    { text: exp.title || "Untitled run", style: "title", margin: [0, 14, 0, 12] },
    { columns: [metaCell("Run ID", exp.id, true), metaCell("Run date", exp.date), metaCell("Operator", exp.operator || "Not recorded"), metaCell("Report made", when(generatedAt))], columnGap: 12 },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.6, lineColor: RULE }], margin: [0, 14, 0, 12] },
    { table: { widths: [3, "*"], body: [[{ text: "", fillColor: STATUS[s.status] || MUTE }, { stack: [
      { text: [{ text: `${s.label}. `, bold: true, color: STATUS[s.status] || INK, fontSize: 11 },
        { text: main.length + info.length ? `${s.reviewed} of ${s.total} findings reviewed, ${s.open} still open.` : "Nothing was flagged by the checks that ran.", fontSize: 10 }] },
      { text: "These are things PlateCheck thought worth a second look. It doesn't certify the experiment or its conclusions, and anything listed under “Not checked” wasn't looked at.", style: "muted", margin: [0, 3, 0, 0] }] }]] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: i => (i ? 10 : 0), paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 } },
    { columns: counts.map(([k, v, c]) => ({ stack: [{ text: String(v ?? 0), fontSize: 15, color: v ? c : RULE, bold: !!v }, { text: k, fontSize: 7, color: MUTE }] })), margin: [0, 16, 0, 16] },
    res.rows.some(r => r.key) && { stack: [{ svg: plateSvg(res, exp), width: 360 },
      { text: [{ text: "Plate overview. ", bold: true }, "Shaded: well has a Ct (tan: no-template or no-RT control). Open: no Ct. Coloured ring: well is in a finding that is not reviewed yet (red high, orange medium, olive low). Dashed: no data."], style: "caption" }], margin: [0, 0, 0, 4] },

    { toc: { title: { text: "CONTENTS", fontSize: 6.5, color: MUTE, characterSpacing: 0.8, margin: [0, 14, 0, 4] }, textStyle: { fontSize: 8, lineHeight: 1 }, numberStyle: { color: MUTE, fontSize: 8, lineHeight: 1 }, textMargin: [0, 0, 0, 0] } },

    // ---- findings
    { ...heading("Findings", sec), pageBreak: "before" },
    main.length ? main.map(finding) : { text: "None.", margin: [0, 0, 0, 8] },
    orphan.length ? [{ text: "Earlier decisions on findings that no longer appear", style: "h3" }, { text: "For example after a plate-map correction.", style: "muted" },
      bullets(orphan.map(([, r]) => `${r.title || ""}: ${DISPOSITION_LABEL[r.disposition]} by ${r.by} on ${when(r.at)}${r.note ? `. ${r.note}` : ""}`))] : [],

    heading("Method details not provided", sec),
    missing.length ? bullets(missing.map(f => { const r = reviewOf(rv, f), d = r?.disposition && r.disposition !== "unreviewed";
      return { text: [f.title.replace(/^Not provided: /, ""), f.severity === "info" ? { text: " (optional)", color: MUTE } : "", d ? { text: `  ${DISPOSITION_LABEL[r.disposition].toLowerCase()}${r.note ? `: ${r.note}` : ""}`, color: MUTE } : ""] }; }))
      : { text: "Everything asked for was provided.", margin: [0, 0, 0, 8] },

    heading("What was checked", sec),
    bullets(res.checksRun),
    { text: "Not checked", style: "h3" },
    bullets(res.notAssessed.length ? res.notAssessed : ["Nothing; every check had the data it needed."]),
    info.length ? [{ text: "Other notes", style: "h3" }, bullets(info.map(f => ({ text: [f.description, " ", { text: f.evidence, color: MUTE }] })))] : [],

    heading("Experiment", sec),
    kv([["Title", exp.title], ["Project", exp.project], ["Operator", exp.operator], ["Run date", exp.date], ...CONTEXT_FIELDS.map(f => [f.label, exp.context?.[f.key]])]),
    htmlToPdf(targetsReportHtml(exp, res, { esc, table: (h, r) => `<table><thead><tr>${h.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${r.map(x => `<tr>${x.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` }), { section: null }),

    heading("Files", sec),
    files.map(([k, f]) => [{ text: `${k}: ${f.name}`, style: "h3" }, kv([["Imported", `${when(f.importedAt)} by ${f.importedBy}`], f.workbook && ["From workbook", `${f.workbook.name}, sheet “${f.workbook.sheet}”`],
      ["SHA-256 checksum", f.sha256, true], f.valueType && ["Melt values", f.valueType], f.plateSize && ["Plate layout", `${f.plateSize}-well`]])]),
    p ? kv([["Layout recognised", FORMATS[p.format]], ["Columns read", Object.entries(p.columns).map(([k, v]) => `${FIELD_LABEL[k] || k} from “${v}”`).join(", ")],
      p.unrecognized.length && ["Columns ignored", p.unrecognized.join(", ")], ["Rows read", String(p.rows.length)], p.malformed.length && ["Rows that couldn't be read", p.malformed.map(m => `line ${m.line}`).join(", ")],
      p.warnings.length && ["Notes from reading the file", p.warnings.join(" ")], ["Reader version", PARSER_VERSION]]) : { text: "No results file imported." },

    heading("Settings used", sec),
    { text: `${rs.profile.name}, version ${rs.profile.version}. ${RULES_REVIEW.status}.` + (() => { const ch = rulesetChanges(rs); return ch.length ? ` Changed for this experiment: ${sentence(ch.map(c => `${c.label[0].toLowerCase() + c.label.slice(1)} ${onoff(c.to)} (default ${onoff(c.from)})`))}.` : ""; })(), margin: [0, 0, 0, 6] },
    table(["Setting", "Value", "Basis"], RULESET_FIELDS.map(f => [f.label, onoff(rs.values[f.key]), [f.evidence, (f.refs || []).map(k => REFERENCES[k].short).join("; ")].filter(Boolean).join(" ")]), { widths: [150, 40, "*"], size: 7.5 }),
    Object.keys(exp.controlNA || {}).length ? [{ text: "Controls marked not applicable", style: "h3" }, bullets(Object.entries(exp.controlNA).map(([k, v]) => { const [role, t] = k.split("|"); return `${ROLE_LABEL[role]} for ${t}: ${v.reason} (${v.by})`; }))] : [],

    heading("Technical replicates", sec),
    table(["Biological unit", "Group", "Target", "Wells", "Ct/Cq as exported", "Mean", "SD"], res.replicateGroups.map(g => [g.unit, g.group, g.target, g.wells.join(", "), g.raw_ct.map(x => x ?? "(empty)").join(", "), num(g.mean), num(g.sd, 3)]), { widths: ["*", "auto", "auto", "auto", "auto", "auto", "auto"], mono: [4] }),
    { text: `Wells sharing a biological unit and target are technical repeats, not separate biological samples. Biological units per group: ${res.bioSummary.map(b => `${b.group || "no group"} / ${b.target}: ${b.units.length}`).join("; ") || "none"}.`, style: "muted" },

    htmlToPdf(analysisReportHtml(exp, res, esc), { section: sec }),
    (() => { if (!exp.analysis?.on) return []; const t = RG.summaryText(RG.forRun(res, exp.analysis).r); return t ? [{ text: "Reference gene stability", style: "h3" }, { text: t, margin: [0, 0, 0, 8] }] : []; })(),
    exp.assaySetup?.type ? htmlToPdf(assayReportHtml(exp, res.rows, esc, res.stdCurves), { section: sec }) : [],

    res.stdCurves.length ? [heading("Standard curves", sec),
      table(["Target", "Efficiency", "95% CI of efficiency", "R²", "Slope", "Intercept", "Levels"], res.stdCurves.map(c => { const d = Q.curveDetails(c);
        return [c.target, num(c.efficiency, 1) + "%", d?.effLow != null ? `${num(d.effLow, 1)}–${num(d.effHigh, 1)}%` : "—", num(c.r2, 4), num(c.slope, 3), num(c.intercept), c.levels]; })),
      (() => { const q = Q.quantify(res.rows, res.stdCurves); return q.units.length ? [{ text: "Absolute quantity of unknowns", style: "h3" },
        { text: "Read off each target's standard curve at the mean Ct of the replicate wells, in the standards' units, with a 95% prediction interval (Massart et al. 1997).", style: "muted", margin: [0, 0, 0, 4] },
        table(["Target", "Biological unit", "Wells", "Mean Ct", "Quantity", "95% prediction interval", "Note"], q.units.map(u => [u.target, u.unit, `${u.n}/${u.wells.length}`, num(u.meanCt), Q.fmtQ(u.q), u.qLow == null ? "—" : `${Q.fmtQ(u.qLow)} – ${Q.fmtQ(u.qHigh)}`, u.note]))] : []; })()] : [],

    // ---- appendices
    { ...heading("Plate map", sec), pageBreak: "before" },
    table(["Well", "Sample", "Target", "Group", "Role", "Biological unit", "Quantity", "Ct/Cq", "Changed from file"], res.rows.map(r => {
      const edited = Object.keys(exp.map?.[r.id] || {}).map(k => `${FIELD_LABEL[k] || k} was “${r.file[k] ?? ""}”`).join("; ");
      return [r.key || r.well, r.sample, r.target, r.group, ROLE_LABEL[r.role] + (r.roleSource.startsWith("inferred") ? " (from name)" : ""), r.bio_unit, r.quantity, r.ct ?? "(empty)", edited];
    }), { size: 7, mono: [7] }),

    heading("History", sec),
    table(["When", "Who", "What"], exp.audit.map(a => [when(a.at), a.actor, a.detail]), { widths: [78, 70, "*"], size: 7.5 }),

    heading("References", sec),
    { text: "Sources for the thresholds above and for the checks that raised a flag. The reasoning behind each number is in docs/thresholds.md in the PlateCheck repository.", style: "muted", margin: [0, 0, 0, 4] },
    { ol: referencesFor(res.findings).map(r => ({ text: [r.text, " ", { text: `doi:${r.doi}`, link: `https://doi.org/${r.doi}`, color: ACCENT }] })), fontSize: 7.5, margin: [0, 0, 0, 8] },

    heading("Limits of this report", sec),
    bullets(LIMITATIONS),
    exp.feedback ? { text: `Asked whether this review was useful: ${exp.feedback.value.toLowerCase()}.`, style: "muted" } : [],
    { text: [`Made with PlateCheck ${APP_VERSION} (build ${BUILD}), by ${CREDIT.name}, ${CREDIT.affiliation}. Questions: `, { text: CREDIT.email, link: `mailto:${CREDIT.email}`, color: ACCENT }, ".",
      CREDIT.guidance?.length ? ` With guidance from ${CREDIT.guidance.map(g => `${g.name}, ${g.affiliation}`).join("; ")}.` : ""], style: "muted", margin: [0, 18, 0, 0] },
  ].filter(x => x !== false && x !== null && x !== undefined);

  return {
    pageSize: "A4", pageMargins: [56, 64, 56, 56],
    info: { title: `${exp.title}: qPCR run review`, author: exp.operator || CREDIT.name, subject: "qPCR run review (PlateCheck)", creator: `PlateCheck ${APP_VERSION} (build ${BUILD})`, producer: "PlateCheck", keywords: `qPCR, ${exp.id}` },
    watermark: draft ? { text: "DRAFT · NOT REVIEWED", color: SEV.high, opacity: 0.06, bold: true, fontSize: 54, angle: -45 } : { text: "PlateCheck", color: ACCENT, opacity: 0.035, bold: true, fontSize: 96, angle: -45 },
    header: page => (page === 1 ? null : { margin: [56, 28, 56, 0], stack: [
      { columns: [{ text: exp.title || "", fontSize: 7.5, color: MUTE }, { text: [{ text: "qPCR run review · ", color: MUTE }, { text: exp.id, font: "Mono" }], fontSize: 7.5, alignment: "right" }] },
      { canvas: [{ type: "line", x1: 0, y1: 4, x2: 483, y2: 4, lineWidth: 0.4, lineColor: RULE }] }] }),
    footer: (page, pages) => ({ margin: [56, 18, 56, 0], columns: [
      { text: [`PlateCheck ${APP_VERSION} · build ${BUILD}`, srcSha ? ` · results file ${srcSha}` : "", draft ? { text: `  ·  draft: ${s.open} finding${s.open === 1 ? "" : "s"} not reviewed`, color: SEV.high } : ""], fontSize: 6.5, color: MUTE },
      { text: `Page ${page} of ${pages}`, fontSize: 6.5, color: MUTE, alignment: "right", width: 70 }] }),
    content,
    defaultStyle: { font: "Plex", fontSize: 8.5, lineHeight: 1.25, color: INK },
    styles: {
      title: { fontSize: 22, bold: true, lineHeight: 1.1 },
      h2: { fontSize: 12.5, bold: true, margin: [0, 6, 0, 0] },
      h3: { fontSize: 9.5, bold: true, margin: [0, 6, 0, 3] },
      th: { fontSize: 7, color: MUTE, bold: true, characterSpacing: 0.3 },
      muted: { color: MUTE, fontSize: 7.5 },
      caption: { color: MUTE, fontSize: 7, margin: [0, 4, 0, 0] },
    },
    pageBreakBefore: (node, after) => node.headlineLevel === 1 && after.length === 0, // a heading never ends a page
  };
}

// ---- browser: load pdfmake and the fonts once, then render
let lib = null;
const here = p => new URL(p, import.meta.url).href;
async function load() {
  if (lib) return lib;
  if (!globalThis.pdfMake) await new Promise((ok, fail) => { const s = document.createElement("script"); s.src = here("./vendor/pdfmake.min.js"); s.onload = ok; s.onerror = () => fail(new Error("Couldn't load the PDF library.")); document.head.append(s); });
  const pm = globalThis.pdfMake, F = "./fonts/pdf/";
  const files = { "Plex-Regular.woff": "IBMPlexSans-Regular.woff", "Plex-SemiBold.woff": "IBMPlexSans-SemiBold.woff", "Plex-Italic.woff": "IBMPlexSans-Italic.woff", "Plex-SemiBoldItalic.woff": "IBMPlexSans-SemiBoldItalic.woff", "PlexMono-Regular.woff": "IBMPlexMono-Regular.woff" };
  const vfs = {};
  await Promise.all(Object.entries(files).map(async ([k, f]) => { const r = await fetch(here(F + f)); if (!r.ok) throw new Error(`Couldn't load the font ${f}.`); const b = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); vfs[k] = btoa(s); }));
  pm.addVirtualFileSystem(vfs);
  pm.addFonts({ Plex: { normal: "Plex-Regular.woff", bold: "Plex-SemiBold.woff", italics: "Plex-Italic.woff", bolditalics: "Plex-SemiBoldItalic.woff" },
    Mono: { normal: "PlexMono-Regular.woff", bold: "PlexMono-Regular.woff", italics: "PlexMono-Regular.woff", bolditalics: "PlexMono-Regular.woff" } });
  return (lib = pm);
}
export async function reportPdf(exp, res) {
  const pm = await load();
  return pm.createPdf(reportPdfDoc(exp, res)).getBlob();
}
