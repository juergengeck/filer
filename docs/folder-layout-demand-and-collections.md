# Filer folder layout: demand categories, multi-view projections, and peer shares

Status: proposed, awaiting owner review (revision 5: Assembly-backed ownership and peer shares, multi-view category projections)
Date: 2026-11-20
Summary: Filer folders are Unix paths mapped into Finder. Root segments are
category tags and demand is a set of category tags. Content is pure
content-addressed data; ownership, time, access, and tags are external metadata
that never live inside the content they describe. Within each category, the same
immutable item projects dynamically into multiple views (tags/collections, time,
place, recognized people, and `Geteilt/<person>`). Peer shares — including
shared tags — arrive as `Assembly` releases, access is assigned by the app from
context, and reports are read after the fact from events.

## Problem

Filer's root today is a list of product projections, and peer sharing is split
across incompatible bespoke mechanisms:

- `FilerRuntime` mounts `/Files`, `/Fotos`, and `/Gesundheit` (with the
  product-owned `Flexibel` child) through `FilerFolderRegistry`.
- `filer.folders` stores one `auto | visible | hidden` mode per product ID
  (`files`, `fotos`, `health.flexibel`). It controls visibility only and tells
  no supplier what this Filer wants.
- Peer shares are fragmented across three custom paths:
  - `SharedFotosFileSystem` projects signed `FotosShareCertificateChain` shares
    flat into `/Fotos/<scopeId> (<issuerHash>)`, mixing raw issuer hashes with
    owned photos.
  - `FilesObjectPlan` records CHUM-imported `FilerObjectRoot`s in
    `FilerReceivedObjectsRoot`, visible only in `/ONE/System/journal` and the
    headless `/objects` endpoint — not in Finder.
  - `PublishedHealthFileSystem` reads only own-owner `flexibel:health-files:*`
    channels under `/Gesundheit/Flexibel`.
- Users cannot browse the same item across multiple facets (time, place,
  recognized person, tags/collections, and who shared it) without duplicating
  data or maintaining parallel folder hierarchies.
- Two older documents disagree on root names: `/Files`, `/Fotos`
  ([dynamic folder configuration](dynamic-folder-configuration.md)) versus
  `/Dateien`, `/Bilder`, `/Freigaben`
  ([domain collections](../DOMAIN_COLLECTIONS_AND_SHARING.md)).

The shared platform in `../one/packages/*` already provides the pieces needed:

- `assembly.core`: signed `Assembly` envelopes (`signer`, `signingKeys`,
  `writerPolicy`, `predecessors`, `authoredAt`) and explicit releases
  (`ReleaseState`, `GraphReleaseState`, `AssemblyReleasePlan`).
- `tag.core`: `TagDefinition`, `TagBinding`, `TagSetDefinition`,
  `TagGovernance`, per-tag tries, and Journal audit.
- `matching.core` + `discovery.core`: generic `RuntimeDemand` / `RuntimeSupply`
  matching.
- `filer.core`: `CategoryDemandPlan` and `FilerSnapshotStore` (stable IDs and
  incremental `FilerDelta` feeds).

## Data and metadata boundary

Content in ONE is immutable and content-addressed. Categories that describe
context rather than content **cannot live inside the content they describe**:

| Category | Where it lives | Rule |
| --- | --- | --- |
| **Content** | Immutable objects, BLOBs, CLOBs | Identified solely by hash. Contains no owner, timestamp, access list, or folder path. |
| **Ownership** | Implicit by instance owner, or explicit by `Assembly` metadata reference | Local data attached to this instance's roots is implicitly owned by `getInstanceOwnerIdHash()`. Shared/peer data carries explicit ownership on its verified `Assembly` (`signer` / `publisher`), never via a self-asserted `owner` field inside content. |
| **Time** | External causal/observation metadata (`Assembly` predecessors, time tries, EXIF-derived bindings) | Never mutated into content; the same immutable item can be observed, tagged, or released at different times. |
| **Access** | Assigned by the app from context (an `Assembly`, a certificate, user interaction, demand/supply match) | External `Access` / `IdAccess` grants and release states. Content and tags never carry or widen access on their own. |
| **Tags** | External metadata relations (`TagBinding`, `TagSetDefinition`) | Ordinary data shared the exact same way as any other data: implicitly owned locally, or carried inside an `Assembly` release when shared by a peer. |

Because ownership, time, access, and tags stay outside content, **one immutable
item can be projected into many folders at once** — by time, place, recognized
person, tag/collection, and sharing peer — with zero byte duplication and
without ambiguity about who owns it or who may receive it.

## Decisions

| # | Decision |
| --- | --- |
| D0 | **Folders are Unix paths**, mapped into Finder (and FUSE, ProjFS) as ordinary folders. System segments (categories, axes, `shared`) are English internally and shown translated (`pictures` → `Bilder`, `shared` → `Geteilt`); user tags and saved folders keep their own labels. No Finder-tag mirror. |
| D1 | **Categories first.** Root folders are category tags (`tag:category:files`, `tag:category:pictures`, `tag:category:health`, …), not products and not peers. A product appears as a child only when its data has its own authority (`Gesundheit/Flexibel`). |
| D2 | **Demand is category tags** in the system's generic demand and supply (`matching.core`, `RuntimeDemand`/`RuntimeSupply`), never a specific folder, item, or person. A category's checkbox activates or withdraws that category's demand (`CategoryDemandPlan`). |
| D2a | **Only supply makes content visible.** Demand grants nothing and reveals nothing beyond the demanded categories. |
| D3 | **Multi-view projection inside every category.** One immutable item projects into every view whose external metadata matches it: tags/collections, time (`Zeit/`), place (`Orte/`), recognized people (`Personen/`), and sharing peer (`Geteilt/<person>/`). |
| D4 | **A folder path is a tag selector** (`allOf` its segments) for plain tag paths. A **saved folder** (collection) is a `TagSetDefinition` with an explicit `id`; it may include other saved folders via `unionOfSets`. No folder objects exist for plain tag paths. |
| D5 | **Filing is tagging (classification only).** Finder writes create or revoke local manual `TagBinding`s (owned implicitly by the local instance). Items are never silently copied or deleted by a folder operation. Filing a peer-shared item records classification without retaining a local copy or widening access; keeping a local copy across share retirement requires an explicit, policy-authorized adoption step. |
| D6 | **Time, place, and recognized people are external metadata / tags**, bound with `sourceKind: imported` (EXIF/GPS) or `suggested` (face clusters, AI). Finder shows the canonical view: active and approved bindings only. |
| D7 | **Sharing is an `Assembly` release; access is app-assigned from context.** Tags never widen access and have no special sharing transport. The app assigns access based on context (user share action, `Assembly`, certificate/credential, IoM demand match) and publishes an `Assembly` release (`GraphReleaseState` for person-targeted cuts in slice 1; `ReleaseState` for versioned entity / group releases). |
| D8 | **Tags are shared like any other data.** A peer's shared tags and saved folders arrive pinned by exact version hashes inside that peer's accepted `Assembly` release cut. They project under `Geteilt/<person>/` resolved exclusively within that cut and never collide with or overwrite the local instance's implicitly owned tag roots. |
| D9 | **Reporting is after the fact.** Demand, supply, `Assembly` releases, and access changes are events; status views and reports (including a doctor's report) are read from those records, never written alongside them. |
| D10 | **Stable IDs identify roots and appearances; labels are presentation.** Decorated ONE datatypes (`SHA256Hash<T>`, `SHA256IdHash<T>`) are never replaced with plain strings; using decorated hash/ID types does not by itself imply graph inclusivity. Each projected Finder appearance gets its own view-scoped stable `FilerItem` ID in `FilerSnapshotStore` while sharing the same immutable `contentVersion`. |

## Layout

Categories come first at the root. Inside a category, the same items project
simultaneously across multiple dynamic views:

```
/Dateien/                              files category: containment for owned files
    ...                                owned FilerStoredEntry hierarchy
    Geteilt/                           present only when active peer file shares exist
        Anna/                          Anna's accepted Assembly file releases (read-only)
            Projektplan/
/Bilder/                               pictures category (allOf [tag:category:pictures])
    Urlaub/                            local tag folder: allOf [tag:urlaub]
        Italien/                       narrowing path: allOf [tag:urlaub, tag:italien]
    Urlaub Italien 2026/               local saved folder / collection (TagSetDefinition)
    Zeit/                              time projection (owned + accepted peer shares)
        2026/
            03/
    Orte/                              place projection (owned + accepted peer shares)
        Wien/
    Personen/                          recognized-person projection (approved bindings)
        Anna/
    Geteilt/                           peer-share projection (present only when non-empty)
        Anna/                          Anna's accepted Assembly picture releases (read-only)
            Sommer 2026/               collection/tag Anna shared in her release
            IMG_1042.jpg               directly shared item in Anna's release
/Gesundheit/                           health category
    Knie OP/                           local tag folder
    Zeit/  Orte/                       same axes as pictures
    Flexibel/                          product child: StudyCenter-authorized roots
    Berichte/
        2026-03 Knie OP.pdf            report over a share (read-only)
    Geteilt/                           present only when active peer health shares exist
        <person>/
/ONE/System/...                        settings, status, journal, raw objects (unchanged)
```

Example: a photo taken in March 2026 in Vienna with Max recognized in it, shared
by Anna inside her collection `Sommer 2026`, is one immutable object/BLOB that
appears simultaneously in:

- `/Bilder/Geteilt/Anna/Sommer 2026/IMG_1042.jpg` (from Anna's accepted
  `Assembly` release — *shared by*)
- `/Bilder/Zeit/2026/03/IMG_1042.jpg` (*by time*)
- `/Bilder/Orte/Wien/IMG_1042.jpg` (*by place*)
- `/Bilder/Personen/Max/IMG_1042.jpg` (*by person recognized*, once approved)
- `/Bilder/Urlaub/IMG_1042.jpg` (if the local user also files it into `Urlaub` —
  *by local tag/collection*)

Filing Anna's photo into `/Bilder/Urlaub` records only a local `TagBinding`
(classification). When Anna retires her release — and no other authorized source
remains for that item — the photo disappears from `/Bilder/Geteilt/Anna/...`,
from the axes (`/Bilder/Zeit/...`, `/Bilder/Orte/...`, `/Bilder/Personen/...`),
and from active Finder listings in `/Bilder/Urlaub/`, while the local
`TagBinding` stays preserved (so if an authorized source returns later, the
binding restores it automatically). Retaining a local copy that survives share
retirement requires a separate, explicit, policy-authorized **adoption** step
(for example copying into `/Dateien/` or invoking an explicit "Keep local copy"
action where domain policy permits — refused for non-adoptable clinical data),
which references the existing `SHA256Hash<BLOB>` under a local owned root with
zero byte duplication.

## Dynamic folders for peer shares (`Assembly` releases)

### Unit of sharing and audience scope

- **Slice 1 (person-targeted graph cuts):** uses `GraphReleaseState` with an
  explicit `Person` audience (`audience: {type: 'person', id: SHA256IdHash<Person>}`),
  observed through `AssemblyReleasePlan` (`../one/packages/assembly.core`).
- **Group observation:** belongs to `ReleaseState` (`ObservedReleaseAudience`:
  local `Person` plus subscribed `Group`s), not `GraphReleaseState`.
- **Ownership and provenance:** verified from the `Assembly` (`signer`,
  `signingKeys`, `writerPolicy`, `signature`) and the release state
  (`publisher`, `audience`, `source`, `selection`, `roots`). A stored object
  that merely claims `owner: Anna` or `createdBy: Anna` in its own fields is
  never promoted into `Geteilt/Anna/`.
- **Access assignment:** the sending app assigns ONE access (`Access` /
  `IdAccess`) based on context — an explicit user share gesture, a certificate
  or clinical credential, or an IoM category demand/supply match — and publishes
  the `Assembly` release. Tags do not assign access by themselves.

### Receiver-visible replacement and signed retirement

`GraphReleaseState` includes `roots` in its identity (`isId: true`) and commits
each cut with `predecessors: []` so a fresh CHUM receiver never replays
retracted cuts. Because `listAcceptedGraphReleaseSelections()` unions roots
across accepted cuts and `retireGraphReleaseSelection()` only clears the
sender's direct access grants, a receiver that already accepted an earlier cut
would otherwise keep projecting it after replacement or retirement.

To make replacement and retirement explicit and order-independent on the
receiver without replaying retracted cuts:

- Keep each `GraphReleaseState` cut as a detached genesis `Assembly` carrying
  the exact payload `roots` for that cut.
- Pair it with a causal **selection-head `Assembly`** keyed by
  `(source: SHA256IdHash<any>, audience: SHA256IdHash<Person>, publisher: SHA256IdHash<Person>, selection: string)`
  — **excluding** `roots` from its identity:

```ts
type GraphReleaseSelectionHead = {
  $type$: 'GraphReleaseSelectionHead';
  source: SHA256IdHash<any>;             // isId
  audience: SHA256IdHash<Person>;        // isId
  publisher: SHA256IdHash<Person>;       // isId
  selection: string;                     // isId
  status: 'active' | 'retired';
  /** Exact active cut Assembly; absent when status is 'retired'. */
  currentCut?: SHA256Hash<Assembly<GraphReleaseState>>;
};
```

- **Typed non-inclusive reference:** `currentCut` uses the decorated datatype
  `SHA256Hash<Assembly<GraphReleaseState>>` (never a plain `string` datatype in
  code), without making it a CHUM-traversed `referenceToObj` inclusion edge.
  Decorated hash/ID types preserve type safety without implying graph
  inclusivity, so chaining `GraphReleaseSelectionHead` via
  `Assembly.predecessors` gives a verified causal DAG without pulling retracted
  payload cuts through CHUM.
- **Replace:** the publisher stores and grants Cut 2 via `releaseGraph()`
  (which withdraws direct sender grants on Cut 1) and commits a new causal
  `GraphReleaseSelectionHead` `Assembly` with `predecessors: [head1Hash]`,
  `status: 'active'`, and `currentCut: cut2AssemblyHash`.
- **Retire (signed withdrawal):** the publisher commits a causal
  `GraphReleaseSelectionHead` `Assembly` with `predecessors: [headNHash]`,
  `status: 'retired'`, and `currentCut` omitted, and calls
  `retireGraphReleaseSelection()`.
- **Receiver resolution:** for each selection-head entity addressed to the local
  `Person`, Filer reads the causal tip via `readAssemblyHeads(selectionHeadEntity)`
  (never unioning old cuts via `listAcceptedGraphReleaseSelections()`):
  - `status === 'retired'` → project nothing for that selection immediately.
  - `status === 'active'` → project **only** the accepted `GraphReleaseState`
    whose `Assembly` hash equals `currentCut` once that cut is accepted.
  - **Out-of-order arrival:** if Cut 1 or `head1` arrives *after* Cut 2 or
    *after* a signed withdrawal, `head2` / the withdrawal head causally
    dominates `head1` and Cut 1 is not `currentCut`, so Cut 1 is never
    resurrected.

### Exact version pinning for shared tags and collections

Because `TagBinding.targetRef` and `TagSetDefinition.selector` (`unionOfSets`)
are not CHUM-traversed `referenceToObj` edges, a tag or collection share cannot
rely on implicit traversal from a `TagSetDefinition`. Every shared tag or
collection cut pins its complete closed graph as exact version hashes inside the
release cut (`GraphReleaseState.roots` / `Assembly.objects` and reachable
`Assembly.blobs`):

- the exact `TagSetDefinition` version hash(es) for the shared folder and every
  transitively included `unionOfSets` set the sharer discloses;
- the exact `TagDefinition` version hash(es) needed for display labels;
- the exact `TagBinding` version hash(es) binding tags to members of that cut;
- the exact target item version hash(es) (and their reachable BLOBs) that the
  sharer is authorized to disclose.

On the receiver, `Geteilt/<person>/...` resolves shared tags, saved folders, and
includes **exclusively** against the objects pinned in that accepted cut — never
consulting ambient local `TagSetDefinition` or `TagBinding` heads and never
merging peer tags into the local instance's implicitly owned tag tries. An
included set or target item absent from the pinned cut is skipped/marked
unavailable deterministically.

### Dynamic folder lifecycle

All mount and folder changes are event-driven from `Assembly` acceptance,
contact profile updates, and category-demand changes; no polling or ambient
storage scans are used.

| Event | Filesystem effect |
| --- | --- |
| First accepted active cut + selection head from peer $P$ in mounted category $C$ | `Geteilt/` (if absent) and `Geteilt/<P>/` appear dynamically under `/<C>/`, exposing each active release selection/folder from $P$. Released items with time/place/approved-person metadata also project into `/<C>/Zeit/`, `/<C>/Orte/`, `/<C>/Personen/`. |
| Replacement selection head + new `GraphReleaseState` cut from $P$ | The projected folder updates incrementally in place via `FilerSnapshotStore` deltas to match **only** the new `currentCut`; removed entries disappear even if the old cut arrives later. |
| Signed withdrawal head (`status: 'retired'`) from $P$ | That shared folder disappears from `/<C>/Geteilt/<P>/` immediately, and any items with no remaining authorized source leave axes and active local tag listings. When $P$ has no active shares left in $C$, `/<C>/Geteilt/<P>/` disappears; when no peer has active shares in $C$, `/<C>/Geteilt/` disappears. |
| Peer $P$ renames their `Profile` or shared `TagSetDefinition.label` / `FilerShareCut.label` | Displayed segment name updates via `createStableProjectionNames` (profile name + deterministic suffix only on collision; never raw hashes as ordinary labels). Stable `FilerItem` IDs stay unchanged. |
| Accepted release arrives for an **undemanded / unmounted** category | The category root does **not** appear unilaterally in Finder (anti-spam / consent boundary). Available peer supply is reported in `/ONE/System/settings/Filer/status.json` and the Filer UI so the user can opt in by checking the category. |
| Peer shares mixed-category content in one `Assembly` release | Each item in the release projects into the category matching its category classification under `<Category>/Geteilt/<P>/...` (only for active categories). |

### Convergence of existing peer-share paths

This replaces the three separate peer-share mechanisms currently in the codebase:

- `FilesObjectPlan`'s `FilerReceivedObjectReceipt` / `FilerReceivedObjectsRoot`
  (hand-rolled CHUM provenance index) → accepted inbound `Assembly` releases
  projected under `/Dateien/Geteilt/<person>/`.
- `SharedFotosFileSystem`'s `FotosShareCertificateChain` / `FotosShareManifest`
  (flat `/Fotos/<scopeId> (<issuerHash>)`) → accepted inbound `Assembly`
  releases projected under `/Bilder/Geteilt/<person>/<collection>` and into
  `/Bilder/Zeit/`, `/Bilder/Orte/`, `/Bilder/Personen/`.
- `PublishedHealthFileSystem`'s owner-only channel scan → `Assembly`-verified
  StudyCenter releases under `/Gesundheit/Flexibel` and peer health shares under
  `/Gesundheit/Geteilt/<person>/`.

## Path resolution

A path below a category resolves to a view selector:

1. **Root segment** is a category tag (`tag:category:*`). Providers bind it on
   import (`sourceKind: system`) from the item's type so every item belongs to
   its category. The same tags form demand.
2. **Axis segments** (`time`, `places`, `people`, `shared`, shown translated as
   `Zeit`, `Orte`, `Personen`, `Geteilt`) select external metadata projections
   and cannot be created manually by users.

   Category and axis segments resolve from either the English name or its
   translation, so paths keep working when the display language changes.
3. **Own tag and saved-folder segments** (directly below the category root):
   looked up first among the local instance's saved-folder labels at that
   position, then by the label or alias of a `TagDefinition`. Each additional
   tag segment narrows the result (`allOf`), resolved over the local instance's
   canonical bindings.
4. **Axis projections** (`Zeit/`, `Orte/`, `Personen/`): project **all**
   accessible items in the category — both locally owned items and items from
   accepted peer `Assembly` releases — using their active, approved metadata
   bindings (`tag:time:*`, `tag:place:*`, `tag:person:*`).
5. **Peer-share projection** (`Geteilt/<person>/...`): resolves `<person>`
   against peers with active accepted `Assembly` releases in this category (via
   `createStableProjectionNames`), then projects that peer's released folders,
   saved `TagSetDefinition`s, shared tag views, and directly released items
   strictly within the roots of that peer's accepted releases.

A segment that names no known tag, saved folder, axis value, or active peer
share returns `ENOENT`.

### Listing and enumeration bounds (File Provider safety)

Each folder lists:

- items matching the folder's selector or release root;
- for local category roots and saved folders: active saved folders whose label
  places them here (even when empty) and plain-tag subfolders in use here;
- axis folders (`Zeit`, `Orte`, `Personen`) and `Geteilt` (only when non-empty)
  at the category root;
- inside `Geteilt/<person>/`: only the explicitly shared roots (released
  collections/folders/tags and directly shared items) from that peer's accepted
  releases.

> [!IMPORTANT]
> Native working-set enumeration (macOS `NSFileProviderReplicatedExtension`)
> must **never** recursively walk unbounded powerset/permutation tag-path
> lattices (`PublishedWorkingSet.collect()` over $k!$ narrowing paths). Dynamic
> projections publish through `FilerSnapshotStore` with stable `FilerItem` IDs
> and incremental `FilerDelta` feeds, materializing explicit roots, saved
> folders, axis levels, and active `Geteilt/<person>/` release folders, while
> deep ad-hoc multi-tag narrowing paths resolve on demand during directory
> enumeration.

### Stable Finder item identity per projected appearance

`FilerSnapshotStore.prepare()` requires unique `key` and `path` per item
(matching macOS File Provider's single-parent invariant). Because one immutable
item can appear under multiple views simultaneously (`Zeit/`, `Orte/`,
`Personen/`, `Geteilt/<person>/`, local tag/collection folders), every projected
appearance gets its own deterministic entry key scoped by its view/parent and
source item identity:

- Example key shape: `appearance:<viewKey>:<sourceItemIdentity>` — where
  `<viewKey>` is the stable parent scope (for example
  `share:<publisherIdHash>:<selection>:<relDir>`, `time:2026-03`,
  `place:tag:place:wien`, `person:tag:person:<personIdHash>`,
  `tag-set:<setId>`, or `tag-path:<canonicalTags>`) and `<sourceItemIdentity>`
  is the item's immutable identity (`SHA256Hash` / `SHA256IdHash`).
- All appearances of the same underlying file or photo share the exact same
  `contentVersion` (`SHA256Hash<BLOB>` / item content hash), while each
  appearance keeps a distinct, stable `SHA256IdHash<FilerItem>` that survives
  profile renames, folder renames, and updates to sibling views.

## Saved folders and includes

A saved folder (collection) is a `TagSetDefinition`:

```ts
{
  $type$: 'TagSetDefinition',
  id: 'tag-set:folder:<uuid>',                       // explicit stable id (no owner baked in)
  label: 'Urlaub Italien 2026',                      // path segment / placement
  selector: {
    allOf: ['tag:urlaub', 'tag:italien', 'tag:time:2026'],
    unionOfSets: ['tag-set:folder:<familie-hochzeit>']
  }
}
```

- Ownership of a saved folder is **implicit** for locally created sets and
  **explicit** via the enclosing `Assembly` release for peer-shared sets — never
  inferred from a `createdBy` field or an owner prefix in `id`.
- `id` is explicit (not derived from the selector) so renaming a folder creates
  a new version with the same `id` without breaking references or Finder item
  identities.
- `label` is the folder's literal path segment. A label with `/` places the
  folder at that path inside its category.
- **Includes** (`unionOfSets`) reference other saved folders by `id` and are
  shown as relative paths (`../Familie/Hochzeit`). Cycles are harmless (visited
  set). An include outside the viewer's accessible scope or tombstoned shows as
  unavailable.
- A plain tag path never needs a saved folder. Saving is for a custom name, an
  empty persisted folder, or includes.

## Filing: Finder gestures become bindings

Local writes create or revoke **manual** `TagBinding`s in the local instance's
implicitly owned tag state (`sourceKind: manual`, `approvalStatus: approved`).
A folder's **own tag** is the last segment of a path folder, or the single
`allOf` tag of a saved folder.

| Gesture | Effect |
| --- | --- |
| `mkdir /Bilder/Urlaub` | Ensure the `TagDefinition` for `Urlaub`, and create a local saved folder (label `Urlaub`, `allOf [tag:urlaub]`) so it stays listed while empty. |
| `mkdir /Bilder/Urlaub/Italien` | Same, with label `Urlaub/Italien` and `allOf [tag:urlaub, tag:italien]`. |
| Copy an existing item (owned or peer-shared) into a local folder | Bind each tag of the folder's `allOf` that the item lacks canonically in local state. Filing a photo with no EXIF date into `Zeit/2026` is a deliberate local correction and is allowed. Filing a peer-shared item never copies bytes and never grants re-sharing authority. |
| Move an item between local folders | Revoke the local manual binding of the source folder's own tag, then bind the target's missing tags. |
| Drop a new file from outside Filer | The category provider imports it (e.g. Fotos photo import), then the copy rule applies. A provider may refuse a type (`EINVAL`). |
| Delete an item from a local folder | Revoke the local manual binding of the folder's own tag. If the tag comes only from `imported`/`suggested` bindings (e.g. EXIF year), return `EPERM` with the reason; reject suggestions in the app instead. If the item appears only through an include, return `EPERM` ("lives in ../Familie"). |
| Rename a local folder | A saved folder gets a new `TagSetDefinition` version with the new label and the same `id`; its tags are unchanged. A plain path folder is first saved, then renamed. `TagDefinition`s are never relabeled from Finder. |
| Delete an empty local folder | Deleting a saved folder writes a tombstone object referencing its set `id`; history stays intact and the set no longer resolves. A plain path folder leaves the listing once empty. `TagDefinition`s stay. |
| Rename an item | `EPERM`; item names come from the source. |
| Write inside `Geteilt/` or `Berichte/` | `EPERM` (read-only projections of peer `Assembly` releases and share reports). Copying a received item out into an own tag folder creates a local classification binding (D5); explicit adoption into a local owned root is a separate policy-checked action. |
| Write inside axis folders (`Zeit/`, `Orte/`, `Personen/`) | `mkdir`, folder rename, and folder delete at axis roots return `EPERM`. Copying an existing item into `Zeit/<year[/month]>` or `Orte/<place>` is allowed as a manual local correction (creating a local manual binding); writes into `Personen/` and deleting imported-only bindings return `EPERM`. |

Writes from a saved folder with more than one `allOf` tag bind all of them on
copy; delete is `EPERM` there because no single own tag exists.

## Time, place, recognized people, and suggestions

| Axis | Source | `sourceKind` | Writable in Finder |
| --- | --- | --- | --- |
| Time (`tag:time:2026`, `tag:time:2026-03`) | Capture time from EXIF, provider, or peer release metadata | `imported` | Copy adds a local manual binding (user correction); delete of imported-only is `EPERM` |
| Place (`tag:place:<slug>`) | GPS reverse-geocoded by the provider | `imported` | Same as time |
| People (`tag:person:<id>`) | fotos.core face clusters / recognized people | `suggested`, `pending` until approved | Only approved bindings appear in Finder; approve or reject in the app |
| AI content tags (e.g. `wunde`, `quittung`) | AI assertion | `suggested`, `pending` | Same as people |

Imported and suggested tags are evidence, not truth. Finder shows the canonical
view (active and approved bindings). Apps may show the discovery view (including
pending suggestions) separately.

## Demand and supply

Filer uses the system's generic demand and supply; it defines no demand or
supply type of its own:

- **Matching:** `matching.core` (`matchDemandSupply`,
  `matchRuntimeDemandSupply`).
- **Records:** persisted `RuntimeDemand` and `RuntimeSupply` objects
  (`discovery.core`), already carrying tag IDs (`requiredTagIds` /
  `governedTagIds`).

The unimplemented `SyncDemand` / `SyncSupply` / `ScopedTrieRoot` / `SyncMatch`
family in [demand/supply matching](../DEMAND_SUPPLY_SYNC_MATCHING.md) is
superseded and not built.

### Demand is category tags

The owner demands categories via `CategoryDemandPlan`
(`../one/packages/filer.core/src/CategoryDemandPlan.ts`):

- One `RuntimeDemand` per category tag: `domain: content`,
  `requiredTagIds: [tag:category:<id>]`, `status: active | withdrawn`.
- Checking a category creates or reactivates its demand; unchecking writes
  `status: withdrawn`.
- Demand never names a folder, item, saved set, or person.
- Withdrawing deletes nothing, revokes nothing on the supplier side, and keeps
  received objects. The category leaves the Finder root listing.

### Supply and app-assigned access

- A supplier (Cube, fotos.one, another Filer) publishes its `RuntimeSupply` with
  the category tags it supplies in `governedTagIds`.
- Within the owner's IoM, the supplying app matches the owner's category demand
  at `inner-circle` trust, assigns access, and publishes an `Assembly` release
  so content arrives without a manual share step.
- For another person, demand alone exposes nothing. The sending app assigns
  access and publishes an `Assembly` release only when its context authorizes
  it (explicit user share action, verified certificate/role credential, or
  domain policy).

### Where the checkbox lives

The checkbox lives in the Filer menu and Cube's **Your devices** settings; every
surface calls the same demand operation. In Finder, `mkdir` of a category name
at the root activates that category's demand, and `rmdir` of an empty category
withdraws it. Other names at the root return `EPERM`.

## Sharing and authority

- **App-assigned access:** The app decides *whether* to grant access based on
  context — an `Assembly`, a certificate (`AccessCertificate`, clinical role
  bundle), explicit user interaction, or IoM matching — and executes ONE access
  grants plus an `Assembly` release (`ReleaseState` / `GraphReleaseState`).
- **Tags are data, not authority:** Ordinary tags never grant access. Sharing a
  tag folder or saved folder packages the governed scope (its items and, where
  selected, its `TagSetDefinition` / `TagBinding`s) into an `Assembly` release
  for the target audience.
- **No accidental re-sharing:** Filing a peer-shared item into an own folder
  creates only a local binding. When the local user shares that folder to a
  third party, the app includes only items the sharer has authority to release;
  items from a third party without re-share authority show as unavailable to the
  recipient unless their publisher also released them to that recipient.
- **Clinical boundary:** StudyCenter-authorized health data is never shared by
  being tagged. Its policy owner decides per item and releases through
  StudyCenter-signed `Assembly` publications.

## Reporting

Reporting is after the fact. Demand changes, supply changes, `Assembly`
releases, and tagging actions are the events; every report reads them and none
is written alongside them:

| Event | Record that already exists |
| --- | --- |
| Demand created or changed | `RuntimeDemand` versions |
| Supply created or changed | `RuntimeSupply` versions |
| Share / release / revocation | `Assembly<ReleaseState>` / `Assembly<GraphReleaseState>` causal history |
| Tagging and approval | `tag.core` Journal / `Story` entries (`tag:bound`, `tag:approved`, …) |

- **Status** (`/ONE/System/settings/Filer/status.json`): current folder state
  per category (**Waiting for content**, **Syncing**, content present, plus
  available peer releases in unmounted categories), computed from these records.
- **A doctor's report:** a report over a share. The accepted `Assembly` release
  fixes the exact released graph/roots at that cut; later re-tagging does not
  mutate what was released, so no separate snapshot object is written at send
  time. Filer projects such reports read-only under `<category>/Berichte/`.

## Required platform changes

### `assembly.core`

| Change | Why |
| --- | --- |
| `GraphReleaseSelectionHead` recipe and causal selection-head helpers (`replace` / `retire` with `currentCut?: SHA256Hash<Assembly<GraphReleaseState>>`) | Makes `GraphReleaseState` replacement and signed retirement visible and order-independent on receivers without chaining payload cuts through `Assembly.predecessors`. |

### `tag.core`

| Change | Status / Why |
| --- | --- |
| `TagSelector.unionOfSets?: string[]`, resolved with a visited set in `TagSetService` | Done (`TagSetDefinition.ts`, `TagSetService.ts`). |
| Non-ASCII slug transliteration & README status | Done. |
| Tombstone object for a deleted saved folder (plain object referencing set `id`) | Needed: removing a saved folder without deleting history; tombstoned includes are skipped. |
| Decouple tag content from embedded ownership/time and global singleton tries | Needed: strip single-owner assumptions from `TagBinding` / `TagSetDefinition` / `TagSyncTrieRoot` so local tries remain implicitly instance-owned and peer-shared tags resolve strictly over pinned version hashes in an accepted `Assembly` cut without ID collisions. |
| Namespaced slugs `category:`, `time:`, `place:`, `person:` as a documented convention | Convention for category roots, demand, and axis projections. |

### `filer.core` and `refinio.api/src/filer`

| Change | Why |
| --- | --- |
| Wire `assembly.core` into `FilerRuntime` (`Assembly` recipes, `GraphReleaseSelectionHead`, `createAssemblySyncRules`, `AssemblyPlan`, `AssemblyReleasePlan`) | `FilerRuntime` currently registers none of `assembly.core`, forcing bespoke receipt/certificate paths for peer shares. |
| `FilerShareCut` root recipe + slice-1 Files release producer/fixture | Gives slice 1 one exact, immutable Files share root (`{ $type$: 'FilerShareCut', label: string, entries: Set<SHA256Hash<FilerStoredEntry>> }`) carried by `GraphReleaseState` (`audience: Person`). |
| `AcceptedSharesProjection` + persisted `FilerProjectionHead` | Single owner that resolves active selection heads, commits `FilerSnapshotStore` heads, serves **both** `FilerProjection` and `IFileSystem` reads from the same committed snapshot head (so `FileProviderRpc.readItemContent` opens every listed file), and emits `FilerSnapshotStore.affectedContainers()` into `FilerRuntime.onPublishedFilesChanged`. |
| Wire `CategoryDemandPlan` (`tag:category:files`) into `FilerRuntime` in slice 1 | Provides an explicit category-demand source immediately so slice-1 peer shares gate cleanly on active `tag:category:files` demand without waiting for slice 3's full migration. |
| Multi-view category projector (`CategoryProjection` over local state + accepted selection heads) | Projects each category into local tag/collection folders, `Zeit/`, `Orte/`, `Personen/`, and `Geteilt/<person>/` with distinct view-scoped `FilerItem` IDs per appearance. |
| Segment-level localization for categories and axes | Replaces `FilerFolderNames.swift`'s hardcoded full-path map so dynamic segments (`Geteilt`/`Shared`, `Zeit`/`Time`, `Orte`/`Places`, `Personen`/`People`) work across all categories. |

## Ownership boundaries

| Owner | Responsibility |
| --- | --- |
| `assembly.core` | Signed `Assembly` envelopes, `ReleaseState` / `GraphReleaseState`, `GraphReleaseSelectionHead`, causal ordering, `ObservedReleaseAudience` (`ReleaseState`), release acceptance and signed retirement. |
| `tag.core` | Pure atomic tags (`TagDefinition`), `TagBinding`, saved sets (`TagSetDefinition`), tombstones, tries, Journal audit. |
| Filer (`../one/packages/filer.core`, `refinio.api/src/filer`) | Category registry, `AcceptedSharesProjection` + `FilerProjectionHead`, multi-view path resolution, Finder gesture → local binding mapping, demand writes (`CategoryDemandPlan`), `FilerSnapshotStore` projection and unified `IFileSystem` reads, status, report placement. |
| Shared platform (`../one/packages`) | Generic demand/supply (`matching.core`, `discovery.core`), app-assigned access (`one.core`, `trust.abac`), CHUM, translation of English system segments. |
| Domain providers (Fotos, health) | Imports and type validation, category/time/place bindings, suggested person bindings, domain adoption and release policies. |
| Native bridges (`one.provider`, `one.fuse3`, `one.projfs`) | Map native callbacks onto `IFileSystem` / `FilerProjection`; no domain or trust logic in native code. |

## Migration

1. Register category tags and map existing `filer.folders` settings once:
   `files` → `tag:category:files`, `fotos` → `tag:category:pictures`,
   `health.flexibel` → `tag:category:health`; `visible`/`auto` create an active
   demand, `hidden` creates none. Retire `filer.folders` once migrated.
2. `/Files` becomes `/Dateien`. Verify File Provider item identifier stability on
   macOS before shipping the rename.
3. Convert Fotos library JSON collections once at Fotos startup into
   `TagDefinition` / `TagSetDefinition` + manual `TagBinding`s.
4. Converge peer shares onto `Assembly` releases:
   - `FilesObjectPlan` received files → `/Dateien/Geteilt/<person>/`
   - `SharedFotosFileSystem` collections → `/Bilder/Geteilt/<person>/<folder>`
     (and simultaneously into `/Bilder/Zeit/`, `/Bilder/Orte/`, `/Bilder/Personen/`)

## Out of scope

Smart folders beyond `allOf`/`anyOf`/`noneOf` plus `unionOfSets`; demand
narrower than category tags; Filer-specific demand or supply types; automatic
peer sharing without app-authorized context; clinical authorization changes;
Finder tags (`tagData`); platform-specific layout differences beyond the shared
`IFileSystem` / `FilerProjection` contract.

## Delivery order

1. **Slice 1 — End-to-end usable Finder Files share:**
   - Add `GraphReleaseSelectionHead` (`currentCut?: SHA256Hash<Assembly<GraphReleaseState>>`)
     and causal replace / signed-withdrawal helpers in `assembly.core`.
   - Define `FilerShareCut` (`{ $type$: 'FilerShareCut', label: string, entries: Set<SHA256Hash<FilerStoredEntry>> }`)
     and a Files release producer/fixture using `GraphReleaseState` with a
     `Person` audience plus `GraphReleaseSelectionHead`.
   - Register `assembly.core` recipes, sync rules, `AssemblyPlan`,
     `AssemblyReleasePlan`, and `CategoryDemandPlan` (`tag:category:files`) in
     `FilerRuntime`.
   - Implement `AcceptedSharesProjection` owning a persisted
     `FilerProjectionHead` and `FilerSnapshotStore`, wired into **both**
     `FilerProjection` and `IFileSystem` reads (mounted under the active Files
     root at `/Files/Geteilt/<person>/<share>` until the `/Files` → `/Dateien`
     rename verification) and emitting `FilerSnapshotStore.affectedContainers()`
     into `FilerRuntime.onPublishedFilesChanged`.
   - Prove end-to-end through File Provider RPC (`enumerateItems`, `getItem`,
     `readItemContent`): browse, hydrate exact bytes, replace cut, out-of-order
     old-cut arrival, signed retirement, and receiver restart.
2. **`tag.core` cleanup:** saved-folder tombstones and clean separation of tag
   content from embedded ownership/time and singleton trie IDs so shared tags
   travel pinned by exact version hash in `Assembly` cuts.
3. **Multi-view category projector:** category registry, `CategoryDemandPlan`
   migration from `filer.folders`, path resolution across local tag/collection
   folders + `Zeit/` + `Orte/` + `Personen/` + `Geteilt/<person>/` with distinct
   view-scoped `FilerItem` IDs per appearance, Finder gesture → local binding
   writes, and explicit policy-authorized adoption.
4. **Fotos convergence:** JSON → tags conversion, EXIF time/place and suggested
   person bindings, Fotos shares emitted as `Assembly` releases, retiring flat
   `/Fotos/<scopeId> (<issuerHash>)`.
5. **Files & Health convergence:** retire legacy `FilesObjectPlan` received
   receipts once all Files shares use `FilerShareCut` `Assembly` releases; add
   health tag folders and reports under `/Gesundheit`.

## Validation

Disposable independent ONE instances with a local relay, as in `pnpm test:files`:

- **Slice-1 end-to-end Finder Files share:** producer publishes a
  `FilerShareCut` via `GraphReleaseState` (`audience: Person`) and
  `GraphReleaseSelectionHead`; receiver browses `/Files/Geteilt/<person>/<share>/`
  via File Provider RPC (`enumerateItems`, `getItem`) and hydrates exact file
  bytes via `readItemContent` (proving `FilerSnapshotStore` and `IFileSystem`
  serve the same committed head) with live container invalidation.
- **Cut replacement and out-of-order arrival:** producer replaces Cut 1
  (`{a.txt, b.txt}`) with Cut 2 (`{a.txt, c.txt}`); receiver updates in place to
  show `{a.txt, c.txt}`. Delivering Cut 1 (or its earlier selection head) **last**
  does not resurrect `b.txt`.
- **Signed retirement and restart:** producer commits a signed withdrawal
  selection head (`status: 'retired'`) and calls `retireGraphReleaseSelection()`;
  receiver removes the share folder, `<person>/`, and `Geteilt/` reactively.
  Restarting the receiver preserves the committed snapshot head and never
  resurrects retired or replaced cuts.
- **Multi-view projection with distinct Finder IDs:** a photo shared by Anna via
  an `Assembly` release (with EXIF date, GPS place, and an approved
  recognized-person binding) appears simultaneously in `/Bilder/Geteilt/Anna/...`,
  `/Bilder/Zeit/2026/03/`, `/Bilder/Orte/Wien/`, and `/Bilder/Personen/Max/`
  with the identical `contentVersion` (`SHA256Hash`), zero duplicated BLOBs, and
  distinct stable `SHA256IdHash<FilerItem>` IDs per appearance.
- **Pinned shared tags without collision:** Anna and the local user both use tag
  `Urlaub` on different photos. Anna's release cut pins the exact
  `TagSetDefinition`, `TagDefinition`, `TagBinding`, and item version hashes;
  `/Bilder/Geteilt/Anna/Urlaub/` resolves strictly within that cut without
  modifying or colliding with the local `/Bilder/Urlaub/`.
- **Filing vs. explicit adoption across peer, axis, and local views:** copying
  Anna's photo into `/Bilder/Urlaub` creates only a local `TagBinding`. When
  Anna retires her release (leaving no authorized source), the photo disappears
  from `/Bilder/Geteilt/Anna/...`, from `/Bilder/Zeit/...`, `/Bilder/Orte/...`,
  `/Bilder/Personen/...`, and from active Finder listings in `/Bilder/Urlaub/`,
  while the local `TagBinding` remains preserved (re-sharing restores it). A
  second photo explicitly adopted through a policy-authorized local-copy action
  retains the existing `SHA256Hash<BLOB>` under a local owned root and stays
  readable across local and axis views after Anna's release retires.
- **Provenance boundary:** a stored object claiming `owner: Anna` or
  `createdBy: Anna` without a verified accepted `Assembly` release never appears
  under `Geteilt/Anna/`.
- **Profile / folder rename stability:** renaming Anna's profile or Anna's
  shared `TagSetDefinition.label` / `FilerShareCut.label` updates the Finder
  display name via `FilerSnapshotStore` deltas while preserving stable
  `FilerItem` IDs.
- **Category consent boundary:** a peer's `Assembly` release for a category the
  owner has not demanded does not create a top-level Finder root; it surfaces in
  `status.json` and mounts under `<Category>/Geteilt/<person>/` once the owner
  activates that category's demand.
- **Local tag folders & includes:** `mkdir /Bilder/Urlaub`, narrowing
  `/Bilder/Urlaub/Italien`, `EPERM` on deleting EXIF-only tags in `Zeit/2026`,
  cyclic `unionOfSets` includes, and pending face suggestions staying hidden
  until approved.
- **Scale & durability:** working-set enumeration stays bounded without walking
  combinatorial tag-path permutations or polling.
