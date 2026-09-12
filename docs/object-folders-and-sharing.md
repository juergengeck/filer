# Object folders and sharing through Filer

Status: implemented for contacts, owned imported files, and authenticated received
files. Received files are read-only; received Fotos collections retain their
sender-controlled projection.

## Current runtime

The shared implementation lives in `../one/packages/filer.core`, with runtime
composition in `../one/packages/refinio.api` and macOS bridge support in this
repository. It exposes:

- `/contacts/<main profile name>/index.html` for portable contact representations;
- `/objects/<imported filename>/` for each owned file, containing its HTML view,
  original content, `Shared with`, and `People in photo`;
- `/Files` as the existing import surface, preserving original paths and bytes.
- `/ONE/System/journal` for sharing receipts and retained QA run reports (displayed
  as `ONE/System/Journal` in Finder).

Completed CHUM object imports persist a receiver-owned receipt binding the exact
file root to the authenticated sending person. Received objects appear alongside
owned objects in `/objects`, with deterministic identity-based name disambiguation
when filenames collide. They expose their summary and original bytes, without
editable sharing or photo-association folders. Their original sender retains
ownership; receipt does not add the file to the receiver's owned `/Files` root.

The first authenticated immutable entry for a stable object identity is retained.
Repeated delivery and later photo-association metadata do not replace it; a
different entry under the same immutable identity is rejected. A stored object
that merely claims an owner cannot be promoted into an authenticated receipt.
Revocation stops future sender access; it does not erase already received copies.
Old data imported before receipt recording requires a renewed authenticated head
import to gain this projection; Filer does not infer provenance by scanning storage.

Journal receipts are immutable JSON views. QA reports are retained per run, updated
atomically for that run, and remain visible after restart. The previous single
`qa-reports/latest.json` is migrated to its run's journal entry. Journal contents
cannot be changed by dragging or deleting files in the mounted view.

Valid profiles without a name appear as `Unnamed contact`, with identity-based
disambiguation when necessary. Names preserve readable Unicode. Renaming a profile
changes the displayed path while references retain the person's stable identity.

`Shared with` lists the object's explicit recipient grants, including members of
groups granted on that root. Removal refuses to succeed when another shared graph
or group still provides access. Inherited audiences are not independently editable
entries in this initial projection. Access changes performed through this object
plan are serialized; broader concurrent policy changes remain the responsibility
of the access owner.

Empty copied contact folders are temporary staging entries. They grant nothing;
only a complete, validated contact HTML import commits the relationship. Pending
staging disappears on runtime restart. Imported file content remains immutable.
The object root stores photo associations separately from its `IdAccess` grants.

Validation covers real ONE storage and live access-cache revocation, malformed and
duplicate imports, HTML/name handling, native RPC copy/delete behavior, and a
two-instance test transferring object bytes after a contact HTML share. The
two-instance test also checks association and revocation persistence across restart.
Live Finder drag-and-drop has not been manually exercised for this change.

The [file-sharing trace](file-sharing-trace.md) distinguishes receiver storage
transfer from filesystem visibility and records the separate native Fotos path.

## Purpose

Filer presents most domain entries as folders. Each folder represents an object,
contains an HTML view of that object, and exposes its content and relationships
through ordinary filesystem operations. Users can browse contacts, preview a
picture, and share that picture by copying a contact representation into its
`Shared with` folder.

This extends the canonical-root and access model in
[Domain collections and sharing](../DOMAIN_COLLECTIONS_AND_SHARING.md).
The paths below illustrate the interaction; they do not prescribe new mount names.

## Folder representation

```text
contacts/
  Alice Smith/
    index.html
objects/
  Holiday photo/
    index.html
    photo.jpg
    Shared with/
      Alice Smith/
        index.html
    People in photo/
      Alice Smith/
        index.html
```

Contact folder names come from the contact's main profile name. Stable identity
determines which contact a folder represents; the displayed name is a label.
Profile renames update labels without changing identity or breaking relationships.
Duplicate names require a deterministic disambiguating suffix. Filesystem-unsafe
characters must be escaped without changing the underlying name.

Every object folder contains `index.html`, a generated, browser-renderable view
of the underlying object. A picture folder also exposes its ordinary image file.
Other object types expose their appropriate native content alongside the HTML
view. These views are projections of canonical objects, not separate authoritative
copies maintained by Filer.

The HTML representation carries a stable object reference so that users can copy
the file itself into a relationship folder. Copying the enclosing contact folder
must support the same interaction. Filer resolves and validates the reference
before acting; a filename or arbitrary HTML text cannot establish identity or
authorization. The exact portable reference encoding remains an implementation
decision.

## Sharing by copying and removing

`Shared with` expresses access to the containing object.

| Filesystem action | Meaning |
| --- | --- |
| Copy Alice's `index.html` into the picture's `Shared with/` | Grant Alice access to the picture. |
| Copy Alice's contact folder into the same destination | Perform the same grant using the same contact identity. |
| Copy Alice there again | Keep one relationship; do not create duplicate contacts or grants. |
| Remove Alice's entry from `Shared with/` | Revoke Alice's access to the picture. |
| Open Alice's entry | Render the referenced contact. |

After a successful copy, Filer projects the recipient as a contact folder under
`Shared with`, regardless of whether the input was a file or folder. This action
creates an access relationship to the existing contact; it does not create a new
contact or require copying the contact's entire object graph to the recipient.
Removing that relationship does not delete the source contact or the picture.

The destination determines the operation. Copying the HTML file outside Filer
exports a representation. Copying it into `Shared with` explicitly requests a
grant. An ambiguous drop into the object folder itself must not silently grant
access.

Sharing uses the owning domain's authorization operation and the object's
canonical stable root. The grant covers the content needed to render and use the
object, including the picture bytes, according to that domain's reference graph.
It does not grant unrelated contact data. Filer must preserve domain policy,
including approval by the owning authority where required.

## Revocation is an access change

Removing a recipient must change underlying access, not merely hide a directory
entry. Filer reports success only after the authoritative operation succeeds.
Pending work remains visibly pending; rejected grants or revocations surface as
filesystem errors and leave the authoritative relationship visible accurately.

Revocation stops further authorized retrieval and future synchronization through
the revoked access. It cannot retract immutable bytes or exported copies already
received by another device.

Multiple access paths need explicit treatment before implementation: a person may
also receive access through a group or a shared parent collection. Filer must not
report that removal revoked a person's access while another effective grant
remains. The representation and operation for these cases must either support
effective revocation through the owning policy or reject the removal with the
reason. Silently deleting only a direct grant does not meet this interaction
contract.

## Association is separate from access

`People in photo` describes who appears in an image. Adding or removing a contact
there changes that association without granting or revoking access. Alice can
appear in a picture without receiving it, and receive a picture without appearing
in it.

Other relationship folders should likewise state their meaning. For example,
associated pictures and the contact's profile picture are distinct relationships.
Their final labels and write semantics remain to be specified.

## Implementation boundaries

Shared projection, reference-resolution, and access contracts belong in
`../one/packages/*`. Native Filer adapters translate filesystem operations into
those contracts consistently on macOS, Linux, and Windows. Domain objects and
domain authorization remain owned by their existing models.

Native copies may arrive as several writes. A partial file or interrupted
directory copy must not trigger a grant. Implementation must define a completion
boundary, validate the full reference, and make repeated operations idempotent.
Changes to names, relationships, and access should invalidate the affected native
entries through the existing event/change-feed path.

## Acceptance scenarios

1. A contact appears under its main profile name with a renderable `index.html`.
2. Renaming that profile preserves identity and existing sharing relationships.
3. Contacts with identical names remain distinguishable and resolve correctly.
4. A picture folder provides both its HTML view and original image content.
5. Copying either a contact HTML file or its folder into `Shared with` grants the
   intended person access and produces one recipient folder.
6. Duplicate copies do not duplicate contacts or grants.
7. Invalid references, incomplete copies, and unauthorized operations fail without
   creating a share.
8. Removing a recipient revokes effective access or visibly fails if domain policy
   or another access path prevents it; hiding an entry is insufficient.
9. A revoked recipient cannot obtain subsequent versions through the revoked
   access; previously received copies remain outside the retraction guarantee.
10. Changing `People in photo` never changes sharing permissions.

The shared implementation and macOS bridge cover these operations. Other native
adapters consume the shared filesystem contract; their platform-specific drag-and-drop
behavior still needs native verification.
