# StabilitySoft: formulas used in the calculations

This report lists every formula the program uses, taken from the program code as it is now (engine `src/engine/`, importer `src/importer/`). Each section names the code file that does the work.

**Symbols and conventions**

| Symbol | Meaning | Unit |
|---|---|---|
| L | length between perpendiculars (LBP) | m |
| B | moulded breadth | m |
| D | moulded depth | m |
| x | longitudinal position, measured **from the AP**, + forward | m |
| y | transverse position, + starboard | m |
| z | vertical position, measured from the base line | m |
| Δ | displacement | t |
| ρ | sea water density of the load case | t/m³ |
| ρ_ref | density the hydrostatic and KN tables were made for | t/m³ |
| t | trim, + by the stern | m |
| φ, θ | heel angle, + to starboard | ° |
| g | gravity, 9.81 m/s² | |

---

## 1 Tanks (`tanks.ts`)

The volume V comes from what is entered:

| Entered as | Volume |
|---|---|
| Filled | V = capacity |
| % | V = % / 100 × capacity |
| Volume | V = the value entered |
| Weight W | V = W / ρ_liquid |
| Sounding / ullage | V = linear interpolation in the sounding table |

From the volume:

- Weight: W = V × ρ_liquid.
- LCG, TCG and VCG: linear interpolation in the calibration table, against volume.
- Free surface moment, for a slack tank only (0 < V < capacity):
  - FSM = i_t × ρ_liquid.
  - i_t is the transverse inertia of the liquid surface, interpolated at V.
  - With the "maximum" method, i_t is the largest inertia in the table.
  - With "manual total", one FSM total is typed in for the whole ship.
- A full (pressed-up) tank has FSM = 0.
- Checks:
  - A volume above capacity is an error.
  - A filling between 98 % and 100 % gives a warning.

## 2 Weights summation (`stability.ts`)

The items are the lightship, every tank, every variable weight, and (for anchor handling) the vertical wire load F_v at the stern.

- Δ = Σ w_i
- LCG = Σ w_i·x_i / Δ
- TCG = Σ w_i·y_i / Δ
- KG = Σ w_i·z_i / Δ
- Free surface correction: FSC = Σ FSM / Δ
- KG fluid: KG_f = KG + FSC

The sums use compensated (Kahan) summation, so that rounding errors don't add up. Negative weights are allowed, for example to remove an item that is part of the lightship; each one gives a warning.

## 3 Hydrostatics, trim and drafts (`hydro.ts`)

### 3.1 Density correction

The tables are entered with the displacement at the table's density:

- Δ_ref = Δ × ρ_ref / ρ
- Draft, LCB, LCF and KM are read at Δ_ref.
- MTC and TPC are scaled to the actual density: MTC = MTC_table × ρ / ρ_ref, and TPC likewise.

### 3.2 One even-keel table (small-trim method)

All values are interpolated linearly in Δ_ref. The table draft d is taken as the draft at the LCF.

- Trim: t = Δ·(LCB − LCG) / (100·MTC)
- Draft at the AP: d_AP = d + t·LCF / L
- Draft at the FP: d_FP = d − t·(L − LCF) / L
- Draft at midship: d_MS = d + t·(LCF − L/2) / L
- Mean draft: d_mean = (d_AP + d_FP) / 2

If |t| > 1 % of L, a warning says the even-keel table loses accuracy.

### 3.3 Several trimmed tables (free trim, used when tables for 2 or more trims exist)

1. In every trim table, LCB is read at Δ_ref (linear in displacement).
2. The trim of equilibrium is where LCB(t) = LCG. It is found by linear interpolation between the two trims where LCB − LCG changes sign: t = t_i + (LCB_i − LCG)/(LCB_i − LCB_{i+1}) · (t_{i+1} − t_i).
3. Every other value (draft, LCF, KM, KB, MTC, TPC, C_b, L_WL) is interpolated linearly between those two trims.
4. The draft of a trimmed table is the draft at its origin x₀. That is midship (x₀ = L/2) unless the vessel data says otherwise.
   - d_AP = d + t·x₀ / L
   - d_FP = d − t·(L − x₀) / L
   - d_MS = d + t·(x₀ − L/2) / L
5. If LCG lies outside the trim range of the tables, the calculation stops with a message. Nothing is extrapolated.

### 3.4 Block coefficient

C_b comes from the table if it is there. If not: C_b = (Δ/ρ) / (L·B·d_mean).

## 4 Drafts given at another point: conversion on import (`importer/references.ts`)

Trimmed hydrostatic tables are stored with the **draft at midship**. On import you choose where the drafts of the table are measured:

- at midship
- at the LCF
- at the AP
- at the FP
- at another point X

The waterline is a straight line, d(x) = d_AP − t·x/L, so a draft d_ref measured at x_ref becomes:

> **d_MS = d_ref + t · (x_ref − L/2) / L**

| Drafts measured at | x_ref used |
|---|---|
| Midship | no conversion |
| LCF | the LCF of the same row of the table |
| AP | 0 |
| FP | L |
| Other point | the X you type |

For an even-keel table (t = 0), the draft is the same everywhere, so nothing is converted. Each converted cell keeps the number printed in the booklet and shows a note like "draft 3.200 at LCF (27.1 m from AP) → 3.2051 m at midship (trim 1 m)".

**Example.** Trim 1.0 m by the stern, L = 57.4 m, a row with LCF = 25.0 m from AP and a printed LCF draft of 3.200 m:
d_MS = 3.200 + 1.0 × (25.0 − 28.7) / 57.4 = 3.200 − 0.0645 = **3.1355 m**.

## 5 Cross curves (KN) and the GZ curve (`hydro.ts`, `stability.ts`)

### 5.1 Reading KN

- Displacement corrected for density: Δ_ref = Δ·ρ_ref / ρ.
- In each KN table, KN at every tabulated heel angle is interpolated in displacement with **PCHIP**, a monotone cubic that never overshoots between table points.
- With KN tables for several trims, the values are then interpolated linearly in trim, at the trim found in §3.
- Between table angles, KN(φ) is interpolated with PCHIP in heel.
- A displacement, trim or angle outside the tables stops the calculation. Nothing is extrapolated.

### 5.2 KN tables given against draft or volume: conversion on import (`importer/references.ts`)

The program stores KN against displacement. On import you choose what the first column of the table gives:

| First column | Conversion to displacement |
|---|---|
| Displacement | none |
| Draft | Δ = linear interpolation of the draft in the **hydrostatic table of the same trim** (draft → displacement); drafts are at midship, as stored |
| Volume ∇ | Δ = ∇ × ρ_ref |

For the draft option the hydrostatics must be imported first. If there is no hydrostatic table for that trim, or a draft lies outside it, the row is marked as an error and cannot be stored. Nothing is guessed.

### 5.3 GZ

- GZ(φ) = KN(φ) − KG_f·sin φ − TCG·cos φ
- Initial GM (solid): GM = KM − KG
- Initial GM (fluid): GM_f = KM − KG_f
- **Static heel:** the angle where GZ = 0, nearest to upright. It is found by scanning in steps of 0.1° and then bisection to 10⁻⁶°. If no such angle exists within 60°, the program reports that the vessel capsizes. If GM_f ≤ 0, it warns about an angle of loll.
- **Worst side:** all criteria are measured towards the side the ship heels to. For a heel to port, the curve is mirrored: GZ_s(φ) = −GZ(−φ).
- **GZ max and its angle:** found by scanning in steps of 0.1°, then refined by golden-section search.
- **AVS (angle of vanishing stability):** the first angle beyond GZ max where GZ = 0.
- **Range of positive stability:** AVS − |static heel|.

### 5.4 Areas under the curve

Areas use composite **Simpson's rule** with a step of 0.1° or less. The result is in metre-radians:

> A(a→b) = (h/3)·[f(a) + 4f(a+h) + 2f(a+2h) + … + f(b)] × π/180

### 5.5 Down-flooding and deck edge

- Draft at the opening: d(x) = d_AP + (d_FP − d_AP)·x / L
- Flooding angle of an opening: θ = arctan((z − d(x)) / |y|).
  - It is 0° if the opening is under water, and 90° if the opening is on the centreline.
  - θ_f is the smallest angle of all openings.
- Warnings: an opening is under water, or θ_f < 30°.
- Deck edge immersion angle: θ_deck = arctan((D − max(d_AP, d_FP, d_MS)) / (B/2)).

### 5.6 GZ table range and step

The GZ tables use the range and step you choose, for the load case or for each criteria group (step at least 0.1°, limited to the largest KN angle). The criteria themselves are always computed on the full curve, as in §5.3–5.4. The range only changes what is printed.

## 6 Criteria (`stability.ts`, `criteriaGroups.ts`)

**Margin**

- For a "≥" criterion: margin = actual − required.
- For a "≤" criterion: margin = required − actual.
- Margin % = margin / |required| × 100.

**General criteria types** (also used for criteria you define yourself):

| Type | Value checked |
|---|---|
| AREA | ∫ GZ dφ from a to b. If "cap at θ_f" is ticked, b = min(b, θ_f) |
| GZ_AT | GZ at an angle |
| GZ_MAX_FROM | the largest GZ at angles ≥ a |
| ANGLE_GZMAX | the angle of GZ max |
| GM | GM fluid |
| RANGE | range of positive stability |
| HEEL | static heel |
| HEEL_MOMENT | the angle φ_e where GZ(φ) = heeling arm(φ) |
| RESID_AREA | ∫ (GZ − arm) dφ from φ_e to b |
| RESID_GZMAX | the largest (GZ − arm) beyond φ_e |
| ARM_GZMAX_RATIO | arm(φ_e) / GZ max |
| RESERVE_RATIO | A1/A2: A1 = ∫(GZ − arm) from φ_e to the limit, A2 = ∫(arm − GZ) from (φ_e − roll angle) to φ_e |

**IS Code 2008 Part A 2.2 (general criteria)**

- Area 0–30° ≥ 0.055 m·rad
- Area 0–40° (or 0–θ_f) ≥ 0.090 m·rad
- Area 30–40° (or 30°–θ_f) ≥ 0.030 m·rad
- GZ ≥ 0.20 m at an angle ≥ 30°
- Angle of GZ max ≥ 25°
- GM₀ ≥ 0.15 m

**OSV (IS 2008 B 2.4.5)**

- Area from 0° to θ_max:
  - at least 0.070 m·rad if θ_max ≤ 15°;
  - at least 0.055 + 0.001·(30 − θ_max) for θ_max between 15° and 30°;
  - at least 0.055 m·rad if θ_max ≥ 30°.
- The other limits are as in Part A, except that the angle of GZ max must be ≥ 15°.

## 7 Heeling moments you define (`formula.ts`, `stability.ts`)

- Each moment is a formula. Its variables are linked to values you enter, to values of the load case (Δ, drafts, KG, KG_f, KB, TCG, LCG, GM, KM, trim, static heel), or to the heel angle θ.
- Heeling arm = M / Δ. If the formula already gives an arm, it is used directly.
- A group with several moments uses their sum: arm_total(θ) = Σ arm_i(θ).
- A group can also have no moment at all. It then holds only criteria that need no moment (areas, GZ, GM, and so on).

## 8 Weather criterion (IS Code 2008 A 2.3; also IMO A.562)

**Wind levers**

- Steady wind lever: l_w1 = P·A·Z / (1000·g·Δ).
  - P = 504 N/m² (A.562: 0.0514 t/m²).
  - A is the windage area at d_MS, plus the wind areas of weight items.
  - Z = h_A − h_U: from the centre of the wind area to the centre of the underwater area. If h_U is not in the table, h_U = d_mean/2.
- Gust wind lever: l_w2 = 1.5·l_w1.

**Roll angle factors**

- X1 from B/d and X2 from C_b, both from the IS Code tables (linear between table values, end values outside the table).
- **k (bilge keels):**
  - If the bilge keel box is ticked and the area A_k is known, k comes from the IS Code table of A_k·100/(L_WL·B).
  - If there is no area: k = 1.0 for a round bilge, k = 0.7 for a sharp bilge.
- OG = KG_f − d
- r = 0.73 + 0.6·OG/d
- C = 0.373 + 0.023·(B/d) − 0.043·(L_WL/100)
- Roll period: T = 2·C·B / √GM_f
- s comes from T, using the IS Code table.
- Roll angle: θ₁ = 109·k·X1·X2·√(r·s)

**Angles, areas and limits**

- θ₀ is where GZ = l_w1. The roll-back angle is θ_R = θ₀ − θ₁.
- Area a = ∫(l_w2 − GZ) from θ_R to the first crossing of l_w2.
- Area b = ∫(GZ − l_w2) from that crossing to θ₂ = min(θ_f, 50°, the second crossing).
- The criteria are: b ≥ a, and θ₀ ≤ min(16°, 0.8 × deck edge angle).
- Warnings are shown when B/d ≥ 3.5, when KG/d − 1 is outside −0.3…0.5, or when T > 20 s.

## 9 Special operations

| Check | Formula (heeling arm, or what is checked) |
|---|---|
| **Fire-fighting (BV)** | arm = [n·R·(h − T/2) + S·(T/2 − e)]·cos φ / Δ; heel at equilibrium < limit |
| **Crane / lifting wind (IS 2008 B 2.9)** | q = ½·ρ_air·V²; M = q·C·A·Z / 9806.65; l_w = M/Δ. Checks: equilibrium heel ≤ crane design heel; ARL/AHL ≥ 1.4; residual area to 20° (or θ_f) ≥ 0.03; deck edge not immersed; freeboard ≥ 0.5 m (sheltered) or max(1.0, 0.75·Hs) (exposed) |
| **Passenger crowding (IS A 3.1)** | arm = N·w·y·cos θ / Δ; heel ≤ 10° |
| **Passenger turning (IS A 3.1)** | arm = 0.200·(v₀²/L_WL)·(KG − d/2)·cos θ / g; heel ≤ 10° |
| **Grain (Grain Code A 7)** | λ₀ = Σ(VHM/SF)/Δ, λ₄₀ = 0.8·λ₀, straight line; heel ≤ 12° (or deck edge); residual area ≥ 0.075; GM ≥ 0.30 |
| **Pontoon (IS B 2.2)** | area to θ_max ≥ 0.08; l_w = 540·A·Z/(1000·g·Δ); heel ≤ angle at half freeboard; range ≥ 20° |
| **MODU (MODU Code 3.4)** | M = ½·1.222·V²·C·A·Z / 9806.65; area ratio ≥ 1.4 (1.3 for column-stabilised units); GZ positive up to the second intercept |
| **Anchor handling (MSC.415, B 2.7)** | y = min(y₀ + x·tan α, B/2); β = max(arctan(y/(h·sin α)), arccos(1.5·BP/(F_p·cos α))); F_v = F_p·sin β (added as a weight at the stern); M_AH = F_p·(h·sin α·cos β + y·sin β); arm = M_AH·cos φ/Δ. Checks: residual area ≥ 0.07; heel ≤ min(angle of ½ GZ max, deck edge angle, 15°). The permissible tension table is found by bisection on F_p |
| **Towing, self-tripping (B 2.8.2.1)** | C_T = 0.5 (conventional) or max(0.9/(1 + l/L_LL), 0.7 or 0.5) (azimuth); arm = BP·g·C_T·(h·cos φ − r·sin φ)/(g·Δ); area A > area B |
| **Towing, tow-tripping (B 2.8.2.2)** | C1 = 2.8·(Ls/L − 0.1), limited to 0.1…1.0; φ_D = arctan(2f/B); C2 = max(1, φ/(3φ_D) + 0.5); C3 = 0.26·φ/φ_D + 0.30, limited to 0.5…0.83; V = 2.57 m/s; arm = C1·C2·ρ·V²·A_P·(h·cos φ − r·sin φ + C3·d)/(2·g·Δ); first crossing < θ_f |
| **Escort (B 2.8.3)** | constant arm HL; A/B ≥ 1.25 (equilibrium to 20°); C/D ≥ 1.4; heel ≤ 15° |
| **Lifting (B 2.9.5–2.9.7)** | threshold M_L = 0.67·Δ·GM·(f/B); CHL1 = (P_L·y − CBM)·cos φ/Δ; residual area ≥ 0.053 or 0.08; after loss of the hook load: CBHL2 = CBM·cos φ/(Δ − P_L), area 2 − area 1 > 0 or 0.037; ratio area 2 / area 1 ≥ 1.0 or 1.4 |

## 10 Operational limits (`opLimits.ts`)

Each limit is checked only when its tick is on. The results are shown apart from the stability criteria.

| Limit | Condition | Tolerance |
|---|---|---|
| Max draft at midship | d_MS ≤ limit | 5 mm |
| Max draft at AP | d_AP ≤ limit | 5 mm |
| Min draft at FP | d_FP ≥ limit | 5 mm |
| Max trim by the stern | t ≤ limit | 5 mm |
| Max trim by the head | t ≤ limit | 5 mm |
| Max heel | \|φ\| ≤ limit | 0.05° |
| Min GM | GM_f ≥ limit | |
| Air draft | z_top − d(x_top) ≤ limit, with d(x) = d_AP + (d_FP − d_AP)·x/L | 5 mm |

## 11 Arrival condition (`arrival.ts`)

- Each tank of a consumable type keeps (1 − used %) of its content. The default is 90 % used (10 % remaining).
  - A tank entered as "full" becomes a % filling.
  - A tank entered by sounding becomes a volume.
- Variable weights can be reduced by a % in the same way.
- Everything else is copied unchanged. The arrival condition is then calculated from the beginning, with new tank centres and free surface.

## 12 Imported data: conversions and checks (`importer/`)

**Positions**

- Positions printed from midship are converted to positions from the AP: x = L/2 ± value.
  - A trailing "a" or "f", or the "aft/fwd of midship" setting, gives the sign.
  - TCG and other transverse values follow the port/starboard setting.

**Numbers**

- Every number read is compared digit by digit with the printed text (the digit check).
- Text read by OCR below 60 % confidence is marked for checking.

**Checks after reading**

- Values that should increase do increase.
- Spikes and shifted decimal points are flagged, by comparing each value with the median of its 3 neighbours on each side.
- The TPC and MTC columns are compared with each other. Totals are compared with the printed totals (for example the lightship total).

**Read-back**

- After storing, every value is read back from the database and compared with the table you reviewed. The import is accepted only if all of them are identical.

## 13 Interpolation rules (`math.ts`)

| What | Method |
|---|---|
| Hydrostatics (in displacement and in trim), tank tables, windage, IMO factor tables, KN between trims | linear |
| KN in displacement, and KN between heel angles | PCHIP (Fritsch–Carlson monotone cubic) |
| IMO factor tables (X1, X2, k, s) | linear, clamped at the end values as the Code prescribes |
| Every other table | **no extrapolation**: a value outside the table stops the calculation with a message naming the table |
| Roots (heel, crossings) | scan at 0.05–0.1°, then bisection |
| Integration | Simpson's rule, step ≤ 0.1° |
