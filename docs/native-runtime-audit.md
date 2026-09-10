# Native runtime and hash audit — 2026-09-09

Filer's native application is Swift **plus bundled Node.js and ONE**. Shared
implementation lives in `../../one/packages/refinio.api`, not a second native
ONE implementation. The host owns one Node process per configured storage UUID.
The extension projects that runtime's filesystem.

## Native security boundary

- The host holds an exclusive app-group lock and listens on `runtime.sock` with
  mode `0600`. It removes a stale socket only after acquiring the owner lock.
- Both peers obtain `LOCAL_PEERTOKEN` from the kernel and validate the live code
  signature using `SecCodeCopyGuestWithAttributes` with `kSecGuestAttributeAudit`
  and `kSecGuestAttributeDynamicCode`. The requirement includes the Apple anchor,
  team `26W8AC52QS`, and the exact opposite bundle identifier. No caller-provided
  PID, identity, or bearer token authenticates a peer.
- Each connection carries one bounded, length-prefixed operation. The host maps
  the registered domain to its own configuration; requests cannot select an
  executable, module, storage path, secret, or arbitrary runtime configuration.
- The owned Node executable uses inherited stdin/stdout and the existing
  `StdioTransportPlan`. The preload routes console output to stderr. Node runs
  `--jitless`, inherits the app sandbox, and has no JIT entitlement. The extension
  needs no outgoing network entitlement; the host needs one for ONE sync.
- The Node environment excludes `NODE_OPTIONS` and `NODE_PATH`. Credentials are
  generated into the host Keychain and passed through the bootstrap pipe, never
  CLI arguments or shared domain configuration.
- Production `TransportPlan` validates the owner's hash and checks capabilities
  against the normalized operation before calling the registry. The native
  composition exposes explicit `filer:*` methods, three device methods, and the
  model publication/pinning/sharing and pairing operations described in
  [the model weights implementation](model-weights.md).
  Introspection, arbitrary storage, and request-supplied privilege escalation
  are denied. Closing stdin drains queued operations and shuts down ONE.

This secures the native route. The separately launched legacy REST server still
needs its own complete authorization review. Its default bind is now loopback
and default CORS is disabled; that alone does not authenticate its routes.

Apple documents audit-token guest selection in [Security guest attributes](https://developer.apple.com/documentation/security/guest-attribute-dictionary-keys).
The shared implementation uses that API's dynamic-code mode so validation does
not depend on permission to read another process's executable from disk.

## Hash search and corrections

Scope: active `one.filer/src`, `one.provider/Sources`, and canonical
`refinio.api/src` plans, clients, transports, auth context, and File Provider code.
Searched hash/identity names declared as strings and assertions to SHA256 brands,
then traced producers and consumers before choosing types.

| Boundary | Correction |
| --- | --- |
| `OneGroupPlan.createWithCertificate` | Members are `SHA256IdHash<Person>[]`; validate JSON values before storage/access calls. |
| `OneGroupPlan.validate` | A HashGroup is unversioned: use `SHA256Hash<HashGroup<Person>>`, not an arbitrary group name or ID hash. Trusted affirmers use person ID hashes. |
| `OneGroupPlan.checkCertificate` | Object references use `SHA256Hash \| SHA256IdHash` and validate shape before trust lookup. |
| `CAPlan.certifyPairingTrust` | `profileHash` uses `SHA256Hash<Profile>` and validates input; removed assertions at story/reference boundaries. |
| Typed memory client results | Create/update return `SHA256Hash` and `SHA256IdHash`, replacing raw strings. |
| Client usage examples | Document/subject lookups require branded ID hashes; removed `as any` and corrected the subject call shape. |
| File Provider `createFile` | A wire BLOB hash passes `ensureHash<BLOB>` before filesystem dispatch. |
| FUSE temporary BLOB writer | Validates the SHA-256 digest with `ensureHash<BLOB>` instead of asserting the brand. |
| `AccessRightsManager` | Uses the existing typed `Group.hashGroup` directly, removing a redundant assertion. |
| Native local domain config | Renamed UUID `instanceId` to `storageId`; real ONE owner/instance hashes come from the initialized runtime and are validated at bootstrap. |

These checks validate the wire representation. A 64-digit value does not by
itself prove that an object exists or has a given recipe; owning storage/model
operations remain responsible for those semantics.

Values deliberately kept as strings: filesystem paths and File Provider item
identifiers, opaque version tokens, user-assigned channel names, certificate
serial IDs, operation request IDs, and URL fragments. They are not all ONE hashes.

Remaining type debt found:

- Development-only auth in HTTP/IPC/stdio has now been corrected: an explicit
  `DevelopmentAuthContext` has no person ID. `AuthContext` retains its branded
  `SHA256IdHash<Person>`; authenticated contexts are validated in all modes and
  production rejects development contexts.
- `CAPlan` certificate/story paths still contain broad assertions. In particular,
  `importVC` reaches an `any` storage adapter and assumes the return value is a
  hash, while `CAModel` elsewhere accepts both an object result and a direct hash.
  That producer contract needs normalization. It is not exposed by native Filer's
  capability list.
- Older typed plan interfaces still use `SHA256Hash<any>` / `SHA256IdHash<any>`.
  Those preserve the hash-vs-string distinction but lose recipe specificity.

## Verification and release gaps

Passed: canonical API TypeScript build; five focused Jest suites (29 tests);
Swift suite (64 tests, four environment-dependent tests skipped); packaged
Swift/Node/ONE integration; valid signed IPC peers and rejection of wrong host,
wrong client, and an ad-hoc impostor; provisioned App Sandbox IPC without network
entitlements; bundled Node/ONE initialization, device operation, and shutdown in
a provisioned sandbox; signed Xcode Release configuration and recursive strict
signature verification. This local Xcode build uses development signing.

The unrelated existing `one.filer` declaration build remains blocked by
`ConnectionsModelConfig.ts` supplying `deferIncomingRouteStart`, which is missing
from the canonical model's current declaration contract. The hash edits introduced
no additional reported diagnostics.

This is not a Mac App Store release. Outstanding work includes:

- Explicit adoption/migration of legacy domains and existing ONE identities.
  Old `path` or `endpoint`/`token` JSON is rejected without being overwritten.
- Installed Finder lifecycle validation, reliable change enumeration/signaling,
  working-set behavior, rename/move semantics, recovery, and installed large-file
  validation. Native hydration now writes bounded 1 MiB RPC reads directly to a
  temporary file; model reads fetch and verify only the required 4 MiB chunks.
  The legacy whole-file RPC remains available, with model weights rejecting it
  above 4 MiB. The private transport still imposes a bounded frame size.
- Host launch availability and complete user-visible recovery flows. The host
  must currently remain open.
- App Store distribution signing/profiles and validation, privacy disclosures and
  required metadata, dependency/license review, architecture/OS test matrix, and
  submission. Developer ID notarization remains the existing distribution path.

No installed application or registered domain was replaced during these checks.

## Continuation: domain lifecycle and development identities

The host now observes the configuration directory, so atomic `domains.json`
replacement by either its UI or signed CLI retires removed runtimes. `RuntimePool`
shares one bootstrap, checks registration again after suspension, and retains
ownership through shutdown before allowing a replacement to reopen storage.
Tests cover removal during bootstrap, concurrent requests, configuration races,
and actual filesystem-event-driven teardown.

Domain changes use cross-process file locks. A per-domain lease prevents competing
operations on the same name while macOS completes registration/removal. Completion
re-reads current configuration, preserving changes to unrelated domains. Failed
registration restores the original bytes when no other domain changed; otherwise
it rolls back only its own entry. These operations retain ONE storage and secrets.
Runtime failures now return a correlated, sanitized error envelope rather than
silently dropping a valid request's connection.

The original Finder contract blocker was deeper than signaling an enumerator:
`IFileSystem` exposed no change feed; API anchors were constant stubs;
native identifiers were paths, which change on rename; and metadata without an
owning content version received a timestamp synthesized at each stat call.
Stable item identities, owner-produced versions, and an ordered change feed were
needed together. The following implementation supplies them for tracked model items.


## Persistent model items and change feed

The shared contract now lives in canonical `filer.core`, with the model library as
its first producer. Stable item IDs use owner/namespace/logical-key identity, while
paths, names, parent membership, and versions belong to the stored item metadata.
A `FilerSnapshot` and its typed delta history are committed in the same library
version as accepted model membership. Native enumeration consumes this history with
scope-bound, restart-safe pagination and explicit anchor expiration.

The Node owner emits typed filesystem notification frames separately from operation
replies. The host signals affected enumerators and the working set, rechecking the
configured storage owner before delivery. Bootstrap also signals persisted tracked
containers. Swift preserves item and content versions, deletion IDs, page tokens,
and anchors; malformed responses fail instead of synthesizing progress.

This resolves the missing-contract blocker for `/models`. Unconverted mutable mounts
still need their own identity/version/feed adoption. Installed Finder lifecycle,
host launch/recovery, retention, and distribution validation remain open. See the
[full contract and validation scope](filer-change-feed.md).

Validation on 2026-09-09 passed canonical `filer.core`, `llm.one`, and API builds;
two persistent filesystem contract tests; two model recipe tests; 18 API managed
write tests; 71 Swift tests (five environment-dependent skips, zero failures);
and two packaged Swift/Node tests with no skips. The multi-process CHUM integration
passed, including pagination, rejected anchors, content-version checks, and restart.
The regenerated Xcode Release build and recursive strict signature verification
also passed with development signing.

The existing isolated Spark and local Qwen 27B libraries were upgraded and reopened
twice. The manifest, stable item ID, content version, metadata version, and feed
anchor were preserved across restart; ID-based range reads matched the source.
The complete model is not pinned locally. No installed application or registered
domain was replaced, so these results do not establish installed Finder behavior.
