# Appendix A — Calculation Methods (Naval Architecture Reference)

| Item | Value |
|---|---|
| Document ID | SS-CALC-001 |
| Version | 0.1 (Draft for technical review) |
| Applies to | Calculation Engine `@stabilitysoft/engine`, Phase 1 (Intact Stability) |
| Normative references | IMO Res. MSC.267(85) — *International Code on Intact Stability, 2008* (IS Code 2008), Part A §2.2 and §2.3; IMO MSC.1/Circ.1229 — *Guidelines for the approval of stability instruments*; IACS UR L5 — *Computer software for onboard stability calculations* |

> **Review rule:** Every formula in this appendix must be checked against the current consolidated text of the IS Code and accepted by the project's responsible Naval Architect before implementation. Clause references are listed in §A.12 (Regulatory Traceability). This appendix is the **single source of truth** for the engine. Code that differs from this document is a defect.

---

## A.1 Coordinate system, units and sign conventions

### A.1.1 Ship coordinate system (internal)

| Axis | Origin | Positive direction | Symbol |
|---|---|---|---|
| X (longitudinal) | Aft Perpendicular (AP) | Forward | x, LCG, LCB, LCF |
| Y (transverse) | Centreline | Starboard | y, TCG |
| Z (vertical) | Baseline (moulded) | Upward | z, VCG, KG |

- **Heel** φ: positive = heel to starboard.
- **Trim** t: positive = trim by the stern (T_aft > T_fwd).
- Each vessel stores its *source convention* (for example LCG measured from midship, positive aft, as printed in the stability booklet). The **import layer converts to the internal convention once**, at verification time. The engine itself never handles more than one convention.

### A.1.2 Units (SI, internal)

| Quantity | Unit |
|---|---|
| Length, draft, lever | m |
| Mass/weight (displacement) | t (tonnes) |
| Volume | m³ |
| Density | t/m³ |
| Moment | t·m |
| TPC | t/cm |
| MTC (MCT 1 cm) | t·m/cm |
| Free surface moment (FSM) | t·m |
| Free surface inertia (i) | m⁴ |
| Angle (display / input) | degrees |
| Angle (integration) | radians |
| Area under GZ curve | m·rad |
| Wind pressure | N/m² (Pa) |
| g | 9.81 m/s² (IS Code 2008 value) |

Display rounding never affects stored or computed values. The engine works in IEEE-754 double precision. Rounding happens only in the presentation layer and the report generator. Default display precision: drafts 3 dp, GM/GZ 3 dp, areas 4 dp, weights 1 dp, angles 1 dp.

---

## A.2 Interpolation methods

| Data | Independent variable(s) | Default method | Allowed alternatives |
|---|---|---|---|
| Hydrostatic table | Draft (and trim, if trimmed tables exist) | Linear (bilinear with trim) | Monotone cubic (PCHIP) in draft |
| KN cross curves | Displacement/volume × heel angle (× trim) | PCHIP in displacement; PCHIP in angle | Linear in either |
| Tank calibration | Sounding/ullage → volume; volume → centroids, FSM (× trim, × heel) | Linear | — |
| Windage table | Draft | Linear | — |
| IMO tables (X1, X2, k, s) | Per table | **Linear** (per IS Code explanatory notes) | none |

Rules:
1. **No extrapolation.** A value outside a table's range raises a blocking `OUT_OF_TABLE_RANGE` error that names the table, the variable and the limits. The engine never silently clamps.
2. The interpolation method and the table version are written into every `CalculationRun` record, so any result can be reproduced.
3. Tables must be strictly monotonic in their independent variable. This is checked at verification time.
4. **Accuracy depends on table spacing.** Engine tests on an exact box-hull reference show that, with KN tabulated every 0.5 m draft and every 5° (10° above 50°), GZ is reproduced within 3 mm at tabulated angles and within 7 mm between angles up to 50°. Between 50° and 60° the error grows to about 15 mm. Linear interpolation across displacement gave errors up to 8 mm even at tabulated angles, which is why PCHIP is the default. **Recommendation for vessel data preparation:** KN at 5° steps up to at least 60°, and draft steps of 0.5 m or finer.

---

## A.3 Loading condition summation

For every item *i* (lightship, tank contents, solid weights):

```
Δ        = Σ wᵢ
LCG      = Σ (wᵢ · xᵢ) / Δ
TCG      = Σ (wᵢ · yᵢ) / Δ
VCG = KG = Σ (wᵢ · zᵢ) / Δ
ΣFSM     = Σ FSMⱼ       (j = slack tanks, per free-surface method, §A.6)
```

The weight summary shows every line item with its weight and its three moments, so the result is fully traceable.

---

## A.4 Tank content conversion

Every tank input mode is converted to **volume V (m³)** first. After that, everything is looked up from the calibration table.

| Input mode | Conversion to V |
|---|---|
| Filled (100%) | V = V₁₀₀ (calibrated full volume) |
| Percentage p | V = p/100 · V₁₀₀ |
| Volume | V = given value |
| Weight W | V = W / ρ_liquid |
| Sounding s | V = interp(sounding table, s [, trim, heel]) |
| Ullage u (optional) | V = interp(ullage table, u [, trim]) |

Then:

```
W    = V · ρ_liquid
LCG, TCG, VCG = interp(calibration table, V)     (actual centroid of liquid)
FSM  = i_T(V) · ρ_liquid                        (if inertia stored)
     or FSM_table(V) · ρ_liquid / ρ_table       (if FSM stored at reference density)
```

Validation:
- V ≤ V₁₀₀, otherwise a blocking error.
- 98% < V < 100% V₁₀₀ gives a warning (expansion margin). The threshold is configurable. Tanks pressed up to exactly 100% are normal practice and are not warned.
- Sounding outside the table range gives a blocking error.
- Every tank row shows the input mode used, so the source of each number is clear.

---

## A.5 Hydrostatics, drafts and trim

### A.5.1 Density correction

Hydrostatic tables are stored at a **reference density** ρ_ref (usually 1.025 t/m³), recorded with the dataset. For an actual water density ρ:

```
∇        = Δ / ρ                     (displaced volume)
Δ_ref    = ∇ · ρ_ref                 (displacement used for table lookup)
```

Look up these values at Δ_ref: T (even-keel draft at LCF), LCB, LCF, KB, KM_T, TPC_ref, MTC_ref, C_B, L_WL, A_WP. Then:

```
TPC = TPC_ref · ρ/ρ_ref
MTC = MTC_ref · ρ/ρ_ref
```

Geometric values (T, LCB, LCF, KB, BM, KM, C_B) do not depend on density at equal volume.

### A.5.2 Trim and drafts (small-trim method, Phase 1)

```
t     = Δ · (LCB − LCG) / (100 · MTC)              [m, + by stern]
T_AP  = T + t · x_F / L_BP                         (x_F = LCF from AP)
T_FP  = T − t · (L_BP − x_F) / L_BP
T_MS  = T + t · (x_F − L_BP/2) / L_BP              (draft at midship)
T_mean= (T_AP + T_FP) / 2
```

- **Draft marks:** if draft-mark positions differ from the perpendiculars, readings at the marks are computed by linear interpolation along the trimmed waterline. A keel-thickness setting converts moulded drafts to extreme drafts.
- **Validity guard:** if |t| > 1% L_BP (configurable) and the vessel has **no trimmed hydrostatics**, the result carries the warning `LARGE_TRIM_ACCURACY`.
- **Free-trim method (Phase 1, when trimmed tables exist):** the engine iterates on (T, t) using bilinear interpolation of trimmed hydrostatics until |Δ_calc − Δ| < 0.001 t and |LCB − LCG| < 0.001 m (Newton–Raphson with bisection fallback, maximum 50 iterations). If it does not converge, it raises a blocking error.

### A.5.3 Metacentric height and free surface correction

```
KM        = interp(KM_T at Δ_ref)        (= KB + BM)
GM_solid  = KM − KG
FSC       = ΣFSM / Δ                     (free surface correction, m)
KG_fluid  = KG + FSC
GM_fluid  = GM_solid − FSC  = KM − KG_fluid
```

**GM_fluid** (corrected GM, called GM₀ in the IS Code) is used for all criteria.

### A.5.4 Static heel

The equilibrium heel φ_eq is the root of GZ(φ) = 0 (§A.7) nearest to upright, including the TCG term. Small-angle estimate, used only as the solver's starting value:

```
tan φ_eq ≈ TCG / GM_fluid
```

If GM_fluid ≤ 0, the engine reports `NEGATIVE_INITIAL_GM` (blocking for criteria evaluation). It still reports any angle of loll it finds.

---

## A.6 Free surface moment methods

The method is selected per load case (default set per vessel). It is stored in the calculation run.

| Method | Description |
|---|---|
| `ACTUAL` | FSM from calibration at the actual filling of each tank. |
| `MAXIMUM` | Maximum FSM of each tank regardless of filling (conservative). |
| `IS_CODE` | IS Code 2008 free-surface guidance: for consumable tanks, the maximum free surface effect is assumed for each type of liquid (at least one transverse pair or a single centre tank, per tank flags). Other tanks use actual filling. Small-tank exclusion is applied only where the vessel's data flags it and the exemption criterion is satisfied. |

Each tank record carries the flags `isConsumable`, `fsmGroup` (liquid type / pair) and `fsmExempt`. The engine **never** decides on its own which tanks are exempt. It applies the verified flags and lists them in the report.

---

## A.7 Righting lever (GZ) curve

### A.7.1 Formula

For each heel angle φ (heel to starboard positive):

```
GZ(φ) = KN(Δ_ref, φ) − KG_fluid · sin φ − TCG · cos φ
```

For negative angles (heel to port), using hull symmetry of KN:

```
GZ(−|φ|) = −[ KN(Δ_ref, |φ|) − KG_fluid · sin|φ| ] − TCG · cos φ
```

- The KN table is the **fixed-trim** (or **free-trim**, if supplied) cross curve dataset. The dataset type is shown on the report.
- Default angle grid: 0° to 90° in 1° steps, plus the angles in the KN table, plus all critical angles. The user can define a range (for example −30° to 80°).
- The table output for each tabulated angle has these columns: **Heel angle | KN | KG·sin φ | TCG·cos φ | GZ**.

### A.7.2 Derived values

| Value | Method |
|---|---|
| GZ_max, φ(GZ_max) | Golden-section search on interpolated curve (tolerance 0.01°) |
| Angle of vanishing stability (AVS) | Root of GZ = 0 after GZ_max (bisection, tolerance 0.01°) |
| Range of positive stability | AVS − φ_eq |
| Area A(φ₁, φ₂) | ∫ GZ dφ (radians), composite Simpson's rule on 0.1° sub-grid of the interpolated curve |
| Dynamic stability | Same as area, reported in m·rad |

### A.7.3 Down-flooding angle θ_f

Down-flooding angle is the heel at which openings that cannot be closed weathertight are immersed. Sources, in order of preference (each vessel chooses one, recorded per run):

1. **Approved table** θ_f vs displacement (or draft) from the stability booklet, which is interpolated.
2. **Computed (approximate)** from opening coordinates (x, y, z). For each opening, the immersion angle is found with the waterline rotated about its intersection with the centreline at the local draft T(x):

   ```
   immersed when (z − T(x)) · cos φ − |y| · sin φ ≤ 0
   → φ_open = atan( (z − T(x)) / |y| )        (opening on the immersing side)
   θ_f = min over all unprotected openings
   ```

   This ignores the heel-induced change in sinkage and trim. The report labels it **"Approximate — not hull-form based"**. A hull-form-based method arrives in Phase 3 with the 3D hull model.

The deck-edge immersion angle (needed for the Weather Criterion θ₀ limit) uses the same two-source logic. The computed method uses the deck at side at the **deeper end** of the ship (lowest freeboard, sheer ignored): θ_deck = atan((D − max(T_AP, T_FP)) / (B/2)). This reproduces the MARSOL SPLENDOR booklet (6.53° vs 6.54° for Condition 2).

---

## A.8 IS Code 2008 — General intact stability criteria (Part A §2.2)

| ID | Criterion | Requirement |
|---|---|---|
| IS-2.2.1.1 | Area under GZ, 0° → 30° | ≥ 0.055 m·rad |
| IS-2.2.1.2 | Area under GZ, 0° → 40° or θ_f if θ_f < 40° | ≥ 0.090 m·rad |
| IS-2.2.1.3 | Area under GZ, 30° → 40° or θ_f if θ_f < 40° | ≥ 0.030 m·rad |
| IS-2.2.2 | GZ at an angle of heel ≥ 30° | ≥ 0.20 m |
| IS-2.2.3 | Angle of maximum GZ | ≥ 25° |
| IS-2.2.4 | Initial metacentric height GM₀ (GM_fluid) | ≥ 0.15 m |

Implementation notes:
- Areas are measured from 0° (upright), as the code defines. If θ_f < 30°, the 0–30° area is evaluated to θ_f. If φ_eq ≠ 0 because of TCG, the report also shows the areas measured from φ_eq for information.
- IS-2.2.2 is evaluated as max GZ over [30°, θ_limit], where θ_limit is the end of the curve or θ_f (configurable per criteria set; the default follows the explanatory notes adopted by the project's naval architect).
- If θ_f < 30°, the 0–30° area criterion is evaluated per the criteria-set configuration and flagged `DOWNFLOODING_BELOW_30` for engineering review.

---

## A.9 IS Code 2008 — Severe wind and rolling criterion (Weather Criterion, Part A §2.3)

### A.9.1 Wind heeling levers

```
l_w1 = (P · A · Z) / (1000 · g · Δ)        [m]   steady wind lever (constant with heel)
l_w2 = 1.5 · l_w1                          [m]   gust wind lever
```

| Symbol | Meaning | Source in StabilitySoft |
|---|---|---|
| P | Wind pressure = 504 N/m² (unrestricted service). A reduced value may be used for restricted service only if the Administration approves it. | Criteria set parameter. Any change from 504 requires an approval reference. |
| A | Projected lateral area of the ship and deck cargo above the waterline (m²) | Windage table vs draft (interpolated at T_mean) + deck cargo windage items in the load case |
| Z | Vertical distance from the centre of A to the centre of the underwater lateral area, or approximately to a point at one half the mean draft (m) | Windage table gives the centroid height above base h_A. Z = h_A − T_mean/2 (default) or h_A − h_U if the underwater lateral centroid is supplied |
| Δ | Displacement (t) | Load case |
| g | 9.81 m/s² | Constant |

### A.9.2 Angle of roll θ₁

```
θ₁ = 109 · k · X₁ · X₂ · √(r · s)          [degrees]
r  = 0.73 + 0.6 · OG / d,      OG = KG − d   (positive if G above waterline)
T_roll = 2 · C · B / √GM                    [s]
C  = 0.373 + 0.023 · (B/d) − 0.043 · (L_WL/100)
```

OG is computed with KG corrected for free surface (KG_fluid). This is the conservative choice: a higher G gives a larger roll angle θ₁. It must be confirmed by the reviewing naval architect.

where B = moulded breadth, d = mean moulded draught, L_WL = waterline length, C_B = block coefficient, GM = GM_fluid, and A_k = total overall area of bilge keels or area of lateral projection of bar keel, or the sum of these (m²).

**Table X₁ (factor from B/d)**

| B/d | ≤2.4 | 2.5 | 2.6 | 2.7 | 2.8 | 2.9 | 3.0 | 3.1 | 3.2 | 3.4 | ≥3.5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| X₁ | 1.00 | 0.98 | 0.96 | 0.95 | 0.93 | 0.91 | 0.90 | 0.88 | 0.86 | 0.82 | 0.80 |

**Table X₂ (factor from C_B)**

| C_B | ≤0.45 | 0.50 | 0.55 | 0.60 | 0.65 | ≥0.70 |
|---|---|---|---|---|---|---|
| X₂ | 0.75 | 0.82 | 0.89 | 0.95 | 0.97 | 1.00 |

**Table k (factor from A_k·100 / (L_WL·B))**

| A_k·100/(L·B) | 0 | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | 3.5 | ≥4.0 |
|---|---|---|---|---|---|---|---|---|
| k | 1.00 | 0.98 | 0.95 | 0.88 | 0.79 | 0.74 | 0.72 | 0.70 |

- k = 1.0 for a round-bilged ship with no bilge or bar keels. k = 0.7 for a ship with sharp bilges. Otherwise k comes from the table. The vessel record stores `bilgeType` (ROUND / SHARP) and A_k.

**Table s (factor from rolling period T_roll)**

| T (s) | ≤6 | 7 | 8 | 12 | 14 | 16 | 18 | ≥20 |
|---|---|---|---|---|---|---|---|---|
| s | 0.100 | 0.098 | 0.093 | 0.065 | 0.053 | 0.044 | 0.038 | 0.035 |

Intermediate values are linearly interpolated. When a parameter lies outside the table range (for example B/d > 3.5), the bounding value is used **and** an `OUT_OF_RANGE_PARAMETER` warning is raised. The code's alternative-assessment provisions may then apply. The parameter values used (r, s, X₁, X₂, k, T_roll, C) are all shown in the report.

### A.9.3 Angles and areas

```
θ₀  = heel at first intersection of l_w1 with GZ curve (steady wind heel)
θ_r = θ₀ − θ₁                    (angle of roll to windward; GZ evaluated at negative angles)
θ_x = first intersection of l_w2 with GZ curve
θ_c = second intersection of l_w2 with GZ curve
θ₂  = min(θ_f, 50°, θ_c)

Area a = ∫[θ_r → θ_x] (l_w2 − GZ) dθ        (wind lever above GZ)
Area b = ∫[θ_x → θ₂ ] (GZ − l_w2) dθ        (GZ above wind lever)
```

**Criteria**

| ID | Requirement |
|---|---|
| IS-2.3-AREA | Area b ≥ Area a |
| IS-2.3-HEEL | θ₀ ≤ 16° **and** θ₀ ≤ 0.8 × deck-edge immersion angle (whichever is less) |

If l_w2 never intersects the GZ curve (gust lever exceeds GZ_max), the criterion **fails**. The reason given is "gust heeling lever exceeds maximum righting lever".

---

## A.10 Margin of compliance and failure explanation

```
Margin (absolute) = Actual − Required        (for "≥" criteria)
Margin (%)        = (Actual − Required) / Required × 100
For "≤" criteria (θ₀): Margin = Required − Actual
Weather area: Margin = b − a ;  Ratio = b / a
```

Every failed criterion carries a **machine-generated explanation** built from templates, for example:

> *"Area 0°–30° = 0.048 m·rad is 0.007 m·rad (12.7%) below the 0.055 m·rad minimum. The main contributor is high KG_fluid (8.42 m), of which 0.21 m is free surface correction from 3 slack tanks (largest: No.2 DB WB (P) — 412 t·m). Consider pressing up or emptying slack tanks or lowering deck loads."*

The explanation engine ranks contributors by sensitivity (∂criterion/∂input, estimated by finite differences on KG, FSM and individual tank fillings). It **never** changes the loading on its own.

---

## A.11 Operational ("standard") checks

These are configurable per vessel and are not IMO criteria. Each is reported separately from the IMO criteria.

| Check | Typical limit source |
|---|---|
| Maximum draft (load line / seasonal zone) | Load Line certificate |
| Minimum forward draft (slamming) | Owner / class |
| Propeller immersion (aft draft) | Owner |
| Maximum trim (by head / stern) | Owner |
| Maximum static heel | Owner (default 1°) |
| Air draft | Owner, per voyage |
| Tank overfill (> 98%) | Owner |

---

## A.12 Regulatory traceability

| Engine function | Regulation reference (to be verified against current consolidated text) |
|---|---|
| `checkGeneralCriteria()` | IS Code 2008, Part A, §2.2.1–2.2.4 |
| `weatherCriterion()` | IS Code 2008, Part A, §2.3 (incl. Tables 2.3.4-1 to 2.3.4-4) |
| Free surface methods | IS Code 2008, Part B (free surface guidance) |
| Stability instrument behaviour, test conditions | MSC.1/Circ.1229, IACS UR L5 |
| Future: passenger crowding/turning | IS Code 2008, Part A, §3.1 |
| Future: timber deck cargo, grain, towing, MODU | IS Code 2008 Part A §3.x / Part B, International Grain Code |

---

## A.13 Verification and validation of the engine

1. **Benchmark vessels:** at least 3 real vessels with approved Trim & Stability Booklets. *All* booklet loading conditions are re-calculated. Tolerances follow the IACS UR L5 accuracy expectations (the class society's specific values govern at approval):

   | Quantity | Tolerance |
   |---|---|
   | Displacement | ±0.2% (target ±0.1%) |
   | Drafts | ±0.010 m (±0.050 m at large trim) |
   | GM | ±0.010 m (target ±0.005 m) |
   | GZ ordinates | ±0.010 m (target ±0.005 m) |
   | Areas | ±0.001 m·rad |

2. **Independent re-implementation:** a separate Python reference implementation (NumPy/SciPy), written from this appendix by a different engineer. The CI pipeline compares both engines on thousands of randomised load cases. Any difference above 1×10⁻⁶ relative fails the build.
3. **Unit tests** for every formula with hand-calculated values. These are reviewed and signed by the responsible Naval Architect.
4. **Property-based tests:** for example, increasing KG must never increase GM; emptying a slack tank must never increase FSC; GZ(0) = −TCG.
5. **Engine versioning:** semantic version; any change to numerical output is a MAJOR or MINOR version bump with a validation report. The engine version is stored in every calculation run.
