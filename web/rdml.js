// RDML (Real-time PCR Data Markup Language; Lefever et al. 2009, Ruijter et al. 2015; https://rdml.org): import and
// export. An .rdml file is a zip holding rdml_data.xml. Import turns each run into the CSV-style results, amplification
// and melt texts PlateCheck already reads, in the same shape as an Excel workbook (excel.js readWorkbook), so the
// upload path, provenance and checks are the same. Export writes RDML 1.3 (validated with rdmlpython's schema check).
// Unzip / zip: the zip code in the bundled SheetJS library (works in every browser PlateCheck supports, and in Node).
import { detectFileKind, parseCurves, ctNum, APP_VERSION, BUILD } from "./core.js";
// Plain CSV for the texts handed to PlateCheck's own parser. Not core.toCsv: that one guards downloads against
// spreadsheet formulas and would change a sample called "-RT" into "'-RT".
const plainCsv = rows => rows.map(r => r.map(c => { const v = String(c ?? ""); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",")).join("\n") + "\n";

let lib = null;
const load = async () => (lib ||= await import("./vendor/xlsx.mjs"));

// ---- a small XML reader (elements, attributes, text, CDATA, comments; entities). RDML needs nothing more, and this
// works the same in browsers and in Node (which has no DOMParser).
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
export function parseXml(text) {
  const root = { name: "#root", attrs: {}, children: [], text: "" }, stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {}; for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unent(a[2] ?? a[3]);
      const el = { name: m[3].replace(/^.*:/, ""), attrs, children: [], text: "" };
      top.children.push(el); if (!m[5]) stack.push(el);
    } else if (m[6]) top.text += unent(m[6]);
  }
  return root.children[0] || null;
}
const kids = (el, name) => (el?.children || []).filter(c => c.name === name);
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name) => (kid(el, name)?.text ?? "").trim();

// RDML sample types → PlateCheck tasks. nac (no amplification control) and ntp (no target present) are negative
// controls like an NTC; opt (optical calibrator) is not a reaction to check and is left out.
const TYPE = { unkn: "Unknown", ntc: "NTC", nac: "NTC", ntp: "NTC", std: "Standard", pos: "Positive control", nrt: "No RT" };
const GROUP_PROPS = /^(group|condition|biological group|biological replicate|treatment|genotype)$/i;
const label = (fmt, n) => { // react id → well position, from pcrFormat (row and column labels "ABC", "123" or "A1a1")
  const cols = +fmt.columns || 12, i = n - 1, r = Math.floor(i / cols), c = (i % cols) + 1;
  const rl = fmt.rowLabel === "123" ? String(r + 1) : String.fromCharCode(65 + r), cl = fmt.columnLabel === "ABC" ? String.fromCharCode(65 + c - 1) : String(c);
  return rl + cl;
};

// Every run in an RDML document → { id, experiment, results, amp, melt, … } as texts.
export function rdmlRuns(xml) {
  const doc = parseXml(xml);
  if (!doc || doc.name !== "rdml") throw new Error("This file has no RDML document (rdml_data.xml with an <rdml> root).");
  const samples = {}, warnings = [];
  for (const s of kids(doc, "sample")) {
    const ann = Object.fromEntries(kids(s, "annotation").map(a => [txt(a, "property"), txt(a, "value")]));
    const group = Object.entries(ann).find(([p]) => GROUP_PROPS.test(p))?.[1] || "";
    const q = kid(s, "quantity");
    samples[s.attrs.id] = { type: txt(s, "type") || "unkn", quantity: q ? txt(q, "value") : "", unit: q ? txt(q, "unit") : "", group };
  }
  const targets = Object.fromEntries(kids(doc, "target").map(t => [t.attrs.id, { type: txt(t, "type") || "toi", eff: txt(t, "amplificationEfficiency") }]));
  const runs = [];
  for (const ex of kids(doc, "experiment")) for (const run of kids(ex, "run")) {
    const f = kid(run, "pcrFormat"), fmt = { rows: txt(f, "rows"), columns: txt(f, "columns"), rowLabel: txt(f, "rowLabel") || "ABC", columnLabel: txt(f, "columnLabel") || "123" };
    const res = [["Well", "Sample", "Target", "Task", "Quantity", "Cq", "Group", "Omit"]], amp = [["Well", "Target", "Cycle", "Fluorescence"]], melt = [["Well", "Target", "Temperature", "Fluorescence"]];
    let withCq = 0, n = 0, opt = 0, a = 0, mm = 0;
    for (const re of kids(run, "react")) {
      const well = label(fmt, +re.attrs.id), sid = kid(re, "sample")?.attrs.id ?? "", s = samples[sid] || { type: "unkn", quantity: "", group: "" };
      if (s.type === "opt") { opt++; continue; }
      for (const d of kids(re, "data")) {
        const tar = kid(d, "tar")?.attrs.id ?? "", cqRaw = txt(d, "cq"), cq = cqRaw === "" || +cqRaw < 0 ? "Undetermined" : cqRaw, excl = txt(d, "excl");
        n++; if (cqRaw !== "" && +cqRaw >= 0) withCq++;
        res.push([well, sid, tar, TYPE[s.type] || "Unknown", s.type === "std" ? s.quantity : "", cq, s.group, excl ? "TRUE" : ""]);
        for (const p of kids(d, "adp")) { amp.push([well, tar, txt(p, "cyc"), txt(p, "fluor")]); a++; }
        for (const p of kids(d, "mdp")) { melt.push([well, tar, txt(p, "tmp"), txt(p, "fluor")]); mm++; }
      }
    }
    const w = [];
    if (!withCq && n) w.push(`This run has ${a ? "amplification curves but " : ""}no Cq values, and PlateCheck's checks start from Cq values. Export the run with Cq values from your instrument software or from RDML-Tools (LinRegPCR), then load that file.`);
    else if (withCq < n) w.push(`${n - withCq} of ${n} reactions have no Cq in the RDML file (missing or −1); they are read as Undetermined.`);
    if (opt) w.push(`${opt} optical calibrator reaction(s) (sample type "opt") were left out.`);
    const refs = [...new Set(res.slice(1).map(r => r[2]))].filter(t => targets[t]?.type === "ref");
    runs.push({ id: run.attrs.id, experiment: ex.attrs.id, reactions: n, withCq, references: refs, warnings: [...w, ...warnings],
      results: plainCsv(res), amp: a ? plainCsv(amp) : null, melt: mm ? plainCsv(melt) : null, rows: +fmt.rows || 8, columns: +fmt.columns || 12 });
  }
  if (!runs.length) throw new Error("The RDML file has no experiment runs.");
  return { version: doc.attrs.version || "", runs };
}

// Reads a dropped .rdml file. Returns null when the bytes aren't an RDML zip. Same shape as excel.js readWorkbook:
// { best: { results, amp, melt }, all: [...] }, each item { name, text, kind, parsed, workbook: { name, sheet, sha256 } }.
export async function readRdml(name, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x50 || b[1] !== 0x4b) return null; // not a zip
  const X = await load();
  let xml;
  try { const z = X.CFB.read(b, { type: "array" }), e = z.FileIndex.find(f => /\.xml$/i.test(f.name) && f.content?.length); xml = e && new TextDecoder().decode(e.content); } catch { return null; }
  if (!xml || !/<rdml[\s>]/.test(xml.slice(0, 2000))) return null;
  const doc = rdmlRuns(xml), sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map(x => x.toString(16).padStart(2, "0")).join(""); // the .rdml file itself
  const all = [], best = {};
  for (const r of doc.runs) {
    const sheet = `${r.experiment} / ${r.id}`, wb = { name, sheet, sha256: sha, rdml: { version: doc.version, references: r.references, warnings: r.warnings } };
    for (const [kind, text] of [["results", r.results], ["amp", r.amp], ["melt", r.melt]]) {
      if (!text) continue;
      const k = detectFileKind(text), item = { ...k, kind: k.kind || kind, sheet, text, name: doc.runs.length > 1 ? `${name} [${sheet}]` : name, workbook: wb };
      if (kind === "melt" && item.parsed) item.parsed.guessedValueType = "fluorescence"; // RDML mdp is raw fluorescence
      all.push(item); if (!best[kind]) best[kind] = item;
    }
  }
  if (doc.runs.length > 1 && best.results) best.results.alternatives = all.filter(i => i.kind === "results" && i !== best.results).map(i => i.sheet);
  if (doc.runs.length > 1 && best.results) best.results.why = `This RDML file has ${doc.runs.length} runs (${doc.runs.map(r => `“${r.experiment} / ${r.id}”`).join(", ")}). I used the first; to check another, load it with Replace on the Upload page, or combine them as plates of a study.`;
  return { best, all, rdml: doc };
}

// ---- export: the run as RDML 1.3 (element order as in the RDML 1.3 schema).
const xmlEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const ROLE_TYPE = { sample: "unkn", ntc: "ntc", nrt: "nrt", positive: "pos", standard: "std" };
const idOk = s => String(s ?? "").trim() || "unnamed";
export function rdmlXml(exp, res, { now = new Date().toISOString().slice(0, 19) } = {}) {
  const rows = (res?.rows || []).filter(r => r.key && r.role !== "empty" && r.target);
  const big = rows.some(r => r.key.charCodeAt(0) > 72 || Number(r.key.slice(1)) > 12), R = big ? 16 : 8, Cn = big ? 24 : 12;
  const refs = new Set(exp.analysis?.refs || []);
  const samples = new Map(), targets = new Map();
  for (const r of rows) {
    const sid = idOk(r.sample || r.bio_unit || r.key);
    if (!samples.has(sid)) samples.set(sid, { type: ROLE_TYPE[r.role] || "unkn", quantity: r.role === "standard" ? r.quantity : null, group: r.group || "", unit: r.bio_unit || "" });
    if (!targets.has(r.target)) targets.set(r.target, refs.has(r.target) ? "ref" : "toi");
  }
  const eff = Object.fromEntries((res.stdCurves || []).filter(c => Number.isFinite(c.efficiency)).map(c => [c.target, 1 + c.efficiency / 100]));
  const amp = res.amp?.series || {}, melt = meltSeries(exp, Cn === 24 ? 384 : 96);
  const byWell = new Map(); for (const r of rows) (byWell.get(r.key) || byWell.set(r.key, []).get(r.key)).push(r);
  const pos = k => (k.charCodeAt(0) - 65) * Cn + Number(k.slice(1));
  const L = [`<?xml version="1.0" encoding="UTF-8"?>`, `<rdml xmlns="http://www.rdml.org" version="1.3">`, `<dateMade>${now}</dateMade>`, `<dateUpdated>${now}</dateUpdated>`,
    `<dye id="dye"/>`];
  for (const [id, s] of samples) L.push(`<sample id="${xmlEsc(id)}">` + (s.group ? `<annotation><property>Group</property><value>${xmlEsc(s.group)}</value></annotation>` : "") +
    (s.unit && s.unit !== id ? `<annotation><property>Biological unit</property><value>${xmlEsc(s.unit)}</value></annotation>` : "") +
    `<type>${s.type}</type>` + (s.quantity != null && s.quantity !== "" && Number.isFinite(Number(String(s.quantity).replace(/,/g, ""))) ? `<quantity><value>${Number(String(s.quantity).replace(/,/g, ""))}</value><unit>other</unit></quantity>` : "") + `</sample>`);
  for (const [id, type] of targets) L.push(`<target id="${xmlEsc(id)}"><type>${type}</type>` + (eff[id] ? `<amplificationEfficiencyMethod>standard curve (PlateCheck)</amplificationEfficiencyMethod><amplificationEfficiency>${eff[id].toFixed(4)}</amplificationEfficiency>` : "") + `<dyeId id="dye"/></target>`);
  L.push(`<experiment id="${xmlEsc(idOk(exp.title || exp.id))}"><description>Exported by PlateCheck ${xmlEsc(APP_VERSION)} (build ${xmlEsc(BUILD)}) from ${xmlEsc(exp.source?.name || "")}${exp.melt && exp.melt.valueType !== "fluorescence" ? "; melt curves were derivative values, which RDML does not hold, so they are not included" : ""}</description>`,
    `<run id="${xmlEsc(idOk(exp.source?.name || exp.id))}">` + (exp.context?.instrument ? `<instrument>${xmlEsc(exp.context.instrument)}</instrument>` : "") +
    `<pcrFormat><rows>${R}</rows><columns>${Cn}</columns><rowLabel>ABC</rowLabel><columnLabel>123</columnLabel></pcrFormat>` + (exp.date ? `<runDate>${xmlEsc(exp.date)}T00:00:00</runDate>` : ""));
  for (const k of [...byWell.keys()].sort((a, b) => pos(a) - pos(b))) {
    const rs = byWell.get(k), sid = idOk(rs[0].sample || rs[0].bio_unit || k);
    L.push(`<react id="${pos(k)}"><sample id="${xmlEsc(sid)}"/>`);
    // RDML allows one result per target in a well: a second one (a duplicated well) isn't written; rdmlNotes says so.
    for (const r of rs.filter((x, i) => rs.findIndex(y => y.target === x.target) === i)) {
      const c = ctNum(r.ct, r.dc), a = amp[`${k}|${r.target}`] || (Object.keys(amp).filter(x => x.startsWith(k + "|")).length === 1 && rs.length === 1 ? amp[Object.keys(amp).find(x => x.startsWith(k + "|"))] : null);
      const mm = melt[`${k}|${r.target}`] || melt[`${k}|`] || null;
      L.push(`<data><tar id="${xmlEsc(r.target)}"/>` + (c !== null ? `<cq>${c}</cq>` : "") + (r.omit ? `<excl>excluded in the instrument export</excl>` : "") +
        (a ? a.map(([x, y]) => `<adp><cyc>${x}</cyc><fluor>${y}</fluor></adp>`).join("") : "") + (mm ? mm.map(([x, y]) => `<mdp><tmp>${x}</tmp><fluor>${y}</fluor></mdp>`).join("") : "") + `</data>`);
    }
    L.push(`</react>`);
  }
  L.push(`</run></experiment></rdml>`);
  return L.join("\n");
}
// Raw melt curves of the run, keyed like the amplification series. RDML's mdp holds fluorescence, so a melt file of
// derivative values isn't written (the export's description says so).
function meltSeries(exp, plateSize) {
  if (!exp.melt?.text || exp.melt.valueType !== "fluorescence") return {};
  try { return parseCurves(exp.melt.text, "melt", { plateSize }).series; } catch { return {}; }
}
export async function rdmlZip(exp, res) {
  const X = await load(), z = X.CFB.utils.cfb_new();
  X.CFB.utils.cfb_add(z, "rdml_data.xml", new TextEncoder().encode(rdmlXml(exp, res)));
  return X.CFB.write(z, { fileType: "zip", type: "array", compression: true });
}

// What the RDML file can't carry from this run, for a note next to the download (RDML needs a plate position and a
// sample for every reaction, and holds numeric Cq and raw melt fluorescence only).
export function rdmlNotes(exp, res) {
  const rows = res?.rows || [], notes = [];
  const noPos = rows.filter(r => !r.key && r.role !== "empty");
  if (noPos.length) notes.push(`${noPos.length} well(s) without a valid plate position were left out (${noPos.slice(0, 5).map(r => r.well || "?").join(", ")}).`);
  const kept = rows.filter(r => r.key && r.role !== "empty" && r.target);
  const noTarget = rows.filter(r => r.key && r.role !== "empty" && !r.target);
  if (noTarget.length) notes.push(`${noTarget.length} well(s) without a target were left out (${noTarget.slice(0, 5).map(r => r.key).join(", ")}).`);
  const noSample = kept.filter(r => !r.sample && !r.bio_unit);
  if (noSample.length) notes.push(`${noSample.length} reaction(s) had no sample name; RDML needs one, so the well name was used (${noSample.slice(0, 5).map(r => r.key).join(", ")}).`);
  const text = kept.filter(r => ctNum(r.ct, r.dc) === null && r.ct != null && String(r.ct).trim() !== "" && !/^(undetermined|undet|n\/?a|nan|no ?c[tq]|-|none|no amp)$/i.test(String(r.ct).trim()));
  if (text.length) notes.push(`${text.length} Cq value(s) that weren't numbers were left out (${text.slice(0, 5).map(r => `${r.key} “${r.ct}”`).join(", ")}); RDML holds numeric Cq only.`);
  const seen = new Set(), dup = kept.filter(r => { const k = `${r.key}|${r.target}`; if (seen.has(k)) return true; seen.add(k); return false; });
  if (dup.length) notes.push(`${dup.length} duplicate result(s) for the same target in one well were left out (${dup.slice(0, 5).map(r => `${r.key} ${r.target}, line ${r.line}`).join("; ")}); RDML holds one result per target per well, so the first was written.`);
  if (exp.melt && exp.melt.valueType !== "fluorescence") notes.push("The melt curves are derivative values; RDML holds raw melt fluorescence, so they weren't included.");
  return notes;
}
