# MARSOL SPLENDOR: data verification checklist

**Source:** Preliminary Intact Stability Booklet DU5864/1022 Rev.0 (Aries Marine, 28.10.2026), 184 pages.
**Status:** EXTRACTED, NOT VERIFIED. Nothing here may be used for real decisions until each item is ticked.

## A. Extracted data: please check against the booklet pages

| # | Data | Booklet page (PDF) | What was extracted | Automatic checks done |
|---|---|---|---|---|
| A1 | General particulars | 5 | LOA 62.800, LBP 57.400, B 16.80, D 5.300, summer draft 4.200 m, IMO 9944376, call sign 3E3692 | n/a |
| A2 | Lightship | 6 | 1911.97 t, LCG 0.592 m aft of midship, TCG 0.243 m port, VCG 5.792 m | Same values in all 13 conditions |
| A3 | Sign conventions | 29 | Midship = LBP/2 = 28.700 m from AP; f/a, s/p | Displacement and KG of all 13 conditions reproduced to ≤ 1 mm |
| A4 | Hydrostatic tables | 129–133 | 5 trims (−1.0, −0.5, 0, +0.5, +1.0 m) × 26 drafts (2.25–4.75 m) | Displacement increasing; drafts of all conditions within 8 mm |
| A5 | Cross curves (KN) | 134–138 | 5 trims × 26 displacements × angles 5, 10, 20, 30, 40, 50, 60° | GZ of booklet conditions within 17–41 mm |
| A6 | Down-flooding points | 139 | 4 points at Z 12.150 m | p.139 prints POSITION 2(P) at **6.300s**; condition pages print **6.300p**. Port used. **Please confirm.** |
| A7 | Tank calibration tables | 158–184 | 54 tanks × 14 rows (% / volume / weight / LCG / TCG / VCG / FSM) | Every tank weight in all 13 conditions matches the tables (≤ 0.02 t) |
| A8 | Wind areas | 35, 43, 68, 91, 112 | Built from the "Heeling Moment Derivation" of the 5 sailing conditions (drafts 2.663–4.200 m) | Wind moments recomputed within 0.06 t·m. Rows at 2.25 m and 4.75 m are **extrapolated**. |
| A9 | Fire-fighting data | 27, 46 | 2 monitors × 1.530 t at 19.600 m; bow thruster 18 t at 1.200 m | Not yet used (next step) |

## B. Problems found in the booklet itself

1. **Sample calculation (pages 18–22)** gives displacement **2889.73 t** in one place and **3305.44 t** in the loading summary. These are Condition 3 and Condition 2 values mixed together.
2. **Down-flooding point (4)**: see A6.
3. **Typos:** "SUMMER DRFAT" (p.5), "FULLY LOADED RRIVAL" (p.7). Harmless.
4. **Pages 14, 146, 147 are drawings only.** The FIFI heeling formula (p.14), the KN volume (p.146) and the lateral area profile (p.147) have no numbers.
5. The PDF ends at page 184. The GA plan, tank capacity plan, crane moment chart and lightship report listed in the contents (printed pages 184–190) are **not included**.

## C. Data still needed

| # | Missing | Why it matters | Who can provide it |
|---|---|---|---|
| C1 | **Sounding tables** for the tanks | The booklet only has % tables, so tanks can't be entered by sounding | Shipyard tank tables / ship's sounding book |
| C2 | **Bilge keel area** (or "no bilge keels") and the booklet's weather-criterion inputs (k, X1, X2, C_B, L_WL, r, s) | Our roll angle θ1 is 1.5–2.3° larger than the booklet's. Condition 1 area ratio is 1.008 (booklet 1.088). | Aries Marine (booklet author) |
| C3 | **Cross curves at 5° steps** (15°, 25°, 35°, 45°, 55°) and finer trim steps | Between 10° and 20° the angle of max GZ differs (Cond. 2: booklet 19.96°, ours 23.14°) | Aries Marine (one GHS run) |
| C4 | **Free surface rule** used (which tanks get maximum FSM) | The booklet uses its own maximum-FSM selection; for now the booklet's total FSM is entered per condition | Aries Marine / you |
| C5 | Lateral area table vs draft (full range) | Wind data outside 2.66–4.20 m is extrapolated | Aries Marine |
| C6 | Crane: maximum static heel the crane is designed for | Crane criterion (1) uses 5° in the booklet | Crane manual |

## D. How the comparison works

See [BENCHMARK.md](BENCHMARK.md): every booklet condition is recalculated and compared, and this report is regenerated on every test run.
