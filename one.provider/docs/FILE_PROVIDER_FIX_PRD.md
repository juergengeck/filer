# Product Requirements Document: Fix macOS File Provider Implementation

**Status:** Draft
**Created:** 2025-10-20
**Author:** Technical Analysis
**Priority:** P0 - Critical (Blocking feature functionality)

---

## Executive Summary

The current macOS File Provider implementation fails to load with error codes -2001 (NSFileProviderErrorNotAuthenticated) and -2014 (NSFileProviderErrorProviderNotFound). This PRD outlines the root causes and required fixes to achieve a working File Provider extension that exposes ONE database content through macOS Finder.

---

## Problem Statement

### Current State
- File Provider extension is compiled and installed at `/Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex`
- Extension is registered with pluginkit (`com.one.filer.extension`)
- CLI tool exists but cannot list or interact with domains
- Error when attempting domain operations: "Das Programm kann gerade nicht verwendet werden" (The application cannot be used right now)

### Desired State
- Working File Provider extension that macOS can load and communicate with
- Ability to register/unregister domains via CLI
- Mounted filesystem visible in Finder at `~/Library/CloudStorage/OneFiler-<DomainName>`
- IPC bridge successfully connecting Swift extension to Node.js runtime
- ONE database content accessible through standard macOS file operations

---

## Root Cause Analysis

### 1. App Group Identifier Mismatch ❌ CRITICAL
**Impact:** Prevents extension from accessing shared configuration

**Current State:**
- Extension Info.plist: `NSExtensionFileProviderDocumentGroup = "group.com.one.filer"`
- Extension entitlements: `group.com.refinio.onefiler.mac`
- Host app entitlements: `group.com.refinio.onefiler.mac`
- Domain config location: `~/Library/Group Containers/group.com.refinio.onefiler.mac/domains.json`

**Issue:** The Info.plist declares a different App Group than what's in entitlements. macOS will reject access to the shared container.

**Required Fix:** All three locations must use the same identifier: `group.com.refinio.onefiler.mac`

### 2. Build System Incompatibility ❌ CRITICAL
**Impact:** SPM cannot properly build App Extensions with required bundle structure

**Current State:**
- Using Swift Package Manager (Package.swift)
- SPM builds a library target, not a proper `.appex` bundle
- Info.plist placed manually in Resources/
- No automatic entitlement application during SPM build
- No code signing configuration in SPM

**Issue:** App Extensions require:
- Specific bundle structure with `Contents/MacOS/` and `Contents/Info.plist`
- Extension point declaration in Info.plist embedded in bundle
- Proper code signing with entitlements
- Xcode-compatible provisioning profile handling

**Required Fix:** Migrate to Xcode project using XcodeGen to generate project from YAML spec

### 3. Missing Domain Registration ❌ BLOCKING
**Impact:** No domains exist for macOS to activate

**Current State:**
- `domains.json` exists in App Group container with 3 domain configs
- No domains registered with `NSFileProviderManager.add(domain)`
- CLI tool has registration code but it fails because extension won't load

**Issue:** Configuration file exists but macOS doesn't know about any domains. The extension won't be instantiated until a domain is registered.

**Required Fix:**
- Fix build system first (prerequisite)
- Run `onefiler register --name "ONE" --path "/tmp/one-test-instance"` to register domain
- Verify domain appears in `NSFileProviderManager.domains()`

### 4. Extension Info.plist Issues ❌ CRITICAL

**Current State:**
```xml
<key>NSExtension</key>
<dict>
    <key>NSExtensionFileProviderDocumentGroup</key>
    <string>group.com.one.filer</string>  <!-- WRONG -->
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.fileprovider-nonui</string>
    <key>NSExtensionPrincipalClass</key>
    <string>FileProviderExtension</string>
</dict>
```

**Issues:**
- Wrong App Group identifier
- Missing `NSExtensionFileProviderSupportsEnumeration` (optional but recommended)
- Missing `NSExtensionFileProviderDomainUsageDescription`

**Required Fix:** Update Info.plist with correct values

---

## Technical Requirements

### 1. Build System Migration

**Requirement:** Migrate from Swift Package Manager to Xcode project using XcodeGen

**Acceptance Criteria:**
- [ ] Create `project.yml` for XcodeGen
- [ ] Define three targets:
  - OneFilerHost.app (host application)
  - OneFilerExtension.appex (File Provider extension)
  - onefiler (CLI tool embedded in host app)
- [ ] Configure proper code signing for each target
- [ ] Configure App Group entitlements
- [ ] Support both Debug and Release configurations
- [ ] Maintain existing source file organization under `Sources/`

**Files to Create:**
- `project.yml` - XcodeGen specification
- `scripts/generate-xcode.sh` - Generate Xcode project
- `scripts/build-app.sh` - Build and install to /Applications

**Files to Update:**
- `.gitignore` - Ignore generated `OneFiler.xcodeproj`
- `package.json` - Add build:xcode, install scripts
- `README.md` - Update build instructions

### 2. Fix App Group Identifier

**Requirement:** Ensure consistent App Group identifier across all configurations

**Acceptance Criteria:**
- [ ] Update Extension Info.plist: `NSExtensionFileProviderDocumentGroup = "group.com.refinio.onefiler.mac"`
- [ ] Verify all entitlement files use `group.com.refinio.onefiler.mac`
- [ ] Update XcodeGen project.yml to reference correct App Group
- [ ] Verify extension can read from `~/Library/Group Containers/group.com.refinio.onefiler.mac/`

**Files to Update:**
- `Resources/Info.plist` (extension Info.plist template)
- `Resources/Extension.entitlements`
- `Resources/OneFiler.entitlements`
- `project.yml` (when created)

### 3. Extension Info.plist Enhancements

**Requirement:** Complete extension Info.plist with all required and recommended keys

**Acceptance Criteria:**
- [ ] Set `NSExtensionFileProviderDocumentGroup` to `group.com.refinio.onefiler.mac`
- [ ] Add `NSExtensionFileProviderSupportsEnumeration` = `true`
- [ ] Add `NSExtensionFileProviderDomainUsageDescription` with user-facing text
- [ ] Verify `NSExtensionPointIdentifier` = `com.apple.fileprovider-nonui`
- [ ] Verify `NSExtensionPrincipalClass` = `FileProviderExtension`

**Template:**
```xml
<key>NSExtension</key>
<dict>
    <key>NSExtensionFileProviderDocumentGroup</key>
    <string>group.com.refinio.onefiler.mac</string>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.fileprovider-nonui</string>
    <key>NSExtensionPrincipalClass</key>
    <string>FileProviderExtension</string>
    <key>NSExtensionFileProviderSupportsEnumeration</key>
    <true/>
    <key>NSExtensionFileProviderDomainUsageDescription</key>
    <string>OneFiler provides access to your ONE instance data as a native macOS filesystem</string>
</dict>
```

### 4. Domain Registration Flow

**Requirement:** Establish working domain registration via CLI

**Acceptance Criteria:**
- [ ] Build and install OneFiler.app with fixed extension
- [ ] Run `/Applications/OneFiler.app/Contents/MacOS/onefiler register --name "ONE-Test" --path "/tmp/one-test-instance"`
- [ ] Verify domain appears in `/Applications/OneFiler.app/Contents/MacOS/onefiler list`
- [ ] Verify domain config written to `~/Library/Group Containers/group.com.refinio.onefiler.mac/domains.json`
- [ ] Verify mount point appears at `~/Library/CloudStorage/OneFiler-ONE-Test/`
- [ ] Verify extension logs show initialization: "OneFiler Extension: init() called for domain: ONE-Test"

**Test Commands:**
```bash
# Register domain
/Applications/OneFiler.app/Contents/MacOS/onefiler register --name "ONE-Test" --path "/tmp/one-test-instance"

# Verify registration
/Applications/OneFiler.app/Contents/MacOS/onefiler list

# Check logs
log stream --predicate 'subsystem == "com.one.filer"' --level debug

# Verify mount
ls -la ~/Library/CloudStorage/OneFiler-ONE-Test/
```

### 5. Extension Loading Verification

**Requirement:** Confirm extension loads and initializes when domain is accessed

**Acceptance Criteria:**
- [ ] Extension process appears in Activity Monitor when Finder accesses domain
- [ ] Logs show "OneFiler Extension: init() called for domain"
- [ ] Logs show "OneFiler: Connected to ONE instance at /tmp/one-test-instance"
- [ ] No error logs with NSFileProviderError codes
- [ ] Bridge successfully spawns Node.js process
- [ ] IPC communication established between Swift and Node.js

**Verification:**
```bash
# Start log streaming
log stream --predicate 'subsystem CONTAINS "one" OR process CONTAINS "OneFiler"' --level debug &

# Trigger extension load
ls ~/Library/CloudStorage/OneFiler-ONE-Test/

# Check for extension process
ps aux | grep OneFilerExtension

# Verify Node.js IPC server running
ps aux | grep node-runtime
```

---

## Implementation Plan

### Phase 1: Build System Fix (P0 - Prerequisite for everything)
**Duration:** 2-4 hours

1. Create `project.yml` for XcodeGen
   - Define OneFilerHost.app target
   - Define OneFilerExtension.appex target
   - Define onefiler CLI tool target
   - Configure entitlements
   - Configure code signing

2. Create build scripts
   - `scripts/generate-xcode.sh` - Run xcodegen
   - `scripts/build-app.sh` - Build and install to /Applications

3. Update package.json scripts
   - `build:xcode` - Generate project and build
   - `install` - Install to /Applications
   - Keep existing `build` for TypeScript

4. Test build
   - Run `npm run build:xcode`
   - Verify OneFiler.app created
   - Verify extension bundle structure correct

### Phase 2: Fix App Group & Info.plist (P0)
**Duration:** 30 minutes

1. Update Info.plist template in `Resources/Info.plist`
2. Update entitlements files
3. Rebuild with `npm run build:xcode`
4. Verify with `plutil` and `codesign`

### Phase 3: Domain Registration (P0)
**Duration:** 1 hour

1. Install fixed OneFiler.app
2. Register test domain
3. Verify mount point appears
4. Check logs for extension initialization

### Phase 4: Integration Testing (P1)
**Duration:** 2-4 hours

1. Test full flow: register → mount → list files → read file
2. Test IPC bridge connection
3. Test error handling
4. Test unregister domain

---

## Success Metrics

### Critical Success Criteria
- [ ] `onefiler list` executes without error
- [ ] Domain registration succeeds
- [ ] Mount point appears in Finder
- [ ] Extension logs show successful initialization
- [ ] No NSFileProviderError codes in logs

### Quality Metrics
- [ ] Extension loads within 5 seconds of mount access
- [ ] IPC connection established within 2 seconds
- [ ] File enumeration works for root container
- [ ] Build completes in under 60 seconds

---

## Risks & Mitigations

### Risk 1: XcodeGen Learning Curve
**Probability:** Medium
**Impact:** Low (delays Phase 1 by few hours)
**Mitigation:** Reference existing XcodeGen projects (Dropbox, OneDrive use similar patterns)

### Risk 2: Code Signing Issues
**Probability:** Medium
**Impact:** High (blocks installation)
**Mitigation:** Use development signing for testing, document provisioning profile setup

### Risk 3: Extension Still Won't Load After Fixes
**Probability:** Low
**Impact:** High (would require architecture redesign)
**Mitigation:** Based on analysis, identified issues match documented Apple requirements exactly

### Risk 4: IPC Bridge Incompatibility
**Probability:** Low
**Impact:** Medium (would need redesign of bridge)
**Mitigation:** IPC code looks correct, issue is extension not loading

---

## Open Questions

1. **Q:** Should we support multiple simultaneous domains?
   **A:** Yes - design already supports this via domains.json, just needs testing

2. **Q:** What happens if Node.js is not in PATH?
   **A:** Bridge will fail to start - need to document Node.js requirement or bundle Node

3. **Q:** Should CLI be separate binary or embedded in .app?
   **A:** Embedded in .app at Contents/MacOS/onefiler (current approach is correct)

4. **Q:** Do we need a GUI for domain management?
   **A:** Not for MVP - CLI is sufficient. Can add later.

---

## Dependencies

### External
- XcodeGen (`brew install xcodegen`)
- Xcode 15+ with macOS 13+ SDK
- Valid Apple Developer certificate (for code signing)
- Node.js in PATH (for runtime)

### Internal
- `one.core` - TypeScript library (built)
- `one.models` - TypeScript library (built)
- `node-runtime/` - TypeScript IPC server (built)

---

## Documentation Updates Required

### README.md
- Replace "Build with `swift build`" with "Build with `npm run build:xcode`"
- Document XcodeGen requirement
- Update installation instructions
- Add domain registration examples

### Development Guide
- Explain XcodeGen project generation
- Document build target structure
- Explain code signing setup
- Troubleshooting section for common issues

---

## Appendix: Apple File Provider Requirements Checklist

Based on Apple's official File Provider documentation:

### Bundle Structure ✅
- [x] Extension has `.appex` suffix
- [x] Extension inside host app at `Contents/PlugIns/`
- [ ] Proper Info.plist at `Contents/Info.plist` (needs App Group fix)
- [x] Extension binary at `Contents/MacOS/`

### Info.plist Keys ⚠️
- [x] `CFBundleIdentifier` - com.one.filer.extension
- [x] `CFBundlePackageType` - XPC!
- [x] `NSExtensionPointIdentifier` - com.apple.fileprovider-nonui
- [x] `NSExtensionPrincipalClass` - FileProviderExtension
- [ ] `NSExtensionFileProviderDocumentGroup` - needs fix to match entitlements
- [ ] `NSExtensionFileProviderSupportsEnumeration` - should add
- [ ] `NSExtensionFileProviderDomainUsageDescription` - should add

### Entitlements ⚠️
- [x] `com.apple.security.app-sandbox` = true
- [ ] `com.apple.security.application-groups` = [group.com.refinio.onefiler.mac] (needs consistency check)
- [x] `com.apple.security.network.client` = true
- [x] `com.apple.security.files.user-selected.read-write` = true

### Swift Implementation ✅
- [x] Class conforms to `NSFileProviderReplicatedExtension`
- [x] Required init(domain:) implemented
- [x] item(for:request:completionHandler:) implemented
- [x] fetchContents(for:version:request:completionHandler:) implemented
- [x] enumerator(for:request:) implemented
- [x] Extension principal class matches Info.plist

### Domain Management ❌
- [ ] Domain registered with NSFileProviderManager.add()
- [ ] Domain configuration stored in shared container
- [ ] NSFileProviderManager can get manager for domain

---

## References

- Apple File Provider Framework: https://developer.apple.com/documentation/fileprovider
- NSFileProviderReplicatedExtension: https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension
- XcodeGen Documentation: https://github.com/yonaskolb/XcodeGen
- App Groups Entitlement: https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_application-groups
