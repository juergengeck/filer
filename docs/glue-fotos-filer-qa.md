# Glue, Fotos, and Filer integration QA

The [12 September file-sharing trace](file-sharing-trace.md) attributes first-share
latency and records the native File Provider registration failure and recovery.

Native QA reports and authenticated file-sharing receipts are browsable in
`ONE/System/Journal`. QA retains `qa-<runId>.json` for each terminal run, including
failed and cancelled runs, and updates the same run atomically. The former single
`qa-reports/latest.json` is relocated there on the first upgraded runtime opening.
The journal is read-only and survives application restart.

Filer owns an embedded `filer-test-runner` plan, following Flexibel's four-instance runner pattern. The participants are a production Glue registrar, Alice's Fotos app, Bob's Filer app, and Charlie's Fotos app. Charlie pairs with Alice but receives no collection grant.

The runner calls application operations. Fotos imports through its normal photo pipeline, edits real collections, and commits the same share operations as its UI. Bob reads the production `/Fotos` filesystem. Collection addresses use the shared filesystem helper (stable collection ID plus issuer). No test process fabricates identity certificates, storage objects, or receiver snapshots.

## Run from Filer

Start the registrar and two separate Fotos browser profiles with independent storage. Configure both Fotos apps to use that registrar and communication relay, including the registrar's trusted system key. Use disposable app instances: the protocol registers identities, imports photos, creates a collection, pairs participants, and changes its grants. Older Fotos indexes without exact `data-size-bytes` metadata must be re-ingested; rounded display sizes are not accepted as byte counts.

For unattended runs in an actively rebuilt workspace, finish the shared-package builds first, then start each Fotos server with `pnpm dev:qa 5383` (and `5384` for the second actor) from `fotos.browser/browser-ui`, using the same registrar/relay environment as normal development. This keeps the app-owned HTTP/HMR operation transport while disabling automatic file-watch reloads and separating optimizer caches per port. The QA launcher sets the null watch option after Vite configuration resolution, since Vite discards null values during config merging. Restart these QA servers after changing code. Normal `pnpm dev` retains live file watching.

Obtain the exact Fotos client IDs from each development server's `GET /api/clients`. An explicitly selected unknown client is an error; the bridge never substitutes its active tab.

In the Filer menu, select the domain's **Run Integration Test…** action and open a JSON configuration:

```json
{
  "glueApiBase": "http://127.0.0.1:19101",
  "alice": {
    "apiBase": "http://127.0.0.1:5381",
    "clientId": "ALICE_CLIENT_ID"
  },
  "charlie": {
    "apiBase": "http://127.0.0.1:5382",
    "clientId": "CHARLIE_CLIENT_ID"
  },
  "timeoutMs": 60000
}
```

Use the same relay in Filer's domain configuration. Optional `bobDisplayName`, per-browser `displayName`, and `collectionName` override generated names. Existing Fotos identities retain their prepared name. Optional `fixtures` is exactly two objects containing `name`, `mimeType`, `bytesBase64`, and optional `lastModified`; defaults are valid, distinct PNGs generated for the run. Include a JPEG when testing the distinction between Fotos content identity and the original byte digest.

The menu receives pushed step changes, provides Stop, and saves the completed JSON report. The runtime also persists the latest report in its storage directory at `qa-reports/latest.json`. Local runtime replacement retains the same Person and Instance identities and rebinds app operations.

## Inspect the actual Finder domain

The installed signed host supports a separate persistent QA domain on the same test relay:

```bash
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost \
  --register-domain 'Filer QA' --email bob-native-qa@filer.local \
  --comm-server ws://127.0.0.1:19100
/Applications/OneFiler.app/Contents/MacOS/OneFilerHost \
  --qa-domain 'Filer QA' runFullProtocol < /absolute/path/configuration.json
```

Set `pauseBeforeRevocation: true` in the configuration to stop after step 9 with the remaining photo still shared. This is a running inspection checkpoint, not a passed result. Open the domain's Fotos folder in Finder and hydrate the original to verify actual File Provider bytes. The menu's **Finish Revocation Test** action, or `--qa-domain 'Filer QA' resume`, completes revocation and the subsequent reload/regrant check. **Save Integration Report…** saves the completed steps and current snapshot while paused; it explicitly lists both remaining checks. `getStatus` is a short read; observers should use a bounded deterministic watcher and emit changed progress only.

Domain-specific relay settings are persisted alongside the identity. Existing domains retain their default relay and cannot be silently retargeted. The CLI uses the signed host's authenticated private socket, and the native menu uses the same runtime as Finder.

`--qa-domain 'Filer QA' getDiagnostics` reads current CHUM/projection evidence, and `getFotosSnapshot` reads the live receiver collection paths and byte digests. Both use the current domain runtime rather than the terminal run's saved report.

For a focused membership latency measurement, `--qa-domain 'Filer QA' waitForFotos < expected.json` observes the production projection through the same signed transport. Supply `collectionPath`, exact `files: [{name, sha256}]`, and `timeoutMs` (or `absent: true` for revocation). This waits on projection events. Measure from the sender's membership operation through this completion, then verify the original bytes through the File Provider mount separately; a completed projection does not imply Finder has enumerated the new path yet.

## Protocol coverage

1. Discover and await the explicitly selected Fotos app handlers.
2. Prepare/register actual identities with Glue; verify Person signing-key certificate binding and separate device identities.
3. Pair Alice with Bob and Charlie; assert pairing alone leaves content unshared.
4. Import two photos and create a collection containing the first.
5. Share with Bob; verify projected names and original bytes.
6. Add the second photo and await the receiver change.
7. Remove the first; verify its old path is unreadable.
8. Replace Filer's runtime offline; verify exact persisted identity, keys, and remaining original bytes.
9. Resume networking, explicitly demand Alice’s persisted peer route, and verify the projection.
10. Revoke Bob; await disappearance and reject reads through the old path. Check Charlie remains unauthorized throughout.
11. Reload Alice, restore Bob's grant, reconnect, and verify the remaining original photo again. The completed run leaves this verified share available for inspection.

The embedded protocol covers the native host's private IPC and production filesystem projection. Finder enumeration and hydration are verified separately using the installed app and a persistent domain; the isolated XCTest runtime alone cannot establish that Finder displays the result.

## Ownership and automation

Shared Filer implementation lives in `../one/packages/refinio.api/src/filer/`, with reusable profiling and event-backed observation in canonical `../one/packages/qa.protocol`. The higher-level `qa.core` re-exports these utilities; API depends only on the leaf package because `qa.core` itself consumes API validators. Optional diagnostics enter through a host-supplied result contract. Fotos owns its `fotos-qa` surface and HTTP/HMR dispatch. The native menu talks to its already-owned runtime through private IPC. The native composition injects `node-fetch` for HTTP because its `--jitless` launch disables the WebAssembly parser used by built-in fetch; runtime packaging verifies both the actual Filer module graph (`--check-runtime`, without opening an instance) and a real loopback HTTP request under those launch flags. Filer explicitly requires the API's optional Fotos peer; unrelated platform optionals remain excluded. The runner uses existing OperationRegistry composition; `orchestration.core` is not needed for this protocol.

Public runner methods are `runFullProtocol`, `getStatus`, `stop`, `resume`, `waitForCompletion`, `getProtocolReport`, and `getInspectionReport`. Native UI uses pushed completion rather than a long blocking `waitForCompletion` request. Observer waits have deadlines and cancellation; local model lifecycle operations and accepted browser mutation requests settle before cancellation completes. Runner controls remain available during model replacement. Diagnostics and report-write failures become terminal failures rather than leaving an active run stuck.

The native XCTest entrypoint runs the same embedded protocol against explicit app actors:

```bash
FILER_QA_CONFIGURATION=/absolute/path/configuration.json \
FILER_QA_COMM_SERVER=ws://127.0.0.1:19100 \
ONE_FILER_TEST_NODE=/absolute/path/node \
ONE_FILER_TEST_ENTRY=/absolute/path/refinio.api/dist/src/filer/stdio-main.js \
ONE_FILER_TEST_PRELOAD=/absolute/path/filer/one.provider/scripts/console-to-stderr.cjs \
swift test --package-path one.provider \
  --filter FilerQARuntimeTests.testGlueFotosFullProtocol
```

The test writes `filer-protocol-report.json` alongside the configuration and fails unless the embedded runner passes. `testIdentityAndFilesSurviveOfflineRuntimeRestart` separately checks private IPC, identity/key continuity, and retained `/Files` bytes without Fotos participants. Build shared packages before running against `dist`.

To test the packaged runtime and run the native regression suite together, use the existing connection-test entrypoint after packaging:

```bash
FILER_QA_CONFIGURATION=/absolute/path/configuration.json \
FILER_QA_COMM_SERVER=ws://127.0.0.1:19100 \
npm --prefix one.provider run test:connection
```

This entrypoint selects the Node binary, API entrypoint, and preload from `one.provider/build/native-runtime`. Obtain the disposable registrar's current public key from `GET /api/registration/authority/publicKey` when configuring the Fotos actors; a previous session's authority key is not a substitute for the current binding.

## Recorded live validation

The focused [before measurement](qa-evidence/glue-fotos-filer-latency-before-2026-09-12.json) took **6.607 seconds** to project a membership addition and **7.340 seconds** to read the new file through File Provider. With the receiver fix alone, the [same-collection measurement](qa-evidence/glue-fotos-filer-latency-receiver-2026-09-12.json) took **349 ms** for projection and **351 ms** for native bytes. Its projection rebuild fell from **6,217 ms to 10 ms**. After explicitly restarting Fotos with both fixes and retaining the additional regression collection, the [final measurement](qa-evidence/glue-fotos-filer-latency-final-2026-09-12.json) took **708 ms** for addition projection, **710 ms** for native bytes, and **505 ms** for removal/native bytes. These are individual observed runs, not percentile guarantees.

The [final installed-native performance protocol](qa-evidence/glue-fotos-filer-native-performance-final-2026-09-12.json) passes all **11 stages and 52 assertions**, including revocation, offline persistence, and reload/regrant. Added-photo receiver wait is **668 ms**, removal **467 ms**. Cold operations remain expensive: initial sharing waits **10.179 seconds**, offline runtime restart plus projection takes **12.664 seconds**, and revocation waits **5.308 seconds**. The preceding [receiver-only protocol](qa-evidence/glue-fotos-filer-native-receiver-performance-2026-09-12.json) also passed, in 34.969 seconds versus 79.341 seconds for the final run; shared workspace builds and retained test graph size make whole-run timings variable.

Filer now waits for the trust owner's pending updates instead of rescanning every profile and right before every signature check. Immutable signature results survive content changes and are cleared on trust, profile, or committed contact changes. Revocation still selects the current certificate head and invalidated in-flight reads are discarded. Fotos publishes only the selected collection members and skips durable unchanged entries; it checks originals, thumbnail content, metadata, and requested authorship before doing so. Failed publication remains retryable, including after reload. The native runtime still runs with `--jitless`.

Receiver validation passed 123 Fotos core tests, 38 Filer API tests, and 9 trust-owner tests, including actual contact removal and in-flight trust invalidation; independent review found no remaining issues. Fotos browser passed all 195 tests, type checking, and production build. The signed CLI mapping test passed; two unrelated environment-dependent IPC tests were skipped, while the installed-native protocol exercises the real IPC path.

The expanded [installed-native reconnect report](qa-evidence/glue-fotos-filer-native-reconnect-2026-09-12.json) passes **11 stages and 54 assertions**, including Alice reload and regrant, in **116.019 seconds**. The [Finder byte proof](qa-evidence/glue-fotos-filer-finder-reconnect-proof-2026-09-12.json) verifies the remaining 2,688-byte JPEG through the actual File Provider mount; Finder also displayed its rose preview. The originally stuck share recovered too, with its own [restored byte proof](qa-evidence/glue-fotos-filer-finder-restored-proof-2026-09-12.json). Both shares remain available in the persistent Filer QA domain.

That earlier expanded run observed a **5.093-second** added-photo receiver wait, versus 11.294 seconds in the preceding packaged run. Initial sharing took 27.680 seconds to reach the receiver. Concurrent workspace builds and older QA instances affected that session, so those are observed timings, not a controlled benchmark. Obsolete owned QA browsers were closed; the final Alice and unauthorized Charlie remain in separate origins in the inspection browser.

The new stage exposed a [reload-readiness regression](qa-evidence/glue-fotos-filer-native-reload-regression-2026-09-12.json): Fotos announced readiness before its persisted photo source and collection members had hydrated. Readiness now follows that restoration boundary. Reconnect testing also repaired the stale initial-disabled policy in `one.models`: separate committed membership sets receive group deltas before route activation, while unsaved or failed explicit-blacklist edits cannot unblock a peer.

The earlier [installed-native report](qa-evidence/glue-fotos-filer-native-2026-09-12.json) passes all ten stages and 47 assertions in **46.779 seconds** with the sender and receiver fixes. Its added-photo receiver wait was **2.688 seconds**, member removal 1.832 seconds, and recipient revocation 3.692 seconds. That report predates the explicit reload/regrant stage.

The installed native app now has a separate Finder inspection path. The [inspection report](qa-evidence/glue-fotos-filer-native-inspection-2026-09-12.json) and [File Provider byte proof](qa-evidence/glue-fotos-filer-finder-proof-2026-09-12.json) cover the first nine stages and a hydrated 2,688-byte JPEG. This run reduced the photo-add receiver wait from 11.294 to 4.178 seconds. Its subsequent [revocation regression report](qa-evidence/glue-fotos-filer-native-regrant-regression-2026-09-12.json) correctly failed: Fotos issued an active certificate 640 ms after its revocation. That evidence drove the desired-recipient ownership fix described below; the inspection report is not a full-protocol pass.

Fotos serializes publications per scope, coalesces identical in-flight requests, and distinguishes explicit recipient assignments from background content refreshes. A stale refresh cannot override an explicit desired recipient set. Filer shares one verified projection across reads and invalidates it on authoritative content/trust events; reads that overlap revocation recheck the current generation before returning bytes. Projection counters describe the current runtime generation, so an offline restart resets them.

The [2026-09-12 packaged-runtime report](qa-evidence/glue-fotos-filer-packaged-2026-09-12.json) verifies the final `qa.protocol` package layout: all ten stages and 47 assertions passed in 68.729 seconds, and the reconnected CHUM session reported zero errors. All eight native tests passed with no skips. The slowest receiver wait was **11.294 seconds**, for Bob to observe the added second photo; its whole protocol stage took 13.145 seconds.

The [2026-09-11 report](qa-evidence/glue-fotos-filer-2026-09-11.json) records all ten stages passing with 47 assertions in 29.35 seconds. The run used independent real Fotos browser contexts, a production Glue registrar and relay, and the native Filer host's `--jitless` runtime. Fixtures were a 14,320-byte PNG and a 2,688-byte JPEG. The reconnected CHUM session reported zero errors after revocation.

The live test exposed and drove fixes to product contracts: original photo BLOB publication, exact index byte sizes, replacement of stale concrete manifest entries, and access-manager reachability. Revoking a manifest now removes its exclusively authorized descendants while preserving the retained certificate chain and shared descendants. Exact-object authority remains separate from identity-wide version authority; asynchronous traversal cannot restore revoked grants.
