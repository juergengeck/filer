# Filer update and Cube pairing — 2026-09-10

Filer's canonical platform remains `../one`. Flexibel Cube remains on its own
`one-experimental` platform. This update does not mix their package trees.

## Fixed in Filer's platform

Cube's CHUM importer reads recipe references directly after receiving an object.
The canonical exporter previously authorized those children only when the peer
also called `GET_OBJECT_CHILDREN`. A successful pairing therefore stopped at a
`TrustKeysCertificate` with `CES-GO1` (unauthorized object).

`one.core/src/chum-exporter-service.ts` now traverses the declared edges after
checking parent access and before returning `GET_OBJECT` or `GET_ID_OBJECT`
bytes. It uses the existing filtered access traversal. It does not create new
root grants or grant unrelated objects.

The regression uses a real stored root → child → grandchild graph. Reading each
parent unlocks only its declared next edge; an unrelated object remains denied.
The exporter and access-manager suites pass together (20 tests).

The native test also exposed a partial-arrival bug in `TrustedKeysManager`:
a Profile could be stored before its endpoint's Keys child. Reading that missing
child threw `SB-READ2`, stopping the runtime and preventing subsequent startup.
The trust owner now projects available keys, records the exact missing child
dependency, and refreshes the current profile when that Keys object arrives.
It installs arrival listeners before startup hydration. No key is trusted from
a missing object, and a late child cannot revive a withdrawn endpoint. All eight
trust tests pass, including those two arrival cases. Bootstrap diagnostics now
retain error codes and source locations without logging error messages or
credential payloads.

## Demo evidence

An isolated Cube demo used `demo@demo.de`, with its built-in runner enabled.
The full protocol through step 11 passed all 12 executed steps. Its report is
`/tmp/filer-flexibel-cube-demo/reports/full-protocol-2026-09-10T07-47-00-770Z.md`.

A separate Filer stdio instance paired with that Cube using an IoM invitation
scoped to an existing demo patient. The initial unscoped invitation was rejected
by Cube's clinical publication aftercare because it requires an exact patient.
After the exporter fix, the scoped run completed pairing and the CHUM transition
without the previous certificate-access failure. Local diagnostics live in
`/tmp/filer-flexibel-cube-demo`; invitation and credential files are private and
are deliberately not included in this repository.

The installed host now accepts invitations from each domain's **Pair with Another
Device…** menu action. Domain registration accepts an identity email before
creating storage; an existing domain cannot be rebound to a different email.
The signed host CLI routes pairing to the running owner over its authenticated
socket, rather than opening a second instance. Invitation tokens travel through
stdin and the private socket, not process arguments or domain configuration.

Native verification used **Flexibel Cube Demo**, registered with `demo@demo.de`.
The installed host accepted a fresh Cube invitation. After updating the trust
owner, the same paired storage reopened and Finder enumerated all seven root
folders. A File Provider read materialized the 5,117-byte demo profile file,
including its profile certificate and two person certificates. Finder Quick Look
rendered its JSON successfully.

Drive: `/Users/gecko/Library/CloudStorage/OneFiler-FlexibelCubeDemo`.

Native pairing and clinical Finder browsing are now verified for the demo publication.
The updated runtime exposes `/Gesundheit/Flexibel` when a verified Flexibel
publication exists. Cube's `flexibel-health-files`
plan publishes 15 verified demo records for the explicitly selected canonical
patient as JSON BLOBs in a `PersistentFileSystemRoot` tree. An owner-only
`ChannelInfo` carries the current root; normal paired CHUM carries its declared
closure. Filer follows that current publication without interpreting raw clinical
objects or using Cube's debug API as its data transport.

Finder enumerated `Gesundheit/Flexibel/Patient-Test [canonical patient id]` and its clinical
categories. All 15 JSON files were hydrated through macOS File Provider and their
sizes and SHA-256 hashes matched the downloaded publication. Finder Quick Look
rendered the 305-byte BodyTemperature record (37.2 °C) successfully.

The final blocker was a missing `objectEvents.init()` in FilerRuntime. CHUM had
stored the health tree and committed its channel head, but ChannelManager never
received the storage event. Filer now owns dispatcher startup and shutdown around
its model lifecycle and reports dispatch errors. A real-runtime regression proves
channel-ready completion, health-file arrival notifications, file reads, and
registry restoration after restart.

The affected demo's exact imported channel was repaired once through the existing
ChannelManager owner. Its head and file bytes were preserved; no storage scan or
startup replay was added. Native notification identifiers and anchor RPC paths
now translate consistently between Finder identifiers and absolute filesystem
paths. The mounted files remain readable while Cube is closed.
The receiver now explicitly declines unsupported advertised root schemas before
parsing, while accepted roots and their dependencies retain strict validation.
Filer prioritizes current ChannelInfo snapshots before background version history.

## Native build

OneFiler 1.0.1 build 5 bundles the updated canonical runtime and official Node
24.19.0. The Swift suite passed (77 tests, 5 environment-dependent skips), as did
the packaged Swift/Node integration (3 tests). Five signed IPC checks accepted
the extension and host CLI and rejected wrong identities and an ad-hoc impostor.
The Debug app has development
signing; recursive strict signature verification passed. This is a local update,
not an App Store or notarized distribution release.

The three legacy path-based entries were preserved byte-for-byte in
`~/Library/Group Containers/group.one.filer/domains-legacy-20260910.json`, with
mode 0600. The new `domains.json` contains the separate demo domain. Existing
instance directories and the old provider's `group.com.one.filer` configuration
were not changed. This is not a migration of legacy identities or data; those
old locations still require their own credential-preserving migration.

Native delivery and Finder hydration are complete for this read-only JSON slice.
A fresh clinical update across the live pair remains unverified: the running Cube
had a study-center role and correctly rejected clinical entry, then Cube was
closed during verification. No replacement clinical record was created. See
`specs/002-flexibel-xlsx-roundtrip/plan.md` for that ownership boundary; workbook
editing is a later slice.

## Native HTML data view

Flexibel's health data source selects exact hashes from its verified projection
and calls ONE.core `implode(hash, undefined, {retainIdReferences: true})`.
Exact object references are embedded recursively; identity references retain
their native links without selecting a current version. The demo patient's ID
has no local version head, so expanding it with the default resolver fails.
This explicit policy does not suppress errors for missing exact objects.
The file publisher carries those unchanged
microdata bytes as `.html` files in the existing owner-only publication tree.
It does not serialize the projection's JSON convenience view. Filer reads the
published HTML and adds a document shell with CSS, preserving the native object
markup and embedded reference hashes byte-for-byte.

The styles consume canonical `one/packages/vger.ui/styles/theme.css` plus the
shared `microdata.css` selectors for `itemscope`, `itemtype`, and `itemprop`.
They are embedded at build time; the optional VGER UI peer is excluded from the
native runtime closure. Font-package imports are removed for the theme's system
font stacks. No React, scripts, fetch, CDN, or data reconstruction is involved.
Finder versions include the stylesheet and document-shell hash.

Compared reference implementations:

- Fotos `fotos.core/src/ingest/index-html.ts` creates browsable folder documents,
  embeds CSS, and retains semantic attributes with a corresponding parser. This
  is folder indexing; portable browser HTML export is separately deferred by
  `docs/product/ui/decisions/D-05-html-export.md`.
- VGER `vger.cube/src/main/services/memory-storage-handler.ts` separates memory
  content, document wrapping, and `memory.core` styles. Its `renderMemoryAsHtml`
  creates a domain-specific presentation with source metadata; it is not the
  raw native-object imploder.
- VGER `vger.cube/src/main/services/html-export/implode-wrapper.ts` calls ONE's
  `implode()` directly. That is the source-preserving path used here. Filer does
  not copy the JSON renderer or the memory-specific field rendering.

The earlier JSON-to-HTML renderer and generated aggregate page were removed.
On 2026-09-10 Cube published 15 HTML records in root
`2134c0f3c3a9c235505df46808ea0a89ab38bebb90a75e4b074b9cff63c01228`.
All 15 reached the native runtime and were hydrated through the Finder mount;
their SHA-256 hashes match the documents served by the signed runtime.
Previously downloaded JSON files remain in the macOS cache, while the current
publication tree contains HTML. HTML remains read-only; future edits must pass through
Flexibel's owning plans and validation, not overwrite the publication BLOBs.

The native refresh path now follows the replicated File Provider contract:
macOS ignores folder-level signals, so every validated notification wakes
`workingSet`. `PublishedWorkingSet` includes the currently mounted Files, Fotos,
and Gesundheit roots while
delegating model enumeration and exact model deltas to their existing persistent
projection. Publication versions bind pagination and expire a changed working
set. Path identities are preserved, and Files retains its explicit
`canAddChildren` capability independently of read-only POSIX modes.

The installed host also accepts the model parent `ONE/System` and all three
publication namespaces in its validated notification protocol. Previously the
new model location caused it to reject a startup notification and stop Node.

Validation includes a real stored-object round trip: `implode` → CSS document →
extract unchanged native microdata → `explode`, with identical root hash and
nested reference hashes. Publisher tests cover verified source selection and
exact microdata bytes. The native round-trip test also verifies that retained
identity links do not invoke the version resolver; the default resolver behavior
is unchanged. The core imploder/exploder suites passed all 18 tests, including
retained identity links inside embedded objects and collections.
The experimental platform's corresponding 16 microdata tests passed as well;
its older collection parser also needed the canonical nested-context fix.
The publisher's six tests, all-three-mount working-set regressions, full Filer
runtime build, and four packaged Swift/Node tests passed. Packaged checks verify
Files/Fotos/Gesundheit/model presence and the Files ingestion capability.
Browser automation blocked local file URL navigation;
browser visual QA is not claimed.
