# PRD: Editable Flexibel workbooks in Filer

Status: Draft for review

Date: 2026-09-05

Products: Filer and Flexibel

## Product outcome

When the operator's active Flexibel role is Doctor or StudyCenter, Filer presents authorized Flexibel content as useful XLSX workbooks. The operator opens a workbook in Excel, changes permitted values, and saves. Flexibel validates and applies those changes through its domain operations, and its normal projections and synchronization distribute the accepted result.

The workbook is an editable representation of domain data. Flexibel remains the authority for record identity, permissions, validation, revisions, clinical provenance, and sharing. Filer remains a role-neutral filesystem client.

This PRD extends the health projection described in [Domain Collections and Sharing](../../DOMAIN_COLLECTIONS_AND_SHARING.md). That document's IoM identity, StudyCenter release, and platform ownership boundaries continue to apply. For these clinical workbooks, this PRD's conflict and save requirements take precedence over the generic last-write-wins and offline queue examples in the older [Apple File Provider specification](../001-apple-file-provider/spec.md).

## Problem

Filer's current health adapter exposes individual verified clinical entries as JSON under `/Gesundheit/<patient>/<domain>/`. This is useful for inspecting individual records, but doctors and study staff need tables for reviewing and updating structured information. A detached spreadsheet export also requires a separate import step and can overwrite newer data unless its relationship to the source is preserved.

The desired workflow makes ordinary spreadsheet saving the entry point for a validated domain update. It must preserve the context of the exported data, detect concurrent changes, and communicate whether the update actually reached Flexibel.

## Users and scope

| Active role | Presentation | Authorized scope | Editing |
| --- | --- | --- | --- |
| Doctor | Patient workbooks organized by clinical domain | Patients released to the operator under current care policy | Fields and operations explicitly permitted by Flexibel |
| StudyCenter | Study/cohort workbooks, with access to patient detail where permitted | Released records within the certified study and organizational scope | Fields and operations explicitly permitted for that StudyCenter subject |
| Other roles | Existing domain presentation | Existing authorization rules | No new XLSX editing capability introduced by this feature |

Holding several credentials does not combine their permissions. The selected active role and certified subject define one editing context. Doctor and StudyCenter receive XLSX as their primary structured health presentation; diagnostic JSON is not a required user workflow.

## Goals

- Open and edit structured Flexibel content through native filesystem workbooks.
- Make Doctor and StudyCenter presentations useful at patient and cohort scale respectively.
- Apply spreadsheet edits through the same domain validation, authorization, and provenance rules as Flexibel's own interfaces.
- Preserve concurrent changes, stable identities, and the operator's work on rejection or interruption.
- Refresh projected files from semantic domain events without polling or storage scans.
- Reuse one domain round-trip contract across supported native filesystem providers.

## Non-goals for the initial release

- Arbitrary XLSX import, user-defined clinical schemas, macros, or external data connections.
- Replacing Flexibel workflows for signatures, attestations, consent, or role administration with spreadsheet cells.
- Granting access, changing care assignments, or sharing patient data by moving or copying files.
- Creating or deleting patients or clinical records through inserted or removed rows.
- Applying clinical mutations while the authoritative write service cannot validate them.
- Preserving arbitrary Excel styling, charts, or user-added analysis through regeneration. A copied workbook may be used for independent analysis.
- Claiming compatibility with every spreadsheet editor before testing it.

## User journeys

### Doctor edits a patient record

1. The operator selects the Doctor role using the owning role context and opens Filer's health location.
2. Filer shows workbooks only for patients whose roots have been released to this operator.
3. The doctor opens a domain workbook. It identifies the patient, the data's revision context, and which fields can be edited.
4. The doctor changes permitted values and saves using Excel's ordinary save action.
5. Flexibel validates the complete change set, checks current permissions and revisions, and records an attributed update.
6. The updated values appear in Flexibel and in subsequent reads of the Filer workbook. Existing authorized recipients receive the update through normal synchronization.

### StudyCenter edits across a cohort

1. A StudyCenter operator opens a workbook for one authorized study/cohort and domain.
2. Each row identifies its participant and record independently of its position or display name.
3. The operator filters, sorts, and edits permitted values for several participants.
4. Saving submits a single change set. Validation errors or conflicts identify the affected sheet, row, and field before any changes from that save become accepted clinical state.
5. A successful save produces one definitive result covering all intended changes.

### A save conflicts or is rejected

The operator receives an actionable reason: invalid value, field not editable, role changed, access revoked, stale record, unsupported workbook, or service unavailable. The edited workbook remains recoverable. For a conflict, the operator can inspect baseline, edited, and current values and deliberately resolve the edit. No newer value is silently overwritten.

## Presentation requirements

### Workbook organization

Proposed paths, subject to a usability check:

```text
/Gesundheit/<patient>/Baseline.xlsx
/Gesundheit/<patient>/Fragebögen.xlsx
/Gesundheit/<patient>/Temperatur.xlsx
/Gesundheit/Studien/<study>/Kohorten/<cohort>/Baseline.xlsx
```

Each workbook covers a coherent domain and bounded patient/cohort scope. Multiple sheets may represent related tables or different questionnaire schemas. Unrelated record types must not be flattened into a table with ambiguous columns. Cohort membership comes from the owning authorized study projection.

Filenames and labels are display values. Stable provider item identities must distinguish patients, studies, cohorts, and domains, including collisions with reserved directory names. Role changes or renames must never redirect an existing file handle to a different subject.

### Readable and editable cells

- Use German labels initially, explicit units, filters, frozen headers, and clearly distinguished editable and read-only columns.
- Preserve text identifiers, leading zeros, numeric precision, boolean values, missing values, dates, and timestamps according to a documented domain schema. Never infer units or identity from cell formatting.
- Make blank-cell behavior explicit per field: clearing an optional value differs from leaving it unchanged; required values cannot be cleared.
- Calculated scores and other derived values are read-only and recomputed by Flexibel. Formulas in writable clinical input cells are rejected; cached formula results are not accepted as authored values.
- Display unavailable or incomplete domain data as such. Do not fabricate zeroes, empty observations, or a claim of complete cohort coverage.
- Sheet protection is an editing aid. The domain service validates every submitted field independently of workbook protection.

### Round-trip identity

Each managed workbook must retain a schema version, stable workbook/scope identity, export context, and enough metadata to resolve every existing row to its canonical patient, domain record, and exact baseline revision. Where a domain uses immutable observations, retain the observation reference and the owning domain's correction identity; do not treat a content hash as a mutable record ID.

Metadata must survive sorting, filtering, and ordinary Excel saves. Hidden tables or columns may carry it, but metadata is untrusted input. The service must validate it against an authoritative export snapshot or verifiable source references. Missing, duplicated, altered, or unsupported metadata must fail visibly without guessing from names or row positions.

## Write semantics

### Authorization and authorship

The Flexibel provider obtains the active role context from its owner and binds a workbook session to that context. The binding includes the requesting Filer instance, operator identity, certified role subject, study/patient scope, and role-context revision. Selection of the active role for this Filer session must be explicit; it must not be inferred from whichever credential arrived most recently over IoM.

On save, the owning service revalidates current role and identity evidence, instance authorization, care/study relationship, and field-level write permission. Read access never implies permission to edit. Switching roles requires reopening or explicitly rebinding the workbook; a pending save must not silently execute under a different role. Revocation prevents new reads and writes through Filer, while already downloaded workbook bytes cannot be recalled.

Accepted mutations preserve original authorship and history. A doctor or StudyCenter correction to patient-reported content must use an explicit domain amendment operation. It must not impersonate the patient, rewrite an attestation, or publish to a foreign-owned channel as if it were the original author. Domains without suitable mutation semantics remain read-only until those semantics exist in Flexibel.

### Diff, validation, and commit

1. Receive and durably stage the complete workbook save candidate.
2. Resolve the managed item and validate workbook schema, scope, identities, and metadata.
3. Compare normalized editable values with the authoritative export baseline. Ignore formatting changes, ordering changes, and unchanged values.
4. Validate the entire proposed change set, current authorization, cross-field rules, and baseline revisions.
5. Commit through Flexibel-owned operations with conditional revision checks at the mutation boundary.
6. Produce a durable result identifying accepted revisions, author, role subject, and operation identity; advance the clinical projection and signal filesystem changes.

All intended edits in one workbook save form one logical commit. Validation failure or conflict must apply none of them. A crash must not expose an arbitrary prefix as a successful save. If current domain APIs cannot provide that guarantee, implement the required batch/commit boundary in the owning domain before enabling multi-record workbook writes; sequential calls plus best-effort rollback do not satisfy this requirement.

Re-delivery of a save after a lost response must return its existing result without duplicate clinical events. Idempotency is based on the logical mutation and base context, not XLSX ZIP byte equality. An intentional later edit receives a new operation identity.

### Concurrent changes

Use baseline, edited, and current domain values to distinguish user edits from unrelated source updates. Unedited cells must never write stale baseline values back. Non-overlapping edits may be accepted only after validating the resulting complete domain state; the first implementation may reject any changed base record conservatively. Divergent changes to the same field always require explicit resolution. No last-write-wins policy is allowed for clinical workbook edits.

After a successful save, subsequent saves from the still-open workbook must use the acknowledged revision lineage. The implementation must prove that a second edit, a duplicate save, and an intervening external update behave correctly even if Excel retains the original embedded metadata.

### Rows and filesystem operations

- Sorting and filtering preserve row identity and have no clinical effect.
- Added rows are rejected for the initial release. Missing rows do not delete records; an incomplete managed table is rejected with a clear explanation.
- Editing read-only clinical values or identity fields is rejected, not silently ignored.
- Copying a workbook outside the managed location produces a detached copy. Its saves do not update Flexibel.
- Save As to a new managed filename does not create a patient, clinical record, or new writable scope. Standalone rename, move, and delete operations on generated workbooks are unsupported initially and never imply clinical mutations.
- Provider-internal temporary-file creation and replacement needed to complete a save are supported separately from those user-level operations. Temporary and lock files never become clinical records.

## Native save and refresh behavior

Filer must distinguish three states: bytes saved locally, domain commit pending, and domain update accepted or rejected. A local Excel save or filesystem write acknowledgement alone must not be represented as Flexibel acceptance.

Where the native provider can return the domain result through the save completion, it must do so. Where the operating system acknowledges local bytes before domain processing completes, Filer must expose pending and rejected state through native status and an actionable error surface. Routine valid saves require no additional confirmation dialog.

Complete-file writes, chunked writes, truncation, repeated callbacks, and temporary-file replacement must converge on the same logical save behavior. Do not parse partial workbook bytes or use a timer to guess that writing has finished. Define and test the platform's actual commit boundary. In particular, relying solely on FUSE `release` is insufficient for error reporting because the current adapter documents that its return value is ignored.

Interrupted or rejected edits must remain durably recoverable across provider restart until the operator resolves or explicitly discards them. This staging is an uncommitted user document, not an accepted clinical store or a parallel synchronization system. A restart resolves any uncertain operation using its durable result before permitting resubmission.

When the authoritative write service is unavailable, retain the edit and report it as uncommitted. The initial release requires an explicit resave after connectivity and authorization are restored; it does not silently apply delayed edits under a later role context. Remote recipient synchronization may remain pending after a successful local authoritative domain commit and must be reported separately.

Source changes invalidate only affected generated workbooks through Flexibel projection events and native provider notifications. Do not overwrite unsaved local edits or silently rebase an open workbook. Unchanged domain content and schema must retain a stable provider content version even if workbook serialization includes volatile metadata.

## Ownership and integration

| Owner | Responsibility |
| --- | --- |
| `flexibel.core` | Domain-to-workbook mappings, authorized scope, field capabilities, baseline resolution, diff validation, clinical commands, provenance, and commit results |
| Filer | Managed paths/item identities, staging, native save lifecycle, error/status presentation, and projection invalidation |
| `../one/packages/*` | Reusable domain-provider contracts, filesystem/runtime integration, and shared platform mechanisms required by Filer |
| Native providers | Platform callbacks, item versions, replacement semantics, and correct delivery of save outcomes |

Flexibel implements a shared contract consumed by Filer. Public actions use existing registered plans/operations and normal authenticated transport and synchronization owners. Do not introduce a private spreadsheet relay, direct clinical storage writes, unrestricted scans, or a second ONE runtime in one process.

Filer's platform base remains `../one`; Flexibel's current platform base remains `../one-experimental`. Integration must preserve that package boundary. Reusable XLSX parsing/serialization can be shared, but clinical column mappings and update rules remain Flexibel-owned.

### Known foundation and gaps

Repository observations at drafting time, not claims of completed end-to-end support:

- `one.filer/src/fileSystems/FlexibelHealthFileSystem.ts` accepts a data source and exposes a read-only health hierarchy.
- Flexibel's `FlexibelHealthDataSource` reads its verified clinical projection and currently returns JSON entries.
- Flexibel has patient/settings workbook import with diff detection. Its supported domain mappings may be reused after review; it is not a general clinical correction contract.
- The architecture document records outstanding Filer demand publication, running adapter composition, and complete authorization/projection tests.
- Direct source inspection on 2026-09-05 confirms `FilerRuntime` and authenticated `FileProviderRpc` now exist in `../one/packages/refinio.api/src/filer/`, with a Fotos composition example in `scripts/fotos-api.mjs`. The older README's missing-runtime note is stale. Flexibel composition still needs to be established; the existing RPC writes through `createFile` without conditional revisions, and its change/anchor responses are placeholders.
- The macOS provider accepts a `baseVersion` in `modifyItem`, but the inspected content-write call does not pass it to the bridge. Conditional write semantics must be carried through the full path.
- `ClinicalBaselineAssessment` is immutable. Its current record operation creates a new assessment; it does not implement conditional amendment. `ClinicalDataCertificate` already defines an exact `supersedes` reference and the certification service accepts it. Reuse that lineage mechanism, while implementing and testing amendment authorization and projection behavior before enabling baseline edits.

These are prerequisites to prove during implementation. A workbook codec alone does not complete this feature.

## Delivery plan

### Milestone 1: Doctor vertical slice on macOS

Use Excel for Mac and the macOS File Provider as the initial editor/provider combination. Present one patient's existing records for one domain in a managed workbook, with one explicitly supported edit operation. Clinical baseline is the proposed candidate, subject to verifying its revision/amendment API. If that operation is absent, implement the domain operation before exposing its cells as writable.

Complete identity and StudyCenter release wiring, export, staging, conditional domain commit, status/error reporting, repeat-save lineage, and event-driven refresh. Prove both successful edits and rejected edits against the real Flexibel runtime. Remaining domains can be read-only XLSX until their mappings and mutation semantics are implemented.

### Milestone 2: StudyCenter cohort editing

Add authorized study/cohort discovery, bounded domain tables across participants, and atomic multi-record commits. Apply the same role and field checks to every row. Establish cohort size limits from measured generation, parsing, and commit costs; partition larger scopes by stable study/domain boundaries rather than silently omitting records.

### Milestone 3: Domain and platform expansion

Add further questionnaire and clinical mappings, then qualify Windows/ProjFS and Linux/FUSE with the same save contract. Other spreadsheet editors require their own round-trip and save-lifecycle tests. Future creation, explicit deletion/amendment workflows, and offline commit behavior require separate scope decisions.

## Acceptance criteria

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Doctor opens health content | XLSX workbooks contain only currently authorized, released patient data |
| A02 | StudyCenter opens a cohort | Rows are restricted to certified study scope; partial coverage is visible |
| A03 | Operator holds multiple roles | Active context governs the view; inactive credentials do not widen it |
| A04 | Valid edit and save | Correct Flexibel record changes with attributed provenance; regenerated XLSX shows it |
| A05 | Accepted change synchronizes | An existing authorized recipient's clinical projection receives the accepted revision through normal sync |
| A06 | Sort, filter, or formatting-only save | No clinical mutation; all records retain identity |
| A07 | Duplicate save or lost response | One logical update and one definitive operation result |
| A08 | Second edit without closing Excel | Correct acknowledged revision lineage is used; no duplicate or stale overwrite |
| A09 | Conflicting source edit | No silent overwrite; baseline, edited, and current values are available for resolution |
| A10 | One invalid row in a batch | No row from that save becomes accepted clinical state; error identifies the field |
| A11 | Role switch, revocation, or foreign instance | Save is rejected without applying edits under another identity or role |
| A12 | Missing/tampered metadata or duplicate row ID | Save fails without identity inference or cross-patient mutation |
| A13 | Row/file deletion, move, or copied workbook | No implicit clinical deletion, creation, reassignment, or access grant |
| A14 | Truncate, chunked write, and temporary replacement | Only the complete candidate is processed; lock/temp files have no domain effect |
| A15 | Crash before/during/after commit | Edited bytes remain recoverable; result resolves definitively without partial acceptance or duplicate effects |
| A16 | Service unavailable | Edit remains explicitly uncommitted; recovery requires current authorization and deliberate resave |
| A17 | Domain update while workbook is open | Generated projection is invalidated; unsaved user edits are preserved |
| A18 | Precision, locale, units, blanks, dates, and formulas | Values follow the declared schema; ambiguous or invalid inputs are rejected |
| A19 | Provider save error | User sees actionable failure/pending status; no false claim of Flexibel acceptance |

Release evidence must include real Excel save traces, the owning Flexibel operation result, before/after domain revisions, native error/status behavior, and projection refresh. Logs must omit clinical payloads. Codec-only tests do not establish native save compatibility.

Proposed initial responsiveness targets are at most 2 seconds to generate a locally available workbook with 1,000 records, at most 3 seconds for a 100-record local authoritative commit, and at most 2 seconds from accepted projection update to a native change notification. Measure these at p95 on documented reference hardware with a representative schema. They exclude initial authorization, remote data transfer, and recipient delivery; ratify limits after the first vertical measurement.

## Decisions to close during technical design

- Confirm the first domain and enumerate its editable fields, amendment rules, and existing operation gaps.
- Identify the exact owner of active-role selection for a Filer session and its invalidation event.
- Specify the authenticated write route and durable batch commit/result contract across the current platform boundary.
- Select the authoritative baseline representation and how repeated saves from an open Excel workbook advance it.
- Validate native status, conflict resolution, and edit-recovery UX with actual File Provider callbacks.
- Set tested cohort limits, schema compatibility rules, and staging retention/cleanup behavior.

These decisions refine implementation without weakening the required outcome: ordinary workbook saves produce authorized, conflict-aware, attributable Flexibel updates with a clear and recoverable result.

Implementation follow-through: [technical plan](plan.md) and [delivery tasks](tasks.md).
