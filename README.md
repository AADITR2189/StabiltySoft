# StabilitySoft — Vessel Stability Platform

**StabilitySoft** is a planned professional vessel stability software platform. It replaces Excel-based stability calculations with a controlled, audited and automated system.

It is delivered first as a **Progressive Web App (PWA)**: it runs in a web browser, can be installed like an app and works **offline onboard**. Later it can be packaged as a desktop or mobile application without being rewritten.

> **Status:** Early working version (v0.1). The calculation engine and first screens run in the browser and work offline. They use a **demo vessel** (a box-shaped barge with exactly calculable data) until real vessel data is loaded. See [What works now](#what-works-now).

---

## Why this exists

The current Excel-based stability assessments cause:

| Problem with Excel | How StabilitySoft solves it |
|---|---|
| Human input errors | Controlled data entry with range checks, units and validation |
| Formula modification errors | Formulas are locked inside a tested, versioned calculation engine. Users cannot edit them |
| Version control problems | Every vessel dataset is versioned (Draft → Verified → Active → Superseded) |
| Difficulty managing many load cases | Unlimited load cases per vessel: duplicate, compare, archive, export |
| Difficulty managing vessel databases | Centralised vessel database with approval workflow |
| No automatic criteria checks | Automatic IMO IS Code 2008 and Weather Criterion checks with Pass/Fail and margins |

---

## Design documents

| # | Document | What it answers |
|---|---|---|
| 1 | [Software Requirements Specification (SRS)](docs/01-SRS.md) | *Exactly what must the software do?* (IEEE-style, numbered requirements) |
| 2 | [Product Requirements Document (PRD)](docs/02-PRD.md) | *Who is it for and why?* (vision, personas, user stories) |
| 3 | [System Architecture Document](docs/03-System-Architecture.md) | *How is it built?* (components, data flow, database, API) |
| 4 | [UI/UX Specification](docs/04-UI-UX-Specification.md) | *What does it look like and how do people use it?* (wireframes, flows) |
| 5 | [Development Roadmap](docs/05-Development-Roadmap.md) | *In what order is it built?* (Phases 1–5) |
| 6 | [Technology Recommendation](docs/06-Technology-Recommendation.md) | *Which tools and why?* |
| A | [Appendix A: Calculation Methods](docs/A-Calculation-Methods.md) | *Which formulas, exactly?* (the naval architecture reference) |

**Providing vessel data:** see the [Vessel Data Checklist](docs/DATA-CHECKLIST.md).

**Suggested reading order for non-technical readers:** this README, then the PRD, then the UI/UX Specification, then the Roadmap.

---

## What works now

| Feature | Status |
|---|---|
| Calculation engine: displacement, drafts, trim, heel, KG, GM, free surface, GZ curve | ✅ Working, 28 automatic tests against exact geometry |
| IMO IS Code 2008 general criteria (§2.2) + Weather Criterion (§2.3), with margins and failure explanations | ✅ Working |
| Load case editor: tanks by Filled / % / Volume / Weight / Sounding, variable weights, live results | ✅ Working |
| Multiple load cases: create, duplicate, delete (saved in the browser) | ✅ Working |
| GZ curve chart, GZ table, weather criterion chart and details | ✅ Working |
| Stability groups: IS Code 2008 General, OSV intact, Weather, BV Fire-fighting, Crane operation (IS Code B 2.9) | ✅ Working, each with its own GZ diagram |
| Criteria Library: create own intact criteria and build own groups by clicking criteria | ✅ Working |
| Heeling moments from user formulas: click each symbol to link it to the load case (Δ, drafts, VCB, KG, TCG, GM, heel angle θ …) or enter a value; heeling arm = M / Δ; moment criteria (heel at equilibrium, residual area, residual arm) | ✅ Working |
| GZ table and moment calculation tables for every stability group | ✅ Working |
| Several moments connected to a group: combined heeling moment = sum; criteria can use the group's combined moment; groups can be edited | ✅ Working |
| Catalogue round 1: Passenger ships (crowding, turning), Grain Code, Pontoons, MODU, Lifting 2.9.3 freeboard, reduced wind pressure, IMO A.167 / A.749, DDS 079-1 style ratio criteria; operation data per load case; edit user criteria | ✅ Working |
| MSC.415(97): anchor handling (2.7) with permissible tension table, towing self/tow-tripping (2.8), escort (2.8.4.4), lifting loss of hook load (2.9.5), alternative method (2.9.6/2.9.7), lifting threshold (2.9.1.2) | ✅ Working (source: docs/regulations) |
| IMO A.562(14) weather criterion (1985): P = 0.0514 t/m², θ0 limit as guide value | ✅ Working (source: docs/regulations) |
| MODU column-stabilised alternative, 46 CFR, DDS 079-1 extras, class notations | ⏳ Waiting for rule text |
| Dashboard: general particulars + summary table of all load cases (add, open, duplicate, delete) | ✅ Working |
| MARSOL SPLENDOR loaded from the booklet, all 13 booklet conditions benchmarked | ✅ Working (data not yet verified) |
| Single colour theme (Powder Blue / White / Racing Orange), contrast-checked, installable, offline | ✅ Working |
| Real vessel data | ⏳ Waiting for data: see the [Vessel Data Checklist](docs/DATA-CHECKLIST.md) |
| Import (Excel / CSV / PDF / Word) with verification | ⏳ Next |
| Reports (PDF / Excel) | ✅ Reports screen: PDF (summary, particulars, condition, weights, tanks, criteria, one page per stability group with GZ curve, GZ table and moment calculations, trace) and Excel workbook (same numbers, one GZ sheet per group, all load cases). Report ID = SHA-256 of inputs and results |
| Roll factor k | ✅ IS Code 2008 A 2.3.4: a known bilge keel area A_k is always used (table on A_k·100/(L·B)); without it k = 1.0 (round bilge) or 0.7 (sharp bilge). The basis of k is shown in the weather criterion details |
| Windage and flooding points from the booklet | ✅ Windage from the wind heeling moment tables of the loading conditions (draft found in the same condition; parts re-added and checked against the printed total; sample pages left out; conflicting drafts must be resolved; optional straight-line extension marked DERIVED). Flooding points from lines "name L, T, V" (extra columns ignored); names with (P)/(S) checked against the sign of Y — finds the booklet p.139 typo |
| Imported Data | ✅ Every data set of the vessel (particulars, lightship, hydrostatics and KN per trim, windage, openings, each tank) with its source record and edit history; table editor (add / delete rows, change values) runs the import checks, reads back and logs every change with name and reason |
| Tank types | ✅ Tanks keep the booklet's types (WATER BALLAST, FUEL OIL, BRINE, ACID …); tank tables in the load case, Vessel Database, Imported Data and the PDF / Excel reports are split by type with subtotals (collapsible in the load case). Category editor: rename, recolour, add and delete (when unused) categories, consumable by default. Type editor: rename, add, delete, reorder, category, colour, default density (optionally set for its tanks), consumable, move tanks between types; every change logged |
| Operational limits | ✅ Per load case, each with a tick (unticked = not used): max draft midship / aft, min draft forward, max trim by stern / head, max heel, min GM, max air draft; shown separately from the criteria (sidebar, Stability Criteria, reports) |
| Arrival generator | ✅ From a departure: % used per tank type (preset 10 % remaining) and per weight item, preview of every change |
| Load case file, chart and table export | ✅ One load case as a file (checksum) and import with checks; each group's GZ chart as PNG / SVG and GZ table as CSV |
| GZ range | ✅ From / to / step for the GZ tables (chart from 0°); criteria always on the full curve |
| Scanned PDFs, pictures, old .xls | ✅ Text recognition (Tesseract, in the browser, offline after first use): table rules removed, low-confidence cells outlined, lost-decimal-point check; tested on a booklet page rendered as a scan (≈ 94 % of values exact, every misread row flagged). Old Excel .xls read with SheetJS |
| Database file | ✅ Save the whole database (your vessels with their data record, all load cases, criteria library) to one JSON file sealed with SHA-256; import it back with preview, checksum check, merge or replace |
| Data import | ✅ PDF (text layer), Excel .xlsx, CSV, Word .docx, or pasted / typed tables → general particulars and lightship totals (label / value lists, e.g. "LBP 57.400 m", "LCG 0.592 m AFT of MIDSHIP"; IMO check digit, LOA ≥ LBP, L/B, B/D, draft < depth checks), lightship item tables (items checked against the source total line), **hydrostatics and KN for all trims at once** (booklet pages found automatically by heading + trim line + table; trim read from "No Trim", "Trim: aft 0.500/57.400", "Trim fwd 1.000"; one sheet per trim or a trim column; option to replace all stored trims; tested on all 10 MARSOL pages), **all tank calibration tables at once** (booklet PDF with a title line per tank, one Excel sheet per tank, or one long table with a tank-name column; columns mapped once; name, contents and density read from the title; booklet blanks filled by convention and marked; each tank checked, compared and read back on its own — tested on all 54 MARSOL tanks), hydrostatics (per trim), KN cross curves (per trim), tank calibration, windage, down-flooding openings, load case weights. Column auto-mapping, a/f and s/p letters, midship → AP conversion. Every cell shows its source text and is re-read digit by digit; engineering checks (monotonic, TPC balance, % and weight vs volume, single-value spikes); row-by-row human sign-off; stored data read back and compared value by value |
| Your vessels | ✅ New vessel (particulars form with bilge type and a tick box for bilge keels / bar keel with known area A_k) and lightship editor (totals or a list of weight items, summed automatically) or "copy as mine" of a built-in vessel; data status becomes Verified only when every data set has a verified import record |
| Hydrostatics / tanks editors, compare load cases, settings | ⏳ Planned |

### For developers: running it

```bash
npm install
npm run dev      # start locally at http://localhost:5173
npm test         # run the engine tests
npm run build    # production build in dist/
```

Code layout: `src/engine/` is the calculation engine (pure TypeScript, no UI), `src/data/` holds vessel data, `src/ui/` holds the screens and `tests/` the engine verification tests.

## Phase 1 scope in one paragraph

Phase 1 covers vessel database management (general particulars, lightship, hydrostatics, KN cross curves, tanks with calibration tables, windage data and down-flooding openings) and data import from Excel, CSV, PDF and Word with **mandatory human verification**. It also covers unlimited load cases, a complete **intact stability** calculation (displacement, drafts, trim, heel, KG, GM, free surface correction and GZ curve), **IMO IS Code 2008 general criteria and the Weather Criterion**, and PDF/Excel reports. All of this is offline-capable.

## Important regulatory note

Before StabilitySoft can be used as an *approved onboard stability instrument*, it needs **classification society type approval** (IACS UR L5, IMO MSC.1/Circ.1229) and **vessel-specific approval** of the installed data. Until then, every output is marked *"Not an approved stability instrument — for planning only"*. The architecture is designed from day one to meet these approval requirements (Phase 5).
