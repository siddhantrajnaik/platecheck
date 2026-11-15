// RDML import and export (web/rdml.js). Reference: an independent lxml reading of the same files
// (testdata/published/rdml/lxml_reading.py). The exports were validated against the RDML 1.3 schema with rdmlpython
// 1.7.2 (platecheck-qa/papers/rdml); here the round trip back into PlateCheck is checked.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import * as R from "../web/rdml.js";
import * as C from "../web/core.js";
import * as D from "../web/demo.js";

const P = n => new URL(`../testdata/published/rdml/${n}`, import.meta.url), PUB = n => new URL(`../testdata/public/rdml-tools/${n}`, import.meta.url);
const ref = JSON.parse(readFileSync(P("lxml_reading.json"), "utf8"));
const files = [...readdirSync(P("")).filter(f => f.endsWith(".rdml")).map(f => [f, P(f)]),
  ...(existsSync(PUB("")) ? readdirSync(PUB("")).filter(f => f.endsWith(".rdml") && ref[f]).map(f => [f, PUB(f)]) : [])];
const exp = (name, b) => { const e = C.newExperiment({ title: name }, "qa"); e.source = C.fileRecord({ name: b.best.results.name, text: b.best.results.text, sha: "x", actor: "qa" });
  if (b.best.amp) e.amp = C.fileRecord({ name: "amp", text: b.best.amp.text, sha: "x", actor: "qa" });
  if (b.best.melt) e.melt = C.fileRecord({ name: "melt", text: b.best.melt.text, sha: "x", actor: "qa", valueType: "fluorescence" }); return e; };

test("XML reader: attributes, entities, CDATA, comments, namespaces, self-closing", () => {
  const x = R.parseXml(`<?xml version="1.0"?><!-- c --><r:rdml xmlns:r="x" version='1.3'><sample id="a &amp; b"><type>unkn</type></sample><t><![CDATA[<raw> & ok]]></t><e/><n>&#65;&#x42;&lt;</n></r:rdml>`);
  assert.equal(x.name, "rdml"); assert.equal(x.attrs.version, "1.3");
  assert.equal(x.children[0].attrs.id, "a & b"); assert.equal(x.children[1].text, "<raw> & ok"); assert.equal(x.children[2].children.length, 0); assert.equal(x.children[3].text, "AB<");
});
test("every reaction of the example RDML files reads as lxml reads it (well, sample, target, Cq, curve points)", async () => {
  let n = 0;
  for (const [f, url] of files) {
    const b = await R.readRdml(f, readFileSync(url)), run = b.rdml.runs[0];
    const rows = C.parseResults(run.results).rows, amp = run.amp ? C.parseCurves(run.amp, "amp").series : {}, melt = run.melt ? C.parseCurves(run.melt, "melt").series : {};
    assert.equal(rows.length, ref[f].length, f);
    ref[f].forEach(([well, s, t, cq, na, nm], i) => { const r = rows[i], c = C.ctNum(r.ct); n++;
      assert.deepEqual([r.key, r.sample, r.target], [well, s, t], `${f} #${i}`);
      assert.ok(cq === null ? c === null : Math.abs(c - cq) < 1e-9, `${f} ${well} cq`);
      assert.equal(amp[`${well}|${t}`]?.length || 0, na, `${f} ${well} adp`); assert.equal(melt[`${well}|${t}`]?.length || 0, nm, `${f} ${well} mdp`); });
  }
  assert.ok(n >= 418, `${n} reactions`); // 418 in the committed files; 1778 with the downloaded rdml-tools files
});
test("sample types, standards, groups from annotations, exclusions and Cq −1 are mapped", async () => {
  const q = await R.readRdml("q.rdml", readFileSync(P("py_quantification_methods.rdml")));
  const e = exp("q", q), res = C.analyze(e);
  assert.ok(res.rows.every(r => r.role === "standard")); assert.equal(res.stdCurves.length, 20);
  if (existsSync(PUB("tools_absolute.rdml"))) {
    const a = await R.readRdml("a.rdml", readFileSync(PUB("tools_absolute.rdml"))), ra = C.analyze(exp("a", a)).rows;
    assert.ok(ra.some(r => r.role === "ntc") && ra.some(r => r.role === "standard" && r.quantity === "18750"));
    assert.equal(ra.filter(r => r.ct === "Undetermined").length, 12); // cq −1 in the file
    const rel = await R.readRdml("r.rdml", readFileSync(PUB("tools_relative.rdml")));
    assert.deepEqual([...new Set(C.analyze(exp("r", rel)).rows.map(r => r.group))].sort(), ["Adult", "Embryo"]); // annotation "Biological Replicate"
    assert.equal(rel.rdml.runs[0].references.length, 2); // two targets of type "ref" in the file
    const s = await R.readRdml("s.rdml", readFileSync(PUB("tools_sample.rdml")));
    assert.equal(C.analyze(exp("s", s)).rows.filter(r => r.omit).length, 9); // <excl>
    const two = await R.readRdml("t.rdml", readFileSync(PUB("tools_two_plate_correction.rdml")));
    assert.equal(two.rdml.runs.length, 2); assert.match(two.best.results.why, /2 runs/); assert.equal(two.best.results.alternatives.length, 1);
  }
  const raw = await R.readRdml("m.rdml", readFileSync(P("py_matrix_gaps.rdml")));
  assert.match(raw.rdml.runs[0].warnings[0], /no Cq values/);
  assert.equal(await R.readRdml("x.rdml", new TextEncoder().encode("Well,Ct\nA1,20\n")), null); // not a zip
});
test("export → import gives the same wells, samples, targets, Cq, roles and curves", async () => {
  for (const f of ["py_quantification_methods.rdml", "py_own_mix_a.rdml"]) {
    const e = exp(f, await R.readRdml(f, readFileSync(P(f)))), res = C.analyze(e);
    const back = await R.readRdml("o.rdml", await R.rdmlZip(e, res)), res2 = C.analyze(exp("o", back));
    const key = r => [r.key, r.sample, r.target, C.ctNum(r.ct), r.role, r.omit].join("|");
    assert.deepEqual(res2.rows.map(key).sort(), res.rows.filter(r => r.key && r.target).map(key).sort(), f);
    assert.equal(Object.keys(res2.amp?.series || {}).length, Object.keys(res.amp?.series || {}).length);
    assert.equal(Object.keys(res2.melt?.stats || {}).length, Object.keys(res.melt?.stats || {}).length);
    assert.deepEqual(R.rdmlNotes(e, res), []);
  }
});
test("export of the demo run: valid structure, and the notes say what RDML can't hold", async () => {
  const d = D.demoFiles(), e = C.newExperiment({ title: "Demo <run>" }, "qa");
  e.source = C.fileRecord({ name: "demo.csv", text: d.results, sha: "x", actor: "qa" }); e.melt = C.fileRecord({ name: "m", text: d.melt, sha: "z", actor: "qa", valueType: "derivative" });
  const res = C.analyze(e), xml = R.rdmlXml(e, res), doc = R.parseXml(xml);
  assert.equal(doc.name, "rdml"); assert.equal(doc.attrs.version, "1.3");
  assert.match(xml, /<experiment id="Demo &lt;run&gt;">/);
  const reacts = doc.children.find(c => c.name === "experiment").children.find(c => c.name === "run").children.filter(c => c.name === "react");
  for (const r of reacts) { const tars = r.children.filter(c => c.name === "data").map(c => c.children[0].attrs.id); assert.equal(new Set(tars).size, tars.length, "one result per target per well"); }
  const notes = R.rdmlNotes(e, res).join(" ");
  for (const re of [/Z9/, /no sample name/, /C6 “abc”/, /duplicate result/, /derivative/]) assert.match(notes, re);
});
