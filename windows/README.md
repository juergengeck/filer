# Native Windows Filer

Filer runs as a per-user Windows desktop application using ProjFS. The window
provides settings, the shared Devices inventory, rename/forget actions, a visible
Refresh action, and recent filesystem errors. Closing the window keeps Filer in
the notification area; **Quit Filer** drains imports and reads before stopping
the ONE runtime. Unexpected exits are reported and require an explicit restart.

## Build a package

Build the canonical ONE/Fotos runtime and `one.projfs` first. On Windows x64 with
Node 22 and .NET Framework 4.8 installed:

```powershell
pnpm --dir ../one/packages/refinio.api build
pnpm --dir ../one/packages/refinio.api build:filer
pnpm --dir one.projfs build
npm --prefix windows ci
pnpm package:windows
```

The output is a fresh `dist/OneFiler-windows-x64-*` directory, unsigned ZIP and
adjacent `.zip.sha256` checksum file. Publish both files together. The ZIP contains
Node, the native addon, the compiled desktop host, runtime JavaScript, assets,
dependency licenses and a file-hash manifest. It contains no workspace links or
dependency on installed Node. `NODE_BINARY` may select a Windows x64 Node 22
binary; the build fetches that version's Node license. The Windows bundler emits
a standalone module because Windows ZIP distribution must not depend on the
workspace links used by development installs. macOS packaging remains separate.

## Install and run

Enable Windows' **Projected File System** optional feature (`Client-ProjFS`).
Compare the downloaded ZIP's SHA-256 with the checksum published by Refinio:

```powershell
Get-FileHash -LiteralPath .\OneFiler-windows-x64-<build>.zip -Algorithm SHA256
```

Extract the ZIP, open PowerShell in the extracted folder, and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
```

The execution policy option applies only to this installer process. Installation defaults
to `%LOCALAPPDATA%/Programs/Refinio Filer`, creates a Start menu shortcut, and
does not require administrator access after ProjFS is enabled. Pass
`-StartAtLogin` to add a per-user Startup shortcut. Automatic login startup is
off by default. No Windows service or WSL distribution is installed.

Run **Refinio Filer** from the Start menu. Enter your ONE email and password,
instance name, Files folder and communication server. Configuration is encrypted
with Windows DPAPI for the current Windows user in
`%LOCALAPPDATA%/Refinio/Filer/profile.dat`. Bootstrap credentials travel through a
private inherited pipe. Passwords and invitations are not written to log files.
ONE storage defaults to the profile's `storage` directory. A process-held lock
prevents two desktop hosts from opening the same profile.

The Devices view uses the authenticated canonical `devices` operations; it does
not create another inventory. Forgetting a device does not revoke access or
delete data. Pairing invitations remain available in `ONE/invites` through the
mounted filesystem. A dedicated invitation-paste UI is still release work.

Quit Filer before running the installed `Uninstall.ps1` with the same PowerShell
command, replacing `Install.ps1` with `Uninstall.ps1`. It removes listed
program files and shortcuts belonging to that installation, preserving profile,
storage, mount contents and unlisted files. For an upgrade, uninstall program
files and install the new package; the saved profile is reused on the next run.

Unsigned distribution is the current release policy; code signing is not a
release prerequisite. Users obtain packages and checksums directly from Refinio.
The archive checksum and installer manifest detect damaged or changed files;
publisher trust comes from the distribution channel. An upgrade UI remains
separate work.

## Verify a relocated installation

```powershell
node scripts/test-windows-package.mjs dist/OneFiler-windows-x64-<build>
```

The test installs to a temporary directory with spaces, provisions a disposable
DPAPI profile through stdin, boots the packaged runtime twice against a loopback
ONE server, checks Devices and native browsing, then exercises uninstall while
checking that unlisted files and credentials are preserved. It creates no Start
menu or Startup shortcuts. Linux/FUSE remains supported by the normal Unix build;
Windows packaging does not replace Linux build or Debian packaging code.
