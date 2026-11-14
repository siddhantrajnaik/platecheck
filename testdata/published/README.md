# Published qPCR data used by tests/published.test.mjs

| File | Source | Paper |
|---|---|---|
| `lee2020_raw_qpcr.csv` | Figshare, doi:10.6084/m9.figshare.12136944 (authors' raw Ct and computed values) | Lee et al. 2020, F1000Research, doi:10.12688/f1000research.23580.2 |
| `data_Heffer2020PlosOne.csv` | as shipped in the rtpcr R package (inst/extdata); original deposit on Figshare | Heffer et al. 2020, PLOS ONE, doi:10.1371/journal.pone.0243626 |

Files are copied unchanged. They are used only to compare PlateCheck's numbers with the authors' and with SciPy.
| `pcr_ct3.csv` | pcr R package inst/extdata/ct3.csv (c-myc and GAPDH dilution series, 1 to 0.01 ng, 3 replicates; regenerated from Livak & Schmittgen's Table 1 means, so means differ from the paper by up to 0.1 cycle) | Ahmed & Kim 2018, PeerJ, doi:10.7717/peerj.4473 |
| `data_2factorBlock.csv` | rtpcr R package inst/extdata (PO vs GAPDH, Type x Concentration) | used only for the R two-way ANOVA comparison |
| `plos/pone0339560_*.csv` | converted (platecheck-qa/papers/figshare/prep.py) from PLOS ONE S8 Table, doi:10.1371/journal.pone.0339560.s008, CC BY 4.0 | Cell death-related gene signatures in S. aureus pneumonia, PLOS ONE 2026, doi:10.1371/journal.pone.0339560 |
| `plos/pone0353259_*.csv` | converted from PLOS ONE S5 Table, doi:10.1371/journal.pone.0353259.s005, CC BY 4.0 | Shuangyu Granule in influenza, PLOS ONE 2026, doi:10.1371/journal.pone.0353259 |
| `plos/authors.json` | the authors' own ΔCt / ΔΔCt / fold columns from those two tables | |
| `plos/scipy_ref.json` | SciPy 1.18.1 Student t-test and Tukey HSD on the same per-unit ΔCt | |
| `plos/pgen.1011296.s023.xlsx` | PLOS Genetics S23 Table, doi:10.1371/journal.pgen.1011296.s023, CC BY 4.0, unchanged (LightCycler and SDS exports) | PLOS Genetics 2024, doi:10.1371/journal.pgen.1011296 |
| `sds/2024040{7,8}_*` | ABI 7500 Fast SDS v1.3 exports (`_ct.csv`, `_res.csv`, `_melt.csv`), Figshare 28152689, doi:10.17045/sthlmuni.28152689.v1, CC BY 4.0 | mtDNA copy number in ALS motor neurons, Nature Communications 2025, doi:10.1038/s41467-025-59679-1 |
| `cfx/*.xlsx` | Bio-Rad CFX workbook exports of one run (Cq, amplification, melt derivative, melt peaks), Figshare 34873065, doi:10.6084/m9.figshare.34873065.v2, CC BY 4.0 | |
| `lc480/cts_named.txt` | Roche LightCycler 480 384-well output, Figshare 12221069, doi:10.6084/m9.figshare.12221069.v1, CC BY 4.0 | Spiroplasma / D. hydei quantification |
| (fetched) `public/figshare__30833918/Greenland_Tb_qPCR results.xlsx` | QuantStudio workbook, Figshare 30833918, doi:10.6084/m9.figshare.30833918.v1, CC BY 4.0; downloaded by `testdata/fetch-public.mjs` (2.9 MB) | Lauringson et al. 2026, T. bryosalmonae in Greenland salmonids |
