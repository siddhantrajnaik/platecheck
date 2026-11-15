// MIQE 2.0 checklist (web/miqe.js): 53 items in five sections (Bustin et al. 2025, Table 1), suggestions from the run,
// the user's answers on top, saved with the run, exported as CSV and as a document.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as M from "../web/miqe.js";
import { analyzeRun } from "../web/analysis.js";
import { esc } from "../web/report.js";

function run() {
  const q = [1e6, 1e5, 1e4, 1e3, 1e2].flatMap(x => [x, x, x]), stdCt = [15.02, 15.10, 14.95, 18.41, 18.33, 18.50, 21.80, 21.72, 21.95, 25.20, 25.31, 25.12, 28.70, 28.55, 28.90];
  const L = ["Well,Sample,Target,Task,Quantity,Ct,Group"]; let w = 0; const well = () => { const k = w++; return `${"ABCDEFGH"[Math.floor(k / 12)]}${k % 12 + 1}`; };
  stdCt.forEach((ct, i) => L.push(`${well()},std,GENE,STANDARD,${q[i]},${ct},`));
  for (const [s, g, gene, ref] of [["c1", "ctrl", 22.0, 18.0], ["c2", "ctrl", 22.2, 18.1], ["k1", "kd", 24.0, 18.0], ["k2", "kd", 24.3, 18.2]])
    for (let r = 0; r < 2; r++) { L.push(`${well()},${s},GENE,UNKNOWN,,${gene + r * 0.1},${g}`); L.push(`${well()},${s},ACTB,UNKNOWN,,${ref + r * 0.1},${g}`); }
  L.push(`${well()},NTC,GENE,NTC,,Undetermined,`, `${well()},NTC,ACTB,NTC,,36.2,`);
  const e = C.newExperiment({ title: "miqe <test>" }, "qa"); e.source = C.fileRecord({ name: "m.csv", text: L.join("\n") + "\n", sha: "x", actor: "qa" });
  e.context = { instrument: "QuantStudio 5, Design & Analysis 2.6" };
  e.analysis = C.cleanAnalysisSettings({ on: true, refs: ["ACTB"], control: "ctrl", test: "welch" });
  const res = C.analyze(e); return { e, res, a: analyzeRun(e, res) };
}

test("53 items in the five MIQE 2.0 sections", () => {
  const { e, res } = run(), rows = M.checklist(e, res);
  assert.equal(rows.length, 53); assert.equal(M.ITEM_COUNT, 53);
  assert.deepEqual(M.SECTIONS.map(s => rows.filter(r => r.section === s).length), [8, 13, 7, 6, 19]);
});
test("items PlateCheck can see in the run are suggested; the rest are left open", () => {
  const { e, res, a } = run(), rows = M.checklist(e, res, a), by = id => rows.find(r => r.id === id);
  assert.equal(by("4.6").provided, "yes"); assert.match(by("4.6").text, /QuantStudio 5/);
  assert.equal(by("5.4").provided, "yes"); assert.match(by("5.4").text, /PlateCheck/);
  assert.equal(by("5.8").provided, "yes"); assert.match(by("5.8").text, /GENE: 96\.1% \(95% CI 94\.5–97\.8%\)/);
  assert.equal(by("5.14").provided, "yes"); assert.match(by("5.14").text, /100 to 1e\+6|100 to 1000000|100 to 1\.00e\+6/);
  assert.equal(by("5.6").provided, "yes"); assert.match(by("5.6").text, /1 of 1 wells amplified.*Ct 36\.2/);
  assert.equal(by("5.10").provided, "yes"); assert.match(by("5.10").text, /4 biological unit\(s\) in 2 group\(s\); 2 technical/);
  assert.equal(by("5.16").provided, "yes"); assert.match(by("5.16").text, /ACTB/);
  assert.equal(by("5.9").provided, "yes"); assert.match(by("5.9").text, /Absolute quantities/);
  assert.equal(by("5.15").provided, ""); assert.match(by("5.15").text, /geNorm/);   // a starting point, not a Yes
  for (const id of ["2.1", "3.1", "1.5"]) assert.equal(by(id).provided, "");      // nothing in the run says these
});
test("the user's answers win, survive saving, and appear in the exports (escaped)", () => {
  const { e, res, a } = run();
  e.miqe = { "2.1": { provided: "yes", text: "Liver, n = 4 <mice>" }, "4.6": { provided: "no", text: "" }, "9.9": { provided: "yes" }, "5.1": { provided: "maybe" } };
  const back = C.normalizeExperiment(JSON.parse(JSON.stringify(e)));
  assert.deepEqual(back.miqe, { "2.1": { provided: "yes", text: "Liver, n = 4 <mice>" }, "4.6": { provided: "no" } }); // bad IDs and answers dropped
  const rows = M.checklist(back, res, a), by = id => rows.find(r => r.id === id);
  assert.equal(by("2.1").provided, "yes"); assert.equal(by("2.1").edited, true);
  assert.equal(by("4.6").provided, "no"); assert.match(by("4.6").text, /QuantStudio/); // empty text keeps the suggestion
  const doc = M.miqeDoc(back, rows, esc), csv = M.miqeCsv(rows);
  assert.match(doc, /Liver, n = 4 &lt;mice&gt;/); assert.ok(!/<mice>/.test(doc)); assert.match(doc, /miqe &lt;test&gt;/);
  assert.match(csv, /^item,section,item_label_platecheck,provided,description_or_justification,source/); assert.match(csv, /2\.1,Sample preparation,.*,Yes,"Liver, n = 4 <mice>",you/);
  assert.equal(M.summary(rows).total, 53);
});
