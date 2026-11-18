# Filer native settings implementation plan

Add `settings.mac` for the macOS menu bar and System Settings, an iOS `Settings.bundle`, and `settings.windows` for the native ProjFS host. Use a JSON config file for Linux startup. Start with folder visibility in the macOS menu bar and develop the signed System Settings integration alongside it. Both surfaces use the runtime interface that Windows can reuse.

## Settings ownership

| Setting | Source of truth | Editor |
|---|---|---|
| Folder visibility for Files, Fotos, and Health/Flexibel | Instance-scoped `filer.folders` in `settings.core`. Each folder supports Auto, Visible, and Hidden. | Native Filer settings, the mounted `ONE/System/settings/Filer/folders.json`, and existing own-device settings. |
| Local startup preferences | Host configuration for the platform. On Linux, use the Filer startup JSON file. | Platform module or Linux config file. |
| macOS File Provider domains and operating system permissions | `DomainManager` for registered domain configuration, the OS for permissions, and Keychain for instance secrets. | Existing enrollment flow and the relevant OS settings. |

The native modules read and write shared settings through the runtime that owns the selected instance. Show the configured mode separately from effective visibility, which the runtime already reports in `status.json`. Keep platform preferences local and use the existing `filer.folders` sync path for own-device edits. [Filer settings projection](../../../README.md) · [Own-device settings](../../device-settings-in-your-devices.md)

## 1. Expose folder settings through the owned runtime

- In `../one/packages/refinio.api`, add narrow read and update operations to the Filer runtime registry used by `stdio-main.ts`. Reuse the folder schema from `filer.core`, `FilerFolderSettingsStore`, and the existing reconciliation path. The read returns modes, effective status, and a settings revision. The update accepts the changed modes and the revision the user edited.
- Apply a common revision check at the settings write boundary for the native editor and the mounted file. Preserve the existing `folders.json` format and its content-based revision behavior. Reject a stale edit, reload the current settings, and require the user to retry. Verify this against a simultaneous file edit and an own-device update. A change to effective status alone should leave the settings revision intact.
- Keep the API scoped to the authorized runtime for the selected instance. Use the host's existing owner lookup and private transport. Add no public listener or generic settings-write endpoint.

## 2. Integrate `settings.mac` with the menu bar and System Settings

- Add **Settings…** to the existing `NSStatusItem` menu in `OneFilerHost`. Open an AppKit settings window with a domain picker and one mode control per folder. Resolve the selected domain through `RuntimeService` and `RuntimePool` so the window uses the same runtime as Finder.
- Load settings when the window opens and when the user switches domains. Refresh the selected domain when the runtime reports a change, and reload after saving. Show runtime errors in the window and prevent saves if the domain is removed while the window is open.
- Build a Developer ID signed `.prefPane` using the existing Apple signing setup, and notarize and staple it like the DMG. Gatekeeper blocks an unnotarized pane on a clean machine. Install it on clean machines running macOS 13, the oldest supported release, and the current release. A folder edit from the pane must reach the registered domain through the owning Filer host. Verify the pane's process identity before wiring up writes. Since macOS 13, System Settings loads third-party panes in its own legacy loader process, so expect Apple's identity rather than Filer's. In that case, use the pane to open the Filer settings window and keep writes in the signed Filer host. Keep the existing private IPC peer checks in force. [Current menu](../../../one.provider/Sources/OneFilerHost/MenuBarApp.swift) · [Preference Panes](https://developer.apple.com/documentation/PreferencePanes)
- Test the pane installation separately from dragging Filer out of its DMG. If the pane passes the OS and IPC checks, package it into the notarized Developer ID distribution flow and verify install, upgrade, and removal on a clean Mac. Use the provisioned `test:provider:ipc` suite with the signed app to catch trust regressions. File Provider enablement remains available under **System Settings → General → Login Items & Extensions → File Providers**. [Filer signing and distribution](../../../one.provider/README.md) · [File Provider settings](https://support.apple.com/guide/mac-help/mtusr003/mac)

**Acceptance check.** Register two domains backed by distinct instances. Change Files to Hidden for one domain from the menu bar and verify that Finder, `folders.json`, and `status.json` reflect it without restarting. Edit the mounted file and apply an own-device update to verify both appear in the open window. Check stale saves and instance isolation. Repeat the edit starting from the installed System Settings pane and record whether the OS supports editing in the pane or opens the Filer window.

## 3. Give Linux a standard config path

Use `$XDG_CONFIG_HOME/filer/config.json` for startup options such as mount point and logging. Use `~/.config/filer/config.json` when `$XDG_CONFIG_HOME` is unset, empty, or relative. Keep `--config` for an explicit path and CLI flags for per-run overrides. Use the same path resolver for startup and the config-related CLI commands. Check which existing launchers rely on a working-directory `config.json` and update those launchers to pass it explicitly or migrate the file with clear upgrade instructions. Folder visibility remains editable live through the mounted file on runtimes that expose it. [Current CLI defaults](../../../one.filer/src/misc/commandsHelper.ts) · [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/)

**Acceptance check.** On Linux, verify default resolution, a custom `$XDG_CONFIG_HOME`, `--config` precedence, and an existing service launch after upgrade. A malformed file should identify the path and fail before mounting.

## 4. Add `settings.windows` to the native ProjFS host

Target native Windows with `one.projfs`. The WSL2 integration is deprecated. [Native ProjFS bridge](../../../one.projfs/README.md) · [Projected File System API](https://learn.microsoft.com/en-us/windows/desktop/api/_projfs)

**Build the Windows host first.** No Windows host exists yet. `one.projfs` is a Node native addon, and its only integration example is the old `one.filer` `CombinedFileSystem` stack. Add a Filer Windows host:
- It runs or connects to the one `FilerRuntime` that owns the mounted instance and serves it through `IFSProjFSProvider`.
- It owns the notification area icon and menu.
- It carries settings calls to the runtime over a private channel, with no public listener.
- Choose the tray UI technology before building the window.
- Package it with an installer that enables or checks the ProjFS optional feature.
- Sign the binaries and the installer with an Authenticode code-signing certificate. Unlike the Apple setup, no Windows signing certificate is provisioned yet, so obtaining one is a prerequisite.

**Make settings changes visible in Explorer.** `IFSProjFSProvider` caches entries for 30 seconds (`cacheTTL`). Its only invalidation hooks today are for invites and tombstones. A folder Explorer has already opened also leaves placeholders on disk. When a folder's effective visibility changes, the host must:
- clear the provider cache for the affected path;
- delete placeholders for a folder that becomes hidden (`PrjDeleteFile`);
- re-enumerate the root for a folder that becomes visible (`PrjUpdateFileIfNeeded` where an entry already exists).

Without this, a hidden folder stays visible until the cache expires or the drive is remounted. [Current invalidation hooks](../../../one.projfs/IFSProjFSProvider.js)

Open the `settings.windows` window from the Filer notification area menu. Use the shared folder settings contract for the active mount. Keep Windows Settings links for OS-managed controls such as Startup Apps and Installed Apps. [Windows app settings](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings) · [Windows Settings links](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings)

**Acceptance check.** On a clean Windows machine, run the signed installer and confirm Windows reports a valid publisher. Open Files in Explorer so its entries are hydrated, then set Files to Hidden from the notification area. Explorer must stop showing it immediately, not after the 30-second cache expires, and without a remount. Set it back to Visible and confirm it reappears. Verify the mode persists when the settings window reopens. Apply an own-device edit and verify that the window and Explorer update. Stop the runtime and confirm that an attempted save reports the failure without changing persisted settings.

## 5. Add and sign the iOS Settings target

Add a Filer iOS app target to the Apple project unless an existing iOS host is designated. The project has only macOS targets today. Set its deployment target to iOS 18, where app settings live under **Settings → Apps**. If an earlier iOS must be supported, the controls appear directly in the Settings list instead, and the acceptance check covers both locations. Configure the target with the existing Apple Developer team and provision it for a physical iPhone. Embed a `Settings.bundle` in the iOS app. Share only the setting keys and value model with `settings.mac`, for example through a small Swift package. The Mac side has no `Settings.bundle` to reuse, so no UI is shared. Start with simple local preferences backed by `UserDefaults`. Apply changed values when the app becomes active. [Current Apple targets](../../../one.provider/project.yml) · [Apple development provisioning](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile/) · [Apple Settings bundles](https://developer.apple.com/documentation/foundation/building-a-settings-bundle-for-your-app)

Keep instance selection and live folder status in the app. Before exposing folder modes in iOS Settings, define how the phone owns or reaches its selected instance, and prove that the signed app can send changes to that runtime on foregrounding. If an iOS File Provider extension needs access to the same state, provision the app group for both targets and check access on the signed device build.

**Acceptance check.** Install the team-signed build on an iPhone. Verify that **Settings → Apps → Filer** shows the bundled controls (or **Settings → Filer** on any supported release before iOS 18), a changed preference takes effect when the app returns to the foreground, and the value persists across launches. For any preference used by an extension, verify that the signed extension reads the same value.
