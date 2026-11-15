// The PDF report's document definition (web/report-pdf.js). Rendering itself is pdfmake's; the pages were checked by eye
// (platecheck-qa/pdf/render.mjs). Here: content, draft watermark, plate figure, contents list, and the HTML converter.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as D from "../web/demo.js";
import { reportPdfDoc, htmlToPdf } from "../web/report-pdf.js";

const run = () => {
  const d = D.demoFiles(), e = C.newExperiment({ title: "Demo <run>", operator: "A. B." }, "qa");
  e.source = C.fileRecord({ name: "demo.csv", text: d.results, sha: "abcdef0123456789", actor: "qa" });
  e.melt = C.fileRecord({ name: "m", text: d.melt, sha: "z", actor: "qa", valueType: "derivative" });
  return { e, res: C.analyze(e) };
};
const texts = node => { const out = []; const walk = n => { if (n == null) return; if (typeof n === "string") out.push(n); else if (Array.isArray(n)) n.forEach(walk); else if (typeof n === "object") for (const [k, v] of Object.entries(n)) if (k !== "svg") walk(v); }; walk(node); return out.join(" "); };

test("open findings make it a draft on every page; once all are reviewed the watermark is the plain mark", () => {
  const { e, res } = run(), doc = reportPdfDoc(e, res, { generatedAt: "2026-11-15T10:00:00Z" });
  assert.ok(res.summary.open > 0);
  assert.equal(doc.watermark.text, "DRAFT · NOT REVIEWED");
  assert.match(texts(doc.footer(1, 9)), new RegExp(`draft: ${res.summary.open} findings not reviewed`));
  for (const f of res.findings) e.reviews[f.id] = { disposition: "accepted", by: "qa", at: "2026-11-15T10:00:00Z", title: f.title, description: f.description, evidenceKey: f.evidence };
  const res2 = C.analyze(e), doc2 = reportPdfDoc(e, res2);
  assert.equal(res2.summary.open, 0); assert.equal(doc2.watermark.text, "PlateCheck");
  assert.doesNotMatch(texts(doc2.footer(1, 9)), /draft/);
});

test("same content as the HTML report: every finding, its evidence, the sections, the plate map and the run identity", () => {
  const { e, res } = run(), doc = reportPdfDoc(e, res), all = texts(doc.content);
  for (const f of res.findings.filter(f => f.category !== "missing_context" && f.severity !== "info")) { assert.ok(all.includes(f.title), f.title); assert.ok(all.includes(f.evidence), f.evidence); }
  for (const h of ["Findings", "What was checked", "Experiment", "Files", "Settings used", "Technical replicates", "Plate map", "History", "References", "Limits of this report"]) assert.ok(all.includes(h), h);
  assert.ok(all.includes("Demo <run>") && all.includes(e.id) && all.includes("abcdef0123456789"));
  assert.equal(doc.info.title, "Demo <run>: qPCR run review"); assert.equal(doc.pageSize, "A4");
  assert.equal(doc.header(1), null); assert.match(texts(doc.header(2)), new RegExp(e.id));
  assert.equal(texts(doc.footer(3, 7)).includes("Page 3 of 7"), true);
  assert.ok(doc.content.some(n => n.toc), "contents list");
});

test("plate figure: one circle per position, rings only on wells in open findings", () => {
  const { e, res } = run(), doc = reportPdfDoc(e, res);
  const svg = JSON.stringify(doc.content).match(/"svg":"(.*?)","width"/)[1];
  assert.equal((svg.match(/<circle/g) || []).length, 96);
  assert.ok(/stroke=\\"#b42318\\"/.test(svg), "a red ring for a high-severity open finding");
});

test("HTML sections from other modules convert to headings, paragraphs, lists and tables", () => {
  let n = 0;
  const out = htmlToPdf(`<h2>Analysis</h2><p>ΔCt &amp; fold <b>change</b> &lt;2&gt;</p><ul><li>one</li><li>two &#916;</li></ul><table><thead><tr><th>Gene</th><th>FC</th></tr></thead><tbody><tr><td>A</td><td>2.0</td></tr></tbody></table><h3>Sub</h3>`, { section: { next: () => ++n } });
  assert.equal(n, 1);
  const s = JSON.stringify(out);
  assert.match(s, /Analysis/); assert.match(s, /ΔCt & fold /); assert.match(s, /"bold":true/); assert.match(s, /<2>/);
  assert.deepEqual(out.find(x => x.ul).ul.map(li => li.text.map(t => t.text).join("")), ["one", "two Δ"]);
  const t = out.find(x => x.table).table.body; assert.deepEqual(t.map(r => r.map(c => c.text)), [["Gene", "FC"], ["A", "2.0"]]);
  assert.equal(out.at(-1).text, "Sub");
});
