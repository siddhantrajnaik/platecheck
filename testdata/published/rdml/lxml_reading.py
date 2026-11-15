# Independent reading of each RDML file (lxml, not PlateCheck): well, sample, target, Cq, number of adp/mdp points per reaction.
import sys, zipfile, json, glob, os
from lxml import etree
ns = {"r": "http://www.rdml.org"}
out = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.rdml"))):
    x = etree.fromstring(zipfile.ZipFile(f).read("rdml_data.xml"))
    run = x.find(".//r:run", ns); cols = int(run.findtext("r:pcrFormat/r:columns", namespaces=ns))
    rows = []
    for re_ in run.findall("r:react", ns):
        i = int(re_.get("id")) - 1; well = chr(65 + i // cols) + str(i % cols + 1); s = re_.find("r:sample", ns).get("id")
        for d in re_.findall("r:data", ns):
            cq = d.findtext("r:cq", namespaces=ns)
            rows.append([well, s, d.find("r:tar", ns).get("id"), None if cq is None or float(cq) < 0 else float(cq), len(d.findall("r:adp", ns)), len(d.findall("r:mdp", ns))])
    out[os.path.basename(f)] = rows
json.dump(out, open("indep.json", "w"))
print(sum(len(v) for v in out.values()), "reactions")
