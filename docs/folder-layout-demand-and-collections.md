# Filer folder layout: demand categories and tag folders

Status: proposed, awaiting owner review (revision 2: folders are tag.core selectors)
Date: 2026-11-09
Summary: Name Filer's root folders by content category, turn each folder's
checkbox into a durable demand that suppliers match, and present everything
below a category as `tag.core` tags: a folder path is a tag selector, a saved
folder is a `TagSetDefinition`, and filing an item is a `TagBinding`.

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
| D1 | Root folders are **content categories** (files, pictures, health), not products. A product appears as a child only when its data has its own authority (`Gesundheit/Flexibel`). |
| D2 | A folder's checkbox is a **demand**: a versioned `SyncDemand` with `active: true/false`. Visibility is derived from demand and matched supply; no separate visibility store. |
| D3 | Below a category, **a folder path is a tag selector**: each segment names a tag, and the path means `allOf` those tags. No folder objects exist for plain paths. |
| D4 | A **saved folder** is a `TagSetDefinition` with an owner-scoped explicit `id`; it may include other folders by reference (requires the tag.core extension in [Required tag.core changes](#required-tagcore-changes)). |
| D5 | **Filing is tagging.** Finder writes create or revoke manual `TagBinding`s. Items are never copied or deleted by a folder operation. |
| D6 | **Time, place, and people are tags too**, bound with `sourceKind: imported` (EXIF) or `suggested` (face clusters, AI). Finder shows the canonical view: active and approved bindings only. |
| D7 | Tags never widen access. Sharing a folder is explicit `TagGovernance` consumed by `trust.abac`. |
| D8 | A doctor's report is a **pinned rendering** of a folder: the folder's selector plus the tag trie roots at the moment of sending. |
| D9 | Paths are views. Tag IDs, tag-set IDs, and issuer Person IDs identify roots; segments show labels. |

## Layout

```
/Dateien/                              files category: containment, unchanged
/Bilder/                               pictures category (content-type filter)
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
        2026-03 Knie OP.pdf            pinned report (read-only)
    Geteilt/<person>/
/ONE/System/...                        settings, status, raw objects (unchanged)
```

`/Dateien` keeps ordinary containment (`FilerStoredEntry` paths, one place per
file). Every other category uses tag folders. Received plain files appear under
`/Dateien/Geteilt/<person>/`.

## Path resolution

A path below a category resolves to a selector:

1. The **category segment** is a content-type filter applied by Filer, not a tag.
   It matches on the binding's `targetObjectType` and the provider's declared
   types. This keeps the category the unit of demand and lets a provider refuse
   wrong types.
2. **Axis segments** (`Zeit`, `Orte`, `Personen`) are fixed, localized views over
   tag namespaces: `tag:time:*`, `tag:place:*`, `tag:person:*`. They are not
   tags and cannot be created by users.
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

- items whose canonical bindings satisfy the selector and the category filter;
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
  label: 'Urlaub Italien 2026',                       // display name / placement
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
- `label` is the display name. A label with `/` places the folder at that path
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

## Demand: the checkbox

The checkbox writes a `SyncDemand` version as described in
[demand/supply matching](../DEMAND_SUPPLY_SYNC_MATCHING.md). Those objects
(`ScopedTrieRoot`, `SyncDemand`, `SyncSupply`, `SyncMatch`) are not implemented
yet; they belong in `../one/packages`, and this spec is their first consumer.

| Checkbox | `SyncDemand` |
| --- | --- |
| Category on/off | `selectorKind: category`, selector = category ID and content types, `active: true/false` |
| Folder on/off (path or saved folder) | `selectorKind: tagSet`, selector = the folder's `TagSetDefinition` id (a plain path is saved implicitly as a selector-derived set for this purpose) |

- Within the owner's IoM, an own supplier matches at `inner-circle` trust and
  grants the scoped roots, so content arrives without a manual share step.
- For other people, only the supply owner grants; their explicit share decision
  is unchanged.
- Unchecking writes `active: false`. It deletes nothing, revokes nothing on the
  supplier side, and keeps received objects. The folder leaves the listing.

Derived state per demanded folder, reported in
`/ONE/System/settings/Filer/status.json` with demand, match, and supplier evidence:

| Matched supply | Content | Folder |
| --- | --- | --- |
| none | none | shown, empty; **Waiting for content** |
| yes | none yet | shown, empty; **Syncing** |
| yes | present | shown with content |

The checkbox lives in the Filer menu and the Cube device detail; every transport
calls the same demand operation. In Finder, `mkdir` of a category name at the
root sets that category's demand on and `rmdir` of the empty category sets it
off. Other names at the root are `EPERM`.

## Sharing

Sharing a folder sets `TagGovernance` on its tag or `TagSetDefinition`, which
`trust.abac` turns into grants (the planned `TagGrantCertificate`).

- Ordinary tags never affect access. Filing a received item into an own folder
  copies no authority.
- A recipient of a shared folder gets the bindings and the items the sharer may
  share. Items the sharer received from a third party show as unavailable unless
  their issuer shared them to that recipient as well.
- StudyCenter-authorized health data is never shared by being tagged. Its policy
  owner decides per item.

## Doctor's report

A report is a read-only file rendered from a folder for one recipient:

- **Pinned:** it records the folder's selector, the `TagSetDefinition` version,
  and the tag sync-trie root hashes at sending time. Later re-tagging does not
  change what was sent.
- **Time-ordered:** photos, measurements, and documents in one timeline.
- **Stated vs inferred:** manual bindings and approved suggestions are shown as
  the patient's statements; imported metadata is labeled as recorded data.
- Sending it is a share as above; access is checked per item.
- Filer shows it under `<category>/Berichte/`.

The rendering format and who assembles the report are open (question 5).

## Required tag.core changes

| Change | Why |
| --- | --- |
| `TagSelector.unionOfSets?: string[]`, included in `makeTagSetId` normalization, resolved with a visited set in `TagSetService` | Folder includes (D4). Today a selector is one conjunction. |
| `TagSetDefinition.state?: 'active' \| 'retired'` (absent = active), mirroring `TagBinding.state` | Removing a saved folder without deleting history. |
| Namespaced slugs `time:`, `place:`, `person:` as a documented convention | Axis folders. `canonicalizeTagSlug` already keeps `:`; the README already uses `person:<personId>`. |
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

1. Register categories and map existing settings once: `files` → `files`,
   `fotos` → `pictures`, `health.flexibel` → `health`; `visible`/`auto` become
   demand on, `hidden` demand off. Then retire the `filer.folders` section; it
   is not kept beside the demands.
2. `/Files` becomes `/Dateien` (display name by locale). Whether Finder aliases
   survive depends on File Provider item identifiers staying stable; verify on
   macOS before shipping the rename.
3. Fotos library JSON converts once, at Fotos app start: each collection becomes
   a `TagDefinition` plus manual `TagBinding`s on its photos. The JSON is not
   authoritative afterwards.
4. `/Fotos/<issuer collection>` becomes `/Bilder/Geteilt/<person>/<folder>`.

## Out of scope

Smart folders beyond `allOf`/`anyOf`/`noneOf` plus includes; demand toward
people outside the owner's IoM by default; automatic sharing; clinical
authorization changes; Finder-native tag sync (`tagData`) as more than a later
option; Linux and Windows layout differences beyond the shared `IFileSystem`.

## Open questions

1. **Demand privacy toward others.** Proposed default outside the owner's IoM:
   category-level demands only.
2. **Locale.** Category and axis names by OS locale (proposed), or fixed when
   the domain is registered?
3. **Finder tags.** Mirror canonical ONE tags into File Provider `tagData` on
   macOS in a later step, or keep tags in paths only?
4. **SyncDemand vs GlueDemand.** Proposed: separate (sync scope vs market
   trade), bridged later if needed.
5. **Reports.** Format (PDF only, or also structured data such as FHIR) and
   assembler (patient, health provider, or AI).
6. **Grant shape.** How `TagGovernance`/`TagGrantCertificate` grants and
   `ScopedTrieRoot` over the per-tag sync tries fit together for supply.

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
- Checking pictures on Filer causes an own fotos.one instance to grant with no
  manual share; unchecking writes `active: false` and keeps received objects.
- A shared folder containing a third party's photo shows that photo as
  unavailable to a recipient without access.
- A report keeps listing what was sent after the folder is re-tagged.
- Restart preserves demands, bindings, saved folders, and derived state; no
  polling or delayed retry is used.
