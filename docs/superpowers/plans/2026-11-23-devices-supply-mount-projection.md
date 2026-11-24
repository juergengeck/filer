# ONE/Devices Supply Projection & Mount/Unmount Implementation Plan

**Status:** proposed  
**Date:** 2026-11-23  
**Scope:** `../one/packages/matching.core`, `../one/packages/filer.core`, `../one/packages/refinio.api`, `../one/packages/filer.runtime`, `../one/packages/filer.swift`, and `one.provider`

## Goal

Turn `/ONE/devices` (localized in Finder as `ONE/Devices` / `ONE/Geräte`) into a flat, live projection of known and discovered devices (both locally discovered and remotely discovered across the owner's IoM — e.g. a `vger.headless` node sharing discovered devices via `shareDiscoveredDevices` / `PhoneBookProjectionRoot` — or via `glue.one` presence), where:

- **A discovered peer** (subject to the app's trust and sharing settings) projects as an available **supply**.
- **Mounting** activates an available supply by storing/activating a `RuntimeDemand` and requesting the authenticated route/projection governed by trust and settings.
- **Unmounting** withdraws that `RuntimeDemand` (`status: 'withdrawn'`) and detaches the mounted projection without deleting received ONE objects.

## Architectural Alignment (vger, akte, fotos, filer)

This plan reuses the existing shared platform contracts in `../one/packages/*` with **no new ONE recipes**:

1. **Capabilities & supply**:
   - Instance-level capabilities live on `OneInstanceEndpoint` (`instancePlatform`, `suppliedPlanTypes`), published by `InstanceModule` and read via `readPublishedInstanceMetadata` (`connection.core/src/services/InstancePlatformProjection.ts`).
   - Runtime supplies live as versioned `RuntimeSupply` objects (`discovery.core/src/recipes/RuntimeSupplyRecipe.ts`) with `domain`, `supplierPersonId`, `runtimeInstanceId`, `status`, `capabilityKeywords`, `governedTagIds`, `contexts`, `controlSurfaces`, `supportedPlans`, and `routeHints`.
2. **Local & remote discovery sharing**:
   - Local discovery (`DiscoveryService`) and `glue.one` presence (`GlueModule`) feed `ConnectionModule.unifiedPeerDiscovery` (`connection.core/src/discovery/UnifiedPeerDiscovery.ts`).
   - When `iom.shareDiscoveredDevices` is enabled (`vger.core/src/settings/iom-sharing.ts`), `OwnDeviceConnectionInfoSync` publishes `PhoneBookProjectionRoot`s (`device-connections:<instance>:discovery`, `:iom`, `:all`) and `audience:<label>` group projections.
   - `ConnectionModule.applySharedPhoneBookProjectionRoot` converts received sightings into `PeerSearchTarget`s and feeds them into `unifiedPeerDiscovery` (`source: 'peer'`). `FilerGlueRuntime` already boots `ConnectionModule` and `GlueModule`, so these sightings already arrive in Filer.
3. **Demand as mount activation**:
   - Activating a supply writes/reactivates a `RuntimeDemand` (`discovery.core/src/recipes/RuntimeDemandRecipe.ts`), matched against available supplies via `matchRuntimeDemandSupply` (`matching.core`).
   - Trust and sharing boundaries remain owned by `TrustModel`, `iom` sharing settings, and CHUM import filters (`OwnDevicesChumScope` / `FilerSyncRules`). Discovery sightings never bypass trust or implicitly grant access.

## Global Constraints

- **Canonical platform ownership**: Shared TypeScript and Swift logic lives in `../one/packages/*`; macOS host/extension wiring lives in `one.provider/`. Never touch `../one-experimental`.
- **No new ONE recipes**: Reuse `RuntimeSupply`, `RuntimeDemand`, `PhoneBookProjectionRoot`, `Device`, and `OneInstanceEndpoint`.
- **No fallbacks, no polling**: All invalidation is event-driven (`devicesPlan.subscribe`, `unifiedPeerDiscovery.onCandidatesChanged`, `onPeerSearchTargetsChanged`, `objectEvents.onNewVersion`). Malformed writes or unknown actions fail explicitly.
- **Preserved trust boundary**: Mounting a device activates demand and requests an authenticated connection/route through `ConnectionModule` / `GlueModule`; unverified or ignored peers are rejected by the runtime's existing trust/admission gates, never silently promoted.
- **Uncommitted work**: Both `/Users/gecko/src/one` and `/Users/gecko/src/filer` have active uncommitted work in `filer.runtime`, `DevicesFileSystem.ts`, `FilerRuntime.ts`, `FilerFolderNames.swift`, and `one.provider`. Build strictly on top of it; never revert or reformat unrelated changes.

---

## Flat Projection Layout (`/ONE/devices`)

A flat layout keeps every device at a stable path and Finder item identifier across `available ↔ mounting ↔ mounted ↔ offline` transitions (no reparenting churn, no jumping folders while right-clicking):

```text
/ONE/devices/
├── devices.json               # read-only snapshot of all devices, discovered supplies & mount states
├── mounts.json                # revision-bound writable control file (ManagedFileWriteOwner)
├── <Current Device>/          # this local Filer instance (read-only; no mount/unmount action)
│   └── device.json
├── <Discovered Device A>/     # available (unmounted) discovered supply (local, glue, or IoM-sighted)
│   └── device.json
└── <Discovered Device B>/     # mounted device (active RuntimeDemand + matched supply)
    ├── device.json            # identity, trust, discovery provenance, mount/demand state
    ├── supply.json            # live matched RuntimeSupply, capabilities, route & active demand status
    └── <capability...>/       # optional browsable remote capability subtrees via getMountedFileSystem()
```

### File contracts

1. **`/ONE/devices/<Device>/device.json`** (read-only):
   - Stable identity: `deviceKey`, `deviceId?`, `instanceId?`, `personId?`, `name`, `platform`, `isCurrentDevice`.
   - Trust & provenance: `trustLevel`, `identityBinding` (`'verified' | 'unresolved' | 'none'`), `discoverySources` (`('local' | 'mdns' | 'glue' | 'peer')[]`), `observedByInstanceIds?` (e.g. the `vger.headless` instance that sighted it), `lastSeenAt?`.
   - Supply summary: `capabilities` (merged `suppliedPlanTypes` + `RuntimeSupply.capabilityKeywords`), `supplies` (matched/available `RuntimeSupply` summaries: `domain`, `runtimeInstanceId`, `status`, `governedTagIds`, `supportedPlans`, `controlSurfaces`, `routeHints`), `connectionState`.
   - Mount / demand state: `mountState` (`'local' | 'available' | 'mounting' | 'mounted' | 'offline' | 'denied'`), `demandId?`, `demandStatus?` (`'active' | 'fulfilled' | 'withdrawn'`), `mountedAt?`, `error?`.

2. **`/ONE/devices/mounts.json`** (writable via `ManagedFileWriteOwner`, same revision-bound protocol as `/ONE/System/settings/Filer/folders.json`):
   ```json
   {
     "$type$": "FilerDeviceMounts",
     "$version$": 1,
     "mounts": {
       "<deviceKey>": "mounted",
       "<otherDeviceKey>": "unmounted"
     }
   }
   ```
   - Valid values: `"mounted"` | `"unmounted"`.
   - Writing `"mounted"` activates the device's `RuntimeDemand` and reconciles mounts; writing `"unmounted"` withdraws it.
   - Stale writes fail with `ManagedFileErrorCodes.conflict` (`-32010`); unknown keys or local-instance mutations fail with `ManagedFileErrorCodes.invalidWorkbook` (`-32012`) / `unsupportedOperation` (`-32014`).

3. **`/ONE/devices/devices.json`** (read-only):
   - Backwards-compatible `$type$: 'FilerDevicesSnapshot', $version$: 1` extended with `discoveredCount`, `mountedCount`, unified `devices` list (each carrying supply + mount state), and optional `glue` diagnostics.

4. **Finder native actions & decorations (macOS 13.5+)**:
   - Each non-local device directory carries `userInfo: { deviceKey, mountState }` and `decorations` (`one.filer.decoration.device.mounted` | `.mounting` | `.available` | `.offline`).
   - `ExtensionInfo.plist` declares two `NSExtensionFileProviderActions`:
     - `one.filer.action.device.mount` ("Mount Device" / "Gerät einbinden") — active when `userInfo.mountState == "available"`.
     - `one.filer.action.device.unmount` ("Unmount Device" / "Gerät trennen") — active when `userInfo.mountState IN {"mounted", "mounting"}`.
   - Both actions dispatch through `filer:performAction` to the exact same `DeviceSupplyMountPlan` methods used by `mounts.json`.

---

## Delivery Slices & Tasks

### Slice 1: Demand/Supply Matching & Unified Runtime Source

#### Task 1: Instance/Supplier targeting in `matching.core`
**Files:**
- Modify: `/Users/gecko/src/one/packages/matching.core/src/index.ts`
- Test: `/Users/gecko/src/one/packages/matching.core/src/index.test.ts`

**Changes:**
- Add optional `requiredInstanceIds?: string[]` and `requiredSupplierPersonIds?: string[]` to `RuntimePlacementConstraints`.
- Enforce both in `matchRuntimeDemandSupply` right next to `excludedInstanceIds` (returns `null` when present and non-matching, adds an eligibility reason when matched).

**Verify:**
```bash
cd /Users/gecko/src/one/packages/matching.core && pnpm exec vitest run src/index.test.ts && pnpm run build
```

---

#### Task 2: `DeviceSupplyMountPlan` in `filer.core`
**Files:**
- Create: `/Users/gecko/src/one/packages/filer.core/src/DeviceSupplyMountPlan.ts`
- Create: `/Users/gecko/src/one/packages/filer.core/src/DeviceSupplyMountPlan.test.ts`
- Modify: `/Users/gecko/src/one/packages/filer.core/src/index.ts`

**Interfaces:**
- Reuses `RuntimeDemandRecipe` (`$type$: 'RuntimeDemand'`) from `@refinio/discovery.core` and `matchRuntimeDemandSupply` from `@refinio/matching.core`.
- Deterministic demand identity per target supply:
  - `domain`: supply domain (default `'device-supply'`, or concrete supply domain such as `'content'` / `'agent-runtime'`).
  - `demanderPersonId`: local owner `SHA256IdHash<Person>`.
  - `demandId`: `device-mount:${targetKey}` (where `targetKey` is the canonical `instanceId` or discovered `deviceId`).
  - `placementConstraints`: `{ requiredInstanceIds: [targetInstanceId], ...(supplierPersonId ? { requiredSupplierPersonIds: [supplierPersonId] } : {}) }`.
  - `requiredCapabilityKeywords` / `requiredTagIds` / `requiredPlans`: populated from the selected supply when specified.
- Methods:
  - `mountSupply(target: DeviceSupplyMountTarget): Promise<DeviceSupplyMountRecord>` — stores/reactivates `RuntimeDemand` (`status: 'active'`), emits `onChanged`.
  - `unmountSupply(targetKey: string, domain?: string): Promise<DeviceSupplyMountRecord | undefined>` — writes `status: 'withdrawn'` (deletes nothing), emits `onChanged`.
  - `getMountDemand(targetKey: string, domain?: string): Promise<RuntimeDemandObject | undefined>`
  - `listMountDemands(targetKeys: readonly string[]): Promise<Map<string, RuntimeDemandObject>>`
  - `evaluateMountState(candidate, demand, supplies): DeviceMountEvaluation` — uses `matchRuntimeDemandSupply` to compute `'local' | 'available' | 'mounting' | 'mounted' | 'offline' | 'denied'` cleanly with zero heuristics.

**Verify:**
```bash
cd /Users/gecko/src/one/packages/filer.core && pnpm exec vitest run src/DeviceSupplyMountPlan.test.ts && pnpm run build
```

---

#### Task 3: Register `RuntimeSupply` & compose unified discovery/supply source in `filer.runtime`
**Files:**
- Modify: `/Users/gecko/src/one/packages/filer.runtime/src/config.ts`
- Modify: `/Users/gecko/src/one/packages/filer.runtime/src/config.test.ts`
- Create: `/Users/gecko/src/one/packages/filer.runtime/src/device-supply-source.ts`
- Create: `/Users/gecko/src/one/packages/filer.runtime/src/device-supply-source.test.ts`
- Modify: `/Users/gecko/src/one/packages/filer.runtime/src/glue-runtime.ts`

**Changes:**
1. **`config.ts`**:
   - Import and register `RuntimeSupplyRecipe` from `@refinio/discovery.core/recipes/index.js`.
   - Add `'RuntimeSupply'` to `FILER_SHARE_AND_SETTINGS_TYPES` (same trust-gated `context.peerTrustLevel !== 'ignore'` rule as `RuntimeDemand`).
2. **`device-supply-source.ts`**:
   - Pure/testable composition implementing the expanded `FilerDevicesSource` contract:
     - **Inventory**: `DevicesPlan.listDevices()` (paired IoM devices, setup observations, live connection state).
     - **Discovered peers**: `connectionModule.unifiedPeerDiscovery.getCandidates()` + `connectionModule.listPeerSearchTargets()` (local + Glue presence + IoM-forwarded `discovery-sighting`s from e.g. `vger.headless`).
     - **Capabilities**: `readPublishedInstanceMetadata(...)` from `OneInstanceEndpoint.suppliedPlanTypes` + stored/imported `RuntimeSupply` versions for known/discovered instances.
     - **Demands**: `DeviceSupplyMountPlan` (active/withdrawn `RuntimeDemand`s).
     - **Merging rules**:
       - Key devices by authenticated `instanceId` when known, falling back to `candidateId` / `deviceId` for unverified sightings. Never merge an `unresolved` sighting onto a verified `Device` row by display name or bare claimed `personId`.
       - Record `discoverySources` and `observedByInstanceIds` explicitly so the user sees whether a peer was discovered locally, via Glue, or sighted by a sibling IoM node like `vger.headless`.
     - **Mount execution (`mountDevice(deviceKey)`)**:
       - Rejects `isCurrentDevice` or `trustLevel === 'ignore'` / blocked peers.
       - Calls `DeviceSupplyMountPlan.mountSupply(...)` to persist/activate the `RuntimeDemand` (granted to the owner/authorized peer scope as configured).
       - If the target has a verified `personId` / `instanceId` and is not yet connected, invokes the existing authenticated connection path (`devicesPlan.connectDevice` for paired IoM devices or `connectionModule.requestPeerConnection` / `glueModule.requestPeerConnectionWithBestKnownLane` for trusted contacts) — never bypassing CHUM/trust admission.
       - Attaches the device's mounted projection subtree (when the supply provides browsable content or synced shares/status) and emits change notification.
     - **Unmount execution (`unmountDevice(deviceKey)`)**:
       - Calls `DeviceSupplyMountPlan.unmountSupply(deviceKey)` (`status: 'withdrawn'`), detaches the mounted subtree, and emits change notification.
     - **Subscription (`subscribe(listener)`)**:
       - Listens to `devicesPlan.subscribe`, `unifiedPeerDiscovery.onCandidatesChanged`, `connectionModule.onPeerSearchTargetsChanged`, `DeviceSupplyMountPlan.onChanged`, and `objectEvents.onNewVersion` for `'RuntimeSupply'` and `'RuntimeDemand'`.
3. **`glue-runtime.ts`**:
   - Wire `DeviceSupplyMountPlan` and `createFilerDeviceSupplySource(...)` into `FilerRuntime`'s `devicesSource` (in both Glue mode and plain mode, with plain mode gracefully exposing local `DevicesPlan` + `DeviceSupplyMountPlan` without Glue/ConnectionModule).

**Verify:**
```bash
cd /Users/gecko/src/one/packages/filer.runtime && pnpm exec vitest run && pnpm run build
```

---

### Slice 2: Flat `/ONE/devices` Projection, Managed Writes & RPC Actions

#### Task 4: Upgrade `DevicesFileSystem` to flat per-device folders + `mounts.json` + actions
**Files:**
- Modify: `/Users/gecko/src/one/packages/refinio.api/src/filer/DevicesFileSystem.ts`
- Create: `/Users/gecko/src/one/packages/refinio.api/src/filer/DevicesFileSystem.test.ts`

**Changes:**
- Expand `FilerDeviceEntry` and `FilerDevicesSource`:
  - `listDevices(): Promise<readonly FilerDeviceEntry[]>` (unified known + discovered supplies with `deviceKey`, `mountState`, `discoverySources`, `observedByInstanceIds`, `supplies`, `capabilities`, `identityBinding`, `trustLevel`).
  - `mountDevice?(deviceKey: string): Promise<void>`
  - `unmountDevice?(deviceKey: string): Promise<void>`
  - `getMountedFileSystem?(deviceKey: string): IFileSystem | undefined` (optional live subtree mounted inside `/ONE/devices/<Device>/` when `mountState === 'mounted'`).
  - `subscribe?(listener: () => void): () => void`
- Implement the flat directory layout:
  - `/` lists `devices.json`, `mounts.json`, and one sanitized folder `<Device>` per entry (deterministic collision disambiguation using `-<deviceKey.slice(0, 8)>`, never dropping entries).
  - `/<Device>` lists `device.json`, plus `supply.json` (live matched `RuntimeSupply`, advertised capabilities, active `RuntimeDemand`, and connection/route state) and any children of `getMountedFileSystem(deviceKey)` when `mountState === 'mounted'` (names colliding with `device.json` / `supply.json` are isolated deterministically and never shadow them).
  - `stat('/<Device>')` returns `mode: 0o40555`, deterministic `contentHash` / `metadataHash` incorporating `mountState` and children, `canDelete: false`, plus optional native presentation metadata:
    - `userInfo`: `{ deviceKey, mountState }` (omitted for `isCurrentDevice` or set to `mountState: 'local'`).
    - `decorations`: `['one.filer.decoration.device.' + mountState]`.
- Implement `ManagedFileWriteOwner` on `DevicesFileSystem` for `/ONE/devices/mounts.json`:
  - Strict schema validation (`$type$: 'FilerDeviceMounts'`, `$version$: 1`, `mounts: Record<string, 'mounted' | 'unmounted'>`).
  - Base64 `baseVersion` optimistic concurrency check (mirrors `FilerSettingsFileSystem.commit`).
  - Diffs desired vs. current state and executes `mountDevice` / `unmountDevice` for changed keys.
- Implement `performAction(actionId: string, itemPath: string): Promise<void>`:
  - Resolves `<Device>` folder path to `deviceKey`.
  - Dispatches `'one.filer.action.device.mount'` → `mountDevice(deviceKey)` and `'one.filer.action.device.unmount'` → `unmountDevice(deviceKey)`.
  - Throws typed error (`unsupportedOperation` / `noSuchItem`) on unknown actions, files, or `isCurrentDevice`.

**Verify:**
```bash
cd /Users/gecko/src/one/packages/refinio.api && pnpm exec jest src/filer/DevicesFileSystem.test.ts
```

---

#### Task 5: Wire `FilerRuntime`, `PublishedWorkingSet`, `FileProviderRpc`, and `filer.core` item descriptors
**Files:**
- Modify: `/Users/gecko/src/one/packages/filer.core/src/types.ts`
- Modify: `/Users/gecko/src/one/packages/refinio.api/src/filer/PublishedWorkingSet.ts`
- Modify: `/Users/gecko/src/one/packages/refinio.api/src/filer/FileProviderRpc.ts`
- Modify: `/Users/gecko/src/one/packages/refinio.api/src/filer/createFileProviderOperations.ts`
- Modify: `/Users/gecko/src/one/packages/refinio.api/src/filer/FilerRuntime.ts`
- Test: `/Users/gecko/src/one/packages/refinio.api/src/filer/FileProviderRpc.managed-write.test.ts` (and new action + invalidation tests)

**Changes:**
1. **`filer.core/src/types.ts`**:
   - Add optional `userInfo?: Record<string, string>` and `decorations?: string[]` to `FilerItemDescription`.
2. **`PublishedWorkingSet.ts`**:
   - In `describe(filePath)`, forward optional `userInfo` and `decorations` from `fs.stat(filePath)` onto `FilerItemDescription`.
3. **`FileProviderRpc.ts`**:
   - Add `'performAction'` to `FILER_METHODS`.
   - Accept an optional `actionHandlers?: ReadonlyMap<string, { performAction(actionId: string, path: string): Promise<void> }>` (keyed by mount prefix, matching `managedWriteOwners`).
   - On `performAction({ actionId, id })`: resolve `id` to canonical path, dispatch to the most-specific registered mount handler, and return `{ status: 'ok' }`.
4. **`FilerRuntime.ts` & `createFileProviderOperations.ts`**:
   - Register `FILER_DEVICES_MOUNT` → `this.devicesFileSystem` in `getManagedFileWriteOwners()` and in a new `getActionHandlers()` map passed into `FileProviderOperations`.
   - Subscribe `this.devicesFileSystem.subscribe(...)` inside `onPublishedFilesChanged` so any device/discovery/supply/demand change notifies `['/ONE', FILER_DEVICES_MOUNT, 'workingSet']` (and the specific changed device folder container) immediately.
   - Clean up the device subscription in `shutdown()`.

**Verify:**
```bash
cd /Users/gecko/src/one/packages/filer.core && pnpm run build
cd /Users/gecko/src/one/packages/refinio.api && pnpm exec jest src/filer/DevicesFileSystem.test.ts src/filer/FileProviderRpc.managed-write.test.ts src/filer/FilerRuntime.invalidation.test.ts && pnpm run build
```

---

### Slice 3: macOS Finder Native Custom Actions & Badges

#### Task 6: Extend `OneFilerCore` (`filer.swift`) for `userInfo` & `NSFileProviderItemDecorating`
**Files:**
- Modify: `/Users/gecko/src/one/packages/filer.swift/Sources/OneFilerCore/ONEObject.swift`
- Modify: `/Users/gecko/src/one/packages/filer.swift/Sources/OneFilerCore/FileProviderItem.swift`
- Modify: `/Users/gecko/src/one/packages/filer.swift/Sources/OneFilerCore/FilerBackend.swift`
- Test: `/Users/gecko/src/one/packages/filer.swift/Tests/OneFilerCoreTests/FileProviderItemTests.swift`

**Changes:**
- Add `public var userInfo: [String: String] = [:]` and `public var decorationIdentifiers: [String] = []` to `ONEObject`.
- In `FileProviderItem.swift`:
  - Expose `public var userInfo: [AnyHashable: Any]?` returning `oneObject.userInfo` when non-empty (so Finder's `ActivationRule` predicates can inspect `userInfo.mountState`).
  - Under `#if os(macOS)` conform `FileProviderItem` to `NSFileProviderItemDecorating`, returning `oneObject.decorationIdentifiers.map(NSFileProviderItemDecorationIdentifier.init(rawValue:))`.
  - Include `userInfo` and `decorationIdentifiers` in `itemVersion.metadataVersion` hash whenever non-empty, guaranteeing Finder re-evaluates badges and context-menu actions as soon as `mountState` changes.
- Add `func performAction(identifier: String, itemIdentifiers: [String]) async throws` (with default unsupported throw or required on `FilerBackend` as appropriate).

**Verify:**
```bash
cd /Users/gecko/src/one/packages/filer.swift && swift test
```

---

#### Task 7: Wire `NSFileProviderCustomAction` & decorations in `one.provider`
**Files:**
- Modify: `/Users/gecko/src/filer/one.provider/Resources/ExtensionInfo.plist`
- Modify: `/Users/gecko/src/filer/one.provider/Sources/OneFiler/ONEBridge.swift`
- Modify: `/Users/gecko/src/filer/one.provider/Sources/OneFiler/FileProviderExtension.swift`
- Test: `/Users/gecko/src/filer/one.provider/Tests/OneFilerTests/` (add bridge & action decoding tests)

**Changes:**
1. **`ExtensionInfo.plist`** (under `NSExtension`):
   - Add `NSExtensionFileProviderActions`:
     - `one.filer.action.device.mount` — title `"Mount Device"`, `NSExtensionFileProviderActionActivationRule`: `"SUBQUERY(fileproviderItems, $item, $item.userInfo.mountState == 'available').@count == fileproviderItems.@count AND fileproviderItems.@count > 0"`.
     - `one.filer.action.device.unmount` — title `"Unmount Device"`, `NSExtensionFileProviderActionActivationRule`: `"SUBQUERY(fileproviderItems, $item, $item.userInfo.mountState IN {'mounted', 'mounting'}).@count == fileproviderItems.@count AND fileproviderItems.@count > 0"`.
   - Add `NSFileProviderDecorations`:
     - `one.filer.decoration.device.mounted` — `NSFileProviderDecorationBadgeImageType` / SF Symbol (`externaldrive.fill.badge.checkmark` or `checkmark.circle.fill`), label `"Mounted"`.
     - `one.filer.decoration.device.mounting` — SF Symbol (`arrow.triangle.2.circlepath`), label `"Mounting…"`.
     - `one.filer.decoration.device.available` — SF Symbol (`externaldrive.badge.plus` or `circle.dashed`), label `"Available"`.
     - `one.filer.decoration.device.offline` — SF Symbol (`bolt.slash`), label `"Offline"`.
2. **`ONEBridge.swift`**:
   - Decode optional `userInfo` (`[String: String]`) and `decorations` (`[String]`) in both `getObject(id:)` (`stat`) and `decodeItem(_:)`.
   - Add `performAction(identifier: String, itemIdentifiers: [String]) async throws` calling `filer:performAction` for each item identifier.
3. **`FileProviderExtension.swift`**:
   - Conform `FileProviderExtension` to `NSFileProviderCustomAction`.
   - Implement `performAction(identifier:onItemsWithIdentifiers:completionHandler:) -> Progress`: forward to `bridge.performAction(...)`, then signal the domain's `.workingSet` (and `/ONE/devices` container) on completion so Finder updates badges and mounted children immediately.

**Verify:**
```bash
cd /Users/gecko/src/filer/one.provider && swift test
```

---

### Slice 4: End-to-End Verification

#### Task 8: Cross-instance integration test (`vger.headless` sighting → Filer `ONE/Devices` mount/unmount)
**Files:**
- Create: `/Users/gecko/src/one/packages/filer.runtime/src/devices-supply-mount.integration.test.ts`

**Scenarios verified against real disposable ONE instances:**
1. **Remote IoM discovery becomes supply**: A sibling IoM node (modeling `vger.headless` with `iom.shareDiscoveredDevices = true`) publishes a `PhoneBookProjectionRoot` (`discovery-sighting`) and/or `RuntimeSupply` to the owner's IoM. Filer receives it over CHUM and projects `/ONE/devices/<Discovered Device>/device.json` with `discoverySources: ['peer']`, `observedByInstanceIds: [headlessInstanceId]`, and `mountState: 'available'`.
2. **Mount activates `RuntimeDemand`**: Performing `filer:performAction('one.filer.action.device.mount', 'ONE/devices/<Discovered Device>')` (and identically via revision-bound `mounts.json` write) stores an active `RuntimeDemand` matching the supply via `matchRuntimeDemandSupply`, updates `device.json` / `stat.userInfo.mountState` to `'mounted'` (or `'mounting'` while connecting), and emits container invalidation for `/ONE/devices`.
3. **Unmount withdraws `RuntimeDemand` non-destructively**: Performing `one.filer.action.device.unmount` writes `status: 'withdrawn'` on the `RuntimeDemand`, returns `mountState` to `'available'`, detaches the mounted subtree, and leaves already-synced ONE objects untouched.
4. **Trust & settings enforcement**:
   - Turning off `shareDiscoveredDevices` on the observing sibling withdraws the discovery sighting from `/ONE/devices`.
   - Attempting to mount an `ignored` peer or the local instance fails explicitly without creating a demand.

---

## Build & Test Order

```bash
# 1. Shared platform build & tests (in dependency order)
cd /Users/gecko/src/one/packages
for p in matching.core filer.core refinio.api filer.runtime; do
  (cd "$p" && pnpm run build) || exit 1
done

(cd matching.core && pnpm exec vitest run src/index.test.ts)
(cd filer.core && pnpm exec vitest run src/DeviceSupplyMountPlan.test.ts)
(cd refinio.api && pnpm exec jest src/filer/DevicesFileSystem.test.ts src/filer/FileProviderRpc.managed-write.test.ts src/filer/FilerRuntime.invalidation.test.ts)
(cd filer.runtime && pnpm exec vitest run)

# 2. Shared Swift core & macOS File Provider
(cd /Users/gecko/src/one/packages/filer.swift && swift test)
(cd /Users/gecko/src/filer/one.provider && swift test)
```

## Mounted Folder Contents (Decided)

- **Slice 2 (initial mounted view)**: Mounting `/ONE/devices/<Device>/` activates the device's `RuntimeDemand` and authenticated connection lane (so sibling/shared categories such as `/Files/Geteilt/<person>` and `/Fotos` and cross-device capabilities become live) and exposes `supply.json` alongside `device.json` inside `/ONE/devices/<Device>/` showing the live matched `RuntimeSupply`, capabilities, active `RuntimeDemand`, and route status.
- **Follow-up slice (browsable remote capability subtrees)**: `FilerDevicesSource.getMountedFileSystem(deviceKey)` is wired from Slice 2 onward so remote peers exposing browsable service/filesystem capabilities (such as `fotos.library` or a remote headless/Filer share) plug directly into `/ONE/devices/<Device>/<Capability>/` without changing the mount protocol, `mounts.json`, or Finder actions.
