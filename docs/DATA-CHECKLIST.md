# Vessel Data Checklist

This is what we need to load a real vessel into StabilitySoft. Almost all of it is in the vessel's **approved Trim & Stability Booklet** (sometimes called the *Stability Information Booklet* or *Loading Manual*).

Send whatever format you have: **PDF, Excel, CSV, Word, or photos/scans**. Excel or CSV is fastest. PDF is fine.

> Start with **one vessel**. Once it is verified and working, the next vessels go much faster.

---

## 1. General particulars (usually the first pages of the booklet)

| Item | Example | Where to find it |
|---|---|---|
| Ship name, IMO number, call sign | MV OCEAN PIONEER, 9412345, 9V1234 | Booklet cover / ship certificates |
| Length overall (LOA) and length between perpendiculars (LBP) | 183.00 m / 176.00 m | "Principal particulars" |
| Breadth moulded, depth moulded | 32.20 m / 18.80 m | "Principal particulars" |
| Load line drafts (summer, winter, tropical, fresh) | 11.02 m … | Load Line certificate / booklet |
| Draft mark positions (if not at the perpendiculars) | Aft marks 2.5 m fwd of AP | Draft marks drawing / booklet |
| Keel plate thickness | 18 mm | Booklet (moulded vs. extreme draft) |
| Bilge keels: total area | 42.6 m² | Booklet or general arrangement |
| **How the booklet measures positions** | e.g. "LCG from midship, + forward" | Booklet "sign conventions" / notes |

## 2. Lightship

| Item | Where |
|---|---|
| Lightship weight, LCG, TCG, VCG (KG) | Inclining experiment results (booklet section "Lightship") |
| Date and reference of the inclining experiment | Same |

## 3. Hydrostatic table

The table of values for each draft. Columns we need (names vary between booklets):

| Needed | Also called |
|---|---|
| Draft | Draught, T, d (moulded or extreme, please note which) |
| Displacement | Δ, DISPL |
| LCB | Longitudinal centre of buoyancy, XB |
| LCF | Longitudinal centre of flotation, XF |
| KB | VCB |
| KM (transverse) | KMT, TKM |
| TPC | Tonnes per cm immersion |
| MTC | MCT 1 cm, moment to change trim |
| Block coefficient (C_B) | Cb |
| Waterline length (if given) | LWL |

Also tell us the **density** the table is calculated for (usually 1.025 t/m³). If there are several tables for different trims, send them all.

## 4. Cross curves (KN tables)

| Needed | Notes |
|---|---|
| KN values for each displacement and heel angle | Often titled "Cross curves of stability" or "KN table" |
| Whether they are "fixed trim" or "free trim" | Stated in the table heading |
| The VCG/KG the curves are referenced to | If the table is "GZ for assumed KG = x", tell us the assumed KG |

Finer tables give more accurate results. 5° steps up to at least 60° are ideal.

## 5. Tanks

For **every tank**:

| Item | Where |
|---|---|
| Tank name, type (ballast, fuel oil, fresh water, …), side (P/S/C) | Tank capacity plan |
| 100% capacity (m³) | Tank capacity plan |
| **Sounding table**: sounding → volume, LCG, TCG, VCG | Tank tables / calibration tables |
| Free surface data: FSM (t·m) or moment of inertia (m⁴) | Usually a column in the tank table |
| Default density of the liquid | Booklet |
| Whether the tank is a "consumable" tank | Booklet notes |
| Trim correction tables (if the booklet has them) | Tank tables |

## 6. Wind data (for the Weather Criterion)

| Item | Where |
|---|---|
| Projected lateral area above the waterline, by draft | "Windage area" / "Wind heeling lever" table |
| Height of the centre of that area, by draft | Same table |

If the booklet only gives the **wind heeling lever** directly, send that and we'll use it.

## 7. Down-flooding

| Item | Where |
|---|---|
| Flooding angle table (angle vs. displacement or draft) | Booklet "Flooding angle" / "Downflooding points" |
| or: list of openings with positions (x, y, z) | Booklet "Unprotected openings" |

## 8. Test conditions (very important)

Send **all loading conditions printed in the booklet** (e.g. "Lightship", "Ballast departure", "Full load arrival"). For each one we need the **tank fillings, weights and the printed results** (draft, trim, GM, GZ values, criteria).

We use these to **prove the software matches the approved booklet** before anyone relies on it. This is the same method classification societies use.

---

## How we will check your data together

1. You send the files.
2. I extract the tables and show them to you **next to the source pages**.
3. You confirm the values, or point out errors. Nothing is used until you confirm.
4. I recalculate every booklet test condition and show you the differences.
5. When everything matches within tolerance, the vessel is ready to use.
