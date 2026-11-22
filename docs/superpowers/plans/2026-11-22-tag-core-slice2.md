# Slice 2: `tag.core` cleanup for saved folders and pinned shared-tag cuts

Status: proposed, ready for review
Date: 2026-11-22
Spec: [folder-layout-demand-and-collections.md](../../folder-layout-demand-and-collections.md) (revision 5, delivery slice 2)
Prerequisite: Slice 1 (`.filer-slice1` `e8e4ffad0..ca4cd5942`: `GraphReleaseSelectionHead`, `FilerShareCut`, `AcceptedSharesProjection`, `CombinedFilerProjection`) merged into `../one` as `c965634d8` on `feat/expo-plan-surface`.

This plan implements slice 2 of the Filer folder layout spec in `../one/packages/tag.core`:
saved-folder tombstones, namespaced tag slugs, pure content-addressed tag cuts
that travel pinned by exact version hash inside `Assembly` releases, and
local-vs-imported isolation so peer tags never collide with or leak into the
local instance's implicitly owned tag tries.

## What already exists (verified against `../one/packages/tag.core`, 2026-11-22)

- `TagSelector.unionOfSets?: string[]` is implemented in
  `tag.core/src/recipes/TagSetDefinition.ts:10`, normalized in
  `normalizeTagSelector` / `makeTagSetId`, and resolved with cycle protection in
  `TagSetService` (`tag.core/src/services/TagSetService.ts:53-77`, tested in
  `tag.core/test/tag-set-includes.test.ts`). When `loadIncludedSelector` returns
  `undefined`, `TagSetService` already skips the include.
- `canonicalizeTagSlug` transliterates non-ASCII letters (`ä→ae`, `ö→oe`,
  `ü→ue`, `ß→ss`, …) and preserves `:` (`tag.core/src/recipes/TagDefinition.ts:36-46`,
  tested in `tag.core/test/tag-slug.test.ts`).
- `TagTaxonomyRelease` (`tag.core/src/recipes/TagTaxonomyRelease.ts`) establishes
  the unversioned closure-object pattern inside `tag.core` (`Set<SHA256Hash<...>>`
  with `referenceToObj` edges).
- **Consumers across `../one`:** 8 packages already depend on `@refinio/tag.core`
  (`vger.core`, `agent.core`, `me.core`, `screening.core`, `trust.organisation`,
  `trust.abac`, `trust.study`, `discovery.core`). All changes must keep those
  callers compiling and green.

## Gaps in `tag.core` today (why shared tags cannot ride `Assembly` cuts yet)

1. **No saved-folder tombstone:** there is no tombstone recipe or tombstone-aware
   `TagSetSelectorLoader` for `TagSetService`. Deleting a saved folder has no
   durable representation that preserves history.
2. **Global auto-indexing leaks imported peer bindings into local tries:**
   `PersistentTagIndexService.init()` (`PersistentTagIndexService.ts:197-216`)
   attaches an unfiltered `onVersionedObj` listener that inserts **every** stored
   `TagBinding` into the local singleton trie (`tag-sync:<tagId>`). Any peer
   `TagBinding` synced into storage would immediately pollute local `/Bilder/<tag>`
   queries and collide on `TagSyncTrieRoot`.
3. **No pinned shared-tag cut or cut-scoped resolver:** `TagBinding.targetRef` is
   a string and `TagSetDefinition.selector` is `stringifiable` (not CHUM-traversed
   `referenceToObj` edges). Nothing in `tag.core` pins a closed graph of
   `TagSetDefinition` + `unionOfSets` includes + `TagDefinition` + `TagBinding` +
   authorized target versions or resolves a peer's folder strictly inside that cut.
4. **Embedded ownership and time are required on content recipes:**
   - `TagDefinition.createdAt`, `TagSetDefinition.createdAt`, and
     `TagBinding.createdAt` are required fields (`optional` is absent), forcing
     timestamps into content-addressed objects even when time lives externally
     (`Assembly`, time tries, Journal).
   - `defaultApprovalStatusForBinding` (`TagBinding.ts:69`) only defaults
     `sourceKind: 'manual'` to `'approved'` when `createdBy` is embedded, forcing
     callers to bake ownership into local manual bindings that are implicitly
     owned by the instance owner.
   - `PersistentTagIndexService` derives trie timestamps solely from
     `binding.createdAt` / `binding.approvedAt` (`PersistentTagIndexService.ts:133-147`)
     rather than accepting an external `indexedAt` timestamp.
5. **No namespaced slug helpers:** `category:`, `time:`, `place:`, `person:` are
   undocumented conventions with no shared constructors/validators.

## Rules

- **Content vs. metadata boundary:** do not add `owner`, `publisher`, `releasedBy`,
  `deletedBy`, `releasedAt`, or `deletedAt` to new tag recipes (`TagSetTombstone`,
  `TagShareCut`). Ownership is implicit by instance owner locally and explicit on
  the enclosing `Assembly` (`GraphReleaseState` / `GraphReleaseSelectionHead`)
  when shared.
- **Decorated datatypes throughout:** use `SHA256Hash<T>` and `SHA256IdHash<T>`
  with `ensureHash` / `ensureIdHash` validation; never downgrade hash/ID types to
  plain `string`.
- **Fail fast, no fallbacks:** malformed cuts, invalid hashes, mistyped pinned
  objects, or blank slugs throw visibly.
- **Backward compatibility for existing `../one` callers:** keep existing
  exported functions/fields working (`createdAt` / `createdBy` become optional on
  new pure objects while old callers passing them continue to pass without
  modification; `autoIndexVersionedEvents` defaults to `true` on
  `PersistentTagIndexService` unless opted out by Filer).
- **Test-first** in `../one/packages/tag.core/test/` (`pnpm --filter @refinio/tag.core test`
  and `pnpm --filter @refinio/tag.core build`), plus verifying downstream
  typecheck/tests on `filer.core`, `refinio.api`, `trust.abac`, and `vger.core`.

---

## Task 1 — Namespaced tag-slug helpers (`category:`, `time:`, `place:`, `person:`)

Add `tag.core/src/recipes/TagNamespaces.ts` (exported from `recipes/index.ts` and
`index.ts`):

- `TAG_NAMESPACES = ['category', 'time', 'place', 'person'] as const`
- `makeCategoryTagId(slug: string): TagId` → `tag:category:<canonicalSlug>` (reject empty or nested `:`).
- `makeTimeTagId(value: string): TagId` → `tag:time:YYYY` or `tag:time:YYYY-MM`
  (strict regex `/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/`; fail fast on invalid month or
  malformed date).
- `makePlaceTagId(slug: string): TagId` → `tag:place:<canonicalSlug>`.
- `makePersonTagId(personId: SHA256IdHash<Person>): TagId` → validates with
  `ensureIdHash<Person>(personId)` and returns `tag:person:<personId>`.
- `parseTagNamespace(tagId: TagId): {namespace: TagNamespace; value: string} | undefined`
  for clean axis routing in Slice 3.

**Tests (`test/tag-namespaces.test.ts`):**
- Transliterates non-ASCII place names (`München` → `tag:place:muenchen`,
  `Wien` → `tag:place:wien`).
- Accepts valid `YYYY` and `YYYY-MM`, rejects `2026-13`, `2026-00`, `2026-3`,
  and arbitrary text.
- Accepts valid 64-hex `SHA256IdHash<Person>` for `makePersonTagId`, rejects
  non-hash strings.
- Round-trips through `parseTagNamespace` and returns `undefined` for plain user
  tags (`tag:urlaub`).

---

## Task 2 — `TagSetTombstone` recipe and tombstone-aware `TagSetService` loader

Add `tag.core/src/recipes/TagSetTombstone.ts`:

```ts
export interface TagSetTombstone {
  $type$: 'TagSetTombstone';
  /** Stable idHash of the tombstoned TagSetDefinition (isId). */
  tagSetIdHash: SHA256IdHash<TagSetDefinition>;
  /** Explicit logical set id (e.g. 'tag-set:folder:<uuid>'). */
  setId: string;
  reason?: string;
}
```

- **Why `tagSetIdHash` is `isId: true` (`referenceToId` → `TagSetDefinition`):**
  checking whether a saved folder is deleted is a single $O(1)$
  `exists(tombstoneIdHash)` / `getObjectByIdHash` check with no ambient scan and
  no mutation of `TagSetDefinition` history. No `deletedBy` or `deletedAt` field
  is embedded in the tombstone.
- Export `TagSetTombstoneRecipe`, `TagSetTombstoneReverseMap` (`['TagSetTombstone', new Set(['tagSetIdHash'])]`),
  `createTagSetTombstone`, `makeTagSetTombstoneIdHash`, and register in
  `TagCoreRecipes`, new `TagCoreReverseMaps`, and `@OneObjectInterfaces.ts`.
- Add `tombstoneTagSet(setId, deps)` and `isTagSetTombstoned(setId, deps)` plus
  `createStoredTagSetSelectorLoader(deps)` in `tag.core/src/services/TagSetService.ts`:
  - Computes `tagSetIdHash = calculateIdHashOfObj({$type$: 'TagSetDefinition', id: setId})`.
  - If `isTagSetTombstoned(tagSetIdHash)` is true, returns `undefined`.
  - Otherwise loads `TagSetDefinition` via `getObjectByIdHash(tagSetIdHash)` and
    returns its `selector` (`FileNotFoundError` → `undefined`, other errors throw).

**Tests (`test/tag-set-tombstone.test.ts`, real ONE storage instance):**
- Storing a `TagSetDefinition` then tombstoning it leaves the `TagSetDefinition`
  object and history intact in storage while `createStoredTagSetSelectorLoader`
  returns `undefined`.
- A parent saved folder with `unionOfSets: [deletedChildId]` skips the
  tombstoned child without error and continues resolving its own tags and
  non-tombstoned includes.
- Malformed `setId` (empty / NUL) or non-hash `tagSetIdHash` throws fail-fast.

---

## Task 3 — Pure content option on tag recipes & local-only mode on `PersistentTagIndexService`

Decouple embedded ownership and time from tag content while keeping all existing
`../one` callers working:

1. **Optional `createdAt` on `TagDefinition`, `TagSetDefinition`, `TagBinding`:**
   - Mark `createdAt?: number` optional in TS interfaces and `{itemprop: 'createdAt', optional: true, itemtype: {type: 'number'}}` in their recipes.
   - Keep the existing `createTagDefinition`, `createTagSetDefinition`, and
     `createTagBinding` factories byte-for-byte backward-compatible (unchanged
     defaults, including `Date.now()`), so existing `vger.core` / `tag.core`
     tests stay 100% green without modification.
   - Add explicit pure factories `createContentTagDefinition`,
     `createContentTagSetDefinition`, and `createContentTagBinding` that never
     embed timestamps or person IDs, for Filer's pure content-addressed tag
     objects. They accept the same payload fields minus `createdAt` / `createdBy`.
   - Fix `defaultApprovalStatusForBinding` (`TagBinding.ts:69`):
     `sourceKind === 'manual'` defaults to `'approved'` **without** requiring
     `createdBy` (local manual bindings are implicitly owned by the instance owner).
     Only set `approvedAt` when a timestamp is explicitly supplied.
2. **External indexing time & opt-out auto-indexing on `PersistentTagIndexService`:**
   - Add `autoIndexVersionedEvents?: boolean` (default `true` for existing
     consumers; Filer sets `false` so imported peer `TagBinding`s are **never**
     auto-inserted into local `tag-sync:<tagId>` tries).
   - Add optional `indexedAt?: Date` on `storeBinding` / `indexStoredBinding` so
     time-trie placement comes from external observation time when a binding
     carries no embedded `createdAt`.
   - Guard `bindingIndexedAt` and `bindingVersionOrdinal` when `createdAt` is
     absent (`0` fallback, never `NaN` / `Invalid Date`).

**Tests (`test/persistent-tag-index.test.ts` + new `test/tag-local-isolation.test.ts`):**
- Two pure bindings created at different wall-clock times with no embedded
  `createdAt` / `createdBy` produce the **exact same SHA-256 object hash**.
- `sourceKind: 'manual'` without `createdBy` defaults to `approvalStatus: 'approved'`.
- With `autoIndexVersionedEvents: false`, storing an unrelated/imported
  `TagBinding` in ONE storage does **not** insert it into `PersistentTagIndexService`'s
  `tag-sync:<tagId>` trie; only explicit `storeBinding()` / `indexStoredBinding()`
  calls advance the local trie.

---

## Task 4 — `TagShareCut` recipe and cut-scoped resolver (`resolveTagShareCut`)

Mirror Slice 1's `FilerShareCut` (`filer.core/src/FilerShareCut.ts`) inside
`tag.core` so shared tags, collections (`TagSetDefinition`), and their members
travel pinned by exact version hash inside `GraphReleaseState.roots`:

### Recipe (`tag.core/src/recipes/TagShareCut.ts`)

```ts
export interface TagShareCut {
  $type$: 'TagShareCut';
  label: string;
  /** Exact root saved-folder versions shared by this cut. */
  rootSets: Set<SHA256Hash<TagSetDefinition>>;
  /** Exact transitively included saved-folder versions (unionOfSets). */
  includedSets: Set<SHA256Hash<TagSetDefinition>>;
  /** Exact TagDefinition versions providing labels/aliases within this cut. */
  definitions: Set<SHA256Hash<TagDefinition>>;
  /** Exact TagBinding versions active within this cut. */
  bindings: Set<SHA256Hash<TagBinding>>;
  /** Exact target item versions the sharer is authorized to disclose. */
  targets: Set<SHA256Hash<OneObjectTypes>>;
}
```

- All five hash sets use CHUM-traversed `referenceToObj` edges (`allowedTypes`
  matching each type, `'*'` for `targets`), so granting a `GraphReleaseState`
  `Assembly` whose `roots` contains a `TagShareCut` transfers the **entire closed
  set of exact object versions and reachable BLOBs** without touching any
  receiver `VersionMap` head or singleton `TagSyncTrieRoot`.
- Unversioned (`storeUnversionedObject`); no `owner`, `publisher`, `releasedBy`,
  or `releasedAt` fields inside `TagShareCut` (`Assembly` owns provenance and
  time).
- `createTagShareCut(...)` validates non-empty trimmed `label` (no NUL),
  at least one `rootSet` or `binding`, and every hash via `ensureHash<...>`.
- Register `TagShareCutRecipe` in `TagCoreRecipes`, `TagShareCutReverseMap` in
  `TagCoreReverseMaps`, and `TagShareCut` in `@OneObjectInterfaces.ts`.

### Cut-scoped resolver (`tag.core/src/services/TagShareCutResolver.ts`)

```ts
export interface ResolvedTagShareFolder {
  setId: string;
  label: string;
  /** Exact pinned target hashes matching this set within the cut. */
  targetHashes: SHA256Hash<OneObjectTypes>[];
  /** Included set ids referenced by unionOfSets that were not pinned in the cut. */
  unavailableIncludes: string[];
}

export interface ResolvedTagShareCut {
  label: string;
  folders: ResolvedTagShareFolder[];
  /** Tag labels keyed by TagId from pinned TagDefinitions only. */
  tagLabels: ReadonlyMap<TagId, string>;
  /** Exact pinned target hashes directly matched by pinned canonical bindings. */
  pinnedTargets: ReadonlySet<SHA256Hash<OneObjectTypes>>;
}
```

`resolveTagShareCut(cutHash: SHA256Hash<TagShareCut>, deps?)`:
1. Loads `TagShareCut` via `getObject(ensureHash<TagShareCut>(cutHash))` and
   validates `$type$ === 'TagShareCut'`.
2. Loads every pinned object strictly by its exact `SHA256Hash` via `getObject`
   (returns `undefined` if any pinned object has not arrived yet — `FileNotFoundError`
   means pending arrival, matching `AcceptedSharesProjection.loadPinned`; mistyped
   objects throw fail-fast).
3. Builds an ephemeral in-memory `TagIndexService` populated **exclusively** from
   the cut's pinned `bindings` whose `state === 'active'`, `approvalStatus === 'approved'`,
   and whose `targetRef` string-equals one of the cut's pinned `targets`
   (`targetRef === String(pinnedTargetHash)`, so a binding pointing at an
   unauthorized/unpinned third-party item never resolves!).
4. Builds a cut-scoped `TagSetService` whose `loadIncludedSelector(setId)` reads
   **exclusively** from the map of pinned `rootSets ∪ includedSets` (never local
   storage, never local tombstones). Records any `unionOfSets` ID absent from the
   cut in `unavailableIncludes` without crashing.
5. Resolves every root `TagSetDefinition` (with cycle protection from
   `TagSetService`) and returns deterministic, sorted `ResolvedTagShareCut`.

### Producer helper (`buildTagShareCut`)

Add `buildTagShareCut` in `tag.core/src/services/TagShareCutResolver.ts`:
- Given root `TagSetDefinition` hashes (or IDs) + local loader + authorized
  target set, transitively walks `unionOfSets` (skipping tombstoned sets via
  `createStoredTagSetSelectorLoader` and breaking cycles with a visited set),
  gathers the exact current version hashes of every referenced set, definition,
  canonical binding, and authorized target, verifies all objects exist, and
  returns the stored `TagShareCut` + hash ready to hand to
  `AssemblyReleasePlan.releaseGraph()`.

**Tests (`test/tag-share-cut.test.ts`, real ONE storage instance):**
1. **No collision on shared tag `Urlaub`:** local store has `tag:urlaub` bound to
   `localPhoto` in `PersistentTagIndexService` (`autoIndexVersionedEvents: false`)
   AND a `TagShareCut` pins Anna's `TagBinding` (even with the **same** `TagBinding.id`
   or `TagDefinition.id`!) for `tag:urlaub` → `annaPhoto`.
   - `resolveTagShareCut` resolves only `annaPhoto`.
   - Local `PersistentTagIndexService` resolves only `localPhoto` — zero leakage,
     zero head overwrite.
2. **Exact version pinning:** mutating a `TagSetDefinition` (rename / selector
   change) or revoking a `TagBinding` *after* building `TagShareCut` does not
   change what `resolveTagShareCut(oldCutHash)` returns.
3. **Transitive `unionOfSets`, cycles, and unavailable includes:**
   - Root set includes `set:a` which includes `set:b` which cycles back to
     `set:a`, plus `set:unavailable` omitted from `includedSets`.
   - Resolves the union once, terminates cleanly, and reports `['set:unavailable']`
     in `unavailableIncludes`.
4. **Third-party / unauthorized target exclusion:** a pinned `TagBinding` whose
   `targetRef` is not in `cut.targets` does not appear in `folder.targetHashes`.
5. **Pending arrival vs. malformed cut:** missing pinned hash returns `undefined`;
   mistyped pinned object or invalid hash throws.

---

## Verification checklist (Definition of Done for Slice 2)

- [ ] `pnpm --filter @refinio/tag.core test` — all existing tests + 4 new test
      suites (`tag-namespaces`, `tag-set-tombstone`, `tag-local-isolation`,
      `tag-share-cut`) pass.
- [ ] `pnpm --filter @refinio/tag.core build` succeeds cleanly with zero `tsc`
      errors.
- [ ] Downstream packages consuming `@refinio/tag.core` (`filer.core`,
      `refinio.api`, `trust.abac`, `me.core`, `screening.core`,
      `trust.organisation`, `agent.core`, `vger.core`) build/typecheck cleanly
      with no regressions.
- [ ] No embedded `owner` / `releasedBy` / `deletedBy` / `releasedAt` /
      `deletedAt` fields added to `TagSetTombstone` or `TagShareCut`; all hash/ID
      fields keep decorated `SHA256Hash<T>` / `SHA256IdHash<T>` types.
- [ ] No dirty `pnpm-lock.yaml` or unrelated workspace edits.
