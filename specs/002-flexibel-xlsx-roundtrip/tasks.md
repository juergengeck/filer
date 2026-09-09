# Delivery tasks: Flexibel XLSX round trip

Status: Component implementation in progress. The Doctor end-to-end workflow is not enabled. See [implementation status](implementation-status.md).

References: [PRD](prd.md), [technical plan](plan.md).

## Completed design work

- [x] Write product requirements and acceptance criteria A01–A19.
- [x] Inspect current baseline recipes, certification lineage, health source, canonical Filer runtime/RPC, and Swift content-write path.
- [x] Correct the PRD's stale missing-runtime finding.
- [x] Define the first workbook fields, save lineage, ownership boundaries, and release gates.

## Implemented components

- [x] Implement and test the baseline XLSX codec, strict typed diff, exact export metadata checks, and explicit optional-text clearing in `flexibel.core`.
- [x] Implement and test exact accepted-certificate lineage resolution with explicit conflict and incomplete states. This helper is not yet wired into the clinical projection.
- [x] Add registered domain write ownership to canonical File Provider RPC, with required base/save identities and guards against generic mutation bypasses.
- [x] Carry opaque base-version bytes and deterministic save identities from Swift content modification callbacks to RPC.
- [x] Preserve owning-service errors at the native boundary and test rejection/error mapping.

These components do not complete G1, G2, G4, G5, or G6. In particular, the managed write capability has no production Flexibel commit owner registered yet.

## 1. Establish the owning runtime and command path

- [ ] Read applicable instructions in `../one` and the Flexibel workspace before code changes there.
- [ ] Trace and document the concrete composition route for a Flexibel-owned provider against Filer's initialized ONE model graph, preserving the `../one` / `one-experimental` boundary.
- [ ] Expose the current role selection and its revision/event to that provider through existing domain ownership.
- [ ] Complete/verify Filer IoM demand publication, StudyCenter authorization, and exact-root release for one Doctor/patient pair; include the foreign-instance negative case.
- [ ] Identify the authoritative clinical amendment acceptance owner and existing authenticated operation route; prove its concurrency boundary across two submitting instances.

Done when: G1 passes and the amendment authority is concrete. Do not replace these tasks with a local fake patient/source.

## 2. Implement conditional clinical baseline amendment

- [ ] Trace existing Assembly acceptance and `supersedes` ingestion before adding schemas; reuse their owners.
- [ ] Implement a typed baseline amendment command with exact expected certificate, canonical patient, role context, save identity, and field changes.
- [ ] Validate same-record lineage, current permissions, author binding, permitted fields, and domain values at acceptance.
- [ ] Preserve immutable original assessment/certificate; produce attributed successor evidence using `supersedes`.
- [ ] Feed accepted lineage into the canonical clinical projection; preserve history and expose unresolved forks.
- [ ] Implement a durable operation/result relationship with exact producer-owned references and stable command timestamps.
- [ ] Test competing edits, duplicate commands, changed command under reused identity, revoked roles, and interruption at the acceptance boundary.

Done when: G2 passes through the real domain service, including crash and competing-writer behavior. Workbook input is not required to validate this gate.

## 3. Implement export and XLSX mapping

- [ ] Define the generic managed-content capability in the canonical shared owner; wire it explicitly through registry/composition.
- [ ] Supply authorized item descriptions and exact export baselines from the Flexibel projection.
- [ ] Review existing workbook parsing/serialization utilities and select one shared codec implementation; keep clinical mapping in Flexibel.
- [ ] Generate the one-assessment baseline workbook with German columns, strict field types, identity metadata, and visible editability.
- [ ] Parse complete workbook candidates, validate schema/identity/protected fields, and produce a normalized typed diff.
- [ ] Test formatting-only saves, sort/filter behavior, wrong cell types, formulas, missing/duplicate rows, metadata tampering, optional text clearing, and exact timestamp preservation.

Done when: G3 passes without granting write access through metadata or Excel protection.

## 4. Carry save versions and results across Filer

- [ ] Extend canonical File Provider RPC to invoke managed-content operations with item identity, expected file version, role context, durable save identity, and complete candidate.
- [ ] Return structured domain outcomes and exact resulting versions; keep unmanaged filesystem operations with their existing owner.
- [ ] Implement durable candidate staging and receipt-linked result resolution on restart.
- [ ] Bind native acknowledgement lineage to subsequent saves from the same open workbook; reject ambiguous or foreign session lineage.
- [ ] Add real stable item versions, semantic change cursors, and role/scope invalidation.
- [ ] Extend Swift bridge and File Provider callbacks to carry base versions and expose domain errors/pending state correctly.
- [ ] Test duplicate callbacks, lost response, accepted-result lookup, S1/S2 edits, deliberate revert, stale second device, and service-unavailable resave behavior.

Done when: G4 passes through the full TypeScript/Swift contract, with no placeholder change anchors on managed workbooks.

## 5. Qualify the Doctor workflow in Excel for Mac

- [ ] Capture actual Excel open/save and temporary replacement behavior against the provider.
- [ ] Verify two saves while Excel stays open, including stale embedded metadata and native version acknowledgement.
- [ ] Verify invalid input and concurrent edits show actionable failure while preserving recoverable candidate bytes.
- [ ] Verify role switch and revocation reject a pending save without changing clinical state.
- [ ] Verify authoritative acceptance updates Flexibel, the regenerated workbook, and an authorized recipient through normal sync.
- [ ] Measure export, commit, and native notification latency against the PRD's proposed targets and record tested limits.
- [ ] Publish gate evidence with exact source revisions and tested editor/OS versions; do not include patient payloads in logs.

Done when: G5 and G6 pass and PRD acceptance criteria applicable to the one-record Doctor slice have real evidence.

## 6. Expand after the Doctor slice

- [ ] Add StudyCenter study/cohort scope and capabilities from owning projections.
- [ ] Implement atomic multi-record acceptance before enabling editable cohort tables; test invalid-row rejection and crash consistency for the complete batch.
- [ ] Add additional domain schemas and amendment operations without flattening incompatible questionnaire structures.
- [ ] Qualify Windows/ProjFS and Linux/FUSE save/error boundaries with the same contract.
- [ ] Update the acceptance matrix to show verified role, domain, provider, and editor combinations explicitly.

Done when: the expanded combinations meet the PRD rather than inheriting untested compatibility from the macOS baseline slice.
