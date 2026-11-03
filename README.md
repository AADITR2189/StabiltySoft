# StabilitySoft — Vessel Stability Platform

**StabilitySoft** is a planned professional vessel stability software platform. It replaces Excel-based stability calculations with a controlled, audited and automated system.

It is delivered first as a **Progressive Web App (PWA)**: it runs in a web browser, can be installed like an app and works **offline onboard**. Later it can be packaged as a desktop or mobile application without being rewritten.

> **Status:** Design phase. This repository currently contains the complete design package. No application code has been written yet.

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

**Suggested reading order for non-technical readers:** this README, then the PRD, then the UI/UX Specification, then the Roadmap.

---

## Phase 1 scope in one paragraph

Phase 1 covers vessel database management (general particulars, lightship, hydrostatics, KN cross curves, tanks with calibration tables, windage data and down-flooding openings) and data import from Excel, CSV, PDF and Word with **mandatory human verification**. It also covers unlimited load cases, a complete **intact stability** calculation (displacement, drafts, trim, heel, KG, GM, free surface correction and GZ curve), **IMO IS Code 2008 general criteria and the Weather Criterion**, and PDF/Excel reports. All of this is offline-capable.

## Important regulatory note

Before StabilitySoft can be used as an *approved onboard stability instrument*, it needs **classification society type approval** (IACS UR L5, IMO MSC.1/Circ.1229) and **vessel-specific approval** of the installed data. Until then, every output is marked *"Not an approved stability instrument — for planning only"*. The architecture is designed from day one to meet these approval requirements (Phase 5).
