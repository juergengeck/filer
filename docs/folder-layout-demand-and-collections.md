# Filer folder layout: demand categories and tag folders

Status: proposed, awaiting owner review (revision 3: category-tag demand, literal paths, after-the-fact reporting)
Date: 2026-11-09
Summary: Filer folders are Unix paths mapped into Finder. Every path segment
is a `tag.core` tag, root segments are category tags, and demand is a set of
category tags. Only supply makes content visible. Saved folders are
`TagSetDefinition`s, filing is a `TagBinding`, grants travel like any other
content, and reports are written after the fact from supply, demand, and share
events.

## Problem

Filer's root today is a list of product projections:

- `FilerRuntime` mounts `/Files`, `/Fotos`, and `/Gesundheit` (with the
  product-owned `Flexibel` child) through `FilerFolderRegistry`.
- `filer.folders` stores one `auto | visible | hidden` mode per product ID
  (`files`, `fotos`, `health.flexibel`). It controls visibility only and tells
  no supplier what this Filer wants.
- Content arrives only by push. "Pairing alone shares no collection": the owner
  shares each Fotos collection from fotos.one to the Filer identity by hand.
- Users cannot group content. `/Fotos` mirrors collections others made, and
  Fotos's own collections are JSON library state (`libraryStateJson`), not ONE
  objects.
- Pictures cannot be found by time, place, or person, and health data cannot be
  gathered into something a doctor can receive.
- Two documents disagree on root names: `/Files`, `/Fotos`
  ([dynamic folder configuration](dynamic-folder-configuration.md)) versus
  `/Dateien`, `/Bilder`, `/Freigaben`
  ([domain collections](../DOMAIN_COLLECTIONS_AND_SHARING.md)).

`../one/packages/tag.core` already provides the grouping model this needs:
`TagDefinition` (atomic tag), `TagBinding` (one tag on one target, with source,
approval, and lifecycle), `TagSetDefinition` (saved selector), `TagGovernance`
(the only way a tag affects access), per-tag time and sync tries, and Journal
audit. This spec adds no tag, collection, or grouping type of its own.

## Decisions

| # | Decision |
| --- | --- |
| D0 | **Folders are Unix paths**, mapped into Finder (and FUSE, ProjFS) as ordinary folders. Segment names are literal: no localized display layer, no Finder-tag mirror. |
| D1 | Root folders are **category tags** (`tag:category:pictures`, …), not products. A product appears as a child only when its data has its own authority (`Gesundheit/Flexibel`). |
| D2 | **Demand is a set of category tags**, never a specific folder, item, or person. A category's checkbox adds or removes its tag from the owner's `SyncDemand`. |
| D2a | **Only supply makes content visible.** Demand grants nothing and reveals nothing a supplier can act on beyond the categories. If the owner does not supply something, no one sees it. |
| D3 | **A folder path is a tag selector**: each segment names a tag, and the path means `allOf` those tags. No folder objects exist for plain paths. |
| D4 | A **saved folder** is a `TagSetDefinition` with an owner-scoped explicit `id`; it may include other folders by reference (requires the tag.core extension in [Required tag.core changes](#required-tagcore-changes)). |
| D5 | **Filing is tagging.** Finder writes create or revoke manual `TagBinding`s. Items are never copied or deleted by a folder operation. |
| D6 | **Time, place, and people are tags too**, bound with `sourceKind: imported` (EXIF) or `suggested` (face clusters, AI). Finder shows the canonical view: active and approved bindings only. |
| D7 | Tags never widen access. Sharing a folder is explicit `TagGovernance` consumed by `trust.abac`. The resulting **tag-based grants are content**: they are supplied, synchronized, and shared like any other object. |
| D8 | **Reporting is after the fact.** Supply creation, demand creation, and sharing are events; status views and reports (including a doctor's report) are read from those events, never written alongside them. |
| D9 | Tag IDs, tag-set IDs, and issuer Person IDs identify roots; a path segment is a tag's label. |

## Layout

```
/Dateien/                              files category: containment, unchanged
/Bilder/                               allOf [tag:category:pictures]
    Urlaub/                            allOf [tag:urlaub]
        Italien/                       allOf [tag:urlaub, tag:italien]
    Urlaub Italien 2026/               saved folder (TagSetDefinition)
    Zeit/
        2026/                          allOf [tag:time:2026]
            03/                        allOf [tag:time:2026, tag:time:2026-03]
    Orte/
        Wien/                          allOf [tag:place:wien]
    Personen/
        Anna/                          allOf [tag:person:<id>]
    Geteilt/
        Anna/                          folders and tags Anna shared
/Gesundheit/                           health category
    Knie OP/                           allOf [tag:knie-op]
    Zeit/  Orte/                       same axes as pictures
    Flexibel/                          product child: StudyCenter-authorized roots
    Berichte/
        2026-03 Knie OP.pdf            report over a share (read-only)
    Geteilt/<person>/
/ONE/System/...                        settings, status, raw objects (unchanged)
```

`/Dateien` keeps ordinary containment (`FilerStoredEntry` paths, one place per
file). Every other category uses tag folders. Received plain files appear under
`/Dateien/Geteilt/<person>/`.

## Path resolution

A path below a category resolves to a selector:

1. The **root segment** is a category tag (`tag:category:*`). Providers bind it
   on import (`sourceKind: system`) from the item's type, so every supplied item
   carries its category. The same tags form demand, which keeps folders and
   demand one vocabulary.
2. **Axis segments** (`Zeit`, `Orte`, `Personen`) are fixed path names for the
   tag namespaces `tag:time:*`, `tag:place:*`, `tag:person:*`. They are not tags
   and cannot be created by users.
3. Every **other segment** is looked up first among the viewer's saved-folder
   labels at that position, then by the label or alias of a `TagDefinition`.
   Each additional tag segment narrows the result: the path's tags form one
   `allOf`.
4. `Geteilt/<person>/...` resolves the same way against that person's shared
   bindings and saved folders.

So a parent folder always contains its children's items: a child only adds a
tag to the conjunction. A segment that names no known tag or saved folder does
not exist (`ENOENT`) until it is created (see below).

Each folder lists as children:

- items whose canonical bindings satisfy the selector, including the category tag;
- plain-tag subfolders: every tag that further narrows the current result to a
  non-empty set (for the category root: user tags in use there);
- active saved folders whose label places them here, even when empty;
- the axis folders and `Geteilt` at the category root.

Listing reads the per-tag tries through `TagSetService` and `PersistentTagIndexService`.
No ambient object-store scan is involved.

## Saved folders and includes

A saved folder is a `TagSetDefinition`:

```ts
{
  $type$: 'TagSetDefinition',
  id: 'tag-set:folder:<ownerPersonIdHash>:<uuid>',  // explicit, owner-scoped
  label: 'Urlaub Italien 2026',                       // path segment / placement
  selector: {
    allOf: ['tag:urlaub', 'tag:italien', 'tag:time:2026'],
    unionOfSets: ['tag-set:folder:<owner>:<familie-hochzeit>']   // extension, see below
  },
  createdBy: <owner>
}
```

- The `id` is explicit, not derived from the selector. Two people saving the same
  selector under different names get two objects instead of competing versions
  of one, and renaming a folder is a new version with the same `id`.
- `label` is the folder's literal path segment. A label with `/` places the folder at that path
  inside its category.
- **Includes** reference other saved folders by `id` and are shown as relative
  paths (`../Familie/Hochzeit`). Renaming or moving the included folder keeps
  the include working. An include the viewer cannot access shows as unavailable.
- The folder's result is `resolve(selector without includes) ∪ resolve(each included set)`.
  Cycles are harmless: resolution keeps a visited set and the union is the same.
- A plain path never needs a saved folder. Saving is for a name that is not a
  path of tags, or for includes.

## Filing: Finder gestures become bindings

All writes create or revoke **manual** `TagBinding`s asserted by the owner
(`sourceKind: manual`, `approvalStatus: approved`). A folder's **own tag** is
the last segment of a path folder, or the single `allOf` tag of a saved folder.

| Gesture | Effect |
| --- | --- |
| `mkdir /Bilder/Urlaub` | Ensure the `TagDefinition` for `Urlaub`, and create a saved folder (label `Urlaub`, `allOf [tag:urlaub]`) so the folder stays listed while empty. |
| `mkdir /Bilder/Urlaub/Italien` | Same, with label `Urlaub/Italien` and `allOf [tag:urlaub, tag:italien]`. |
| Copy an existing item into a folder | Bind each tag of the folder's `allOf` that the item lacks canonically. Filing a photo with no EXIF date into `Zeit/2026` is a deliberate user correction and is allowed. |
| Move an item between folders | Revoke the source folder's own-tag binding, then bind the target's missing tags. |
| Drop a new file from outside Filer | The category provider imports it (e.g. Fotos photo import), then the copy rule applies. A provider may refuse a type (`EINVAL`). |
| Delete an item | Revoke the owner's manual binding of the folder's own tag. If that tag comes only from `imported`/`suggested` bindings (e.g. EXIF year), `EPERM` with the reason; reject a suggestion in the app instead. If the item appears only through an include, `EPERM` ("lives in ../Familie"). |
| Rename a folder | A saved folder gets a new `TagSetDefinition` version with the new label and the same `id`; its tags are unchanged. A plain path folder is first saved, then renamed. `TagDefinition`s are never relabeled from Finder: their `id` comes from the slug and is shared with everyone who uses that tag. |
| Delete an empty folder | A saved folder is retired (new version, `state: retired`). A plain path folder has nothing to remove and leaves the listing once empty. `TagDefinition`s stay; vocabulary is not deleted. |
| Rename an item | `EPERM`; item names come from the source. |
| Write inside `Geteilt/`, `Berichte/`, or axis roots | `EPERM`. Copying a received item into an own folder is allowed (D7). |

Writes from a saved folder with more than one `allOf` tag bind all of them on
copy; delete is `EPERM` there, because no single own tag exists.

## Time, place, people, and suggestions

| Axis | Source | `sourceKind` | Writable in Finder |
| --- | --- | --- | --- |
| Time (`tag:time:2026`, `tag:time:2026-03`) | Capture time from EXIF or the provider | `imported` | Copy adds a manual binding (user correction); delete of imported-only is `EPERM` |
| Place (`tag:place:<slug>`) | GPS reverse-geocoded by the provider | `imported` | Same as time |
| People (`tag:person:<id>`) | fotos.core face clusters | `suggested`, `pending` until approved | Only approved bindings appear in Finder; approve or reject in the app |
| AI content tags (e.g. `wunde`, `quittung`) | An AI asserting as its own Person | `suggested`, `pending` | Same as people |

Imported and suggested tags are evidence, not truth, exactly as tag.core
defines. Finder shows the canonical view. The apps may show the discovery view
(including pending suggestions) separately.

## Demand and supply

Demand and supply use the objects described in
[demand/supply matching](../DEMAND_SUPPLY_SYNC_MATCHING.md) (`SyncDemand`,
`SyncSupply`, `ScopedTrieRoot`, `SyncMatch`). They are not implemented yet; they
belong in `../one/packages`, and this spec is their first consumer.

### Demand is category tags

The owner's demand is one versioned `SyncDemand` whose selector is a set of
category tags (`selectorKind: tags`, e.g. `[tag:category:pictures, tag:category:health]`).

- Checking a category adds its tag (new version); unchecking removes it.
- Demand never names a folder, an item, a saved set, or a person. Narrower
  wishes are expressed by what suppliers choose to supply, not by demand.
- Removing a tag deletes nothing, revokes nothing on the supplier side, and keeps
  received objects. The category leaves the root listing.

### Supply decides visibility

- A supplier publishes `SyncSupply` for what it is willing to provide, backed by
  `ScopedTrieRoot`s (for tags: the per-tag sync tries).
- Within the owner's IoM, an own supplier matches the owner's category demand at
  `inner-circle` trust and grants, so content arrives without a manual share step.
- For anyone else, nothing is visible unless the owner supplies it to them.
  Demand on its own exposes nothing beyond the category tags.

### Where the checkbox lives

The checkbox lives in the Filer menu and the Cube device detail; every transport
calls the same demand operation. In Finder, `mkdir` of a category name at the
root adds that category tag to demand, and `rmdir` of the empty category removes
it. Other names at the root are `EPERM`.

### Status

Folder state (**Waiting for content**, **Syncing**, content present) is read
after the fact from the demand, supply, and match events and shown in
`/ONE/System/settings/Filer/status.json`. Filer stores no separate status
record (see [Reporting](#reporting)).

## Sharing

Sharing a folder sets `TagGovernance` on its tag or `TagSetDefinition`, which
`trust.abac` turns into grants (the planned `TagGrantCertificate`).

- **Grants are content.** A tag-based grant is an ordinary object: it is supplied,
  carried by CHUM, and received the same way as the photos it covers. There is no
  separate grant transport or grant registry.
- Ordinary tags never affect access. Filing a received item into an own folder
  copies no authority.
- A recipient of a shared folder gets the bindings and the items the sharer may
  share. Items the sharer received from a third party show as unavailable unless
  their issuer shared them to that recipient as well.
- StudyCenter-authorized health data is never shared by being tagged. Its policy
  owner decides per item.

## Reporting

Reporting is after the fact. Supply creation, demand creation, and sharing are
the events; every report reads them and none is written alongside them.

| Event | Record that already exists |
| --- | --- |
| Demand created or changed | `SyncDemand` versions |
| Supply created or changed | `SyncSupply` versions |
| Match and grant | `SyncMatch`, the grant object, `TagBinding`/`TagGovernance` versions |
| Tagging and approval | tag.core Journal entries (`tag:bound`, `tag:approved`, …) |

- **Status** in `status.json` is a report: current folder state per category,
  computed from these records.
- **A doctor's report** is a report over one share: the grant fixes what was
  shared, and the tag sync-trie roots referenced by that share fix the exact
  membership. Later re-tagging does not change what the share covered, so no
  separate snapshot is taken at sending time.
  - Time-ordered: photos, measurements, and documents in one timeline.
  - Stated vs inferred: manual bindings and approved suggestions are the
    patient's statements; imported metadata is labeled as recorded data.
  - Filer shows rendered reports read-only under `<category>/Berichte/`.

Report format and who renders it are open (question 3).

## Required tag.core changes

| Change | Why |
| --- | --- |
| `TagSelector.unionOfSets?: string[]`, included in `makeTagSetId` normalization, resolved with a visited set in `TagSetService` | Folder includes (D4). Today a selector is one conjunction. |
| `TagSetDefinition.state?: 'active' \| 'retired'` (absent = active), mirroring `TagBinding.state` | Removing a saved folder without deleting history. |
| Namespaced slugs `category:`, `time:`, `place:`, `person:` as a documented convention | Category roots, demand, and axis folders. `canonicalizeTagSlug` already keeps `:`; the README already uses `person:<personId>`. |
| Slug canonicalization of non-ASCII letters | `canonicalizeTagSlug` replaces everything outside `[a-z0-9:._/-]`, so `München` becomes `m-nchen` and `Ärztin` becomes `rztin`. German labels collide or degrade. Transliterate (`ä→ae`, `ß→ss`) or keep Unicode letters. |
| README status | It says "Planned package" while recipes and services exist. |

## Ownership boundaries

| Owner | Responsibility |
| --- | --- |
| Filer (`../one/packages/filer.core`, `refinio.api/src/filer`) | Category registry, path resolution, Finder gesture → binding mapping, demand writes, derived folder state, status, report placement. |
| `tag.core` | Tags, bindings, saved sets, approval, governance metadata, tries, Journal audit. |
| Shared platform (`../one/packages`) | `SyncDemand`/`SyncSupply`/`ScopedTrieRoot`/`SyncMatch`, `trust.abac` grants, CHUM. |
| Domain providers (Fotos, health) | Imports and type validation, imported time/place bindings, suggested person bindings, report rendering. |
| Native bridges (`one.provider`, `one.fuse3`, `one.projfs`) | Unchanged; they map native callbacks onto `IFileSystem`. |

## Migration

1. Register category tags and map existing settings once: `files` →
   `tag:category:files`, `fotos` → `tag:category:pictures`, `health.flexibel` →
   `tag:category:health`; `visible`/`auto` put the tag in demand, `hidden` leaves
   it out. Then retire the `filer.folders` section; it is not kept beside the
   demand.
2. `/Files` becomes `/Dateien`. Whether Finder aliases survive depends on File
   Provider item identifiers staying stable; verify on macOS before shipping the
   rename.
3. Fotos library JSON converts once, at Fotos app start: each collection becomes
   a `TagDefinition` plus manual `TagBinding`s on its photos. The JSON is not
   authoritative afterwards.
4. `/Fotos/<issuer collection>` becomes `/Bilder/Geteilt/<person>/<folder>`.

## Out of scope

Smart folders beyond `allOf`/`anyOf`/`noneOf` plus includes; demand narrower
than category tags; automatic sharing; clinical authorization changes;
localized path names; Finder tags (`tagData`); Linux and Windows layout
differences beyond the shared `IFileSystem`.

## Open questions

1. **Literal names.** Which names the category and axis paths use (`Dateien`,
   `Bilder`, `Gesundheit`, `Zeit`, `Orte`, `Personen` as drafted here, or
   English), chosen once since paths are literal.
2. **SyncDemand vs GlueDemand.** Proposed: separate (sync scope vs market
   trade), bridged later if needed.
3. **Reports.** Format (PDF only, or also structured data such as FHIR) and
   who renders them (patient, health provider, or AI).

## Delivery order

1. tag.core changes (includes, namespaces, non-ASCII slugs).
2. `SyncDemand`/`SyncSupply`/`ScopedTrieRoot`/`SyncMatch` with matching and
   grants in `../one`, tested between two instances of one owner.
3. Filer category registry, path resolution, gesture → binding mapping, and
   demand-derived folders; migrate `filer.folders`.
4. Fotos: JSON → tags conversion, imported time/place bindings, suggested person
   bindings; `/Bilder` axes and `Geteilt`.
5. Health tag folders under `/Gesundheit`, then reports.

## Validation

Disposable independent ONE instances with a local relay, as in `pnpm test:files`:

- `mkdir /Bilder/Urlaub` then copying a photo in creates one manual
  `TagBinding`; the photo appears in `/Bilder/Urlaub` and nowhere loses it.
- `/Bilder/Urlaub/Italien` lists exactly the photos bound to both tags, and every
  one of them is also in `/Bilder/Urlaub`.
- Deleting a photo in `/Bilder/Zeit/2026` whose year comes from EXIF returns
  `EPERM`; filing an undated photo into it adds a manual binding.
- A saved folder including `../Familie/Hochzeit`, with a cycle back to itself,
  lists the union once; renaming the included folder keeps the include.
- A pending face suggestion does not appear under `Personen/` until approved.
- Checking pictures on Filer adds `tag:category:pictures` to demand, and an own
  fotos.one instance grants with no manual share; unchecking removes the tag
  and keeps received objects.
- Another person's demand for `tag:category:pictures` makes nothing visible to
  them until the owner supplies it.
- A tag-based grant reaches the recipient over CHUM like the content it covers.
- A shared folder containing a third party's photo shows that photo as
  unavailable to a recipient without access.
- A report over a share keeps listing what was shared after the folder is
  re-tagged, and no snapshot object was written when sharing.
- Restart preserves demands, bindings, saved folders, and derived state; no
  polling or delayed retry is used.
