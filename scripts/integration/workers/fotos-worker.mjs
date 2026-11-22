import '@refinio/one.core/lib/system/load-nodejs.js';
import {FilerRuntime} from '@refinio/api/filer';
import {FotosFileSystem, getOwnedFotosManifestId, readFotosOriginal} from '@refinio/fotos.core/filesystem';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {ensureIdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {getOneWorkspaceDir} from '../../../test-support/one-workspace-paths.js';
import {createHeldReleasePlan} from '../held-release.mjs';

const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const {buildTagShareCut, createContentTagBinding,
  createContentTagDefinition, createContentTagSetDefinition, makeCategoryTagId, makeTimeTagId,
  makePlaceTagId, makePersonTagId} = await import(pathToFileURL(join(one, 'packages/tag.core/dist/index.js')).href);
let runtime;
let fotos;
let source;
let deferred;
let cleanup = [];

/** Host Fotos production intake and signed releases on the shared CHUM runtime. */
async function start(config) {
  runtime = new FilerRuntime(config);
  await runtime.init();
  const owner = getInstanceOwnerIdHash();
  fotos = new FotosFileSystem(getOwnedFotosManifestId(owner), true);
  await fotos.init();
  source = await fotos.getRootId();
  cleanup = [
    runtime.getConnectionsModel().pairing.onPairingSuccessCommitted.listen(
      (_initiated, _localPerson, _localInstance, person) => process.send({event: 'paired', person})),
    runtime.getAssemblyPlan().onAssemblyAccepted.listen((assembly, origin, observation) => {
      const type = assembly.object.$type$;
      if (type === 'GraphReleaseState' || type === 'GraphReleaseSelectionHead') {
        process.send({event: 'assemblyAccepted', hash: assembly.hash, type, origin,
          selection: assembly.object.selection, status: assembly.object.status,
          currentCut: assembly.object.currentCut, newlyAccepted: observation.newlyAccepted});
      }
    })
  ];
  return {owner, instance: getInstanceIdHash(), source};
}

/** Require fixture labels that remain single native filesystem components. */
function requiredLabel(value, field) {
  if (typeof value !== 'string' || !value.trim() || /[/\\\0]/.test(value) || value === '.' || value === '..') {
    throw new Error(`Fotos ${field} must be a non-empty path component`);
  }
  return value;
}

/** Import exact originals, then pin saved folders, labels, and approved bindings. */
async function publish({audience, selection, label, photos}, releases = runtime.getAssemblyReleasePlan()) {
  ensureIdHash(audience);
  requiredLabel(selection, 'selection');
  requiredLabel(label, 'label');
  if (!Array.isArray(photos) || photos.length === 0) throw new Error('Fotos publication requires photos');
  const names = new Set();
  for (const photo of photos) {
    requiredLabel(photo.name, 'filename');
    if (names.has(photo.name)) throw new Error(`Duplicate Fotos filename: ${photo.name}`);
    names.add(photo.name);
    if (typeof photo.content !== 'string' || !photo.content ||
      Buffer.from(photo.content, 'base64').toString('base64') !== photo.content) {
      throw new Error(`Fotos content must be canonical non-empty base64: ${photo.name}`);
    }
    if (photo.time !== undefined) makeTimeTagId(photo.time);
    if (photo.place !== undefined) makePlaceTagId(requiredLabel(photo.place, 'place'));
    if (photo.person !== undefined) {
      makePersonTagId(photo.person.id);
      requiredLabel(photo.person.name, 'person name');
      if (typeof photo.person.approved !== 'boolean') throw new Error('Fotos person approval must be explicit');
    }
  }
  const definitions = new Map();
  const bindings = new Map();
  const targets = new Set();
  const entries = [];
  const category = makeCategoryTagId('pictures');

  /** Persist real tag versions; the production builder decides canonical inclusion. */
  async function bind(target, tagId, tagLabel, sourceKind, approved = true) {
    const previous = definitions.get(tagId);
    if (previous && previous.definition.label !== tagLabel) throw new Error(`Conflicting Fotos tag label: ${tagId}`);
    if (!previous) {
      const definition = createContentTagDefinition({id: tagId, slug: tagId, label: tagLabel});
      const stored = await storeVersionedObject(definition);
      definitions.set(tagId, {hash: stored.hash, definition});
    }
    const binding = createContentTagBinding({targetRef: target, targetRefKind: 'hash', targetObjectType: 'FotosEntry',
      tagId, sourceKind, sourceRef: source,
      approvalStatus: approved ? 'approved' : 'pending'});
    const stored = await storeVersionedObject(binding);
    if (!bindings.has(tagId)) bindings.set(tagId, []);
    bindings.get(tagId).push({hash: stored.hash, binding});
  }

  for (const photo of photos) {
    const bytes = Uint8Array.from(Buffer.from(photo.content, 'base64'));
    await fotos.importFile(photo.name, bytes.buffer);
    const {obj: manifest} = await getObjectByIdHash(source);
    let imported;
    for (const hash of manifest.entries) {
      const entry = await getObject(hash);
      if (entry.sourcePath === photo.name) {
        if (imported) throw new Error(`Ambiguous Fotos source path: ${photo.name}`);
        imported = {hash, entry};
      }
    }
    if (!imported) throw new Error(`Fotos import did not publish ${photo.name}`);
    const {content} = await readFotosOriginal(imported.entry);
    if (!Buffer.from(content).equals(Buffer.from(bytes))) throw new Error(`Fotos stored original differs: ${photo.name}`);
    targets.add(imported.hash);
    entries.push({name: photo.name, hash: imported.hash,
      blobHash: createHash('sha256').update(Buffer.from(content)).digest('hex')});
    await bind(imported.hash, category, 'Bilder', 'manual');
    if (photo.time !== undefined) await bind(imported.hash, makeTimeTagId(photo.time), photo.time, 'imported');
    if (photo.place !== undefined) await bind(imported.hash, makePlaceTagId(photo.place), photo.place, 'imported');
    if (photo.person !== undefined) await bind(imported.hash, makePersonTagId(photo.person.id),
      photo.person.name, 'suggested', photo.person.approved);
  }
  // The include cycle exercises the production builder's visited-set boundary.
  // Only the collection is a root folder; included sets pin the axis definitions.
  const rootId = `fotos:collection:${selection}`;
  const axisId = `${rootId}:axes`;
  const sets = new Map();
  for (const definition of [
    createContentTagSetDefinition({id: rootId, label,
      selector: {allOf: [category], unionOfSets: [axisId]}}),
    createContentTagSetDefinition({id: axisId, label: 'Fotoachsen',
      selector: {anyOf: [...definitions.keys()].filter(tagId => tagId !== category), unionOfSets: [rootId]}})
  ]) {
    const stored = await storeVersionedObject(definition);
    sets.set(definition.id, {hash: stored.hash, definition});
  }
  const {hash: cutHash} = await buildTagShareCut({label, rootSetIds: [rootId], authorizedTargets: targets}, {
    async loadSetVersion(id) { return sets.get(id); },
    async loadDefinitionVersion(id) { return definitions.get(id); },
    async listCanonicalBindings(id) { return bindings.get(id) ?? []; }
  });
  const {assemblyHash} = await releases.releaseGraph({
    source, audience: {type: 'person', id: audience}, selection, roots: new Set([cutHash])});
  return {assemblyHash, cutHash, source, entries};
}

/** Release the production runtime before closing the IPC process. */
async function stop() {
  for (const unsubscribe of cleanup) unsubscribe();
  cleanup = [];
  await runtime?.shutdown();
  runtime = undefined;
}

/** Keep fixture commands on the same lifecycle contract as the other workers. */
async function command(method, params) {
  switch (method) {
    case 'start': return start(params);
    case 'stop': return stop();
    case 'invite': return runtime.getConnectionsModel().pairing.createInvitation();
    case 'pair': return runtime.getConnectionsModel().pairing.connectUsingInvitation(params.invitation);
    case 'publish': return publish(params);
    case 'publishHeadFirst': return publish(params, (deferred ??= createHeldReleasePlan(runtime)).releases);
    case 'deliverHeldCut': return deferred.deliver(params.hash);
    case 'retire': return (deferred?.releases ?? runtime.getAssemblyReleasePlan()).retireGraphReleaseSelection({
      source, audience: {type: 'person', id: params.audience}, selection: params.selection});
    default: throw new Error(`Unknown Fotos worker command: ${method}`);
  }
}

process.on('message', async ({id, method, params = {}}) => {
  try {
    const result = await command(method, params);
    process.send({id, result}, error => { if (method === 'stop') process.exit(error ? 1 : 0); });
  } catch (error) {
    console.error(error);
    process.send({id, error: {message: error.message, code: error.code}});
  }
});
process.once('disconnect', () => {
  void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
});
