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

This verifies native pairing and browsing of shared platform data. It does not
establish a completed clinical Finder view.
The runtime currently exposes `/chats`, `/debug`, `/invites`, `/objects`, `/types`,
`/profiles`, and `/models`. `/Gesundheit` is not composed into the native runtime.
The existing health projection requires a Flexibel-owned verified data source;
Filer must not substitute raw storage scans or the unauthenticated debug API.

## Native build

OneFiler 1.0.1 build 4 bundles the updated canonical runtime and official Node
24.19.0. The Swift suite passed (75 tests, 5 environment-dependent skips), as did
the packaged Swift/Node integration (2 tests). Five signed IPC checks accepted
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

The remaining clinical integration work is to compose the Flexibel-owned
clinical filesystem through a supported domain boundary. See
`specs/002-flexibel-xlsx-roundtrip/plan.md` for that ownership boundary; workbook
editing is a later slice.
