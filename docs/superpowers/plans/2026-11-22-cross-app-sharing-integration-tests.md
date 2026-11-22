# Cross-App Integration Testing Plan: Sharing Folders & Datatypes with Fotos, VGER, Akte, and Edda

Status: in progress (Phase 0–2 + owner-scoped health shipped; Phase 3 Edda 4-instance clinical suite pending)
Date: 2026-11-22
Spec: [folder-layout-demand-and-collections.md](../../folder-layout-demand-and-collections.md) (revision 5)
Related plans: [2026-11-22-tag-core-slice2.md](2026-11-22-tag-core-slice2.md)

## Goal

Enhance Filer's integration test suite to prove real, multi-process, CHUM-synced
folder and datatype sharing between **Filer** and all four partner products —
**Fotos**, **VGER**, **Akte**, and **Edda** — over disposable local ONE
instances and a loopback `CommunicationServer` relay.

The partner suites share architectural invariants and exercise them according to
each product's disclosure and adoption rules.

- **Real process and ownership boundaries:** Filer runs in its own child process
  using the exact live `stdio-main.ts` projection stack (`FilerRuntime` +
  `CombinedFilerProjection` + `PublishedWorkingSet` + `FileProviderOperations`);
  each partner runs in its own child process with its own ONE store and domain
  recipes. Filer never imports partner internals to pass a test.
- **Real `origin === 'import'` CHUM delivery:** closes the single-runtime
  self-share gap from Slice 1 unit tests by proving genuine cross-instance
  pairing, `Assembly` verification, `GraphReleaseSelectionHead` causal tip
  resolution, cut replacement, out-of-order cut arrival, signed retirement, and
  restart durability.
- **Content vs. metadata separation:** content stays pure content-addressed
  data; ownership travels on verified `Assembly` envelopes; access is assigned
  by the sending app from context; tags travel as pinned `TagShareCut`s like any
  other data.

## What exists today (verified against repos, 2026-11-22)

- **Filer (`filer/scripts/`):**
  - `test-files-collections-integration.mjs` + `files-collections-integration-worker.mjs`:
    spawns two independent forked Node ONE instances against a loopback
    `CommunicationServer`, pairs them, and drives `FileProviderOperations` RPC +
    `HeadlessObjectsEndpoint`.
  - `test-demand-supply-grant-integration.mjs`: tests `RuntimeDemand` /
    `RuntimeSupply` / `AccessCertificate` across two forked workers.
  - `test-fotos-integration.mjs`, `test-glue-fotos-filer-integration.mjs`,
    `test-model-weights-integration.mjs`: single-domain harnesses.
  - **Gaps:** none of the forked two-instance scripts exercise Slice 1's live
    `CombinedFilerProjection` + `GraphReleaseSelectionHead` + `FilerShareCut`
    stack yet, and there is no integration test against **VGER**, **Akte**, or
    **Edda**.
- **Partner repositories (verified sibling checkouts under `../`):**
  - **Fotos (`../fotos`):** `fotos.core` (`FotosEntry`, `FotosMediaVariant`,
    `FotosManifest`, `FotosFileSystem`, `SharedFotosFileSystem`, EXIF ingest,
    face clusters), `fotos.headless`.
  - **VGER (`../vger`):** `vger.headless` (`server.ts`, `vger.core` modules,
    `TargetSettingsStorage`, `AssemblyReleasePlan`, `ModelWeightsPlan`,
    `chat.core`).
  - **Akte (`../akte`):** `akte.dokument` (`DokumentIntakeRecord`,
    `PdfImportPolicy`, `DokumentTextprojektion`, `DokumentOfficeProjektion`,
    `DokumentOcrProjektion`), `akte.crm`, `akte.calendar`, `buchhaltung.core`,
    `akte.headless`, `qa.akte`.
  - **Edda (`../one.edda`):** `edda.core` (`ClinicalDocumentRef`,
    `ClinicalReport` with `draft | ready_for_approval | approved`,
    `QuestionnaireResponse`, `CareEpisode`, `ClinicalBaseline`,
    `DirectCareConsent`, StudyCenter/role credentials), `health.core`,
    `edda.cube` (`test:release:six-instance`).

## Shared Integration Test Architecture

Create a single reusable harness in `filer/scripts/integration/` so all four
partner suites share identical process lifecycle, pairing, tracing, and
assertion helpers:

```text
filer/scripts/integration/
├── harness.mjs                  # Loopback CommunicationServer, mkdtemp, worker spawn/restart, IPC, JSON traces
├── filer-worker.mjs             # Real FilerRuntime + CombinedFilerProjection + PublishedWorkingSet + FileProviderOperations
├── assertions.mjs               # Shared 8-point contract assertions (browse, hydrate, delta, out-of-order, retire, restart, EPERM)
├── workers/
│   ├── vger-worker.mjs          # VGER peer/IoM worker (FilerShareCut, TagShareCut, filer.folders settings, ModelWeights)
│   ├── fotos-worker.mjs         # Fotos peer/IoM worker (FotosEntry + EXIF/GPS/faces + TagShareCut / FotosShare)
│   ├── akte-worker.mjs          # Akte peer worker (DokumentIntakeRecord admitted/rejected + case-folder cuts)
│   └── edda-worker.mjs          # Edda StudyCenter / Clinician / Patient / Foreign-Filer workers
├── test-files-chum.mjs          # Phase 0: 2-instance Slice-1 Filer↔Filer CHUM proof
├── test-vger-integration.mjs    # Suite A: Filer ↔ VGER
├── test-fotos-integration.mjs   # Suite B: Filer ↔ Fotos
├── test-akte-integration.mjs    # Suite C: Filer ↔ Akte
└── test-edda-integration.mjs    # Suite D: Filer ↔ Edda
```

### Harness rules

- **No polling or sleep loops:** every transition waits on an owning event
  (`paired`, `changed`, `assemblyAccepted`, `projectionCommitted`), with a
  single fail-fast deadline only to prevent hung CI runs.
- **Same composition as production `stdio-main.ts`:** the worker and the native
  entry point use the same `createFileProviderOperations` factory to bind
  `FilerRuntime` to the combined projection and published working set. The
  worker exposes `FileProviderOperations.handle` and fixture controls over
  child-process IPC.
- **Sibling path resolution:** extend `test-support/one-workspace-paths.js` to
  resolve `../one`, `../fotos`, `../vger`, `../akte`, and `../one.edda` with a
  clear fail-fast error if a partner repo is absent or unbuilt. Never reference
  `../one-experimental`.
- **Machine-readable evidence:** emit `TRACE <event> <json>` lines (matching
  `test-files-collections-integration.mjs`) and optional `--report <path>` JSON
  output compatible with `docs/qa-evidence/`.

---

## Common Contract Matrix

The suites reuse `assertions.mjs` for the applicable checks below.

| # | Invariant | What is asserted |
| --- | --- | --- |
| C1 | **Zero leakage on pairing** | After pairing, before any share or while the category is undemanded, Finder lists no peer folder; undemanded peer supply reports `*-awaiting-demand` in `status.json` without creating a top-level root. |
| C2 | **Authorized CHUM delivery & exact hydration** | A signed release and selection head cross CHUM and reach `AssemblyPlan.accept()` with `origin: 'import'`. After the applicable category demand or clinical authorization is satisfied, `enumerateItems` and `getItem` agree, and `readItemContent` returns the exact bytes identified by the source SHA-256. |
| C3 | **In-place replacement & `FilerDelta` streaming** | Replacing Cut 1 with Cut 2 (add file, remove file, edit bytes, rename share label, rename partner `Profile`) updates Finder via `getChanges` while keeping stable `filer:<hash>` IDs for surviving/edited paths and removing retracted entries. |
| C4 | **Out-of-order cut safety** | Delivering superseded Cut 1 / `head1` *after* Cut 2 or *after* a signed withdrawal never resurrects removed files. |
| C5 | **Signed retirement & empty-folder cleanup** | `retireGraphReleaseSelection()` writes a signed `'retired'` `GraphReleaseSelectionHead` → share folder, `<person>/`, and `Geteilt/` disappear reactively; working-set `getChanges` expires cleanly. |
| C6 | **Read-only & provenance guards** | Writes under `Geteilt/` and `Berichte/` fail with `-30`; `createFile('/Files', ..., 'Geteilt')` fails with `-30`; unaccepted cuts or forged objects claiming `owner`/`createdBy` never project; remote peers cannot push `FilerProjectionHead` / `FilerSnapshot` / `FilerDelta` / `FilerItem` past `importFilter`. |
| C7 | **Multi-view & distinct Finder IDs** | Where multiple views are supported, the same immutable item appears across views with identical `contentVersion` (`SHA256Hash`), one BLOB, and distinct `filer:<hash>` IDs per appearance. |
| C8 | **Restart durability** | Restarting Filer (and the partner) on the same storage directory preserves category demand, accepted selection heads, committed `FilerProjectionHead`, and never resurrects retired or replaced cuts. |

| Suite | Required invariants | Domain-specific application |
| --- | --- | --- |
| A — VGER | C1–C6, C8. C7 in Phase 2. | Exercise C7 with shared tags. Exercise the Files release and IoM folder controls independently. |
| B — Fotos | C1–C8 in Phase 2. | For C7, compare the same original across shared, time, place, and approved-person views. An explicit copy creates a new locally owned record referencing the same BLOB. |
| C — Akte | C1–C6, C8. C7 in Phase 2. | Use admitted case documents for C7. Keep rejected intake records outside the published cut. |
| D — Edda | C1–C8 in Phase 3. | Apply C1 and C2 using role and instance authorization. Apply C3 to the live care selection and assert immutability for pinned reports. Apply C7 only to authorized live record views. Policy-disallowed adoption returns `EPERM`. |

---

## Partner Suites & Datatype Coverage

### Phase 0 — Two-Instance Slice-1 Baseline (`pnpm test:integration:files`)

Upgrades the single-runtime Slice-1 tests (`FileProviderSharesEndToEnd.test.ts`)
to two real forked ONE instances over loopback `CommunicationServer`:

- **Datatypes:** `FilerShareCut`, `FilerStoredEntry`, `BLOB`,
  `GraphReleaseState` (`audience: Person`), `GraphReleaseSelectionHead`,
  `RuntimeDemand` (`tag:category:files`).
- **First gate:** pair two independent stores, accept the signed cut and head
  through CHUM with `origin === 'import'`, verify that the undemanded share is
  absent, then demand the category and verify the exact SHA-256 and bytes
  through File Provider operations. Exercise replacement deltas with stable
  IDs, read-only writes, signed retirement, and restart durability.
- **Fault injection:** hold the sender's grant for the cut Assembly while
  its signed head arrives. Deliver the raw cut payload and verify the
  previous snapshot and anchor stay current until the Assembly is accepted.
  Deliver another held cut after its selection retires and check that
  the folder stays absent across restart. Offer each valid projection
  fixture under a separate grant, verify CHUM's decline receipt, and check
  that the receiver's store contains none of the declined versions.

---

### Suite A — Filer ↔ VGER (`pnpm test:integration:vger`)

Tests VGER as both a **peer sharer** and an **IoM management hub** for Filer:

- The worker loads the sibling VGER build's `NativeHeadlessCore` and the
  canonical `CoreModule` with the Files and IoM recipe inventory. The
  harness wires the signed exchange and settings grant to those owners.
  Build the VGER native artifacts before running this suite.

- **Datatypes:**
  - `FilerShareCut` + `FilerStoredEntry` + `BLOB` (shared project folders).
  - `TagShareCut` (post-Slice 2: shared `TagSetDefinition` + `unionOfSets` +
    `TagBinding`s + `TagDefinition`s).
  - `TargetModuleSettings` (`filer.folders` / remote device settings from
    `device-settings-in-your-devices.md`) + `RuntimeDemand` (`tag:category:files`).
  - `ModelWeight*` (verifies `CombinedFilerProjection` interleaves
    `ModelWeightsPlan` and `AcceptedSharesProjection` cleanly without anchor or
    ID collisions).
- **Scenarios:**
  1. **Peer folder share (VGER → Filer):** VGER publishes a multi-directory
     `FilerShareCut` → Filer browses and hydrates under `/Files/Geteilt/<vger-name>/<folder>/`,
     updates in place on Cut 2, and cleans up on signed retirement.
  2. **Bidirectional share (Filer → VGER):** Filer publishes a `FilerShareCut`
     back to VGER's `AssemblyReleasePlan`; VGER verifies the cut through its
     accepted Frontier and reads exact bytes.
  3. **IoM remote control:** VGER (paired in the same IoM) toggles Filer's
     category visibility/demand remotely → Filer applies reactively, updates
     `status.json`, and mounts/hides the projected folder without restart.
  4. **Shared-tag collision test (post-Slice 2):** Both VGER and Filer tag
     different files with `tag:urlaub`. VGER shares its `Urlaub` collection via
     `TagShareCut` → Filer shows VGER's files under `Geteilt/<vger>/Urlaub/`
     with zero leakage into Filer's local `/Urlaub/`.
  5. **Coexistence with `ModelWeightsPlan`:** `CombinedFilerProjection`
     enumerates and streams deltas for both `/ONE/System/models/` and
     `/Files/Geteilt/` under one working-set anchor.

---

### Suite B — Filer ↔ Fotos (`pnpm test:integration:fotos`)

Tests Fotos photo libraries, media originals, EXIF/GPS/face metadata, and
multi-view projections under `/Bilder/` (and `/Fotos/` during migration):

- The first live suite uses the existing `/Fotos` mount. It verifies
  accepted-cut views, approved bindings, exact original BLOB hydration, and
  an explicit copy into the local `/Files` root across retirement and restart.

- **Datatypes:**
  - `FotosEntry`, `FotosMediaVariant`, original JPEG/PNG `BLOB`s (reusing real
    EXIF JPEG fixtures from `test-fotos-integration.mjs` / `fotos.core`).
  - `TagShareCut` with pinned `TagSetDefinition` (collection + cyclic
    `unionOfSets` include), `TagDefinition`, imported `tag:time:YYYY-MM` and
    `tag:place:<slug>` bindings, and suggested `tag:person:<personId>` bindings.
  - Legacy bridge check: existing `FotosShareCertificateChain` /
    `FotosShareManifest` continues to pass until Slice 4 convergence retires it.
- **Scenarios:**
  1. **Collection share & original byte fidelity:** Fotos shares a collection
     containing an EXIF-dated, GPS-tagged JPEG (`2026-03`, `Wien`) → Filer
     hydrates exact original bytes (never thumbnail bytes) under
     `/Bilder/Geteilt/<fotos-user>/<collection>/`.
  2. **Multi-view projection with distinct Finder IDs (post-Slice 3):** The same
     immutable photo projects simultaneously into:
     - `/Bilder/Geteilt/<fotos-user>/<collection>/photo.jpg`
     - `/Bilder/Zeit/2026/03/photo.jpg`
     - `/Bilder/Orte/Wien/photo.jpg`
     with identical `contentVersion` (`SHA256Hash<BLOB>`), zero duplicated BLOBs,
     and distinct stable `filer:<hash>` IDs.
  3. **Pending vs. approved person suggestions:** A `suggested` + `pending`
     face-cluster binding (`tag:person:<id>`) stays hidden from
     `/Bilder/Personen/` until approved, then projects immediately.
  4. **Filing vs. explicit adoption across retirement:**
     - Photo 1 filed into local `/Bilder/Urlaub/` creates only a local
       `TagBinding`; when Fotos retires the release, Photo 1 disappears from
       `Geteilt/`, `Zeit/`, `Orte/`, and active `/Bilder/Urlaub/` while the
       local `TagBinding` stays preserved (re-sharing restores it automatically).
     - An explicit, policy-authorized copy of Photo 2 creates a new locally
       owned record with its own identity. It references the existing
       `SHA256Hash<BLOB>` and remains readable in local and axis views after
       Fotos retires the release.
  5. **IoM automatic category match:** Owner's Fotos instance publishes
     `RuntimeSupply` governing `tag:category:pictures`; Filer activates
     `RuntimeDemand` for `tag:category:pictures` → automatic IoM release with no
     manual share gesture.

---

### Suite C — Filer ↔ Akte (`pnpm test:integration:akte`)

Tests Akte's legal/accounting document case files (`Akten`) and its strict
document-admission boundary:

- The Akte worker calls the public document intake and case-share APIs from
  `@akte/app`. It hosts those APIs on the shared Filer runtime's CHUM
  transport and signed release plans.

- **Datatypes:**
  - `DokumentIntakeRecord` (`status: 'admitted' | 'rejected'`, `sourceBlob`,
    `sourceEntry`, `PdfImportPolicy` provenance).
  - `DokumentTextprojektion` / `DokumentOfficeProjektion` (derived text/PDF
    projections alongside the original `sourceBlob`).
  - `FilerShareCut` (Phase 1) and `TagShareCut` (Phase 2: case/Mandat saved
    folder, document date `tag:time:YYYY-MM`, Mandant `tag:person:<id>`).
- **Scenarios:**
  1. **Admitted case-folder share (Akte → Filer):** Akte admits a PDF and an
     Office document (`DokumentIntakeRecord` with `status: 'admitted'`), bundles
     their original `sourceBlob`s (and optional text projection) into a case
     cut (`Mandat Müller 2026`) via `GraphReleaseState` + `GraphReleaseSelectionHead`
     → Filer mounts `/Files/Geteilt/<akte-user>/Mandat Müller 2026/` (later
     `/Dateien/Geteilt/...`) and hydrates byte-exact PDF bytes via
     `readItemContent`.
  2. **Rejected document boundary (negative security test):** A PDF rejected by
     `PdfImportPolicy` (`DokumentIntakeRecord { status: 'rejected' }`) fails
     fast if an adapter attempts to pin it into a share cut and **never**
     projects into Filer.
  3. **Live case update & rename:** Akte appends a new Schriftsatz/Beleg (Cut 2)
     and renames the case label (`Mandat Müller 2026 — Berufung`) → existing
     document `filer:<hash>` IDs stay stable across the rename while the new
     file arrives via `FilerDelta`.
  4. **Mandate termination (signed retirement):** Akte retires the case
     selection (`retireGraphReleaseSelection`) → the case folder disappears
     reactively from Filer, survives restart without resurrection, and a late
     Cut 1 delivery cannot restore closed-case documents.
  5. **Bidirectional client upload (Filer → Akte):** Client drops a document
     into Filer and shares a `FilerShareCut` to Akte → Akte receives the cut,
     verifies the `Assembly`, and feeds the original `BLOB` into Akte's intake
     pipeline (`DokumentIntakeRecord`).

---

### Suite D — Filer ↔ Edda (`pnpm test:integration:edda`)

Tests Edda's clinical & study health data with strict role, instance, draft, and
non-adoptability policies (four independent instances: **StudyCenter**,
**Patient/Clinician Edda**, **Authorized Filer IoM**, and **Foreign Filer**):

- **Datatypes:**
  - `ClinicalDocumentRef` (lab PDF, imaging, referral BLOBs).
  - `ClinicalReport` (`draft` vs. `ready_for_approval` vs. `approved` lifecycle).
  - `QuestionnaireResponse`, `CareEpisode`, `ClinicalBaseline`.
  - StudyCenter-signed `Assembly` releases + `GraphReleaseSelectionHead` and
    role/identity evidence (`PatientDataAccessDemand` / `DirectCareConsent`).
- **Scenarios:**
  1. **Role- and instance-gated clinical release:** Authorized Filer IoM
     instance receives the StudyCenter-released patient cut under
     `/Gesundheit/Flexibel` (or `/Gesundheit/Edda/<patient>/` +
     `/Gesundheit/Zeit/`) and hydrates exact clinical records/PDFs; a
     **foreign Filer instance** presenting the same role bundle receives zero
     roots and zero folders.
  2. **Draft vs. approved `ClinicalReport` boundary:** A `ClinicalReport` in
     `draft` or `ready_for_approval` state never projects into Filer; once
     `approved` and released via `Assembly`, it appears read-only under
     `/Gesundheit/Berichte/` with exact content hash.
  3. **Share-report immutability:** Re-tagging or updating working records after
     an approved report cut is released does **not** alter what the pinned
     report cut exposes under `/Gesundheit/Berichte/`.
  4. **Clinical non-sharing & non-adoptability boundary:**
     - Local tagging of clinical data in Filer never grants access to a third
       party.
     - Attempting policy-disallowed local-copy adoption of a clinical record
       returns `EPERM` (cannot detach clinical data from StudyCenter authority).
  5. **Care-assignment revocation & restart:** StudyCenter / clinician retires
     the patient's `GraphReleaseSelectionHead` → patient folder disappears
     reactively from `/Gesundheit/`, stays absent across restart, and resists
     late arrival of older cuts.

---

## Phased Delivery & npm Scripts

Wire individual scripts and one umbrella command in `filer/package.json` so
each suite can run independently or as a release gate:

| Phase | Depends on | Deliverable & Command |
| --- | --- | --- |
| **Phase 0** | Merged Slice 1 (`e8e4ffad0..6349a739e` in `../one`) | Shared `scripts/integration/harness.mjs`, `filer-worker.mjs`, `assertions.mjs`; two-process CHUM Files suite (`pnpm test:integration:files`). |
| **Phase 1** | Phase 0 | **VGER** Files + IoM settings + ModelWeights coexistence (`pnpm test:integration:vger`) and **Akte** admitted/rejected `DokumentIntakeRecord` + case-folder cuts (`pnpm test:integration:akte`). |
| **Phase 2** | Slice 2 (`tag.core` `TagShareCut` + tombstones) & Slice 3 (multi-view projector) | **Fotos** multi-view `TagShareCut` suite (`pnpm test:integration:fotos`) + add `TagShareCut` & multi-view assertions to VGER and Akte suites. |
| **Phase 3** | Slice 4–5 (Health/Edda convergence) | **Edda** 4-instance clinical & report suite (`pnpm test:integration:edda`). |
| **Phase 4** | Phases 0–3 | Shipped umbrella `pnpm test:integration:all` builds dependencies once and runs Files, VGER, Akte, Fotos, and owner-scoped health in sequence. The four-instance Edda clinical suite remains pending. Native Swift gate: `pnpm test:provider:ipc`. |

The shipped owner-scoped health gate is `pnpm test:integration:health`. It covers
Edda/Flexibel publication, owner IoM access, foreign-person exclusion, exact
hydration, active restart, and withdrawal. It does not replace the pending
four-instance StudyCenter clinical suite described in Phase 3.

Run `pnpm test:integration:all` for the five shipped suites with fresh shared
platform, VGER, Akte, and Edda builds. Each suite accepts `--report <path>` when
invoked directly, for example:

```bash
node scripts/integration/test-vger-integration.mjs --report /tmp/filer-vger.json
node scripts/integration/test-health-chum.mjs --report /tmp/filer-health.json
```

Reports contain verified transition events with `elapsedMs` timestamps; they
are written even when a later assertion fails.

## Definition of Done (per partner suite)

- Runs cleanly from `filer/` via `pnpm test:integration:<partner>` using only
  disposable temp directories and a loopback `CommunicationServer` (zero
  external servers, zero leaked child processes or temp dirs).
- Exercises the real `stdio-main.ts` projection pipeline (`CombinedFilerProjection`
  + `PublishedWorkingSet` + `FileProviderOperations.handle`).
- Passes all applicable rows of the Common Contract Matrix (C1–C8) plus the
  partner's domain-specific negative/policy tests.
- Produces structured `TRACE` output so regressions in transfer latency,
  acceptance ordering, or container invalidation are immediately diagnosable.
