# Sharing per Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → Devices → Your devices shows each device's IoM sharing (discovered devices, AI personas, chats) as that device reports it.

**Architecture:** No new datatype. Each instance publishes an `instance-setup` entry with a structured `setup` property in its own own-device projection root (`device-connections:<instance>:setup`), beside the existing `iom`, `all` and `discovery` roots. A receiving device admits that root only from the lane whose authenticated instance the root names. It hands setups per instance to `DevicesPlan`, which adds them to each device summary. `DevicesManager` renders them read-only.

**Tech Stack:** TypeScript, ONE recipes (`@refinio/one.core`), vitest, React + Testing Library (vger.ui).

Design: `/Users/gecko/src/filer/docs/device-settings-in-your-devices.md`, sections 5a and 5b.

## Global Constraints

- Reuse datatypes: extend `PhoneBookProjectionEntry`, add no recipe type.
- Leave invites and pairing unchanged.
- Do not commit. `/Users/gecko/src/one` holds uncommitted user work in `PhoneBookProjectionRecipes.ts`, `OwnDeviceConnectionInfoSync.ts` (and its tests) and `ConnectionModule.ts`. Build on top of it; never revert or reformat it.
- No fallbacks: malformed setup data throws.
- A setup root may describe only its own instance; received setups are never forwarded.
- Before Task 5, run `ui-consistency:adjusting`; after Task 5, run `ui-consistency:verifying`.
- `DevicesManager` copy lives in its `copy` table with `en` and `de` entries.
- Build order for cross-package checks: `connection.core` → `device.core` → `ui.core` → `vger.core` → `vger.ui`.

## Files

| File | Change |
|---|---|
| `/Users/gecko/src/one/packages/connection.core/src/recipes/PhoneBookProjectionRecipes.ts` | `instance-setup` entry kind, `PhoneBookInstanceSetup`, `setup` property, validation, recipe rule |
| `/Users/gecko/src/one/packages/connection.core/src/recipes/PhoneBookProjectionRecipes.test.ts` | Entry tests |
| `/Users/gecko/src/one/packages/connection.core/src/services/OwnDeviceConnectionInfoSync.ts` | `setup` projection kind, `loadInstanceSetup` dependency, `instanceOfSetupProjection` |
| `/Users/gecko/src/one/packages/connection.core/src/services/OwnDeviceConnectionInfoSync.test.ts` | Publication tests |
| `/Users/gecko/src/one/packages/device.core/src/plans/DevicesPlan.ts` | `ManagedDeviceSetup`, `DeviceSetupSource`, `setSetupSource`, `setup` on summaries |
| `/Users/gecko/src/one/packages/device.core/src/plans/DevicesPlan.test.ts` | Summary tests |
| `/Users/gecko/src/one/packages/device.core/src/index.ts` | Export the new types |
| `/Users/gecko/src/one/packages/ui.core/src/types/devices.ts` | `ManagedDeviceSetup`, `setup` on `ManagedDeviceSummary` |
| `/Users/gecko/src/one/packages/vger.core/src/modules/iom-setup.ts` | Create: setup entry, admission and collection helpers |
| `/Users/gecko/src/one/packages/vger.core/src/modules/iom-setup.test.ts` | Create: helper tests |
| `/Users/gecko/src/one/packages/vger.core/src/modules/ConnectionModule.ts` | Publish, admit, read and supply setups |
| `/Users/gecko/src/one/packages/vger.ui/src/components/device/DevicesManager.tsx` | Sharing disclosure per device |
| `/Users/gecko/src/one/packages/vger.ui/src/components/device/DevicesManager.test.tsx` | UI tests |

---

### Task 1: `setup` property on projection entries

**Files:**
- Modify: `/Users/gecko/src/one/packages/connection.core/src/recipes/PhoneBookProjectionRecipes.ts`
- Test: `/Users/gecko/src/one/packages/connection.core/src/recipes/PhoneBookProjectionRecipes.test.ts`

**Interfaces:**
- Produces: `PhoneBookInstanceSetup` (`moduleId: string; status: 'applied' | 'rejected'; reason?: string; observed?: string; values: string`), `PhoneBookProjectionEntry.setup?`, `CreatePhoneBookProjectionEntryParams.setup?`, entry kind `'instance-setup'`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe` block that holds `'requires only the observing instance as a graph dependency for an unpaired device'`:

```ts
  it('carries an instance setup as a typed property with only its instance as a dependency', async () => {
    const entry = createPhoneBookProjectionEntry({
      entryKind: 'instance-setup',
      subjectInstanceId: OBSERVER_INSTANCE,
      setup: {moduleId: 'iom', status: 'applied', values: '{"shareChats":true}'},
      createdAt: 100,
    });
    expect(entry.setup).toEqual({moduleId: 'iom', status: 'applied', values: '{"shareChats":true}'});
    await expect(determineDirectChildren(entry)).resolves.toEqual([{type: 'id', hash: OBSERVER_INSTANCE}]);
  });

  it('rejects an instance setup without its instance, with a misplaced reason, or with non-object values', () => {
    const base = {entryKind: 'instance-setup' as const, subjectInstanceId: OBSERVER_INSTANCE, createdAt: 100};
    expect(() => createPhoneBookProjectionEntry({...base, subjectInstanceId: undefined,
      setup: {moduleId: 'iom', status: 'applied', values: '{}'}})).toThrow(/Instance setup/);
    expect(() => createPhoneBookProjectionEntry({...base,
      setup: {moduleId: 'iom', status: 'applied', reason: 'stale', values: '{}'}})).toThrow(/Instance setup/);
    expect(() => createPhoneBookProjectionEntry({...base,
      setup: {moduleId: 'iom', status: 'rejected', values: '{}'}})).toThrow(/Instance setup/);
    expect(() => createPhoneBookProjectionEntry({...base,
      setup: {moduleId: 'iom', status: 'applied', values: '[true]'}})).toThrow(/Instance setup/);
    expect(() => createPhoneBookProjectionEntry({...base,
      setup: {moduleId: 'iom', status: 'applied', observed: 'not-a-hash', values: '{}'}})).toThrow(/Instance setup/);
    expect(() => createPhoneBookProjectionEntry({entryKind: 'reachability', subjectInstanceId: OBSERVER_INSTANCE,
      setup: {moduleId: 'iom', status: 'applied', values: '{}'}, createdAt: 100})).toThrow(/Instance setup/);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/gecko/src/one/packages/connection.core && pnpm exec vitest run src/recipes/PhoneBookProjectionRecipes.test.ts`
Expected: FAIL, the type check or runtime rejects `entryKind: 'instance-setup'` and the unknown `setup` property.

- [ ] **Step 3: Implement**

In `PHONE_BOOK_ENTRY_KINDS`, add `'instance-setup'` after `'discovery-sighting'`.

After `PhoneBookDiscoverySighting`, add:

```ts
/**
 * One module's settings as the publishing instance applies them. `observed` names a requested
 * settings version by hash only, so the settings record never travels with the entry.
 */
export interface PhoneBookInstanceSetup {
  moduleId: string;
  status: 'applied' | 'rejected';
  reason?: string;
  observed?: string;
  values: string;
}
```

Add `setup?: PhoneBookInstanceSetup;` after `discoverySighting?` in both `PhoneBookProjectionEntry` and `CreatePhoneBookProjectionEntryParams`.

Change `PHONE_BOOK_ENTRY_KIND_REGEXP` to:

```ts
const PHONE_BOOK_ENTRY_KIND_REGEXP = /^(instance-introduction|trust-evidence|route-observation|discovery-sighting|instance-setup|contact|reachability)$/;
```

In `createPhoneBookProjectionEntry`, add `&& !params.setup` to the "requires at least one evidence or observation reference" condition, and after the discovery-sighting checks add:

```ts
  const setup = params.setup;
  if (setup && (params.entryKind !== 'instance-setup' || !params.subjectInstanceId || !setup.moduleId.trim()
    || (setup.status !== 'applied' && setup.status !== 'rejected')
    || (setup.status === 'rejected') !== (setup.reason !== undefined && setup.reason.trim() !== '')
    || (setup.observed !== undefined && !HEX_STRING_REGEXP.test(setup.observed))
    || !isJsonObjectText(setup.values))) {
    throw new Error('[connection.core] Instance setup needs its instance, module, status, object values, and a reason exactly when rejected');
  }
  if (params.entryKind === 'instance-setup' && !setup) {
    throw new Error('[connection.core] Instance setup entry is missing its setup');
  }
```

Next to the returned `discoverySighting` spread, add `...(setup ? { setup: {...setup} } : {}),`.

Above `createPhoneBookProjectionEntry`, add:

```ts
function isJsonObjectText(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}
```

In `PhoneBookProjectionEntryRecipe`, after the `discoverySighting` rule, add:

```ts
    { itemprop: 'setup', optional: true, itemtype: {type: 'object', rules: [
      {itemprop: 'moduleId', itemtype: {type: 'string'}},
      {itemprop: 'status', itemtype: {type: 'string', regexp: /^(applied|rejected)$/}},
      {itemprop: 'reason', itemtype: {type: 'string'}, optional: true},
      {itemprop: 'observed', itemtype: {type: 'string', regexp: HEX_STRING_REGEXP}, optional: true},
      {itemprop: 'values', itemtype: {type: 'string'}},
    ]}},
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/gecko/src/one/packages/connection.core && pnpm exec vitest run src/recipes/PhoneBookProjectionRecipes.test.ts`
Expected: PASS, including all existing cases.

---

### Task 2: Publish a per-instance setup root

**Files:**
- Modify: `/Users/gecko/src/one/packages/connection.core/src/services/OwnDeviceConnectionInfoSync.ts`
- Test: `/Users/gecko/src/one/packages/connection.core/src/services/OwnDeviceConnectionInfoSync.test.ts`

**Interfaces:**
- Consumes: entry kind `'instance-setup'` (Task 1).
- Produces: `OwnDeviceConnectionInfoSyncDeps.loadInstanceSetup?(): Promise<PhoneBookProjectionEntry[]>`, `connectionInfoProjectionId(instance, 'setup')`, `instanceOfSetupProjection(projectionId: string): SHA256IdHash<Instance> | undefined`.

- [ ] **Step 1: Write the failing tests**

Change `function fixture()` to `function fixture(options: {setup?: boolean} = {})`. Add `const setups: PhoneBookProjectionEntry[] = [];` beside `sightings`, add `...(options.setup ? {loadInstanceSetup: async () => setups} : {})` to `deps`, widen the `root` and `entries` scope parameter to `'iom' | 'all' | 'discovery' | 'setup'`, and return `setups` from the fixture. Add `instanceOfSetupProjection` to the import from `./OwnDeviceConnectionInfoSync.js`. Then append inside `describe('own-device connection information publication', …)`:

```ts
  it('publishes this instance setup to own identities even when connection sharing is off', async () => {
    const f = fixture({setup: true});
    const entry = createPhoneBookProjectionEntry({entryKind: 'instance-setup', subjectInstanceId: OBSERVER_INSTANCE,
      setup: {moduleId: 'iom', status: 'applied', values: '{"shareChats":false}'}, createdAt: 1_000});
    f.setups.push(entry);
    await f.sync.publish(off, false);
    expect(await f.entries('setup')).toEqual([entry]);
    expect(f.replaceAccess).toHaveBeenCalledWith({projectionRootId: (await f.root('setup')).idHash, person: [OWNER_PERSON]});
    expect(await f.entries('iom')).toEqual([]);
  });

  it('refuses a setup entry about another instance', async () => {
    const f = fixture({setup: true});
    f.setups.push(createPhoneBookProjectionEntry({entryKind: 'instance-setup', subjectInstanceId: SIBLING_INSTANCE,
      setup: {moduleId: 'iom', status: 'applied', values: '{}'}, createdAt: 1_000}));
    await expect(f.sync.publish(iom, false)).rejects.toThrow(/only the publishing instance/);
  });

  it('maps only a setup projection id back to its instance', () => {
    expect(instanceOfSetupProjection(connectionInfoProjectionId(OBSERVER_INSTANCE, 'setup'))).toBe(OBSERVER_INSTANCE);
    expect(instanceOfSetupProjection(connectionInfoProjectionId(OBSERVER_INSTANCE, 'iom'))).toBeUndefined();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/gecko/src/one/packages/connection.core && pnpm exec vitest run src/services/OwnDeviceConnectionInfoSync.test.ts`
Expected: FAIL, `instanceOfSetupProjection` is not exported and `'setup'` is not a projection kind.

- [ ] **Step 3: Implement**

Replace the projection kinds and add the parser:

```ts
const projectionKinds = ['iom', 'all', 'discovery', 'setup'] as const;
type ProjectionKind = typeof projectionKinds[number];

export function connectionInfoProjectionId(instance: SHA256IdHash<Instance>, scope: ProjectionKind): string {
  return `device-connections:${instance}:${scope}`;
}

/** The instance a setup root describes, or undefined for every other projection. */
export function instanceOfSetupProjection(projectionId: string): SHA256IdHash<Instance> | undefined {
  const match = /^device-connections:([0-9a-f]{64}):setup$/.exec(projectionId);
  return match ? match[1] as SHA256IdHash<Instance> : undefined;
}
```

Add to `OwnDeviceConnectionInfoSyncDeps`:

```ts
  /** This instance's own setup entries. They are published regardless of connection sharing. */
  loadInstanceSetup?(): Promise<PhoneBookProjectionEntry[]>;
```

In `publish`, replace the `enabled` and `kinds` lines with:

```ts
    const enabled = (kind: ProjectionKind) => kind === 'setup' ? true
      : kind === 'discovery' ? shareDiscoveredDevices === true : kind === selectedScope;
```

```ts
    const kinds = projectionKinds.filter(kind => kind === 'discovery' ? shareDiscoveredDevices !== undefined
      : kind === 'setup' ? this.deps.loadInstanceSetup !== undefined : true);
```

Change the endpoint source to `scope === 'discovery' || scope === 'setup' ? [] : [...]` and the route loop source to `scope === 'discovery' || scope === 'setup' ? [] : observations`. After the `if (scope === 'discovery') { … }` block, add:

```ts
      if (scope === 'setup') {
        for (const entry of await this.deps.loadInstanceSetup!()) {
          if (entry.entryKind !== 'instance-setup' || entry.subjectInstanceId !== this.deps.ownerInstanceId) {
            throw new Error('[connection.core] Instance setup may describe only the publishing instance');
          }
          entries.push(entry);
        }
      }
```

Export `instanceOfSetupProjection` from `/Users/gecko/src/one/packages/connection.core/src/index.ts` next to the existing `OwnDeviceConnectionInfoSync` exports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/gecko/src/one/packages/connection.core && pnpm exec vitest run src/services/OwnDeviceConnectionInfoSync.test.ts src/recipes/PhoneBookProjectionRecipes.test.ts && pnpm run build`
Expected: PASS and a clean build.

---

### Task 3: Setups on device summaries

**Files:**
- Modify: `/Users/gecko/src/one/packages/device.core/src/plans/DevicesPlan.ts`
- Modify: `/Users/gecko/src/one/packages/device.core/src/index.ts`
- Modify: `/Users/gecko/src/one/packages/ui.core/src/types/devices.ts`
- Test: `/Users/gecko/src/one/packages/device.core/src/plans/DevicesPlan.test.ts`

**Interfaces:**
- Produces: `ManagedDeviceSetup` (`moduleId: string; status: 'applied' | 'rejected'; reason?: string; observed?: string; values: Record<string, unknown>; observedAt: number`), `DeviceSetupSource` (`list(instanceIds: string[]): Promise<Map<string, ManagedDeviceSetup[]>>; subscribe(listener: () => void): () => void`), `DevicesPlan.setSetupSource(source)`, `ManagedDeviceSummary.setup?: ManagedDeviceSetup[]` (same shape in device.core and ui.core).

- [ ] **Step 1: Write the failing test**

Append inside `describe('DevicesPlan', …)`:

```ts
  it('adds each device instance setup to its summary and notifies on setup changes', async () => {
    const { plan } = createPlan(undefined, ['instance-remote'])
    const setup = { moduleId: 'iom', status: 'applied' as const, values: { shareChats: false }, observedAt: 1_000 }
    let changed!: () => void
    const list = vi.fn(async (instanceIds: string[]) =>
      new Map(instanceIds.filter(id => id === 'instance-remote').map(id => [id, [setup]])))
    plan.setSetupSource({ list, subscribe: listener => { changed = listener; return () => {} } })
    const listener = vi.fn()
    const unsubscribe = plan.subscribe(listener)

    const devices = await plan.listDevices()
    expect(devices.find(device => device.deviceId === 'device-remote')?.setup).toEqual([setup])
    expect(devices.find(device => device.deviceId === 'device-current')?.setup).toBeUndefined()
    changed()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/gecko/src/one/packages/device.core && pnpm exec vitest run src/plans/DevicesPlan.test.ts`
Expected: FAIL with `plan.setSetupSource is not a function`.

- [ ] **Step 3: Implement**

In `DevicesPlan.ts`, add above `ManagedDeviceSummary`:

```ts
/** One module's settings as a device reports applying them. */
export interface ManagedDeviceSetup {
  moduleId: string
  status: 'applied' | 'rejected'
  reason?: string
  observed?: string
  values: Record<string, unknown>
  observedAt: number
}

export interface DeviceSetupSource {
  list: (instanceIds: string[]) => Promise<Map<string, ManagedDeviceSetup[]>>
  subscribe: (listener: () => void) => () => void
}
```

Add `setup?: ManagedDeviceSetup[]` to `ManagedDeviceSummary`. Give each subscription an `unsubscribeSetup?: () => void`, add a `private setupSource?: DeviceSetupSource` field, and add:

```ts
  setSetupSource(source: DeviceSetupSource): void {
    if (source === this.setupSource) return
    this.setupSource = source
    for (const subscription of this.subscriptions) {
      subscription.unsubscribeSetup?.()
      subscription.unsubscribeSetup = source.subscribe(subscription.listener)
      subscription.listener()
    }
  }
```

In `subscribe`, create the subscription with `unsubscribeSetup: this.setupSource?.subscribe(listener)` and call `subscription.unsubscribeSetup?.()` in its cleanup next to `unsubscribeConnections`. In `buildSummary`, after `lanes` are computed:

```ts
    const setups = this.setupSource ? await this.setupSource.list(instanceIds) : undefined
    const setup = setups ? instanceIds.flatMap(id => setups.get(id) ?? []) : []
```

and add `...(setup.length ? { setup } : {}),` to the returned summary.

Export `type ManagedDeviceSetup` and `type DeviceSetupSource` from `/Users/gecko/src/one/packages/device.core/src/index.ts` beside `DevicesPlan`. In `/Users/gecko/src/one/packages/ui.core/src/types/devices.ts`, add the same `ManagedDeviceSetup` interface and `setup?: ManagedDeviceSetup[]` on `ManagedDeviceSummary`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/gecko/src/one/packages/device.core && pnpm exec vitest run src/plans/DevicesPlan.test.ts && pnpm run build && cd ../ui.core && pnpm run build`
Expected: PASS and clean builds.

---

### Task 4: vger publishes, admits and supplies setups

**Files:**
- Create: `/Users/gecko/src/one/packages/vger.core/src/modules/iom-setup.ts`
- Create: `/Users/gecko/src/one/packages/vger.core/src/modules/iom-setup.test.ts`
- Modify: `/Users/gecko/src/one/packages/vger.core/src/modules/ConnectionModule.ts`

**Interfaces:**
- Consumes: `instanceOfSetupProjection`, `connectionInfoProjectionId` (Task 2); `ManagedDeviceSetup`, `DevicesPlan.setSetupSource` (Task 3); `IOM_SHARING_SECTION_ID` (`vger.core/src/settings/iom-sharing.ts`).
- Produces: `createIomSetupEntry`, `appliedModuleVersion`, `admitsSetupProjectionRoot`, `collectInstanceSetups`, `toManagedDeviceSetup`, `toLocalSetup`.

- [ ] **Step 1: Write the failing tests**

Create `iom-setup.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import type {Instance} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {connectionInfoProjectionId} from '@refinio/connection.core/services/OwnDeviceConnectionInfoSync.js';
import {admitsSetupProjectionRoot, collectInstanceSetups, createIomSetupEntry} from './iom-setup.js';

const A = 'a'.repeat(64) as SHA256IdHash<Instance>;
const B = 'b'.repeat(64) as SHA256IdHash<Instance>;
const values = {shareDiscoveredDevices: true, shareAiPersonas: false, shareChats: true};

describe('IoM setup observations', () => {
  it('describes this instance applied IoM sharing as sorted values', () => {
    const entry = createIomSetupEntry({instanceId: A, values, observedAt: 5});
    expect(entry.subjectInstanceId).toBe(A);
    expect(entry.createdAt).toBe(5);
    expect(entry.setup).toEqual({moduleId: 'iom', status: 'applied',
      values: '{"shareAiPersonas":false,"shareChats":true,"shareDiscoveredDevices":true}'});
  });

  it('admits a setup root only from the lane of the instance it names', () => {
    const root = {$type$: 'PhoneBookProjectionRoot', projectionId: connectionInfoProjectionId(A, 'setup')};
    expect(admitsSetupProjectionRoot(root, {remoteInstanceId: A})).toBe(true);
    expect(admitsSetupProjectionRoot(root, {remoteInstanceId: B})).toBe(false);
    expect(admitsSetupProjectionRoot(root, undefined)).toBe(false);
    expect(admitsSetupProjectionRoot({$type$: 'PhoneBookProjectionRoot',
      projectionId: connectionInfoProjectionId(A, 'iom')}, {remoteInstanceId: B})).toBe(true);
  });

  it('collects setups per instance and refuses entries about another instance', () => {
    const own = createIomSetupEntry({instanceId: A, values, observedAt: 5});
    const setups = collectInstanceSetups([{projectionId: connectionInfoProjectionId(A, 'setup'), entries: [own]}]);
    expect(setups.get(A)).toEqual([{moduleId: 'iom', status: 'applied', values, observedAt: 5}]);
    expect(() => collectInstanceSetups([{projectionId: connectionInfoProjectionId(B, 'setup'), entries: [own]}]))
      .toThrow(/another instance/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/gecko/src/one/packages/vger.core && pnpm exec vitest run src/modules/iom-setup.test.ts`
Expected: FAIL, `./iom-setup.js` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `iom-setup.ts`:

```ts
import type {Instance} from '@refinio/one.core/lib/recipes.js';
import {getObjectByIdHash, hasVersionHead} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {stringify} from '@refinio/one.core/lib/util/sorted-stringify.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {createPhoneBookProjectionEntry, type PhoneBookProjectionEntry} from '@refinio/connection.core/recipes';
import {instanceOfSetupProjection} from '@refinio/connection.core/services/OwnDeviceConnectionInfoSync.js';
import type {ManagedDeviceSetup} from '@refinio/device.core';
import {calculateTargetModuleSettingsIdHash, createInstanceTargetRef} from '@refinio/settings.core';
import {IOM_SHARING_SECTION_ID, type DEFAULT_IOM_SHARING_SETTINGS} from '../settings/iom-sharing.js';

type IomSharingValues = typeof DEFAULT_IOM_SHARING_SETTINGS;

/** This instance's applied IoM sharing, observed by the instance itself. */
export function createIomSetupEntry(params: {
  instanceId: SHA256IdHash<Instance>;
  values: IomSharingValues;
  observed?: SHA256Hash;
  observedAt: number;
}): PhoneBookProjectionEntry {
  return createPhoneBookProjectionEntry({entryKind: 'instance-setup', subjectInstanceId: params.instanceId,
    setup: {moduleId: IOM_SHARING_SECTION_ID, status: 'applied', values: stringify(params.values),
      ...(params.observed ? {observed: params.observed} : {})},
    createdAt: params.observedAt});
}

/** The stored version this instance applies for a module, or undefined while it runs on defaults. */
export async function appliedModuleVersion(instanceId: SHA256IdHash<Instance>, moduleId: string): Promise<SHA256Hash | undefined> {
  const idHash = await calculateTargetModuleSettingsIdHash(createInstanceTargetRef(instanceId), moduleId);
  return await hasVersionHead(idHash) ? (await getObjectByIdHash(idHash)).hash : undefined;
}

/** A setup root may arrive only on the lane authenticated as the instance it describes. */
export function admitsSetupProjectionRoot(obj: object | undefined,
  lane: {remoteInstanceId: SHA256IdHash<Instance> | string} | undefined): boolean {
  const projectionId = (obj as {projectionId?: unknown} | undefined)?.projectionId;
  const instance = typeof projectionId === 'string' ? instanceOfSetupProjection(projectionId) : undefined;
  return instance === undefined || instance === lane?.remoteInstanceId;
}

export function toManagedDeviceSetup(entry: PhoneBookProjectionEntry): ManagedDeviceSetup {
  if (entry.entryKind !== 'instance-setup' || !entry.setup) throw new Error('[vger.core] Setup root holds a non-setup entry');
  const {moduleId, status, reason, observed, values} = entry.setup;
  return {moduleId, status, ...(reason ? {reason} : {}), ...(observed ? {observed} : {}),
    values: JSON.parse(values) as Record<string, unknown>, observedAt: entry.createdAt};
}

/** Setups per instance from received setup roots; each root may describe only its own instance. */
export function collectInstanceSetups(
  roots: ReadonlyArray<{projectionId: string; entries: readonly PhoneBookProjectionEntry[]}>,
): Map<string, ManagedDeviceSetup[]> {
  const result = new Map<string, ManagedDeviceSetup[]>();
  for (const root of roots) {
    const instance = instanceOfSetupProjection(root.projectionId);
    if (!instance) throw new Error('[vger.core] Not an instance setup root');
    result.set(instance, root.entries.map(entry => {
      if (entry.subjectInstanceId !== instance) throw new Error('[vger.core] Setup entry describes another instance');
      return toManagedDeviceSetup(entry);
    }));
  }
  return result;
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `cd /Users/gecko/src/one/packages/vger.core && pnpm exec vitest run src/modules/iom-setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `ConnectionModule`**

Import the helpers and types:

```ts
import {admitsSetupProjectionRoot, appliedModuleVersion, collectInstanceSetups, createIomSetupEntry, toLocalSetup} from './iom-setup.js';
import {instanceOfSetupProjection} from '@refinio/connection.core/services/OwnDeviceConnectionInfoSync.js';
import type {ManagedDeviceSetup} from '@refinio/device.core';
```

Add fields next to `iomSharing`:

```ts
  private iomSharingObservedAt?: number;
  readonly onInstanceSetupChanged = new OEvent<() => void>();
```

In `startConnectionInfoSync`, right after `this.iomSharing = readIomSharingSettings(…)`, set `this.iomSharingObservedAt = Date.now();`. Add to the `OwnDeviceConnectionInfoSync` deps object:

```ts
      loadInstanceSetup: async () => [createIomSetupEntry({instanceId: this.deps.oneCore.instanceId,
        values: this.iomSharing, observedAt: this.iomSharingObservedAt!,
        observed: await appliedModuleVersion(this.deps.oneCore.instanceId, IOM_SHARING_SECTION_ID)})],
```

In the `settingsPlan.subscribe` callback, after computing the new `this.iomSharing`:

```ts
      if (JSON.stringify(previous) !== JSON.stringify(this.iomSharing)) {
        this.iomSharingObservedAt = Date.now();
        this.onInstanceSetupChanged.emit();
      }
```

In the `'PhoneBookProjectionRoot'` `onImported` handler, after `await this.acceptReceivedConnectionInfo(root);`, add `if (instanceOfSetupProjection(root.projectionId)) this.onInstanceSetupChanged.emit();`.

In the import filter, directly before `if (type === 'IomTrustPublication') {`, add:

```ts
          if (type === 'PhoneBookProjectionRoot' && !admitsSetupProjectionRoot(obj, lane)) return false;
```

Add the reader next to `loadReceivedConnectionInfoFacts`:

```ts
  private async loadReceivedInstanceSetups(): Promise<Map<string, ManagedDeviceSetup[]>> {
    const registry = await this.loadReceivedConnectionInfoRegistry();
    if (!registry) return new Map();
    const own = await this.getConnectionInfoOwnPersonIds();
    const roots: Array<{projectionId: string; entries: PhoneBookProjectionEntry[]}> = [];
    for (const rootId of registry.projectionRoots) {
      const current = await this.loadReceivedConnectionInfoRoot(rootId);
      if (!current || !own.includes(current.obj.ownerPersonId) || !instanceOfSetupProjection(current.obj.projectionId)) continue;
      const entries: PhoneBookProjectionEntry[] = [];
      for (const entryHash of current.obj.entries) {
        const entry = await getObject(entryHash);
        if (entry.$type$ !== 'PhoneBookProjectionEntry') throw new Error('[ConnectionModule] Received setup entry has the wrong type');
        entries.push(entry);
      }
      roots.push({projectionId: current.obj.projectionId, entries});
    }
    return collectInstanceSetups(roots);
  }
```

Directly after the existing `this.deps.devicesPlan?.setConnectionSource({ … });` call, add:

```ts
    this.deps.devicesPlan?.setSetupSource({
      list: async instanceIds => {
        const setups = await this.loadReceivedInstanceSetups();
        if (this.iomSharingObservedAt !== undefined) {
          setups.set(this.deps.oneCore.instanceId, [toLocalSetup(this.iomSharing, this.iomSharingObservedAt)]);
        }
        return new Map(instanceIds.map(id => [id, setups.get(id) ?? []]));
      },
      subscribe: listener => this.onInstanceSetupChanged.listen(listener),
    });
```

and add this module-level function in `iom-setup.ts`, exported and imported into `ConnectionModule`:

```ts
/** The current instance's own setup, read directly from its applied values. */
export function toLocalSetup(values: IomSharingValues, observedAt: number): ManagedDeviceSetup {
  return {moduleId: IOM_SHARING_SECTION_ID, status: 'applied', values: {...values}, observedAt};
}
```

Confirm that `reapplyReceivedConnectionInfo` and `listPeerSearchTargets` ignore `instance-setup` entries (they branch on entry kinds). If either throws on an unknown kind, make it skip `instance-setup` explicitly.

- [ ] **Step 6: Typecheck and run the module tests**

Run: `cd /Users/gecko/src/one/packages/vger.core && npx tsc --noEmit -p . && pnpm exec vitest run src/modules/iom-setup.test.ts src/modules/ConnectionModule.test.ts src/settings/index.test.ts`
Expected: no type errors; all tests PASS.

---

### Task 5: Sharing per device in Your devices

**Files:**
- Modify: `/Users/gecko/src/one/packages/vger.ui/src/components/device/DevicesManager.tsx`
- Test: `/Users/gecko/src/one/packages/vger.ui/src/components/device/DevicesManager.test.tsx`

**Interfaces:**
- Consumes: `ManagedDeviceSummary.setup` (Task 3).

- [ ] **Step 1: Run `ui-consistency:adjusting`** for the device card region of `DevicesManager` and follow its checklist. Its findings take precedence over the layout details below.

- [ ] **Step 2: Write the failing test**

Append to `DevicesManager.test.tsx`:

```tsx
it('shows each device reported IoM sharing and says when none was reported', async () => {
  const devices = plan()
  devices.listDevices = vi.fn(async () => [
    { deviceId: 'phone', name: 'Travel phone', platform: 'mobile' as const, isCurrentDevice: false,
      setup: [{ moduleId: 'iom', status: 'applied' as const, observedAt: 1_700_000_000_000,
        values: { shareDiscoveredDevices: true, shareAiPersonas: false, shareChats: true } }] },
    { deviceId: 'filer', name: 'Filer', platform: 'desktop' as const, isCurrentDevice: false },
  ])
  render(<DevicesManager devices={devices} />)
  fireEvent.click(await screen.findByTestId('devices-manager-device-sharing-phone'))
  expect(screen.getByTestId('devices-manager-device-sharing-phone-shareAiPersonas').textContent).toBe('AI personas: Off')
  expect(screen.getByTestId('devices-manager-device-sharing-phone-shareChats').textContent).toBe('Chats: On')
  fireEvent.click(screen.getByTestId('devices-manager-device-sharing-filer'))
  expect(screen.getByTestId('devices-manager-device-sharing-empty-filer').textContent).toBe('Not reported yet')
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /Users/gecko/src/one/packages/qa.core && pnpm exec vitest run --config vitest.vger-ui.config.ts DevicesManager.test`
Expected: FAIL, no element with test id `devices-manager-device-sharing-phone`.

- [ ] **Step 4: Implement**

Add to the `copy.en` entry:

```ts
    sharing: 'Sharing', notReportedSharing: 'Not reported yet', reported: 'Reported', on: 'On', off: 'Off',
    notApplied: (reason: string) => `Not applied: ${reason}`,
    iomLabels: { shareDiscoveredDevices: 'Discovered devices', shareAiPersonas: 'AI personas', shareChats: 'Chats' },
```

and to `copy.de`:

```ts
    sharing: 'Teilen', notReportedSharing: 'Noch nicht gemeldet', reported: 'Gemeldet', on: 'An', off: 'Aus',
    notApplied: (reason: string) => `Nicht übernommen: ${reason}`,
    iomLabels: { shareDiscoveredDevices: 'Gefundene Geräte', shareAiPersonas: 'KI-Personas', shareChats: 'Chats' },
```

In the device card, directly before the existing Device details `<details>`, add:

```tsx
        {(() => {
          const iom = device.setup?.find(setup => setup.moduleId === 'iom')
          return <details className="border-t border-border px-4 py-3 sm:px-5 [&[open]>summary>svg]:rotate-90">
            <summary data-testid={`devices-manager-device-sharing-${device.deviceId}`} className={disclosureClassName}><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t.sharing}</summary>
            {!iom && <p data-testid={`devices-manager-device-sharing-empty-${device.deviceId}`} className="pt-3 text-sm text-muted-foreground">{t.notReportedSharing}</p>}
            {iom && <div className="space-y-2 pt-3 text-sm">
              {iom.status === 'rejected' && <p role="status" className="text-destructive">{t.notApplied(iom.reason ?? '')}</p>}
              <ul className="space-y-1">
                {(Object.keys(t.iomLabels) as Array<keyof typeof t.iomLabels>).map(key =>
                  <li key={key} data-testid={`devices-manager-device-sharing-${device.deviceId}-${key}`}>{t.iomLabels[key]}: {iom.values[key] === true ? t.on : t.off}</li>)}
              </ul>
              <p className="text-xs text-muted-foreground">{t.reported}: {new Date(iom.observedAt).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US')}</p>
            </div>}
          </details>
        })()}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/gecko/src/one/packages/qa.core && pnpm exec vitest run --config vitest.vger-ui.config.ts DevicesManager.test`
Expected: PASS, including the existing DevicesManager tests.

- [ ] **Step 6: Run `ui-consistency:verifying`** on `DevicesManager` and fix what it reports.

---

### Task 6: Cross-package verification

- [ ] **Step 1: Build in dependency order**

Run: `cd /Users/gecko/src/one/packages && for p in connection.core device.core ui.core; do (cd $p && pnpm run build) || exit 1; done && (cd vger.core && npx tsc --noEmit -p .) && (cd vger.ui && npx tsc --noEmit -p .) && (cd vger.settings && npx tsc --noEmit -p .)`
Expected: no errors.

- [ ] **Step 2: Run every touched suite**

Run: `cd /Users/gecko/src/one/packages && (cd connection.core && pnpm exec vitest run src/recipes/PhoneBookProjectionRecipes.test.ts src/services/OwnDeviceConnectionInfoSync.test.ts) && (cd device.core && pnpm exec vitest run) && (cd vger.core && pnpm exec vitest run src/modules/iom-setup.test.ts src/modules/ConnectionModule.test.ts src/settings/index.test.ts) && (cd qa.core && pnpm exec vitest run --config vitest.vger-ui.config.ts DevicesManager.test)`
Expected: all PASS.

- [ ] **Step 3: Report**

Report to the user what passed, which suites were not run, and that nothing was committed. Two-device behaviour (a sibling's setup arriving over a live lane) is not covered by these unit suites; say so.
