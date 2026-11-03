# Product Requirements Document (PRD)

**StabilitySoft — Vessel Stability Platform**

| Item | Value |
|---|---|
| Document ID | SS-PRD-001 |
| Version | 0.1 (Draft) |
| Owner | Product Manager |
| Related | SS-SRS-001, SS-ARCH-001, SS-UX-001, SS-ROAD-001 |

---

## 1. Vision

> **Make every stability calculation onboard and ashore correct, traceable and effortless. No hidden formulas, no copy-paste errors, no uncertainty about which data version was used.**

StabilitySoft replaces fragile, vessel-specific Excel workbooks with one professional platform. It offers the engineering rigour of tools like NAPA or Maxsurf Stability, while a Chief Officer can use it at 0200 before departure, offline, with confidence.

### 1.1 Product principles
1. **Accuracy first.** One validated engine, one formula reference (Appendix A), benchmarked against approved booklets.
2. **Nothing is trusted until verified.** Imported data, AI-extracted data and manual data all go through verification.
3. **Every number explains itself.** Click any value to see its formula, inputs and data source.
4. **Built for the ship, not just the office.** Offline-first, low bandwidth, simple workflows.
5. **Extensible by design.** New stability modules plug in, without rewrites.
6. **Premium and calm.** Dense engineering information, presented with clarity.

### 1.2 Problem statement

| Today (Excel) | Consequence |
|---|---|
| Values typed or copy-pasted from PDF booklets | Transcription errors that go unnoticed |
| Formulas visible and editable in cells | Accidental or undocumented formula changes |
| Many copies of "the" spreadsheet | No one knows which version is correct |
| Load cases stored as separate files / sheets | Hard to compare, archive, audit |
| Criteria checked by eye or ad hoc formulas | Missed failures, no margins, no explanations |
| No audit trail | Cannot demonstrate due diligence to PSC, class or charterers |

### 1.3 Goals and success metrics

| Goal | Metric | Target (12 months after launch) |
|---|---|---|
| Eliminate calculation errors | Discrepancies vs approved booklet conditions | 0 outside tolerance |
| Eliminate transfer errors | Datasets activated without verification | 0 (enforced) |
| Faster condition preparation | Median time to prepare a departure condition | ≤ 15 min (vs ~60 min Excel) |
| Adoption | Fleet vessels with active database | ≥ 90% of pilot fleet |
| Trust | Officer satisfaction (SUS score) | ≥ 80 |
| Auditability | Reports traceable to calculation run hash | 100% |

### 1.4 Non-goals (Phase 1)
- Damage stability, grain, timber, towing, MODU, passenger criteria (planned later)
- Longitudinal strength (shear force / bending moment), planned with Phase 2/3
- 3D hull modelling or hydrostatic generation from hull geometry
- Real-time tank gauging integration
- Class type approval (prepared for, delivered in Phase 5)

---

## 2. Personas

### 2.1 Capt. Elena Novak — Master (primary onboard user)
- **Context:** 15 years at sea, product tanker. Prepares or approves every departure condition. Often offline mid-ocean.
- **Goals:** Get a compliant condition quickly. Be certain it's correct. Print a report for the port state control file.
- **Frustrations:** The Excel workbook "breaks" when cells are overwritten. She cannot tell whether the KN values are right. Slow ship computer.
- **Needs:** Clear Pass/Fail with margins. Simple tank entry (soundings straight from the gauging log). Works without internet.

### 2.2 Ravi Menon — Chief Officer (primary onboard user)
- **Context:** Responsible for ballast and cargo planning. Plans several conditions per voyage (departure, mid-voyage, arrival).
- **Goals:** Try "what-if" ballast changes and see GM and criteria react instantly. Compare departure vs arrival.
- **Frustrations:** Re-typing the same tank data. Copying sheets to make arrival conditions.
- **Needs:** Duplicate + arrival generator, compare view, real-time GZ curve, keyboard-friendly grids.

### 2.3 Dr. Sofia Lindqvist — Fleet Naval Architect (data owner)
- **Context:** Ashore. Supports 40 vessels. Owns all stability data and is accountable to class.
- **Goals:** Build accurate vessel databases from stability booklets (mostly PDF). Control what data is live. Prove correctness.
- **Frustrations:** Manual transcription of 3,000+ table values per ship. No version control.
- **Needs:** Strong import with side-by-side verification, validation rules, approval workflow, version history, benchmark comparison against booklet conditions.

### 2.4 Mark Owusu — Technical Superintendent (reviewer)
- **Context:** Ashore. Reviews conditions of 8 vessels, responds to vetting/PSC questions.
- **Goals:** See fleet compliance at a glance. Review a vessel's condition remotely.
- **Needs:** Fleet dashboard, read-only access, comments, report downloads.

### 2.5 Aisha Rahman — Class Surveyor / Auditor (external, occasional)
- **Goals:** Verify that the calculation method and data are as approved.
- **Needs:** Read-only audit access, calculation traces, dataset provenance, engine version info.

---

## 3. User Stories

Format: *As a [persona], I want [capability] so that [benefit].* Each story has acceptance criteria (AC).

### Epic E1 — Vessel Database
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-101 | As a Naval Architect, I want to create a vessel with its general particulars so that it can hold stability data. | IMO number check-digit validated; required fields enforced; vessel appears in fleet list. | VDB-001..003 |
| US-102 | As a Naval Architect, I want to enter lightship data with its source (inclining report) so that the basis of every calculation is documented. | Lightship stored as a versioned dataset with source reference; old versions viewable. | VDB-004 |
| US-103 | As a Naval Architect, I want each dataset to have Draft/Verified/Active status so that only approved data is used. | Calculations only use ACTIVE datasets; badge visible everywhere. | VDB-005..007 |
| US-104 | As a Naval Architect, I want to choose per dataset whether it's imported or manually entered so that I can mix sources. | Hydrostatics imported while lightship is manual. Imported dataset rejects free edits. | DSM-001..005 |

### Epic E2 — Import & Verification
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-201 | As a Naval Architect, I want to upload the stability booklet PDF and have tables detected automatically so that I avoid manual typing. | Tables detected and listed with page numbers; each can be assigned to a dataset type. | IMP-001..003 |
| US-202 | As a Naval Architect, I want to see the PDF page beside the extracted table so that I can check every value. | Synchronised highlight between cell and source region. | IMP-004 |
| US-203 | As a Naval Architect, I want low-confidence values highlighted so that I focus on likely errors. | Cells below threshold marked; must be confirmed individually or by row. | IMP-006 |
| US-204 | As a Naval Architect, I want validation (monotonic draft, KM = KB + BM, etc.) to run before saving so that obvious errors are caught. | Errors block, warnings need acknowledgement. | IMP-009 |
| US-205 | As a Naval Architect, I want to save column-mapping templates per shipyard so that sister ships import faster. | Template reused; mapping auto-applied with confirmation. | IMP-005 |
| US-206 | As a second Naval Architect, I want to approve a verified dataset so that the four-eyes rule is satisfied. | Verifier ≠ approver when enabled; audit entry created. | SEC-003 |

### Epic E3 — Tanks & Weights
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-301 | As a Chief Officer, I want to enter a tank by sounding so that I can use the gauging log directly. | Volume, weight, %, centroids and FSM shown instantly. | TNK-003..004 |
| US-302 | As a Chief Officer, I want to enter tanks by %, volume or weight interchangeably so that I can use whatever figure I have. | Any mode converts; mode is shown per row. | TNK-003 |
| US-303 | As a Chief Officer, I want to be warned when a tank is above 98% so that I don't plan overfilling. | Warning icon and message; > 100% blocked. | TNK-006 |
| US-304 | As a Chief Officer, I want to add variable weights like provisions and deck cargo so that the condition is complete. | Weight with LCG/TCG/VCG; deck cargo windage optional. | WGT-001..002 |
| US-305 | As a Master, I want a tank plan coloured by fill so that I can see the ballast distribution at a glance. | Profile + plan; hover shows %, t, m³. | TNK-007 |

### Epic E4 — Load Cases
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-401 | As a Chief Officer, I want to create a departure condition so that I can check stability before sailing. | Load case created from blank or template; saved in vessel. | LC-001..002 |
| US-402 | As a Chief Officer, I want to duplicate the departure and generate the arrival with 10% consumables so that I don't retype. | Arrival generated; consumption % per tank group editable. | LC-003, LC-009 |
| US-403 | As a Master, I want to compare departure vs arrival side by side so that I can see how stability changes. | Up to 4 cases; differences highlighted; GZ curves overlaid. | LC-004 |
| US-404 | As a Master, I want to lock a condition when I issue its report so that it cannot change afterwards. | Locked; edits require "Revise" → Rev N+1. | LC-007 |
| US-405 | As a Chief Officer, I want to archive old voyages' conditions so that my list stays clean. | Archived hidden by default; restorable. | LC-006 |

### Epic E5 — Stability & Criteria
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-501 | As a Chief Officer, I want drafts, trim, heel and GM to update as I type so that I can plan ballast interactively. | ≤ 300 ms update. | CALC-010 |
| US-502 | As a Master, I want the GZ curve with the IMO areas and markers so that I understand the margin visually. | Chart per GZ-001. | GZ-001 |
| US-503 | As a Master, I want a clear PASS/FAIL per criterion with margin so that I know how close I am to limits. | Required, actual, margin %, icon + text. | CRIT-004 |
| US-504 | As a Master, I want the system to explain why a criterion fails so that I know what to change. | Plain-language explanation with main contributors. | CRIT-004 |
| US-505 | As a Naval Architect, I want to click any result and see the formula and inputs so that I can verify the calculation. | Trace panel for every computed value. | UI-005 |
| US-506 | As a Naval Architect, I want to define company criteria (e.g. min GM 0.50 m) so that internal policies are checked. | Non-statutory criteria labelled as such. | CRIT-007 |

### Epic E6 — Reports
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-601 | As a Master, I want a professional PDF report so that I can file and show it to PSC/charterers. | All sections per RPT-001, offline. | RPT-001..003 |
| US-602 | As a Superintendent, I want the report in Excel so that I can do further analysis. | Values-only xlsx. | RPT-002 |
| US-603 | As an Auditor, I want to verify a report's authenticity so that I can trust it. | Run hash/QR resolves to stored run. | RPT-004 |

### Epic E7 — Offline, Sync, Security
| ID | Story | Acceptance criteria | SRS |
|---|---|---|---|
| US-701 | As a Master, I want the app to work fully offline so that I can use it mid-ocean. | All Phase 1 functions except PDF/Word extraction work offline. | OFF-001 |
| US-702 | As a Superintendent, I want onboard conditions to appear ashore after sync so that I can review them. | Synced when online; status visible. | OFF-004..006 |
| US-703 | As an Org Admin, I want to assign roles per vessel so that crews only see their ship. | RBAC per vessel. | SEC-002 |
| US-704 | As an Auditor, I want a tamper-evident audit log so that records are trustworthy. | Hash-chained log; export. | SEC-004 |

---

## 4. Functional Requirements (summary)

The authoritative list is in **SS-SRS-001 §3.2**. In summary by module:

| Module | Key capabilities |
|---|---|
| Vessel Database | Unlimited vessels; particulars; lightship; versioned datasets with approval workflow |
| Hydrostatics | Full tables, trimmed tables (S), validation, curves |
| KN Curves | Matrix storage, fixed/free trim, validation, family-of-curves plot |
| Tanks | Calibration tables; 5+ input modes; FSM; tank plan |
| Solid Loads | Fixed & variable weights; libraries; deck cargo windage |
| Load Cases | Unlimited; duplicate; compare; export; archive; lock & revise; arrival generator |
| Stability | Displacement, drafts, trim, heel, KG, GM, FSC, GZ, down-flooding, wind levers |
| Criteria | IS Code 2008 §2.2 + §2.3; Pass/Fail; margins; explanations; data-driven rules |
| Import | xlsx/csv/pdf/docx; detection; mapping; side-by-side verification; mandatory sign-off |
| Reports | PDF/Excel; traceability appendix; immutable issued reports |
| Platform | Offline PWA; sync; RBAC; audit log; dark/light themes |

## 5. Non-Functional Requirements (summary)

| Category | Requirement |
|---|---|
| Accuracy | Within SS-CALC-001 §A.13 tolerances vs approved booklets |
| Performance | Recalc ≤ 300 ms; cold start ≤ 3 s; report ≤ 5 s |
| Offline | 100% of Phase 1 features except PDF/Word extraction |
| Security | OIDC/MFA, RBAC, RLS, encryption at rest/in transit, OWASP ASVS L2 |
| Auditability | Immutable calculation runs, hash-chained audit log, reproducible results |
| Usability | SUS ≥ 80; new officer productive in ≤ 30 min |
| Accessibility | WCAG 2.2 AA |
| Portability | Same codebase → PWA, Tauri desktop, Capacitor mobile |
| Scalability | ≥ 1,000 vessels / 100k load cases per org |
| Maintainability | Engine coverage ≥ 90%; strict typing; semantic versioning |

## 6. Release criteria (Phase 1 GA)
1. All Must requirements implemented and verified.
2. Three benchmark vessels pass all booklet conditions within tolerance.
3. Independent engineering review of Appendix A signed off.
4. Pen-test: no open High/Critical findings.
5. 2-vessel onboard pilot of ≥ 4 weeks with ≥ 1 full offline voyage.

## 7. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PDF extraction quality varies widely across booklets | High manual effort | Side-by-side verification UI, mapping templates, AI-assist, manual-entry fallback |
| Tabulated hydrostatics inaccurate at large trim | Wrong drafts | Trimmed tables (free-trim), `LARGE_TRIM_ACCURACY` warning, Phase 3 hull model |
| Users treat unapproved software as approved | Regulatory exposure | Mandatory disclaimer until class approval (RPT-006) |
| Offline conflicts | Lost work | Never auto-merge; keep both versions |
| Engine discrepancy client vs server | Trust loss | Same code package, server re-verification (CALC-013), dual implementation testing |
| Scope creep into damage stability | Delay | Strict phase gates; module architecture prepared, not implemented |
