#!/usr/bin/env python3
"""
Extract vessel data and loading-condition benchmarks from the
MARSOL SPLENDOR preliminary intact stability booklet (GHS-style text layout).

Usage:
    python3 tools/extract_booklet.py "vessels/marsol-splendor/DU5864_1022_PRELIMINARY INTACT STABILITY BOOKLET_REV.0.pdf" vessels/marsol-splendor

Every value keeps the PDF page it came from, so it can be verified against the source.
Coordinates are converted ONCE from the booklet convention to the StabilitySoft convention:
    booklet:  longitudinal from MIDSHIP, "f" forward / "a" aft; transverse "s"/"p"
    internal: X from AP (+ forward), Y + starboard, Z from baseline
Nothing produced here is trusted until a person verifies it (status = "EXTRACTED").
"""
import json
import os
import re
import subprocess
import sys

LBP = 57.400
MIDSHIP_FROM_AP = LBP / 2  # booklet: AP at Fr.0, FP 57.400 fwd of AP, midship reference at LBP/2

NUM = r"-?[\d,]*\.?\d+"


def page_text(pdf, page):
    return subprocess.run(
        ["pdftotext", "-layout", "-f", str(page), "-l", str(page), pdf, "-"],
        capture_output=True, text=True, check=True,
    ).stdout


def num(tok):
    return float(tok.replace(",", ""))


def long_(tok):
    """'0.927f' -> +0.927 (fwd of midship), '1.081a' -> -1.081; returns X from AP."""
    m = re.fullmatch(rf"({NUM})([fa]?)", tok)
    if not m:
        raise ValueError(f"bad longitudinal token {tok!r}")
    v = num(m.group(1))
    if m.group(2) == "a":
        v = -v
    return round(MIDSHIP_FROM_AP + v, 6)


def trans(tok):
    """'3.353s' -> +3.353, '0.243p' -> -0.243."""
    m = re.fullmatch(rf"({NUM})([sp]?)", tok)
    if not m:
        raise ValueError(f"bad transverse token {tok!r}")
    v = num(m.group(1))
    return -v if m.group(2) == "p" else v


def trim_from_header(text):
    m = re.search(r"Trim:?\s*(aft|fwd)\s*([\d.]+)/57\.400", text)
    if m:
        t = float(m.group(2))
        return t if m.group(1) == "aft" else -t
    if re.search(r"No Trim|Trim zero", text):
        return 0.0
    raise ValueError("trim header not found")


# ---------------------------------------------------------------- hydrostatics
def hydrostatics(pdf, pages):
    tables = []
    for p in pages:
        t = page_text(pdf, p)
        trim = trim_from_header(t)
        rows = []
        for line in t.splitlines():
            toks = line.split()
            if len(toks) == 9 and re.fullmatch(r"\d+\.\d{3}", toks[0]):
                rows.append({
                    "draft": num(toks[0]), "displacement": num(toks[1]),
                    "lcb": long_(toks[2]), "kb": num(toks[3]), "lcf": long_(toks[4]),
                    "tpc": num(toks[5]), "mtc": num(toks[6]), "kml": num(toks[7]), "kmt": num(toks[8]),
                    "page": p,
                })
        tables.append({"trim": trim, "page": p, "rows": rows})
    return tables


# ---------------------------------------------------------------- cross curves
def cross_curves(pdf, pages):
    tables = []
    for p in pages:
        t = page_text(pdf, p)
        trim = trim_from_header(t)
        angles = None
        rows = []
        for line in t.splitlines():
            if line.strip().startswith("Displ"):
                angles = [float(a.rstrip("s")) for a in line.split()[1:]]
                continue
            toks = line.split()
            if angles and len(toks) == len(angles) + 1 and re.fullmatch(r"[\d,]+\.\d+", toks[0]):
                rows.append({"displacement": num(toks[0]), "kn": [trans(x) for x in toks[1:]], "page": p})
        tables.append({"trim": trim, "page": p, "angles": [0.0] + angles,
                       "rows": [{**r, "kn": [0.0] + r["kn"]} for r in rows]})
    return tables


# ---------------------------------------------------------------- tanks
TANK_HEAD = re.compile(r"Tank Capacities for (\S+)\s+containing\s+(.+?)\s*(?:\(([\d.]+)\))?\s*$")


def tank_tables(pdf, pages):
    tanks = []
    cur = None
    for p in pages:
        for line in page_text(pdf, p).splitlines():
            m = TANK_HEAD.search(line)
            if m:
                cur = {"name": m.group(1), "group": m.group(2).strip(),
                       "density": float(m.group(3)) if m.group(3) else None, "page": p, "rows": []}
                tanks.append(cur)
                continue
            if cur is not None and cur["density"] is None:
                md = re.match(r"\s*\(([\d.]+)\)", line)  # density wrapped onto the next line
                if md:
                    cur["density"] = float(md.group(1))
                    continue
            if cur is None:
                continue
            toks = line.split()
            if toks and re.fullmatch(r"[\d.]+%", toks[0]):
                pct = float(toks[0].rstrip("%"))
                if len(toks) == 3:  # 0 % row: no centroid
                    cur["rows"].append({"percent": pct, "volume": num(toks[1]), "weight": num(toks[2]),
                                        "lcg": None, "tcg": None, "vcg": None, "fsm": 0.0})
                elif len(toks) in (6, 7):
                    cur["rows"].append({
                        "percent": pct, "volume": num(toks[1]), "weight": num(toks[2]),
                        "lcg": long_(toks[3]), "tcg": trans(toks[4]), "vcg": num(toks[5]),
                        "fsm": num(toks[6]) if len(toks) == 7 else None,  # 100 % row has no FSM
                    })
    return tanks


# ---------------------------------------------------------------- loading conditions
def find(pattern, text, cast=float, default=None):
    m = re.search(pattern, text)
    return cast(m.group(1)) if m else default


def condition(pdf, first, last, cid, name):
    pages = {p: page_text(pdf, p) for p in range(first, last + 1)}
    alltext = "\n".join(pages.values())

    def page_of(snippet):
        for p, t in pages.items():
            if snippet in t:
                return p
        return None

    fs = {
        "draftFP": find(r"Draft FP\s+([\d.]+)", alltext),
        "draftMS": find(r"Draft MS\s+([\d.]+)", alltext),
        "draftAP": find(r"Draft AP\s+([\d.]+)", alltext),
        "trimRaw": find(r"Trim\s+([\d.]+[af]?)\s+m", alltext, str),
        "heelRaw": find(r"Heel\s+([\d.]+[sp]?)\s+deg", alltext, str),
        "lcg": long_(find(r"LCG\s+([\d.]+[af]?)\s+m\s+VCG", alltext, str)),
        "vcgSolid": find(r"VCG-Solid\s+([\d.]+)", alltext),
        "gmSolid": find(r"GM\(Solid\)\s+([\d.]+)", alltext),
        "fsc": find(r"F/S Corr\.\s+([\d.]+)", alltext),
        "gmFluid": find(r"GM\(Fluid\)\s+([\d.]+)", alltext),
        "kmt": find(r"KMT\s+([\d.]+)", alltext),
        "tpc": find(r"TPcm\s+([\d.]+)", alltext),
        "displacement": find(r"Displacement\s+([\d.]+)\s+MT", alltext),
        "page": page_of("Floating Status"),
    }
    tr = fs.pop("trimRaw")
    fs["trim"] = (float(tr[:-1]) if tr.endswith("a") else -float(tr[:-1])) if tr and tr[-1] in "af" else float(tr or 0)
    hr = fs.pop("heelRaw")
    fs["heel"] = trans(hr) if hr else 0.0

    # fixed weights (first "Fixed Weight Status" block)
    fixed = []
    fw_page = page_of("Fixed Weight Status")
    if fw_page:
        block = pages[fw_page].split("Fixed Weight Status", 1)[1]
        for line in block.splitlines():
            if line.strip().startswith(("Total", "Tank Status")):
                break
            m = re.match(rf"\s+(\S.*?)\s+(-?[\d,]+\.\d+)\s+(\S+[af]?|0\.000)\s+(\S+)\s+([\d.]+)\s*$", line)
            if m and not m.group(1).startswith("Item"):
                fixed.append({"description": m.group(1).strip(), "weight": num(m.group(2)),
                              "lcg": long_(m.group(3)), "tcg": trans(m.group(4)), "vcg": num(m.group(5)),
                              "page": fw_page})

    # tank loads
    tanks = []
    for p, t in pages.items():
        if "Tank Status" not in alltext:
            break
        for line in t.splitlines():
            toks = line.split()
            if len(toks) == 8 and re.fullmatch(r"[A-Z0-9_.]+", toks[0]) and re.fullmatch(r"\d\.\d{3}", toks[1]):
                try:
                    tanks.append({"name": toks[0], "sg": num(toks[1]), "percent": num(toks[2]),
                                  "weight": num(toks[3]), "lcg": long_(toks[4]), "tcg": trans(toks[5]),
                                  "vcg": num(toks[6]), "fsm": num(toks[7]), "page": p})
                except ValueError:
                    pass
    tank_totals = None
    m = re.search(r"Totals:\s+[\d.]+%\s+([\d,.]+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d,.]+)", alltext)
    if m:
        tank_totals = {"weight": num(m.group(1)), "lcg": long_(m.group(2)), "tcg": trans(m.group(3)),
                       "vcg": num(m.group(4)), "fsm": num(m.group(5))}

    # GZ table of the intact criteria (first block after "OSV CHEMICAL CODE")
    gz = []
    osv_page = None
    for p, t in pages.items():
        if "OSV CHEMICAL CODE" in t and "Righting" in t:
            osv_page = p
            body = t.split("OSV CHEMICAL CODE", 1)[1]
            for line in body.splitlines():
                mm = re.match(r"\s*([\d.]+)([sp])\s+([\d.]+)([af])\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)", line)
                if mm:
                    heel = float(mm.group(1)) * (1 if mm.group(2) == "s" else -1)
                    gz.append({"heel": heel, "gz": float(mm.group(6)), "area": float(mm.group(7))})
            break

    # criteria results blocks
    crit = []
    for p, t in pages.items():
        for line in t.splitlines():
            mm = re.match(r"\s*\((\d)\)\s+(.+?)\s+([<>])(-?[\d.]+)\s*(m-R|m|deg)?\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(Yes|No)", line)
            if mm:
                crit.append({"no": int(mm.group(1)), "text": mm.group(2).strip(), "op": mm.group(3),
                             "limit": float(mm.group(4)), "unit": mm.group(5) or "", "actual": float(mm.group(6)),
                             "margin": float(mm.group(7)), "pass": mm.group(8) == "Yes", "page": p})

    weather = {
        "steadyMoment": find(r"Total wind heeling moment\s+([\d.]+)", alltext),
        "gustMoment": find(r"(?:Stbd|Port) heeling moment\s*=\s*([\d.]+)", alltext),
        "rollAngle": find(r"Roll angle is\s+([\d.]+)", alltext),
    }
    wind_parts = []
    wp = page_of("Heeling Moment Derivation")
    if wp:
        for line in pages[wp].split("Heeling Moment Derivation", 1)[1].splitlines():
            mm = re.match(r"\s*([A-Z0-9_.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$", line)
            if mm:
                wind_parts.append({"part": mm.group(1), "area": float(mm.group(2)), "hcp": float(mm.group(3)),
                                   "arm": float(mm.group(4)), "moment": float(mm.group(6)), "page": wp})
    fifi = {
        "monitorForce": find(r"Reaction Force of the Fire Monitor\s*=\s*([\d.]+)", alltext),
        "monitors": find(r"Number of Fire Monitors\s*=\s*(\d+)", alltext),
        "monitorHeight": find(r"Height of firefighting monitor above baseline\s*=\s*([\d.]+)", alltext),
        "thrusterForce": find(r"Reaction Force of the Bow Thruster\s*=\s*([\d.]+)", alltext),
        "thrusterHeight": find(r"Height of Bow Thruster above baseline\s*=\s*([\d.]+)", alltext),
        "totalMoment": find(r"Total Heeling Moment\s*=\s*([\d.]+)", alltext),
    }
    fsm_used = [float(x.replace(",", "")) for x in re.findall(r"Free Surface Moment of ([\d,.]+) MT-m", alltext)]

    return {
        "id": cid, "name": name, "pages": [first, last], "floating": fs, "fixedWeights": fixed,
        "tanks": tanks, "tankTotals": tank_totals, "gz": gz, "gzPage": osv_page, "criteria": crit,
        "weather": weather, "windParts": wind_parts, "fifi": fifi, "fsmUsed": fsm_used,
    }


CONDITIONS = [  # (id, name, first pdf page, last pdf page)
    ("C1", "Condition 1: Lightship (not a sailing condition)", 32, 36),
    ("C2", "Condition 2: Fully loaded departure", 37, 47),
    ("C2T", "Condition 2.1: Fully loaded departure, max transverse crane operation", 48, 54),
    ("C2V", "Condition 2.2: Fully loaded departure, max vertical crane operation", 55, 61),
    ("C3", "Condition 3: Fully loaded arrival", 62, 71),
    ("C3T", "Condition 3.1: Fully loaded arrival, max transverse crane operation", 72, 78),
    ("C3V", "Condition 3.2: Fully loaded arrival, max vertical crane operation", 79, 85),
    ("C4", "Condition 4: Ballast departure (without cargo)", 86, 94),
    ("C4T", "Condition 4.1: Ballast departure, max transverse crane operation", 95, 100),
    ("C4V", "Condition 4.2: Ballast departure, max vertical crane operation", 101, 106),
    ("C5", "Condition 5: Ballast arrival (without cargo)", 107, 115),
    ("C5T", "Condition 5.1: Ballast arrival, max transverse crane operation", 116, 120),
    ("C5V", "Condition 5.2: Ballast arrival, max vertical crane operation", 121, 126),
]


def main():
    pdf, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    src = {"file": os.path.basename(pdf), "status": "EXTRACTED", "note": "Unverified: requires human verification against the source pages."}
    particulars = {
        "name": "MARSOL SPLENDOR", "imo": "9944376", "callSign": "3E3692", "flag": "PANAMA", "class": "BV",
        "type": "Supply vessel - fire fighting ship (well stimulation)",
        "loa": 62.8, "lbp": LBP, "breadth": 16.8, "depth": 5.3, "summerDraft": 4.2, "rhoRef": 1.025,
        "midshipFromAP": MIDSHIP_FROM_AP, "minDraftFwd": 2.451, "minDraftAft": 2.7,
        "lightship": {"weight": 1911.97, "lcg": long_("0.592a"), "tcg": trans("0.243p"), "vcg": 5.792, "page": 6,
                      "source": "Preliminary lightship weight estimation DU5864/1021"},
        "pages": {"particulars": 5, "lightship": 6, "conventions": 29},
    }
    data = {
        "source": src,
        "particulars": particulars,
        "hydrostatics": hydrostatics(pdf, range(129, 134)),
        "crossCurves": cross_curves(pdf, range(134, 139)),
        "floodPoints": [
            {"name": "POSITION 1(S)", "x": long_("9.700f"), "y": trans("5.400s"), "z": 12.15, "page": 139},
            {"name": "POSITION 1(P)", "x": long_("9.700f"), "y": trans("5.400p"), "z": 12.15, "page": 139},
            {"name": "POSITION 2(S)", "x": long_("10.300f"), "y": trans("6.300s"), "z": 12.15, "page": 139},
            # page 139 prints 6.300s for POSITION 2(P); the condition pages print 6.300p -> port used
            {"name": "POSITION 2(P)", "x": long_("10.300f"), "y": trans("6.300p"), "z": 12.15, "page": 139,
             "note": "Booklet p.139 shows 6.300s (typo); condition pages show 6.300p."},
        ],
        "tanks": tank_tables(pdf, range(158, 185)),
        "conditions": [condition(pdf, a, b, cid, name) for cid, name, a, b in CONDITIONS],
    }
    # Windage vs draft, derived from the "Heeling Moment Derivation" of the sailing conditions:
    # HCP = height of part centre above the waterline; Arm - HCP = depth of the underwater lateral centre.
    wind = []
    for c in data["conditions"]:
        if not c["windParts"]:
            continue
        T = c["floating"]["draftMS"]
        A = sum(p["area"] for p in c["windParts"])
        hA = sum(p["area"] * (p["hcp"] + T) for p in c["windParts"]) / A
        depthU = c["windParts"][0]["arm"] - c["windParts"][0]["hcp"]
        wind.append({"draft": T, "area": round(A, 3), "centroidZ": round(hA, 4),
                     "underwaterCentroidZ": round(T - depthU, 4), "condition": c["id"], "page": c["windParts"][0]["page"],
                     "check": {"steadyMomentBooklet": c["weather"]["steadyMoment"],
                               "steadyMomentRecomputed": round(0.0514 * sum(p["area"] * p["arm"] for p in c["windParts"]), 2)}})
    wind.sort(key=lambda r: r["draft"])
    # The sailing conditions only cover drafts 2.663-4.200 m. Extend linearly to the hydrostatic
    # range using the end segments. These rows are DERIVED and must be confirmed with the designer.
    def ext(a, b, T):
        f = (T - a["draft"]) / (b["draft"] - a["draft"])
        return {k: round(a[k] + f * (b[k] - a[k]), 4) for k in ("area", "centroidZ", "underwaterCentroidZ")}
    lo = {"draft": 2.25, **ext(wind[0], wind[1], 2.25), "extrapolated": True}
    hi = {"draft": 4.75, **ext(wind[-2], wind[-1], 4.75), "extrapolated": True}
    wind = [lo] + wind + [hi]
    data["windage"] = wind
    with open(os.path.join(out, "marsol-splendor.extracted.json"), "w") as f:
        json.dump(data, f, indent=1)
    h = data["hydrostatics"]; k = data["crossCurves"]
    print("hydrostatic tables:", [(t["trim"], len(t["rows"])) for t in h])
    print("cross curve tables:", [(t["trim"], len(t["rows"]), len(t["angles"])) for t in k])
    print("tanks:", len(data["tanks"]), [t["name"] for t in data["tanks"]])
    for c in data["conditions"]:
        print(c["id"], "disp", c["floating"]["displacement"], "tanks", len(c["tanks"]), "fixed", len(c["fixedWeights"]),
              "gz", len(c["gz"]), "crit", len(c["criteria"]), "wind", len(c["windParts"]), "fsm", c["fsmUsed"][:1])


if __name__ == "__main__":
    main()
