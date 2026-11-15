# Formats

## Inputs

### Excel workbooks
`.xlsx`, `.xls` (Excel 97 and later) and `.ods` files are read in the browser with SheetJS (`web/vendor/xlsx.mjs`, Apache-2.0), which is loaded only when a workbook is dropped. Each sheet is turned into tab-separated text and then read exactly like a text export, so everything below applies to sheets too.

- Every non-empty sheet is checked. The best sheet for each kind is picked: results (a sheet named like `Results` wins), amplification (`Amplification…`) and melt (`Melt…`). One QuantStudio workbook can therefore give the results and both curve files at once. In the Data tab preview you can switch to another sheet.
- Numbers are taken as stored in the file, with every digit, not as Excel shows them on screen. Date cells keep their displayed form; formula cells use the value Excel saved; errors such as `#DIV/0!` stay as text and are flagged like any other non-numeric Ct.
- The imported file is recorded as `<workbook> [<sheet>]` with the workbook name, sheet name and the SHA-256 of the workbook itself; the checksum stored with the run is of the sheet text that was read. *Download sheet as text* gives back exactly that text.
- Instrument project files (`.eds`, `.pcrd`) are also zip files but are not workbooks, and are refused with a message.

### Results file (required)
Comma, tab or semicolon separated text, or a sheet of an Excel workbook. Column names are matched case-insensitively. The delimiter is taken from the first line that has one; on a tie, tab wins.

| Field | Accepted column names | Required |
|---|---|---|
| Well | `Well Position`, `Well`, `Pos`, `Position` (values such as `A1` or `A01`) | yes |
| Ct/Cq | `Ct`, `Cq`, `CT`, `Cт`, `C_T`, `CRT`, `Cp` | yes |
| Sample | `Sample`, `Sample Name`, `Name` | no |
| Target | `Target`, `Target Name`, `Detector`, `Detector Name`, `Gene`, `Assay` | no |
| Role | `Role`, `Task`, `Content`, `Type` | no |
| Quantity | `Quantity`, `Starting Quantity (SQ)`, `SQ`, `Qty` | no |
| Group | `Group`, `Condition`, `Biological Group`, `Biological Set Name` | no |
| Biological unit | `bio_unit`, `Biological Unit`, `Biological Replicate`, `Bio Rep` | no |

The header row is found anywhere in the first 500 lines (the first row with both a well and a Ct/Cq column). Lines before it are kept as file metadata (`* key = value`, `key,value` and `key: value` lines). The table ends at the next `[Section]` line or a repeated header; blank lines inside it are skipped. A trailing block of rows without well positions (for example Slope / R² or “Analysis Type”) is reported as a footer, not data.

Detected layouts:
- **Thermo QuantStudio**: text export with `* key = value` lines and `[Results]`, or CSV with a key,value preamble (`Block Type`, …). `Omit` flags are kept and reported.
- **Applied Biosystems SDS** (7000/7300/7500/7900HT, SDS 1.x/2.x): text with a preamble and `Detector` / `Detector Name` columns. The SDS 1.x “Ct” export, which has one block per detector (`Detector,Reporter,…` / values / `Well,SampleName,Ct` / rows), is read block by block, with the detector name as the target. The SDS 1.x melt export (rows of readings under `Well, Temperatures …`, `Well, Raw Data …`, `Well, Derivative Data …` per detector) is read as melt curves; its numbered wells take the results file's plate size.
- **Bio-Rad CFX “Quantification Cq Results”**: has `Fluor` and `Content` columns; a leading unnamed index column is ignored.
- **Generic**: anything else with a well and a Ct/Cq column, including Roche LightCycler 480 text exports (`Pos`, `Name`, `Cp`; `Include` = FALSE is treated like QuantStudio's Omit).

Excel workbooks: each sheet is classified as results, amplification or melt, and the instrument-named sheet is preferred. Newer QuantStudio workbooks have no Quantity column on “Results”; when another sheet (“Standard Curve Result”) repeats every well with the same Cq and also has the standards' quantities, that sheet is used and the upload note says why.

## RDML

RDML (Real-time PCR Data Markup Language, https://rdml.org; Lefever et al. 2009, Ruijter et al. 2015) is the standard exchange format for qPCR data and the format MIQE 2.0 asks raw data to be shared in. An `.rdml` file is a zip with `rdml_data.xml`. Code: `web/rdml.js`.

**Import.** Drop an `.rdml` file like any results file. Each run in it is read like a workbook sheet: its reactions become the results table (well from the react number and the plate format, sample, target, Cq, sample type, quantity, group, exclusion), its `adp` points the amplification curves and its `mdp` points the melt curves (raw fluorescence). Mapping:

| RDML | PlateCheck |
|---|---|
| sample type `unkn` (or none, as in RDML 1.4) | sample |
| `std` with `quantity` | standard, with that quantity |
| `ntc`, `nac` (no amplification control), `ntp` (no target present) | no-template control |
| `nrt` | no-RT control |
| `pos` | positive control |
| `opt` (optical calibrator) | left out, with a note |
| sample annotation Group, Condition, Biological group, Biological replicate, Treatment or Genotype | group |
| `cq` missing or −1 | Undetermined |
| `excl` | excluded on the instrument (like QuantStudio's Omit) |
| target type `ref` | named in the upload note, to choose as references in the Analysis step |

A file with several runs uses the first and says so; load another with Replace. Runs with curves but no Cq values (raw-data-only RDML) can be read but not checked; the note says to export Cq values first (instrument software, or RDML-Tools' LinRegPCR).

**Export.** Report step, Other formats, "Download RDML": RDML 1.3 with the plate format, samples (type, standards' quantity, group and biological unit as annotations), targets (type `ref` for the analysis references; standard-curve efficiency where there is one), and per reaction the Cq, the exclusion flag and the raw amplification and melt points. What RDML can't hold is listed after the download: wells without a plate position or target, reactions without a sample name (the well name is used), Cq values that aren't numbers, a second result for the same target in one well, and melt curves that are derivative values (RDML holds raw melt fluorescence).

**Checked against:** the reading of 14 example files from the RDML consortium (rdmlpython and RDML-Tools; RDML 1.3 and 1.4; 1,778 reactions) equals an independent lxml reading of the same files for every reaction: well, sample, target, Cq, and number of amplification and melt points. Exports of four of those files and of the demo run pass the RDML 1.3 schema validation of rdmlpython 1.7.2, and reading an export back gives the same wells, samples, targets, Cq, roles, exclusions, curves, standard curves and flags (`tests/rdml.test.mjs`).

Ct columns named after the dye (`Ct SYBR`, `Cq FAM`, `Cp SYBR Green`) or `CT Value` are read as the Ct/Cq column; only known dye names are accepted, so summary columns such as `Ct Mean`, `Ct SD` or `Ct Threshold` never are. Well positions with a run prefix (`Exp2 A5`) are read from the last word, with a warning; several different prefixes in one file usually mean several plates, and the warning says to split the file. Positions listed with no sample, target, role or Ct (LightCycler lists all 96) are treated as empty wells.

A `Tm` / `Tm1` column (and `Tm2` when the software reports a second peak) is read too. Without a melt-curve file, each product well's Tm is compared with its target's median (the same ±1 °C tolerance as melt curves), and a reported Tm2 is flagged as a possible second product. Peak heights and NTC peaks need the melt-curve file.

Numeric wells: if the well column holds numbers (SDS 2.x), they are converted row by row using the plate size stated in the file, 384 if any number exceeds 96, or the size the user chooses in the preview (`--plate-size` in the CLI). The size is never guessed.

Numbers: in semicolon-separated files, decimal commas (`24,31`) are read as decimals. Thousands separators in quantities (`12,963.927`) are accepted. Raw strings are stored unchanged.

Role values: `Unkn…`/`Unknown`/`Sample` → sample, `NTC`/`No template…` → NTC, `Std…`/`Standard` → standard, `Pos…` → positive, `NRT`/`No RT`/`-RT`/`NAC` → no-RT, `Empty`/`Unused` → empty. Other values (such as `Neg Ctrl`) are not mapped and are flagged. Samples named `NTC`, `water`, `H2O`, `blank` or `no template control`, or ending in `NTC` / `no template` after a target name (`gapdh no template`), are treated as NTC, and samples whose name marks them as a no-RT control (`c1 noRT`, `c1 -RT`, `c1 RT-`, `NRT c1`, `c1 no-RT control`, `c1 minus RT`) are treated as no-RT, when there is no role column or the role is “Unknown”. The Plate page asks you to confirm these guesses; the source of the role is shown in the preview, plate map and report.

No-amplification markers: empty, `Undetermined`, `NaN`, `N/A`, `NA`, `No Ct`, `No Cq`, `-`, `None`, `No Amp`. Any other non-numeric value is kept and flagged.

Safe failure: if the well or Ct/Cq column is missing, the plate size for numeric wells is unknown, or more than half the rows cannot be parsed, nothing is analysed. Otherwise unparseable rows are excluded and reported as findings. A row counts as unparseable when its fields don't line up with the header or it has no well or Ct/Cq cell. A readable row whose Ct/Cq value isn't a number (for example `abc`) is not unparseable: it is kept, flagged as a non-numeric Ct/Cq and left out of calculations, however many such rows there are.

Several candidate columns: if more than one column could be the Ct/Cq column (or the well, sample or target column), the first one is used and the preview shows a warning naming both.

Excel workbooks with several sheets that look like results: a sheet named exactly `Results` (or `Ct Results`, `Cq Results`) is preferred over one that only contains the word, such as `Old results`. When more than one sheet qualifies, the note after import names the others so you can switch.

Import template: `well,sample,target,ct,role,group,bio_unit,quantity` (downloadable from the Data tab).

### Amplification and melt curves (optional)
- The header row can sit below a block of run details (as in QuantStudio Excel exports); the first row with a `Cycle` or `Temperature` column is used.
- **Long layout**: columns for well, optional target, `Cycle` (or `Temperature`), and a value (`Delta Rn`, `ΔRn`, `RFU`, `Fluorescence`, `Rn`, `Value`; for melt also `Derivative`, `-dF/dT`, `-d(RFU)/dT`, `-Rn'`).
- **Wide layout**: a `Cycle` or `Temperature` column plus one column per well (`A1`, `A01`, …), as in CFX amplification and melt exports.
- Melt values can be derivative or raw fluorescence; the user confirms which at import.

### Plate-map template
`well` plus any of `sample, target, group, role, bio_unit, quantity`. Empty cells leave the current value. If a well has several targets, a `target` column selects the row.

## Outputs

| Export | Contents |
|---|---|
| `<id>.report.html` | Human-readable report, readable without PlateCheck. Can be printed to PDF. |
| `<id>.wells.csv` | One row per source data row: source line, raw and normalised well, effective labels, role and its source, raw Ct/Cq, and the file's original label values. |
| `<id>.findings.csv` | One row per finding: ID, rule, rule version, category, severity, description, wells, source lines, evidence, next check, disposition, note, reviewer. |
| `<id>.results.json` | `format: "assaylint-results"`: experiment context, file metadata and checksums, rule set, checks performed and not assessed, summary, findings, replicate groups, controls, standard curves, reviews and wells. |
| `<id>.platecheck.json` | `format: "assaylint-packet"`, `packet_version: 1`: the complete experiment, including original files and audit history, plus the analysis. Importing verifies each embedded file's SHA-256. |

Finding IDs are `<rule>:<key>` and say what a flag is about, so reviews stay attached to the right flag: per-well flags use the well and target (`ntc_amplification:H12|GAPDH`, with `#2` for a second flag of the same rule on that well), other flags their target, unit or role. They never use a file line, so replacing or re-reading the file can't move a decision onto another well. A decision is only applied while the flag's description (which carries its values) is the one that was reviewed; if the values changed, the flag shows "Needs re-review" and the earlier decision is shown next to it but not applied. Runs saved before November 2026 keyed per-well decisions by file line; they are moved to the new IDs when the flag's values match, and left unapplied otherwise. Reviews of findings that no longer appear (for example after a plate-map correction) are kept and listed separately in the report.
