# Slice 2: remote editing with acknowledgement

Status (2026-11-14): shipped as designed, plus review findings 1–4 and 6 (sender
admission in `settings.core`, unlisted-module read fallback, cached known-instance
IDs, per-instance reporting, import-failure logging, "Standardwerte" wording).

This plan implements slice 2 of [device-settings-in-your-devices.md](../device-settings-in-your-devices.md):
writes addressed to another device's settings, carried by own-device sync, applied on arrival,
with Waiting / Acknowledged / Not-applied states on the device card.

Slice 1 (shipped, commit `50898c658` in `../one` plus small fixes) publishes each device's
applied settings as an `instance-setup` observation. Slice 2 adds the other direction:
a requested version written on device A for instance `<B>`, synced to B, applied by B's
reconcile, and observed back through B's next setup entry.

## What already exists (verified against code, 2026-11-14)

- `SettingsPlan` accepts `targetRef` (`settings.core/src/plans/SettingsPlan.ts:169`): a writer on
  device A can address instance `<B>` by passing `targetRef: createInstanceTargetRef(B)`.
- `OwnDeviceConnectionInfoSync` needs no change. Settings versions flow through the separate
  own-devices CHUM type scope (`connection.core/src/services/OwnDevicesChumScope.ts`):
  `TargetModuleSettings` objects flow only for listed `(moduleId, targetRef)` roots; anything
  else is rejected. akte already shares person-targeted modules this way
  (`akte.app/src/iom.ts:239`); vger shares no settings versions yet.
- akte reacts to imports with `onChumObjectImported` (`akte.app/src/iom.ts:56`) — the precedent
  for the apply-on-arrival trigger. Filer's `FilerRuntime` reconciles on `onSectionUpdated`
  but has no import trigger (the known main gap).
- Settings books are already granted to the owner's Person, so a version written on A for
  instance `<B>` is readable on B once synced. Version identity is deterministic
  (`calculateTargetModuleSettingsIdHash`), so A and B name the same version head.
- `readStoredModuleVersion` (`settings.core`) reads any instance target's head; the card
  already compares `observed` against versions.

## Open design point (decide before task 4)

Where the latest requested version per (device, module) lives. The writer on A must remember
what it requested to compare against B's later `observed`. Options: (a) derive from A's own
settings book (A stores what it wrote for B — but A's book for B is exactly the requested
version, so the "request" IS the version head in B's book as last written by anyone);
(b) a small local record per (instance, module). Recommendation: (a) — no new datatype.
The writer reads B's book head (`readStoredModuleVersion(B, module)` is readable on A once
synced, same Person grant); Waiting means head is newer than B's `observed`, Acknowledged
means equal. A conflicting edit from a third device shows as Waiting again, which is honest.
Only if (a) proves racy in tests, fall back to (b).

## Rules

- No commits. Several files under `../one` hold uncommitted step-2/step-3 work; build on it.
- Test-first with a failing run observed before each fix. No `as any`, no fallbacks, static
  imports, reuse helpers. Malformed data throws.
- No new datatype for the observation path; the (a) recommendation adds no record at all.
- Invites and pairing unchanged. Filer still joins only through IoM pairing.

## Task 1 — settings.core: write another instance's module version

`TargetSettingsStorage` is constructed per target. Today every construction uses the local
instance's target. Add a writer path for a remote instance target: the storage must accept
`targetRef: instance:<B>` while running on A, write the versioned `TargetModuleSettings`
object (same deterministic idHash B will compute), and expose it for sync.
Test (new `node:test` file mirroring `stored-module-version.test.mjs`, real temp instance):
construct storage for target B on the same instance, `updateSection('probe.module', ...)`
for B, then `readStoredModuleVersion(B, 'probe.module')` returns the new head while the
local target's head is unchanged. Failing-first: the constructor or write path rejects
foreign targets today.

## Task 2 — connection.core + vger.core: let instance-targeted settings versions flow

vger shares no `TargetModuleSettings` yet. Extend vger's `ConnectionModule` CHUM scope
(the `connectionInfoSyncScope` branch) to share `TargetModuleSettings` with explicit
`settingsRoots`: one root per (registered instance-scoped module, own instance target)
plus the same for every paired instance whose settings the local user may edit (instance
targets come from the DevicesPlan instance list). Narrow, never `*`: the scope throws on
an empty root list by design. Test in `ConnectionModule.test.ts` mirroring the akte scope
tests: a `TargetModuleSettings` for a listed (module, instance-target) pair passes for the
own identity, an unlisted module fails, a foreign identity fails.

As implemented (differs from the draft above): adopting `createOwnDevicesChumScope`
wholesale was rejected — it would re-gate every type for vger and break existing
chat/group flows that rely on the generic path. Implemented instead, narrow and additive:
a targeted `TargetModuleSettings` branch in the import filter (after the lane gate, so
production keeps the me-lane bar): foreign identity → reject; accept only when the new
pure helper `admitsSharedSettingsVersion` (`iom-setup.ts`, mirroring
`admitsSetupProjectionRoot`) holds — module registered for kind `instance`, target
parses to `instance:<id>`, id is the own instance or a DevicesPlan paired instance.
Export calls carry no object and keep the generic path. Tests: `iom-setup.test.ts`
(helper cases) and `iom-setup-lane.test.ts` driving the real `importFilterFactory`.

## Task 3 — apply on arrival: notify settings storage of imported versions

A version that arrives over CHUM sits in storage until something reads it. Filer's gap
(reconcile only runs on local write) applies to every runtime:
- vger: hook `onChumObjectImported` (same import akte uses) in `ConnectionModule` init;
  when an imported `TargetModuleSettings` matches a locally-managed instance target,
  re-read the section (or emit on the existing settings event) so the SettingsPlan and
  `SettingsModuleEditor` pick it up.
- Filer: same hook in `FilerRuntime` init; on a `filer.folders` import for the own instance
  target, run the existing folder reconcile.
- akte already has the import hook; extend its handler the same way if its settings UI
  does not already refresh.
Test per runtime with the existing harnesses (vger `ConnectionModule.test.ts` fake-import
pattern, Filer `FilerSetupSync`-style unit plus the real `FilerRuntime` path by inspection,
akte `iom-chum-scope`-adjacent coverage). Failing-first: an imported version is invisible
until a local write today.

## Task 4 — requested version vs observed: the ack comparison

Implement the (a) recommendation: for device B and module M, the card reads B's book head
H (`readStoredModuleVersion`) and B's latest setup `observed` O. H newer than O means
Waiting (show "last seen" from the device row); H equal to O means Acknowledged with O's
time; setup `status: rejected` means Not applied with `reason`. Put the comparison in one
shared helper (see task 5) so all four UI stacks agree. If (a) proves racy, fall back to
a local requested-version record — say so in the review, do not silently add one.
Test at the helper level: fixtures for newer/equal/rejected/missing heads.

## Task 5 — ui.core: `useDeviceSettings(device)` hook

New hook in `ui.core/src/hooks/` following the existing hook conventions. It returns the
device's module list (section definition from `SettingsRegistry`, or a
"change this on that device" marker when the app has no definition), values per module
(from the device's setup entries plus the requested head), the ack state per module from
task 4, and a `save(moduleId, values)` bound to `targetRef: createInstanceTargetRef(device)`.
The hook reads setups from the `DevicesPlan` surface it is given (same shape the cards
already consume). Test with a fake plan: module list, values, ack states, and save
addressing the right target.

## Task 6 — vger SettingsModuleEditor `targetRef` prop

Thread an optional `targetRef` through `SettingsModuleEditor` down to the `SettingsPlan`
`updateSection` call that already accepts it. No behavior change when absent. Test:
saving with a `targetRef` calls `updateSection` with that target; without, unchanged.

## Task 7 — cards show the editor and the ack states (all four stacks)

- vger `DevicesManager`: each defined module section gets an editor (existing editor
  components, `targetRef` from the hook) plus the ack line (Waiting with last seen /
  Acknowledged with time / Not applied with reason). English and German copy.
- akte `DevicesSettingsSection`: same via the Mantine patterns, German copy.
- Expo `NativeDeviceRow` and akte native: editor where the stack allows; at minimum the
  ack line. If a stack cannot host an editor, its card links to the device ("change this
  on that device") and still shows the ack state.
- Tests colocated per stack as in slice 1 (qa `DevicesManager.test`, akte card test,
  expo `devices-sharing.test.mjs`).

## Task 8 — Filer applies a remote `filer.folders` version on import

Wire task 3's Filer trigger to the existing folder reconcile and folder-mode application
(the code `FilerRuntime` already runs after a local `setModes`). Test: import a
`filer.folders` version for the own instance target (fake import through the same hook
the unit uses), assert the folder modes change and the next setup entry carries the new
values with `observed` equal to the requested head. A conflicting edit from two devices
 surfaces as a settings conflict error, never a silent merge.

## Task 9 — cross-package build and test run

```
for p in settings.core connection.core device.core ui.core filer.core; do (cd $p && pnpm run build); done
for p in filer.core connection.core; do (cd $p && pnpm exec vitest run 2>&1 | tail -3); done
pnpm --dir packages/settings.core test
pnpm --dir packages/refinio.api exec jest src/filer
pnpm exec vitest run src/modules/ConnectionModule.test.ts   # vger.core
pnpm exec vitest run --config vitest.vger-ui.config.ts DevicesManager.test  # qa.core
node --test test/devices-sharing.test.mjs test/devices-nearby.test.mjs      # vger.expo
npx vitest run test/devices-settings-section.test.tsx        # akte.ui
npx vitest run test/settings-registration.test.ts            # akte.app
```

## Self-review note

I checked the plan against the code: `SettingsPlan` target support, the scope's
roots-required rule, akte's `onChumObjectImported` precedent, the deterministic version
idHash, and the existing reconcile paths are all real. The one intentional guess is the
(a) recommendation in the open point — the implementer must prove it with task 4's test
before building tasks 5–7 on it.
