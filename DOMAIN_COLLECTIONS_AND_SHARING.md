# Filer Domain Collections, Groups, Health, and Sharing

**Status:** architecture decision and implementation direction\
**Scope:** Filer, Fotos, Flexibel, Projektor, Glue identity, IoM, and shared ONE platform packages

## Decision

Filer is both a filesystem projection and a sharing surface.

It presents domain-owned data as folders and files, lets applications and users mutate writable data, and can initiate, change, and remove shares. Filer must not invent a second identity, group, or authorization model. A share initiated in Filer is executed by the service that owns the shared root and its policy.

The initial mounts are:

| Filer path | Canonical root | Sharing authority |
| --- | --- | --- |
| `/Dateien` | stable, versioned Filer folder roots | Filer sharing service |
| `/Freigaben` | Filer roots shared by other people | Filer sharing service |
| `/Bilder/<collection>` | `FotosCollection` | Fotos collection service using shared audience bindings |
| `/Gesundheit/<patient>` | StudyCenter-authorized Flexibel patient roots | StudyCenter credential, role, study, and care policy |

The displayed paths are views. Stable ONE IDs, not path components or display names, identify their roots.

## Goals

- Make a Fotos collection a real, versioned ONE object rather than JSON UI state.
- Give Fotos a share selector containing people and groups, plus an IoM shortcut.
- Show an accessible shared collection at `/Bilder/<collection name>` in Filer.
- Back the collection owner identity with the configured Glue-published `Person` ID.
- Reuse Projektor's living and pinned group semantics.
- Reuse Flexibel's canonical person/profile and clinical authorization semantics.
- Project accessible Flexibel health data under `/Gesundheit` without copying it into a second health store.
- Run Filer as an additional role-neutral instance in its operator's IoM.
- Let Filer present the operator's portable role credential and identity chain to the StudyCenter, which selects and shares the authorized patient roots.
- Let Filer create and share its own folders as first-class shared roots.
- Use normal IdAccess and CHUM traversal from one stable root; do not grant every child separately.

## Non-goals

- Filer does not become the owner of Fotos or clinical object schemas.
- Mounting data never widens access to it.
- A filename, path, profile label, `Someone`, or Glue handle is never treated as a canonical person identity.
- Filer does not depend on Flexibel's `one-experimental` tree. Shared implementation belongs in `../one`.
- The design does not maintain local JSON and typed ONE objects as two authoritative stores.

## Ownership boundaries

### Filer

Filer owns:

- filesystem paths and filesystem mutation semantics;
- the mount registry and projection lifecycle;
- its own versioned file and folder roots;
- share, unshare, and audience-selection UX;
- calling the correct domain operation when a user shares from the filesystem;
- exposing imported roots after their domain provider reports them.

Filer is therefore not read-only. For Filer-owned folders it is the data and sharing authority. For a Fotos or Flexibel root, it is an active client of that domain's operations.

Filer has no built-in clinical role. The same Filer runtime may be operated by a patient, doctor, therapist, StudyCenter member, or study admin. Its effective capabilities come only from the credentials synchronized into that Filer instance through the operator's IoM.

### Domain providers

Fotos, Flexibel, and future providers such as Projektor own:

- their semantic root objects and recipes;
- conversion between domain objects and files;
- validation of writes;
- authorization policy;
- how a requested share is materialized;
- semantic update events consumed by Filer.

### Shared ONE platform

Packages in `../one/packages/*` own the reusable mechanisms:

- versioned root and recipe conventions;
- `Person`, `Profile`, `Someone`, `Group`, and `HashGroup` models;
- audience binding and access materialization;
- IdAccess, CHUM traversal, channels, and runtime registration;
- the domain-provider contract used by Filer.

App-specific services are supplied through `ModuleRegistry`. Public cross-module actions are exposed through registered plans/operations. Filer must not reach into another application's private storage implementation.

## Filer as an IoM instance

Filer is an additional possible instance in a person's Internet of Me. It has its own `Instance` ID, but that `Instance` is owned by the same canonical `Person` as the operator's other authorized instances.

IoM synchronization supplies Filer with the operator's portable evidence, including:

- the current role credential bundle;
- the exact role chain of trust;
- the owner/identity credential evidence that binds the runtime owner and keys to the certified role subject;
- the StudyCenter endpoint and publisher identity needed to address a request.

Filer does not turn those objects into local authorization decisions. It presents them to the StudyCenter in a signed, patient-scoped access demand. The StudyCenter verifies the evidence and decides which data roots, if any, to share.

The request must bind all of these coordinates:

```ts
type PatientDataAccessDemand = {
    $type$: 'PatientDataAccessDemand';
    requesterOwner: SHA256IdHash<Person>;
    requesterInstance: SHA256IdHash<Instance>;
    publisherOwner: SHA256IdHash<Person>;
    roleSubject: SHA256IdHash<Person>;
    role: FlexibelRole;
    roleEvidence: SHA256Hash<RoleCertificateBundle>;
    identityEvidence: SHA256Hash<Assembly>;
    patient: SHA256IdHash<Person>;
    scope: 'patientData';
    requestedAt: string;
    nonce: string;
};
```

This is a Flexibel-owned, immutable ONE object. Filer's Flexibel provider stores it, signs its exact object hash with the IoM owner's credential, and sends the resulting `Signature` root to the StudyCenter. The recipe references the exact role bundle and identity-evidence Assembly, so recursive CHUM traversal carries the verification graph before the signed demand is handled. Filer's generic core sees only the domain-provider operation and does not import Flexibel platform internals.

The demand is authenticated, not merely imported. The StudyCenter verifies that:

1. the request signature or authenticated request context belongs to `requesterInstance`;
2. the current `Instance` object is owned by `requesterOwner`;
3. the exact identity CoT binds the request key/runtime owner to `roleSubject` where those IDs differ;
4. the role evidence is current, valid, unrevoked, and issued through the accepted StudyCenter chain;
5. `patient` is the canonical study person ID, not a `Someone`, runtime alias, or profile ID;
6. the role and current relationship authorize the requested patient and scope.

The data access target is the requester `Person`, not a bare device. Once the StudyCenter grants the canonical root to `requesterOwner`, normal IoM synchronization can deliver it to the Filer instance. `requesterInstance` remains required for request authentication, replay protection, audit, and device revocation.

The role matrix is:

| Presented role | Patient roots the StudyCenter may release |
| --- | --- |
| patient | the operator's own canonical patient root |
| doctor | patients with a current doctor/care assignment to that role subject |
| therapist | patients with a current therapist/care assignment to that role subject |
| StudyCenter member | patients managed within the member's certified StudyCenter scope |
| study admin | patients and administrative views within the certified study/admin scope |

There are no patient-, doctor-, therapist-, StudyCenter-, or admin-specific Filer binaries. An absent, expired, revoked, mismatched, or incomplete credential chain yields no clinical root.

## Common Filer domain provider

Filer should replace hard-coded domain assembly with a provider registry. The exact TypeScript shape can be settled during implementation, but the contract needs these capabilities:

```ts
type FilerDomainProvider = {
    readonly mountPath: string;
    listRoots(): Promise<readonly FilerDomainRoot[]>;
    subscribe(listener: (event: FilerDomainEvent) => void): () => void;
    resolve(rootId: string, relativePath: string): Promise<FilerNode>;
    readFile(rootId: string, relativePath: string): Promise<Uint8Array>;
    mutations?: FilerDomainMutations;
    sharing?: FilerDomainSharing;
};
```

The IDs in this boundary are branded hashes in code. String conversion only happens at the native filesystem/IPC boundary.

`mutations` is optional because some projections are intentionally read-only. `sharing` is a domain operation, not generic raw IdAccess access. The Filer-owned provider implements both directly; Fotos and Flexibel adapters delegate them to their domain services.

Provider update events are authoritative. Imported root versions or channel updates feed forward into path invalidation and File Provider/FUSE notifications. Filer must not recover correctness through startup scans, polling, or periodic rediscovery.

## Stable root rule

Anything that must remain shared while its contents change needs a stable, versioned ID object.

The rule is:

1. The root has deterministic identity fields.
2. Mutable state is stored in new versions of that root or objects reachable from it.
3. Access is granted to the root ID before publishing a new version that recipients must receive.
4. CHUM follows typed recipe references from the root to the content.
5. Child object hashes, current root versions, and individual BLOBs receive no duplicate static grants.

This applies equally to a Fotos collection and an independently shared Filer folder.

## Filer-owned data and sharing

The existing unversioned persistent filesystem root is not sufficient as the public sharing root. A shareable folder needs a versioned identity, conceptually:

```ts
type FilerFolder = {
    $type$: 'FilerFolder';
    owner: SHA256IdHash<Person>; // identity field
    folderKey: string;           // identity field, stable opaque value
    name: string;                // mutable presentation data
    tree: SHA256Hash<FilerDirectory>;
};
```

The exact tree recipes may evolve from the existing persistent filesystem recipes. The important boundary is that `owner + folderKey` identify the folder while rename and content changes create new versions without changing its ID.

A nested folder that becomes independently shareable is promoted to its own `FilerFolder` root. Sharing a raw directory object hash would pin the recipient to one immutable snapshot and cannot represent later edits.

The Filer share flow is:

1. Resolve the selected path to its stable Filer root, promoting a folder if necessary.
2. Let the user choose a person, a group, or IoM.
3. Store the canonical audience binding and validate that the caller owns or may share the root.
4. Materialize access on the stable root.
5. Publish the updated root when required.
6. Record disclosure evidence separately from the mutable access decision.

Own roots appear below `/Dateien`. Roots received from others appear below `/Freigaben/<owner>/<folder>`. Display-name collisions gain a short, deterministic suffix derived from the stable ID; the suffix is presentation only.

## Fotos collections

### Canonical object

Fotos currently treats collections as JSON UI state with random IDs and arrays of photo, cluster, and person identifiers. Replace that source of truth with a versioned object, conceptually:

```ts
type FotosCollection = {
    $type$: 'FotosCollection';
    owner: SHA256IdHash<Person>; // identity field
    collectionKey: string;       // identity field, stable opaque value
    name: string;
    entries: Set<SHA256IdHash<FotosEntry>>;
};
```

`name` is mutable and must not participate in identity. Renaming a collection changes the visible Filer path but preserves the collection ID and its shares.

`owner` is the configured Glue-published `Person` ID. It is not a Glue username, email address, profile name, or other mutable string. If Fotos has no configured Glue identity, creating or sharing a collection fails explicitly rather than silently selecting another identity.

Smart selection data such as face-cluster and person filters may remain useful local editing state. Before a collection is published to IoM or another audience, Fotos materializes the selected photos as concrete `FotosEntry` IDs. A receiver and Filer must never be required to resolve another device's local face-cluster IDs.

Each shared entry must lead through registered recipes to its original media BLOB. A local `sourcePath` is a locator, not transferable content. Enabling a share must ensure the original variant is materialized; missing content is an error.

### Fotos selector

The collection editor offers a multi-select audience control with:

- IoM toggle;
- people from the canonical Leute/Flexibel identity graph;
- groups using the same model as Projektor and Flexibel.

IoM is not a boolean field on `FotosCollection` and not a special collection index. It is a shortcut for a living binding to the canonical IoM `Group`.

People are stored as `Person` IDs. `Someone` is only a contact container. Labels and avatars come from typed `Profile` descriptions and endpoints. Clinical roles are labels or policy inputs on a person, never alternative person identities.

### Filer projection

An accessible collection is mounted as:

```text
/Bilder/<escaped collection name>/<photo filename>
```

The provider keys every lookup by `FotosCollection` ID and `FotosEntry` ID. Names are calculated presentation values. Duplicate filenames gain a deterministic short content-hash suffix. Files resolve to the original media variant BLOB; thumbnails remain metadata or preview resources rather than file contents.

The projection is writable only where Fotos defines a valid semantic operation. For example, deleting a photo from a collection may call `removeEntry`, while deleting the projected file must not delete the underlying photo unless Fotos explicitly defines that behavior.

### End-to-end Fotos flow

1. The user creates or edits a collection in Fotos.
2. Fotos stores a `FotosCollection` version using the Glue-backed owner and stable collection key.
3. Fotos ensures every selected entry reaches a transferable original BLOB.
4. The user selects IoM, people, or groups.
5. The Fotos sharing service stores the audience binding and pre-grants the stable collection root.
6. Fotos publishes the new collection version.
7. CHUM transfers the root and its reachable graph.
8. The receiving runtime imports the root and emits a semantic collection update.
9. Filer's Fotos provider invalidates `/Bilder/<collection>` and publishes native filesystem changes.

## Groups and audience bindings

Follow Projektor's separation of three concepts:

- `Group`: stable, versioned group definition.
- `HashGroup`: immutable, content-addressed exact member set.
- access assertion/binding: why and how a specific root is shared.

The common sharing service supports:

- **living binding** — reference the `Group` ID; effective recipients follow future group versions;
- **pinned binding** — reference an exact `HashGroup`; recipients remain the fixed roster.

IoM uses a living binding. Normal UI defaults to living group membership. A deliberate “freeze audience” action may create a pinned binding.

The access binding, the current access grants, and disclosure evidence are separate objects. Changing group membership updates living access materialization; it does not rewrite historical evidence. A pinned binding does not react to later group changes.

The exact current roster comes only from `HashGroup`. Do not copy a parallel member list into Fotos, Filer, or health objects. If concurrent `Group` versions cannot be resolved under the group's freshness policy, sharing fails visibly instead of selecting an arbitrary version.

An implementation may introduce a generic shared root-audience binding in `../one`. It must identify the stable shared root, issuer, audience (`Person`, living `Group`, or pinned `HashGroup`), binding mode, and authored time. It must not import Projektor's project-specific assertion into every domain.

## Flexibel health data

### Canonical source

Health data shown by Filer is the accepted clinical projection produced from roots explicitly released by the StudyCenter to the Filer operator. Relevant payloads currently include:

- diary entries;
- body temperature;
- WBC observations;
- spasticity assessments;
- questionnaire responses and attestations;
- clinical baseline assessments.

The StudyCenter release can include the exact accepted clinical evidence graph for existing history and the canonical patient-owned `patientData` channel topology for future feed-forward updates. Filer must not build a second health collection, scan all clinical objects, or copy records into a parallel persistent filesystem tree. The imported roots and their owning clinical projection are the source of truth.

Generic provider, health-record, and projection contracts belong in canonical packages under `../one`, including `health.core` where appropriate. The signed patient-data demand, StudyCenter fulfillment, and clinical policy are Flexibel-owned. The dependency direction is inverted: a Flexibel adapter implements the shared Filer contract; Filer never imports Flexibel's `one-experimental` platform tree.

### StudyCenter-backed source flow

1. Filer obtains the operator's current role and identity evidence through IoM synchronization.
2. The user selects or navigates to a canonical patient ID.
3. Filer authors and authenticates a patient-scoped health-data demand addressed to the managing StudyCenter.
4. The StudyCenter verifies the requesting Filer instance, requester owner, identity CoT, role evidence, requested patient, current study/care relationship, and requested scope.
5. The StudyCenter rejects the request or releases the exact authorized clinical graph and future update roots to the requester owner.
6. CHUM transfers those roots to the requester's IoM.
7. The Filer instance's clinical import handler advances the accepted health projection.
8. The Flexibel health provider invalidates only the affected path below `/Gesundheit`.

Filer does not discover patients by querying an unrestricted StudyCenter directory. Its visible patient set is the set for which the StudyCenter has released authorized roots, optionally preceded by an equally credential-gated patient index for roles allowed to browse managed patients.

### Health path

The initial projection is:

```text
/Gesundheit/<patient profile name>/Tagebuch/
/Gesundheit/<patient profile name>/Temperatur/
/Gesundheit/<patient profile name>/Blutbild/
/Gesundheit/<patient profile name>/Spastik/
/Gesundheit/<patient profile name>/Fragebögen/
/Gesundheit/<patient profile name>/Baseline/
```

Internally, the patient segment is keyed by the canonical patient `Person` ID and, where needed, the study context. The visible segment is a profile-derived label. Collisions gain a deterministic ID suffix; hashes are never used as the ordinary display label.

File representation for each payload must be deterministic and typed. The first implementation can be read-only, but writable files must map to explicit Flexibel plans with validation and audit semantics; generic JSON replacement is not an acceptable clinical write path.

### Health sharing

Flexibel already models patient, care-provider, StudyCenter, study, and active-care relationships. The StudyCenter uses those projections to decide whether a demand is valid and which stable roots to release. Preserve that policy.

Filer may offer “Request access” or “Share” for health data, but the action submits a signed demand to the StudyCenter. Flexibel validates the requester instance, requester owner, certified role subject, role, CoT, relationship, consent, patient, and target audience, then changes access on the appropriate canonical roots. Filer must not directly manufacture raw grants that bypass those checks.

The people/group picker follows the same canonical identity and group UI as Fotos and Projektor. Availability in the picker is not authorization: the StudyCenter remains responsible for accepting or rejecting the requested share. A StudyCenter or study-admin operator may have broader scope, but only because the presented credential and policy grant it.

## Access, synchronization, and revocation

For every domain:

- grant access to the stable root before publishing content that depends on the grant;
- let CHUM traverse all referenced objects and BLOBs through registered recipes;
- do not grant both the ID and its current object version;
- do not add grants to every descendant as a propagation workaround;
- subscribe to imported semantic roots/channel updates and feed them into Filer;
- fail on missing recipes, missing original media, invalid roots, or unresolved identity.

Removing a share stops access to future versions and future synchronization. It cannot guarantee deletion of immutable bytes already received by another device. The UI and disclosure record must state this accurately.

## Runtime and recipe registration

Every participating runtime registers the full recipe aggregate before reading, writing, or syncing these roots:

- shared ONE models and group/audience recipes;
- Filer root and tree recipes;
- Fotos collection, entry, media, and sharing recipes;
- health and Flexibel channel payload recipes needed by the provider.

Reverse-map declarations from packages are combined by union. One package must not overwrite another package's registration. Aggregate ownership should live at the application composition boundary, while package recipes remain exported by their owning packages.

## Migration

### Fotos

1. Read each legacy JSON collection once.
2. Preserve its UUID as `collectionKey` when valid; otherwise create one stable key and record the migration.
3. Resolve the configured Glue-published owner `Person` ID.
4. Resolve concrete `FotosEntry` IDs and ensure original BLOBs exist.
5. Store the first `FotosCollection` version.
6. Replace JSON collection state as the authority; do not dual-write.

Local smart-filter editing metadata can remain local, but the published membership is the typed collection root.

### Existing Filer roots

1. Load the legacy persistent filesystem root once.
2. Create a versioned owner/root-key identity that references the existing tree.
3. Store future changes through the versioned root.
4. Remove the compatibility read path after migration; do not keep a permanent fallback or startup scan.

## Privacy and safety invariants

- Mounting is never equivalent to sharing.
- A domain provider lists only roots already accessible to the local identity.
- Sharing always requires an explicit user action or an explicit domain policy event.
- Health authorization cannot be weakened by a generic group grant.
- Paths and filenames are escaped for the host platform and cannot traverse mount boundaries.
- Logs contain stable IDs only when required for diagnosis and do not log health payloads or media content.
- A failed share leaves no partially published root version claiming a recipient has access.

## Acceptance tests

### Shared mechanics

- Renaming a shared root changes its path but not its ID or audience binding.
- Sharing grants only the stable root; recipients receive all recipe-reachable content.
- Missing recipe registration fails before publication.
- Imported root events update Filer without polling or full-store scans.
- Duplicate display names map to stable, collision-free paths.

### Filer

- A folder created in `/Dateien` can be shared with a person, group, or IoM.
- A recipient sees the incoming root in `/Freigaben` and reads its bytes.
- Later edits arrive through the same root ID.
- Unsharing prevents future versions from arriving.
- Independently sharing a nested folder creates a stable folder root rather than granting a directory hash.

### Fotos

- A legacy collection migrates once and preserves its collection key.
- A rename keeps the same `FotosCollection` ID.
- IoM shares the collection to another instance of the same person.
- A receiver reads bytes whose hash equals the source original BLOB.
- Living group membership changes update effective access; pinned membership does not.
- Face-cluster IDs never appear as remote collection membership.

### Flexibel

- Filer is registered as an additional instance of the operator's IoM.
- The same binary works for patient, doctor, therapist, StudyCenter, and study-admin operators.
- A health demand binds the requester owner, requester instance, role subject, exact role evidence, exact identity CoT, canonical patient, StudyCenter publisher, nonce, and scope.
- The StudyCenter rejects a demand from a foreign instance even if it names a valid role bundle.
- The StudyCenter rejects expired, revoked, incomplete, or mismatched role/identity evidence.
- A patient receives only the patient's own canonical root.
- A doctor or therapist receives only roots covered by current care assignments.
- StudyCenter and admin credentials receive only roots inside their certified organizational/study scope.
- Filer shows only roots actually released to the local IoM identity.
- Patient labels come from the correct canonical person's profile.
- A clinical share requested in Filer goes through StudyCenter fulfillment.
- A person in the picker without a valid clinical relationship is rejected when policy requires that relationship.
- No health payload is copied into a second Filer-owned object tree.

## Delivery sequence

### Current first-slice status (2026-09-02)

Implemented:

- Flexibel owns the immutable `PatientDataAccessDemand`, detached Signature authentication, exact requester-Instance ownership check, StudyCenter-authored owner-credential Assembly verification, current role verification, role-specific patient scope checks, and a durable nonce claim.
- Cube, browser, and Expo route imported Signature roots to the same Flexibel StudyCenter fulfillment handler. Unsigned demand objects remain inert.
- Authorized fulfillment reuses the existing patient clinical Assembly publication for history and the canonical patient channel topology for future updates.
- Flexibel supplies a `FlexibelHealthDataSource` from its verified feed-forward clinical projection; it neither scans storage nor exposes unverified facts.
- Filer accepts the source through a role-neutral adapter boundary and mounts a read-only `/Gesundheit/<patient>/<domain>/<entry>.json` view. Filer does not import Flexibel or `one-experimental`.

Still required for the complete vertical test:

- the Filer-side operation that selects its portable role/identity cuts, authors and signs the demand, and publishes that exact Signature root to the managing StudyCenter;
- composition wiring that supplies the Flexibel adapter to a running Filer IoM instance;
- a four-instance protocol test proving one accepted patient graph, one rejected foreign Filer Instance, feed-forward projection into `/Gesundheit`, and revocation behavior.

1. Add shared domain-provider and credential-backed health-demand contracts to `../one`.
2. Implement the Flexibel StudyCenter demand verifier and exact-root release operation.
3. Register Filer as an IoM-capable instance and synchronize the operator's portable role/identity evidence.
4. Add the Flexibel accepted-clinical-data provider and `/Gesundheit` projection.
5. Replace the legacy Filer root with stable, versioned shareable folder roots.
6. Add Filer's `/Dateien` and `/Freigaben` providers and sharing operations.
7. Add typed `FotosCollection`, one-time JSON migration, the people/group/IoM selector, and `/Bilder` projection.
8. Add pinned-audience and disclosure-history UX after living bindings are proven end to end.

The first vertical slice should use a patient-operated Filer instance in that patient's IoM. It presents current patient-role and identity CoT evidence to the managing StudyCenter, receives one exact clinical evidence graph, and renders one JSON file under `/Gesundheit/<patient>`. The negative companion test uses the same role bundle from a foreign Filer instance and must receive no root. That validates IoM identity, credential carriage, StudyCenter policy, exact-root release, CHUM, provider events, and native filesystem projection before broadening the role matrix.
