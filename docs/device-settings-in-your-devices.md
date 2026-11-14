# Device settings in Your devices

**Status:** design, not implemented\
**Scope:** `../one/packages/device.core`, `settings.core`, `ui.core`, `vger.settings`, `vger.ui`,
`filer.core`, `refinio.api` (Filer runtime), `../akte/packages/akte.ui`, and the Filer host app

## Decision

Settings → Devices → **Your devices** becomes the place where you see and change the settings
of every device in your IoM, Filer included. Each device row gets a **Settings** disclosure next to
the existing **Device details**. It shows the settings books addressed to that device's instances
and lets you edit them from any app.

A device joins Your devices only through authenticated IoM pairing, as it does today. Discovery,
including IPC on the same Mac, may *offer* pairing but never adds a device or establishes trust.

Each device reports the settings it actually runs with in an **observation** that only it writes.
Your devices shows that observation as the device's state, and later as the acknowledgement of a
change requested from another device. The first slice shows IoM sharing (devices, AI personas,
chats) per device this way, without syncing any settings books.

## Current state

What the code does today, as of 2026-11-14 (slices 1–2 shipped):

| Area | Today | Where |
|---|---|---|
| Your devices list | `DevicesManager` / akte's `DevicesSettingsSection` render `devices.listDevices()` | `vger.ui/src/components/device/DevicesManager.tsx`, `akte.ui/src/settings/DevicesSettingsSection.tsx` |
| What enters the inventory | Only `recordPairedInstance` (IoM pairing completed) and `recordAuthenticatedInstance` (vger: any authenticated same-owner session). Discovery never does. | `device.core/src/plans/DevicesPlan.ts`, `vger.core/src/modules/ConnectionModule.ts`, `connection.core/src/modules/ConnectionModule.ts` |
| One row per | Paired instance. vger.cube and Filer on the same Mac are two rows. | `DevicePlan.getOrCreateLocalDevice(instanceId, …)` |
| Row label | `Instance <first 8 hex>` for every paired peer | both ConnectionModules |
| Device details | Rename, technical details (device ID, instance IDs, connection), forget | `DevicesManager.tsx` |
| Same-Mac discovery | None. Filer's `PrivateSocket` only connects Filer's host app to its own extension. | `filer/one.provider/Sources/OneFilerShared/PrivateSocket.swift` |
| Filer runtime | refinio.api `FilerRuntime` with one.models `ConnectionsModel` and `IoMManager`. Its `DevicesPlan` is local-only (`platform: 'desktop'`) and never records peers. | `refinio.api/src/filer/FilerRuntime.ts`, `filer/stdio-main.ts` |
| Settings model | `TargetSettings` books are addressed by `targetRef` (`instance:<id>`, `device:…`, `person:…`). `SettingsPlan` accepts a `targetRef` on every operation. | `settings.core/src/storage/TargetSettingsStorage.ts`, `plans/SettingsPlan.ts` |
| Settings reach | Every settings book and module version is granted to the owner `Person` (`ensureOwnerAccess`), so CHUM can carry it to every instance in the IoM. | `settings.core/src/storage/ScopedSettingsStorage.ts` |
| Filer's settings | `filer.folders` (`files` / `fotos` / `health.flexibel`: auto · visible · hidden), `targetKinds: ['instance']`, `uiPlacement: 'data'`. Its definition lives in `filer.core`; vger and akte import it to label the module. | `filer.core/src/filer-folder-settings.ts` |
| Applying a change | Filer reconciles its folders when its own instance's `filer.folders` version arrives, with no book entry needed: the storage falls back to the newest stored record for an unlisted module, and the folder store republishes its setup. | `settings.core/src/storage/TargetSettingsStorage.ts` (`loadUnlistedModuleSettings`), `refinio.api/src/filer/FilerFolderSettings.ts`, `refinio.api/src/filer/FilerFolderSettingsImport.ts` |
| Editor | `SettingsModuleEditor` takes a `targetRef` prop; without it, it edits the local instance as before. | `vger.settings/src/settings/SettingsModuleEditor.tsx` |
| Sender admission | A settings version is admitted only from the owner's own identities and only for a known instance (`admitsPeerSettingsVersion`, shared by vger and Filer in `settings.core`). Filer's import listener additionally requires the sender to be its owner. | `settings.core/src/shared-settings-admission.ts`, `vger.core/src/modules/ConnectionModule.ts`, `refinio.api/src/filer/FilerFolderSettingsImport.ts` |
| Import cost | vger caches the known instance IDs and refreshes the cache when devices change, instead of listing devices per object; a version for an unknown instance triggers one fresh read. | `vger.core/src/modules/ConnectionModule.ts` |
| Reporting instance | Every setup in a device summary names the instance that reported it; reads and saves address that instance, not the device's first instance. | `device.core/src/plans/DevicesPlan.ts`, `ui.core/src/lib/deviceSettings.ts` |
| IoM sharing | Settings → Profile → IoM: `shareDiscoveredDevices`, `shareAiPersonas`, `shareChats`, instance-scoped, default on. `ConnectionModule` applies changes live through `settingsPlan.subscribe`. | `vger.core/src/settings/iom-sharing.ts`, `vger.core/src/modules/ConnectionModule.ts` |
| Own-device settings sync | Headless admits only person-target `sourceImap` and Elche modules; Cube and Browser share no settings types | `vger.headless/src/services/headless-own-devices.ts`, `vger.cube/.../module-registry-init.ts`, `vger.browser/.../Model.ts` |
| Remote edits on the target | `ScopedSettingsStorage` notifies listeners on its own writes; reads additionally fall back to the newest stored record when the book has no entry for the module, so an imported version applies without a local write or restart | `settings.core/src/storage/ScopedSettingsStorage.ts` |
| Published instance metadata | Each instance's `OneInstanceEndpoint` in the owner's Profile carries `instancePlatform` and `suppliedPlanTypes`, checked against that instance's `Keys` | `connection.core/src/services/InstancePlatformProjection.ts` |
| Per-instance roots | `IomTrustPublication` (owner + instance) is written only by its instance, granted on authorised IoM lanes, requested by ID, and imported only when its `instance` equals the lane's authenticated remote instance | `trust.me/src/services/IomTrustSupply.ts`, `vger.core/src/modules/ConnectionModule.ts` |
| Provenance | Assembly envelopes record `signer`, `signingKeys`, writing `instance`, causal `predecessors` and `writerPolicy`; `JournalPlan` journals Stories per instance. Settings types are not Assembly-managed (`getObjectHistoryOwner` defaults to `version-node`). | `assembly.core/src/types/Assembly.ts`, `assembly.core/src/plans/JournalPlan.ts`, `one.core/src/object-history.ts` |

## Goals

- Show every IoM device with its settings under Your devices, in vger, akte and any app that
  renders the shared section.
- Edit another device's settings from the device you are using; the change takes effect on that
  device when the settings book arrives there.
- Put Filer in Your devices with a recognisable name, and show its folder settings there.
- Keep the Data placement working: `filer.folders` still appears under Settings → Data on the Filer
  instance itself.

## Non-goals

- No discovery-based inventory, no auto-trust, no auto-pairing without a confirmation.
- No settings schema shipped as data. Section definitions stay code, registered by the package
  that owns the module.
- No per-device replication profiles yet. The "what this device keeps" control from the sharing
  design needs a sync filter that does not exist; it gets a `device`-targeted section once it does.

## Design

### 1. Joining Your devices

The inventory rule stays: a device enters through authenticated IoM pairing, and in vger also
through an authenticated same-owner session.

Filer already pairs into an IoM from its host app. Two changes make it a full member:

- **Filer records its peers.** refinio.api's Filer runtime calls `DevicesPlan.recordPairedInstance`
  when one.models pairing completes for an IoM invitation, as connection.core does. Filer's own
  inventory then lists the devices it paired with, so its menu bar can show them later.
- **Names come from pairing, not the ID.** Both sides pass a display name built from the product
  and the machine to `recordPairedInstance`, for example `Filer · MacBook Pro`, instead of
  `Instance 3f9a1c2e`. The pairing exchange has to carry the peer's product and device name; where
  that field lives is open question 1. Rename keeps working as today and wins over the paired name.

### 2. What a device's settings are

A device row already lists its `instanceIds`. Its settings are the union, over those instances, of:

1. the modules present in the `TargetSettings` book for `instance:<id>`, and
2. the locally registered sections whose `targetKinds` include `instance`, when the device is the
   current one.

The book itself says which modules a device uses, so a phone never shows Filer's folders and no
manifest object is needed. Sections keyed to the whole device use `targetKinds: ['device']` and a
target ref derived from the `Device` ID hash. `createDeviceTargetRef(owner, deviceName)` keys on
the display name and breaks on rename, so it must not be used for this.

### 3. Section definitions travel as code

To render or validate a module, an app needs its definition registered in its `SettingsRegistry`.
Every write passes `assertSectionValues`, which throws `Unknown section` for an unregistered
module, so an app cannot write a module it does not know.

- Move `registerFilerFolderSettings`, `FILER_FOLDER_*` and `decodeFilerFolderModes` from refinio.api
  to `filer.core`. refinio.api keeps calling it; vger and akte import it to manage Filer devices.
- Rule: a section's definition lives in the package that owns the module. An app registers the
  definitions of the device kinds it manages.
- A module the app has no definition for shows as one read-only line: "Filer folders. Change this
  on that device." The app never guesses fields from stored values.

### 4. Editing another device

- `SettingsModuleEditor` gains a `targetRef` prop and passes it to every `settings:*` call.
  Without it, it edits the local instance as today.
- Writes go through `SettingsPlan` with `targetRef: instance:<id>`. The stored module version is
  granted to the owner `Person`, so CHUM delivers it to that instance.
- Concurrent edits from two devices surface the existing "Shared settings conflict" error. The
  editor reloads the section and asks you to apply your change again; it never merges silently.

### 5. Applying a change that arrives from elsewhere

Filer reconciles folders in `onSectionUpdated`, but that hook runs on the runtime's own writes.
A version imported through CHUM must trigger the same reconcile:

- `TargetSettingsStorage` emits `onSectionUpdated` for imported versions of its own target's
  module records, driven by object events for `TargetModuleSettings`. It does not scan or poll.
- Filer's existing handler then reconciles the mount registry and invalidates Finder exactly as it
  does for a `folders.json` edit.

This is the step to verify first; see acceptance test 3.

### 5a. Local and remote state

Three facts tell local from remote; none needs a new author field.

- **Whom a setting is for:** `targetRef`. A runtime applies only records for its own instance or
  its own person. A record for `instance:<other>` is shown, never applied.
- **Who may change it:** the lane and the sender. Settings for my instance are admitted only from my own
  identities, on an authorised IoM lane (own-device CHUM scope, `settingsRoots`).
  A version from any other person is refused before the module or target is even
  checked (`admitsPeerSettingsVersion` in `settings.core`, used by vger's import
  filter and Filer's import listener; Filer additionally requires the sender to
  be its owner). A paired partner therefore cannot change Filer's folder settings.
- **Who wrote a version:** the Assembly. Once `TargetModuleSettings` is declared
  `assembly-frontier`, every version carries its signer, signing keys, writing instance and causal
  predecessors. "Local" means `assembly.instance` is this instance's Assembly. Concurrent edits show
  as divergent predecessors instead of a silent latest-wins. `JournalPlan` provides the history.

### 5b. Acknowledgement by observation

No new datatype. A device's setup is a structured property on the existing
`PhoneBookProjectionEntry`, the same way `discoverySighting` is:

```ts
entryKind: 'instance-setup'
subjectInstanceId: SHA256IdHash<Instance>   // the publishing instance itself
createdAt: number                           // when this setup was observed
setup: {
    moduleId: string;
    status: 'applied' | 'rejected';
    reason?: string;                        // present exactly when rejected
    observed?: string;                      // hash of the requested version; a value, not a graph edge
    values: string;                         // sorted JSON of the applied values
}
```

Each instance publishes its setup entries in its own projection root,
`device-connections:<instance>:setup`, next to its existing `iom`, `all` and `discovery` roots.
`OwnDeviceConnectionInfoSync` grants it to the owner's own identities. Unlike the other roots it is
always published: turning off connection or discovery sharing does not hide a device's setup.
`observed` is stored as a plain hash string, so the settings record never travels with the
observation.

A receiving device admits a setup root only from the lane whose authenticated remote instance is
the one named in the root's projection ID. It reads only entries whose `subjectInstanceId` equals
that instance. Received setup entries are never forwarded: the existing received-facts reader
skips unknown entry kinds.

| Shown | When |
|---|---|
| The device's values, "reported 09:13" | an `applied` observation exists |
| Not reported yet | no observation has arrived |
| Waiting to apply | the latest requested version is newer than `observed` |
| Applied · 09:13 | `observed` equals the latest requested version |
| Not applied: reason | `status` is `rejected` |

Slice 1 publishes setup for the `iom` module only and shows it read-only. It needs no settings
sync and no CHUM scope change. Slice 2 (shipped) adds requested versions from other devices and compares them
with `observed`: a save from Your devices writes a version for the reporting instance, and the
card shows waiting until that instance republishes with the version's hash as `observed`.
Summaries also record which instance reported each setup, so reads and saves address that
instance. When settings become Assembly-managed, the setup root's signature replaces the
lane check, and setups can then be forwarded between devices.

### 6. What you see

```text
Settings › Devices › Your devices
┌──────────────────────────────────────────────────────────┐
│ ▣ vger · MacBook Pro                          This device │
│   desktop · last observed 13 Nov, 09:12                   │
│   › Settings          › Device details                    │
├──────────────────────────────────────────────────────────┤
│ ▣ Filer · MacBook Pro                         connected   │
│   desktop · last observed 13 Nov, 09:12                   │
│   ⌄ Settings                                              │
│     Filer folders                                         │
│       /Files                 auto ▾   shown by default     │
│       /Fotos                 auto ▾   shown when a share … │
│       /Gesundheit/Flexibel   hidden ▾                      │
│     Saved. Filer applies it when it next syncs.            │
│   › Device details                                        │
├──────────────────────────────────────────────────────────┤
│ ▯ akte · iPhone                               not connected│
│   › Settings          › Device details                    │
└──────────────────────────────────────────────────────────┘
```

- **Settings** uses the same disclosure pattern as Device details in each UI stack.
- After a save the editor says the change is saved and will apply when that device syncs. It
  never claims the device has applied it. A device that is not connected shows when it was last
  observed.
- The current device's Settings lists its local modules, so Device preferences and the Data
  sections can link here instead of repeating them.

### 7. Two UI stacks, one model

vger renders `DevicesManager` (shadcn/Tailwind) and akte renders its own `DevicesSettingsSection`
(Mantine, German copy). The logic is shared:

- `ui.core` gets a hook, `useDeviceSettings(device)`. It returns the device's module list
  (definition or "change it on that device"), values per module, and a `save(moduleId, values)`
  bound to the right `targetRef`.
- Each stack renders the hook's result with its own components, following that page's existing
  patterns and copy tables (`en` / `de`).

### 8. Offering pairing on the same Mac (optional phase)

When vger.cube and Filer run on the same Mac for the same macOS user, vger can offer: "Filer is
running on this Mac. Add it to your devices?"

- Filer's host listens on a Unix socket in the user's application-support directory, using
  `PrivateSocket`'s framing and kernel peer identity. It accepts only peers that meet a code-signing
  requirement for the vger/akte apps.
- On confirmation in vger, vger creates an IoM invitation and hands it to Filer over the socket.
  Filer accepts it through its normal pairing operation. The invitation is a bearer secret, so it
  never travels over an unauthenticated channel.
- The socket only shortens pairing. If Filer is already paired, the offer does not appear (Filer
  reports its owner `Person` and instance; vger checks its inventory). Nothing enters the
  inventory until pairing completes.
- macOS only at first. Linux and Windows keep using invitation links and QR codes.

## Delivery

0. **Sharing per device (slice 1, shipped).** Every device publishes its `iom` observation; Your devices
   shows sharing per device read-only. Plan:
   `docs/superpowers/plans/2026-11-14-device-sharing-observations.md`.
1. **Settings reach (shipped).** Imported `TargetModuleSettings` versions apply for their
   target without a local write; cross-target loop tests prove a remote edit is read back
   and observed on republish, for generic modules and for Filer's folders.
2. **Definitions (shipped).** `filer.folders` registration moved to `filer.core`; refinio.api imports it.
3. **Targeted editor and hook (shipped).** `SettingsModuleEditor` `targetRef`; `useDeviceSettings` in
   `ui.core`, addressing each module at its reporting instance.
4. **Your devices UI (shipped).** Settings disclosure in `vger.ui` `DevicesManager`, akte's
   `DevicesSettingsSection`, and Expo's native row, with waiting / acknowledged / not-applied states.
5. **Filer membership.** Filer records paired peers; pairing carries product and device names.
6. **Same-Mac offer.** Socket handshake and offer card, after 1–5 work over normal pairing.

## Acceptance tests

1. A Filer paired into the IoM appears in vger's and akte's Your devices as `Filer · <machine>`,
   not `Instance <hex>`.
2. Its Settings shows Filer folders with the same three folders and modes as `folders.json`.
3. Changing `/Fotos` to `hidden` in vger hides `/Fotos` in Finder on the Filer Mac after sync, with
   no restart, scan or poll; `status.json` shows the new effective state.
4. A phone in the same IoM shows no Filer folders in its Settings.
5. An app without the `filer.core` definition shows the read-only line and cannot write the module.
6. Editing the same module from two devices at once produces a visible conflict on one of them and
   no merged value.
7. Renaming a device keeps its settings, because settings are keyed by instance or device ID, never
   by name.
8. Discovering Filer on the same Mac adds nothing to the inventory until the user confirms and
   pairing completes; an unsigned local process cannot obtain the invitation.

## Open questions

1. **Product and device name in pairing.** Which message in the pairing exchange carries the
   peer's product (`filer`, `vger`, `akte`) and device name, so both sides can call
   `recordPairedInstance` with a real label? one.models pairing (Filer) and vger.core pairing need
   the same field.
2. **Device-level target refs.** Replace `createDeviceTargetRef(owner, name)` with a ref on the
   `Device` ID hash, or keep device-level sections out until one exists?
3. **Write authority.** Only the owner's own identities can write an instance's settings;
   other persons are refused at import. Any instance of the owner can still write any of the
   owner's instances' settings. Should a device be able to refuse remote changes to some
   modules, for example credentials or network exposure?
