# MIQE 2.0 checklist

The Report step has a **MIQE 2.0 checklist** card: the 53 items of the checklist in the MIQE 2.0 guidelines (Bustin et al. 2025, Table 1), in their five sections (reagent preparation 8, sample preparation 13, reverse transcription 7, qPCR protocol 6, data analysis 19). Each item is answered Yes / No / Not applicable with a description: where the information is in the paper, or why it's missing. Code: `web/miqe.js`.

## What PlateCheck fills in

Only what the run itself shows. An item is pre-answered **Yes** when the run contains the information, and gets a **starting point** (answer left open) when the run says something relevant but not everything the item asks for.

| Item | Filled in from | Answer |
|---|---|---|
| 1.2 Gene symbol, species, accession | the gene lookup (Targets panel): symbol, species, HGNC/MGI, Entrez, Ensembl | Yes |
| 1.3–1.5 Amplicon, length, sequences | the "Assay / primer details" you recorded | starting point |
| 3.5 Copies with and without RT | the no-RT control wells and whether they amplified | starting point |
| 3.6, 4.4 Reagent lots | the "Reagent and primer lot numbers" you recorded | starting point |
| 4.5, 5.3 Cycling, baseline / Cq method | the "Run settings" you recorded | starting point |
| 4.6 Instrument | "Instrument and software version", or the instrument named in the file | Yes |
| 5.1 Raw fluorescence data | which curve files were imported; they can be shared as RDML (Report → Other formats) | starting point |
| 5.2 Standards | the standard curves on the plate (identity of the standards is yours to add) | starting point |
| 5.4 Analysis software | the instrument software and the PlateCheck version and build | Yes |
| 5.5, 5.6 Controls | NTC, positive and no-RT wells per target, how many amplified and at which Cq | Yes |
| 5.8 Efficiency | each standard curve: efficiency with its 95% CI, slope, R² | Yes |
| 5.9 Quantity calculation | absolute quantities from the curves; the Analysis method (Pfaffl or 2^−ΔΔCq) | Yes when efficiency-corrected |
| 5.10, 5.11 Replicates, repeatability | biological units and groups, technical wells per unit, technical SD (median, largest) | Yes |
| 5.14 Dynamic range | the standards' range | Yes |
| 5.15 Reference validation | the Analysis step's check that references don't shift between groups | starting point |
| 5.16, 5.17 Normalisation, statistics | the Analysis step's methods text | Yes |
| 5.18 Significance and power | α = 0.05, power not calculated | starting point |
| 5.19 Specificity | melt-curve checks, if melt data were imported | starting point |

Everything else (sample handling, extraction, RNA quality, reverse transcription, oligonucleotides, reagents) is yours. Your answers are saved with the run, in the packet export, and always take precedence; clearing your text brings back PlateCheck's suggestion.

## Downloads

- **Download checklist for Word**: an HTML document saved as `.doc`, which Word, LibreOffice and browsers open, with the five sections as tables, ready to complete and attach to a submission.
- **Download checklist (CSV)**: one row per item (ID, section, label, provided, description, source), for journal forms or a lab notebook.

## Wording and source

The item labels are PlateCheck's own short wording of the checklist items. The full checklist, with its footnotes, is Table 1 of the paper (also available there as an editable supplementary table); the paper is under the publisher's standard reuse terms, so its text isn't reproduced.

Bustin SA, Ruijter JM, van den Hoff MJB, Kubista M, Pfaffl MW, Shipley GL, Tran N, Rödiger S, Untergasser A, Mueller R, Nolan T, Milavec M, Burns MJ, Huggett JF, Vandesompele J, Wittwer CT (2025). MIQE 2.0: Revision of the Minimum Information for Publication of Quantitative Real-Time PCR Experiments Guidelines. *Clinical Chemistry* 71(6):634–651. doi:10.1093/clinchem/hvaf043
