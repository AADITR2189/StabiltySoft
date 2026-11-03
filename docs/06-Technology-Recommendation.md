# Technology Recommendation

**StabilitySoft — Vessel Stability Platform**

| Item | Value |
|---|---|
| Document ID | SS-TECH-001 |
| Version | 0.1 (Draft) |
| Owner | Technical Lead |

## 1. Selection criteria (in priority order)

1. Engineering calculation accuracy and determinism
2. Offline capability (PWA) and smooth migration to desktop/mobile
3. Type safety and maintainability (TypeScript end to end)
4. Long-term scalability and ecosystem maturity
5. Developer availability and hiring
6. Auditability/security features

## 2. Recommended stack

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | **TypeScript 5.x (strict)** | One language for UI, API, engine, shared schemas. Strict typing with **branded unit types** prevents unit mix-ups | — |
| Monorepo | **pnpm + Turborepo** | Shared packages (engine, schemas, ui, report), fast cached builds | Nx |
| Frontend framework | **React 19 + Next.js (App Router)** | Mature ecosystem, excellent DX, static export for an offline PWA shell, SSR for marketing/portal pages | Vite + React (equally valid for a pure SPA; Next.js preferred per project priorities and for future web portal pages) |
| PWA / Service Worker | **Serwist** | Maintained Workbox successor with first-class Next.js integration | Workbox directly |
| UI components | **Radix UI primitives + Tailwind CSS** (design tokens) in our own `packages/ui` | Accessible primitives, full visual control for a premium look | MUI (heavier, harder to make bespoke) |
| Data grid | **AG Grid (Enterprise)** or **TanStack Table + virtualisation** | Spreadsheet-like editing, range paste, keyboard nav, 100k+ rows | Handsontable (licence), Glide Data Grid |
| Charts | **Apache ECharts** (GZ, hydrostatics, comparisons) + **D3/SVG** for bespoke ship diagrams (tank plan, profile, drafts) | ECharts: precise engineering charts, large data, SVG renderer for print. D3: full control over schematic drawings | Plotly (heavier), Recharts (less precise control) |
| Client state | **TanStack Query** (server/local data) + **Zustand** (UI state) | Simple, predictable, works with local-first data | Redux Toolkit |
| Local database | **IndexedDB via Dexie.js** (PWA); **SQLite** via adapter in Tauri/Capacitor | Reliable, transactional, large storage, offline | RxDB, PGlite (promising; re-evaluate), ElectricSQL / PowerSync (managed sync, re-evaluate for Phase 4) |
| Validation & API types | **Zod** schemas in `packages/schemas` → OpenAPI 3.1 | One source of truth for client validation, API validation and docs | TypeBox |
| Calculation engine | **Pure TypeScript package**, executed in a **Web Worker** (Comlink), and in Node on the server | Same code everywhere gives identical results. No network needed. Fast enough (≪ 100 ms). Custom correctly-rounded trig for bit-identical cross-platform results | Rust → WASM (consider later if heavy 3D damage-stability geometry needs more speed: the engine API stays the same) |
| Reference engine | **Python + NumPy/SciPy** (test-only) | Independent implementation for differential testing | — |
| Backend framework | **NestJS (Node.js 22 LTS, Fastify adapter)** | Structured modular monolith, DI, guards for RBAC, OpenAPI, shares TypeScript packages with the client | Next.js route handlers only (too thin for sync, jobs, RBAC at scale); Fastify standalone |
| ORM | **Prisma** | Type-safe schema & migrations, good DX. Raw SQL for RLS policies, partial indexes and triggers via migration SQL | Drizzle ORM (lighter, closer to SQL; good alternative) |
| Database | **PostgreSQL 16+** | Proven reliability, `jsonb` for extensibility, partial indexes, RLS for multi-tenancy, logical replication for future event streaming, PITR backups | — |
| Job queue | **pg-boss** (on PostgreSQL) | No extra infrastructure in Phase 1; transactional enqueue | BullMQ + Redis (when throughput demands) |
| File processing | **Python 3.12 + FastAPI** workers: **pdfplumber**, **Camelot**, **PyMuPDF**, **python-docx**, **openpyxl**, **Tesseract / PaddleOCR**, table-structure model (e.g. Microsoft Table Transformer) | Best-in-class open-source table extraction & OCR is in Python | Commercial: AWS Textract / Azure Document Intelligence (adapter-ready if customers allow cloud processing) |
| AI-assisted extraction (optional) | Vision-capable LLM via a provider adapter, e.g. the latest Claude model with JSON-schema-constrained output. Off by default; enabled per organisation | Handles messy scanned booklets. Output always unverified until a human confirms it | Self-hosted vision models for on-prem customers |
| Client-side spreadsheet parsing | **SheetJS (xlsx)** | Offline Excel/CSV import in browser | — |
| Report generation | **pdf-lib / @react-pdf/renderer** (PDF) + **ExcelJS** (XLSX), shared `packages/report` | Generated identically on client (offline) and server | Headless Chromium (server only; not offline) |
| Authentication | **OIDC** (Authorization Code + PKCE); **Keycloak** bundled; SSO with Entra ID/Okta/Google | Standards-based, enterprise SSO, MFA | Auth0/Clerk (SaaS dependency), Auth.js (less suited to offline/enterprise) |
| Offline auth/crypto | **WebCrypto** (AES-GCM) + **Argon2id (WASM)** for PIN-derived keys | Encrypted local data, device-bound offline unlock | — |
| Object storage | **S3-compatible** (AWS S3 / Azure Blob via S3 API / MinIO on-prem) | Originals and issued reports, object lock (WORM) | — |
| Desktop app (Phase 4) | **Tauri 2** | Small footprint, Rust core for native integrations (OPC-UA, Modbus), secure, reuses web build | Electron (larger, but acceptable fallback) |
| Mobile app (Phase 4) | **Capacitor** | Wraps the same web app, native plugins (file system, share, SQLite) | React Native (would need a UI rewrite) |
| Testing | **Vitest** (unit), **fast-check** (property), **Playwright** (E2E incl. offline), **Stryker** (mutation), **pytest** (fileproc & reference engine) | Strong coverage of the critical engine | Jest |
| Observability | **OpenTelemetry**, Grafana stack / Datadog, **Sentry** (client) | End-to-end tracing, error tracking | — |
| Infra & delivery | **Docker**, **Kubernetes** (Helm), **Terraform**, **GitHub Actions** | Portable SaaS and on-prem | — |
| Security tooling | Dependabot/Renovate, CodeQL, Trivy, SBOM (CycloneDX), OWASP ZAP | Supply-chain & app security, needed for class approval documentation | — |

## 3. Key decisions (ADR summary)

| ADR | Decision | Rationale | Consequence |
|---|---|---|---|
| ADR-001 | The calculation engine is a pure TS library shared by all runtimes | Identical results online/offline/server; traceability | Must avoid platform-specific math; custom trig functions |
| ADR-002 | Local-first client with an outbox sync, not "online app with cache" | Ships are offline for weeks | More complex sync; mitigated by append-only datasets & conflict copies |
| ADR-003 | Engineering data stored as immutable versioned datasets | Auditability, reproducibility, class approval | More storage (negligible); requires version UI |
| ADR-004 | Criteria as data + function registry | User criteria & future regulation without code changes per rule | Registry must be carefully versioned |
| ADR-005 | Python for file processing only | Best extraction libraries | Two languages; isolated behind queue/API |
| ADR-006 | NestJS modular monolith + PostgreSQL | Simplicity now, can split later | Module boundaries enforced by lint rules |
| ADR-007 | PostgreSQL `double precision` for engineering values | Exact match with JS doubles, no conversion drift | Display rounding handled in UI only |
| ADR-008 | Tauri/Capacitor for Phase 4 | Reuse the web build | Platform adapters needed from Phase 1 |

## 4. Accuracy safeguards built into the technology choices

1. **Branded unit types** in TypeScript (`Metres`, `Tonnes`, `Degrees`, `Radians`), so mixing units is a compile error.
2. **Single engine package**, versioned and pinned per calculation run.
3. **Deterministic math**: Kahan summation, own trig, no extrapolation, explicit tolerances.
4. **Differential testing** against an independent Python implementation.
5. **Benchmark suites** from approved stability booklets in CI.
6. **Mutation testing** to prove that the tests actually detect formula errors.
7. **Immutable data & runs** with SHA-256 hashes, so results can always be reproduced.

## 5. Scalability path

| Stage | Load | Architecture |
|---|---|---|
| Phase 1 | ≤ 50 orgs, ≤ 2,000 vessels | Single region, 2–3 API replicas, managed PostgreSQL, autoscaled fileproc |
| Growth | ≤ 1,000 orgs | Read replicas, CDN, partitioned audit/runs, BullMQ/Redis for jobs |
| Enterprise | Data residency, class portals | Multi-region org pinning, event streaming (Kafka/NATS), split services (Import, Reports, Sync) out of the monolith along existing module boundaries |
| Heavy compute (Phase 3) | 3D damage stability | Engine hot paths in Rust → WASM (client) / native (server), same engine API |

## 6. Licensing notes
- AG Grid Enterprise, Highcharts-type libraries and some OCR models have commercial licences. Budget them, or choose the open-source alternatives listed.
- Check licences of all PDF libraries (e.g. PyMuPDF is AGPL/commercial: a commercial licence is required for closed-source SaaS, or use pdfplumber/pypdfium2 instead).
