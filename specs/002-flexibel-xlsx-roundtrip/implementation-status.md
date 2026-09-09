# Implementation status: Flexibel XLSX round trip

Updated: 2026-09-05

The reusable codec and save-transport components are implemented. The requested live Doctor/StudyCenter round trip is **not complete or enabled**. No clinical records have been changed and no running app has been deployed by this implementation work.

## Implemented

- `flexibel.core/services/ClinicalBaselineWorkbook.ts`: exports one baseline assessment as XLSX; validates exact export metadata, protected values, row/column shape, required integer fields and ranges; rejects formulas, macros, malformed workbooks, and unsupported table structures; returns only semantic field edits, including explicit note clearing.
- `flexibel.core/services/ClinicalBaselineLineage.ts`: resolves exact accepted certificate chains with stable original identity, explicit sibling conflicts, and incomplete predecessor state. It rejects cycles and amendments that change patient or assessment identity. It is an exported domain helper, not yet connected to the runtime projection or a mutation operation.
- `../one/packages/refinio.api/src/filer/ManagedFileWrite.ts` and `FileProviderRpc.ts`: define a complete-file domain commit capability. Registered mounts require a base version and operation ID, await the owning commit result, and prevent generic create/delete/rename from bypassing the domain owner. Native base versions travel as base64-encoded opaque bytes; returned content versions match the owning filesystem's `contentHash`.
- `one.provider/Sources/OneFiler/ContentWriteRequest.swift`: forwards the native base version and generates a length-framed SHA-256 operation identity from path, base, and candidate bytes. An identical transport redelivery retains its identity; a later base or different candidate changes it.
- `ONEBridge.swift` and `FileProviderExtension.swift`: forward versioned requests, validate commit acknowledgements, and require returned item metadata to agree with an accepted content version.
- `DomainWriteError.swift`: preserves domain error codes and explanations. Rejected/conflicting workbook writes use `cannotSynchronize` with the exact domain error underneath; permission denial remains a native write-permission error. RPC diagnostics log the code rather than clinical error text.

The managed-write capability is registered explicitly by composition. There is currently no production Flexibel owner registered for it. Generic filesystem operations outside managed mounts keep their existing owner. Temporary replacement saves are not yet qualified; the mutation guards deliberately do not claim to implement Excel's complete replacement lifecycle.

## Verification

- Flexibel workbook and lineage tests: 34 passing cases using real XLSX serialization and adversarial edits.
- Canonical File Provider RPC managed-write tests: 18 passing cases, including delayed acceptance, conflict propagation, missing identities, path normalization, and generic mutation bypass attempts.
- Swift suite: 58 tests, 4 environment-dependent integration tests skipped, 0 failures.
- TypeScript checks passed for `flexibel.core` and canonical `refinio.api`.

These results establish component behavior. They do not prove clinical commits, role authorization, durable candidate recovery, synchronization, or actual Excel save behavior. The RPC commit tests use a controlled domain owner; the lineage tests use already-accepted evidence fixtures.

## Required next implementation

1. Compose the Flexibel provider with the owning initialized runtime and authenticate the Filer IoM identity and active role. Preserve the canonical `../one` platform boundary.
2. Implement baseline amendment acceptance in the existing domain/Assembly owner, including exact predecessor checks, current authorization, durable operation results, and the original certificate's `supersedes` lineage. Merely calling the current baseline-recording API would create another observation and is insufficient.
3. Feed accepted amendments into the owning clinical projection and register the workbook commit owner. The standalone lineage helper is not itself an acceptance or storage mechanism.
4. Implement durable staging and acknowledged editor-session lineage, including repeated saves with old embedded export metadata and recovery after a lost response or restart.
5. Replace constant RPC change anchors with actual semantic item changes and qualify temporary-file replacement, native status, and role invalidation using Excel for Mac.
6. Run the real Doctor round trip and recipient-sync assertions before enabling writes. Add StudyCenter cohort batching only after the domain can accept a complete batch atomically.

Source inspection confirmed that Flexibel's current `AssemblyPlan.commit` compares the exact entity frontier while holding the entity lock and runs mandatory owning handlers before advancing its head. The amendment implementation should use that boundary. A local preflight read or an application mutex alone cannot replace it or establish a globally current head across unsynchronized instances.
