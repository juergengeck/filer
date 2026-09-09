# Implementation plan: Flexibel XLSX round trip

Status: Proposed technical design, grounded in source inspection on 2026-09-05

Product requirements: [PRD](prd.md). Execution order: [tasks](tasks.md).

## First deliverable

Implement Doctor editing of one existing clinical baseline in Excel for Mac through the macOS File Provider. The first workbook contains one editable assessment; additional history is read-only. The same contract later supports multi-record workbooks, but the first slice must not pretend that independent domain calls form an atomic cohort commit.

The first operation is an amendment of an existing assessment, with an exact previous certificate reference. It is not a call to `recordClinicalBaseline` with fresh timestamps. The original fact and certificate remain available in history, while the owning clinical projection supplies the current accepted revision.

This document specifies intended contracts, not APIs already implemented. Names below may be aligned with nearby owning-package conventions during implementation.

## Findings that determine the design

| Source | Observed behavior | Consequence |
| --- | --- | --- |
| Filer `one.filer/src/fileSystems/FlexibelHealthFileSystem.ts` | Read-only `EasyFileSystem`, entry reads through an injected source | Keep domain ownership; add a managed workbook provider rather than writing into the JSON view |
| Flexibel `services/FlexibelHealthDataSource.ts` | Projects verified entries using content/evidence hashes | Add explicit workbook scope and revision contracts; do not promote the current entry hash into a mutable record identity |
| Flexibel `recipes/ClinicalBaselineRecipes.ts` | Unversioned assessment; required integer scores, assessment and creation timestamps | Amend through new immutable facts with explicit lineage |
| Flexibel `recipes/ClinicalDataCertificateRecipes.ts` and `services/ClinicalDataCertificateService.ts` | Exact `supersedes` reference is supported | Reuse this evidence relationship; verify authorization, current-head selection, and fork handling in the owning projection |
| Flexibel `plans/FlexibelClinicalDataPlan.ts` | Baseline recording creates/certifies a fact and launches channel publication as aftercare | Add conditional amendment as a domain operation; distinguish accepted clinical state from recipient delivery |
| ONE `refinio.api/src/filer/FilerRuntime.ts` | Owns one initialized model graph and accepts filesystem mounts | Compose with that graph; do not start a second ONE instance to obtain clinical services |
| ONE `refinio.api/src/filer/FileProviderRpc.ts` | Authenticated byte writes invoke `createFile`; change anchors are constant placeholders | Add managed content operations and real version/change semantics in the canonical platform |
| Filer `one.provider/Sources/OneFiler/ONEBridge.swift` | Sends path and bytes on write | Carry stable item identity, expected version, save identity, and structured result through the bridge |
| Filer `one.provider/Sources/OneFiler/FileProviderExtension.swift` | Receives `baseVersion` but does not pass it on content writes | Enforce the supplied base at the owning operation, not just the native callback |

Flexibel source paths above are relative to `/Users/gecko/src/heiner/one.flexibel/packages/flexibel.core/src/`. ONE source paths are relative to `/Users/gecko/src/one/packages/`. These findings supersede stale missing-runtime statements in older repository notes; they do not prove live Flexibel integration.

## Ownership and dependency boundary

Use the existing authenticated Filer RPC for native file operations. Extend it with a generic managed-content capability supplied by the owning domain through the established registry/composition mechanism. Ordinary Filer-owned files continue using their filesystem owner. Capability selection must be explicit; do not detect clinical files by extension and fall back to generic BLOB replacement when their provider is missing.

The shared contract belongs in `../one/packages/*`, alongside the platform's filesystem/provider contracts. Clinical recipes, workbook mappings, authorization, and mutation plans belong in `flexibel.core`. A Flexibel-owned adapter implements the shared boundary without making Filer depend on `one-experimental`.

Before implementation crosses those repositories, read their applicable instructions and establish the actual package dependency route. A new import from Filer into Flexibel's current runtime is not an acceptable shortcut. The first integration task must show how the required domain service runs against the one owning model graph, or is invoked through an existing authenticated domain-operation transport. Do not introduce a new spreadsheet transport to bridge incompatible package trees.

## First workbook schema

Proposed display: `/Gesundheit/<patient>/Baseline.xlsx`.

| Column | Domain field | First-slice behavior |
| --- | --- | --- |
| Patient | Canonical patient label | Read-only |
| Erfasst am | `assessedAt` | Read-only initially; preserve exact source timestamp |
| NIHSS bei Aufnahme | `admissionNihss` | Editable integer, 0–42 |
| NIHSS bei Entlassung | `dismissalNihss` | Editable integer, 0–42 |
| mRS | `mrs` | Editable integer, 0–6 |
| Barthel-Index | `barthelIndex` | Editable integer, 0–100 |
| Notizen | `notes` | Editable optional text; clearing removes the optional value |

These ranges reflect the current recipe validator, not a newly defined clinical scoring policy. The domain constructor remains authoritative. The spreadsheet parser must reject wrong cell types before calling it; numeric coercion of blank or text cells must not create a valid-looking score.

Store canonical patient ID, original assessment/certificate identity, current certificate, exact data hash, schema version, export reference, workbook scope, and role-context reference in a managed metadata area. Keep the original author and creation time distinct from amendment author/time. Assessment time remains unchanged for the first slice.

Protect read-only columns for usability and validate them on save. Reject inserted/deleted managed rows, duplicate IDs, formulas in input cells, unknown schema versions, and missing metadata. Sorts and presentation-only changes are no-ops.

## Managed-content contract

Define these semantic operations before committing to transport field names:

| Operation | Inputs | Result |
| --- | --- | --- |
| Describe managed item | Stable item ID and authenticated role context | Scope, display path, read/write capabilities, content version, schema version |
| Read managed content | Item ID and requested version/context | Complete bytes, export reference, authoritative base reference, returned content version |
| Commit managed content | Item ID, expected content version, role-context reference, durable save identity, candidate bytes/reference | Accepted revision receipt, no-op receipt, structured rejection, or explicitly pending operation |
| Read commit result | Exact operation reference and authenticated context | Existing durable outcome; no resubmission or mutation |
| Observe changes | Domain event subscription / native change cursor | Changed item IDs and versions; removed capabilities/items |

The bearer token authenticating local RPC is not clinical authorization. The Flexibel operation must also validate the actual Filer instance and certified role subject. Workbook metadata supplies references to verify, never permission.

Expected content version and clinical base revision are separate: a file version identifies the exact view delivered to the editor; the clinical revision identifies the source evidence being amended. Both must survive native-to-domain translation.

Use structured rejection categories for invalid workbook, invalid field, stale revision, changed role, denied access, unsupported operation, and unavailable authority. Include sheet/row/field locations and references needed by authorized conflict UI. Avoid putting clinical cell values into logs or generic transport error strings.

## Baseline and repeated-save lineage

The authoritative export reference resolves exact source evidence and normalized managed values. A client-edited hidden sheet cannot redefine the baseline. Persist any required export/session state as producer-owned references; no process-local map may be the only link between an edited workbook and its accepted source.

For an ordinary save, compare the submitted values against the last editor snapshot acknowledged for that item's version and session. Recheck the current clinical revision at commit. Initially reject a changed base record conservatively; later field-level merges may preserve unrelated changes after whole-record validation.

Example that must pass before enabling writes:

1. Excel opens export E0 with clinical certificate C0 and file version V0.
2. Save S1 changes notes; the owner accepts C1 and returns version V1, recording the exact normalized candidate and its lineage.
3. Excel retains E0's embedded metadata. A second save S2 changes mRS and supplies the native acknowledged base V1. Resolve S2 against S1's acknowledged editor snapshot, then conditionally amend C1.
4. A second device still holding V0 does not inherit S1's session baseline. Its edit conflicts if C0 is stale.
5. A user deliberately reverting notes in S2 creates an edit, even if those notes equal E0.

Native behavior must prove that V1 can be bound to the next save. If it cannot, establish an explicit editor-session/acknowledgement mechanism before release. Do not infer a session from the newest server receipt, the filename, or similarity of submitted values. Unresolvable lineage fails visibly.

Reuse one save identity across duplicate native callbacks and transport retries. Bind it to the exact candidate, context, and base; the same identity with different contents is an error. Generate timestamps once when the logical command is authored so a repeated call does not create different certificate hashes. A later intentional edit has a new identity.

## Clinical amendment and acceptance boundary

Add a Flexibel-owned baseline amendment operation that accepts the expected predecessor certificate, typed field changes, authenticated context, and logical save identity. It must:

1. Resolve the exact accepted assessment and predecessor evidence through the owning projection.
2. Validate canonical patient binding, current Doctor authority, author/role-subject binding, and the permitted amendment relationship to the original fact.
3. Apply typed changes and rerun baseline validation.
4. Check the predecessor remains current at the authoritative acceptance boundary.
5. Produce a new assessment and certificate using the existing `supersedes` reference, with explicit amendment authorship and stable command time.
6. Publish a durable accepted result and advance the owning projection from that acceptance event.

Certificate lineage alone is insufficient: define how the projection validates predecessor subject/type, recognizes supersession, retains history, and exposes concurrent successor forks. An unresolved fork must be a conflict, not a timestamp-selected current row. Existing Flexibel readers must consume the same semantics; Filer must not calculate its own current clinical state.

The serialization authority is a technical prerequisite: a process-local mutex cannot make two IoM runtimes globally conditional. Identify the existing domain owner that can decide acceptance for a clinical amendment, route commands there through established operations, and prove racing requests have one accepted successor or an explicit unresolved conflict. This design does not assume ONE immutable writes alone supply compare-and-swap.

Reuse existing Assembly/evidence and domain acceptance mechanisms where they provide the required boundary. If a commit/result root is needed, it must carry typed exact references to its input, predecessor, output evidence, author context, and result. Register its recipes before runtime initialization and grant only the appropriate semantic root. Do not add untyped JSON audit sidecars or reconstruct results by scanning storage after restart.

For the later cohort phase, preparation of child evidence must not independently expose accepted row changes. One domain-owned commit must make the complete batch accepted to projections, and reject all rows if any condition fails. Establish this before calling individual certifiers in a loop. A single-row milestone narrows the first test but does not eliminate crash consistency requirements.

## Save lifecycle and event delivery

Durably stage a complete candidate before invoking its domain operation. Keep transport staging separate from accepted clinical data. Record the exact operation reference with that staged candidate so restart can query its outcome without inventing another command.

The observable states are staged, submitted/pending, accepted, and rejected. Rejection preserves bytes for recovery; acceptance advances the managed file version and records the receipt. If transport fails after submission, query the existing result when authority is available. A definitive rejection or an edit never submitted requires deliberate resave under current authorization, as required by the PRD.

Carry `baseVersion` through `FileProviderExtension -> ONEBridge -> FileProviderRpc -> managed provider -> Flexibel operation`. Map a conflict to a native conflict/error outcome and retain the candidate. Do not return generic `status: ok` before domain acceptance and present that as completed clinical write-back.

Implement real item versions and change cursors from owning semantic events. Current constant RPC anchors cannot establish refresh. Preserve stable item IDs independent of paths and distinguish a removed capability from a deleted clinical record. Changes to role context invalidate open write capabilities and affected visible items.

Test actual native create/replace callbacks for Excel saves before deciding how temporary replacements map to one managed item. Supporting that sequence does not enable arbitrary Save As or clinical file deletion. Extend FUSE and ProjFS only after the same contract is proved on macOS.

## Verification and delivery gates

| Gate | Evidence required |
| --- | --- |
| G1: Composition and authorization | One initialized runtime graph, authenticated health release to its IoM identity, rejected foreign instance, supplied domain capability |
| G2: Amendment | Exact predecessor retained, authorized amendment accepted, invalid subject/type and unauthorized author rejected, competing amendments handled explicitly |
| G3: Workbook contract | Strict cell typing, preserved identities and precision, metadata tampering rejected, normalization-only save is no-op |
| G4: Commit lifecycle | Duplicate delivery, deliberate revert, stale second device, interruption at acceptance boundary, durable receipt after restart |
| G5: Native save | Real Excel S1/S2 save sequence, temporary replacement, native error visibility, candidate recovery, real version and change notification |
| G6: End to end | Accepted edit appears in Flexibel, regenerated workbook, and an existing authorized recipient; role revocation prevents the next save |

Use package-owned focused tests for the domain and shared RPC, Swift tests for bridge/version mapping, and a real Excel integration trace for the native boundary. Record which gates are implemented and tested separately. No gate passes solely because a mock accepted a workbook.

## Implementation order

Start with G1 ownership/composition and the G2 domain acceptance contract; these determine where the first real edit can be accepted. Build the codec against that contract, then carry versioned saves through canonical RPC and Swift. Complete restart and conflict handling before declaring the doctor slice writable. Cohort batch acceptance and further domain schemas follow the doctor release gate.
