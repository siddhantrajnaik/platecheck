# Published qPCR data used by tests/published.test.mjs

| File | Source | Paper |
|---|---|---|
| `lee2020_raw_qpcr.csv` | Figshare, doi:10.6084/m9.figshare.12136944 (authors' raw Ct and computed values) | Lee et al. 2020, F1000Research, doi:10.12688/f1000research.23580.2 |
| `data_Heffer2020PlosOne.csv` | as shipped in the rtpcr R package (inst/extdata); original deposit on Figshare | Heffer et al. 2020, PLOS ONE, doi:10.1371/journal.pone.0243626 |

Files are copied unchanged. They are used only to compare PlateCheck's numbers with the authors' and with SciPy.
| `pcr_ct3.csv` | pcr R package inst/extdata/ct3.csv (c-myc and GAPDH dilution series, 1 to 0.01 ng, 3 replicates; regenerated from Livak & Schmittgen's Table 1 means, so means differ from the paper by up to 0.1 cycle) | Ahmed & Kim 2018, PeerJ, doi:10.7717/peerj.4473 |
| `data_2factorBlock.csv` | rtpcr R package inst/extdata (PO vs GAPDH, Type x Concentration) | used only for the R two-way ANOVA comparison |
