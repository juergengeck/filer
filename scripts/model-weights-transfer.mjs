/** Publish and verify a model between two explicit, private Filer runtime sessions. */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {startModelWeightsSession} from './model-weights-session.mjs';

const {values} = parseArgs({options: {source: {type: 'string'}, target: {type: 'string'},
  publish: {type: 'string'}, evidence: {type: 'string'}, pin: {type: 'boolean', default: false}}});
if (!values.source || !values.target || !values.publish || !values.evidence) {
  throw new Error('Usage: --source SESSION.json --target SESSION.json --publish SNAPSHOT.json --evidence DIRECTORY [--pin]');
}
await mkdir(values.evidence, {recursive: true});
const sourceLog = createWriteStream(path.join(values.evidence, 'source.log'), {mode: 0o600});
const targetLog = createWriteStream(path.join(values.evidence, 'target.log'), {mode: 0o600});
let source, target;
try {
  const publication = JSON.parse(await readFile(values.publish, 'utf8'));
  source = await startModelWeightsSession({...JSON.parse(await readFile(values.source, 'utf8')), log: sourceLog});
  console.log('Spark model library opened');
  const existing = (await source.call('modelWeights:list')).filter(entry => entry.revision.model === publication.model &&
    entry.revision.revision === publication.revision && entry.revision.source === publication.source &&
    entry.revision.format === publication.format && entry.revision.quantization === publication.quantization);
  if (existing.length > 1) throw new Error('Several published manifests match; select an exact manifest before transferring');
  const hash = existing.length ? existing[0].hash : (await source.call('modelWeights:publish', publication)).hash;
  console.log(`Published immutable revision ${hash}`);
  target = await startModelWeightsSession({...JSON.parse(await readFile(values.target, 'utf8')), log: targetLog});
  const available = (await target.call('modelWeights:list')).some(entry => entry.hash === hash);
  // These runtimes are temporary sessions: establish their authenticated lane each run.
  const invitation = await source.call('pairing:createInvitation');
  await target.call('pairing:connectUsingInvitation', {invitation});
  const arrival = available ? Promise.resolve() : target.call('modelWeights:waitForRevision', {hash, timeoutMs: 120000});
  await source.call('modelWeights:share', {hash, person: target.ready.owner});
  await arrival;
  const entry = (await target.call('modelWeights:list')).find(entry => entry.hash === hash);
  if (!entry) throw new Error('The target did not adopt the selected revision');
  const bytes = entry.files.reduce((sum, file) => sum + file.size, 0);
  console.log(`Metadata available: ${entry.files.length} files, ${bytes} bytes, pinned=${entry.pinned}`);
  const evidence = {model: entry.revision.model, revision: entry.revision.revision, manifest: hash,
    sourceOwner: source.ready.owner, targetOwner: target.ready.owner, files: entry.files,
    totalBytes: bytes, metadataReceivedAt: new Date().toISOString(), pinned: entry.pinned};
  await writeFile(path.join(values.evidence, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  await target.call('modelWeights:waitForPeer', {person: source.ready.owner, timeoutMs: 120000});
  const root = (await target.call('filer:readDir', {path: '/ONE/System/models'})).result;
  let revisionPath;
  for (const model of root.children) {
    const directory = `/ONE/System/models/${model}`;
    const revisions = (await target.call('filer:readDir', {path: directory})).result;
    const selected = revisions.children.find(name => name.endsWith(`-${hash}`));
    if (selected) { revisionPath = `${directory}/${selected}`; break; }
  }
  if (!revisionPath) throw new Error('Selected revision is missing from the Filer projection');
  const weightFile = entry.files.reduce((largest, file) => file.size > largest.size ? file : largest);
  const length = Math.min(4096, weightFile.size);
  const itemPath = `${revisionPath}/${weightFile.path}`;
  const item = (await target.call('filer:stat', {path: itemPath})).result.item;
  const range = await target.call('filer:readItemContent', {id: item.id, version: item.contentVersion,
    position: weightFile.size - length, length});
  if (range.error) throw new Error(range.error.message);
  if (Buffer.from(range.result.content, 'base64').length !== length) {
    throw new Error('On-demand read of the model through Filer failed');
  }
  const sample = Buffer.from(range.result.content, 'base64');
  const sourceItem = (await source.call('filer:stat', {path: itemPath})).result.item;
  const sourceRange = await source.call('filer:readItemContent', {id: sourceItem.id, version: sourceItem.contentVersion,
    position: weightFile.size - length, length});
  if (sourceRange.error || !sample.equals(Buffer.from(sourceRange.result.content, 'base64'))) {
    throw new Error('Target range differs from the published source range');
  }
  evidence.filerPath = revisionPath;
  evidence.filerItemId = item.id;
  evidence.contentVersion = item.contentVersion;
  evidence.metadataVersion = item.metadataVersion;
  evidence.filerAnchor = (await target.call('filer:getCurrentAnchor', {container: 'workingSet'})).result.anchor;
  evidence.rangeReadVerified = true;
  evidence.rangeReadFile = weightFile.path;
  evidence.rangeReadSHA256 = createHash('sha256').update(sample).digest('hex');
  await writeFile(path.join(values.evidence, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('On-demand Qwen range verified through the Filer projection');
  if (values.pin) {
    console.log('Pinning through CHUM; all file SHA-256 values are verified before completion');
    await target.call('modelWeights:pin', {hash});
    await source.close();
    source = undefined;
    const offline = await target.call('filer:readItemContent', {id: item.id, version: item.contentVersion,
      position: weightFile.size - length, length});
    if (offline.error || !sample.equals(Buffer.from(offline.result.content, 'base64'))) {
      throw new Error('Offline read of the pinned model through Filer failed');
    }
    evidence.pinned = true;
    evidence.verifiedAt = new Date().toISOString();
    evidence.filerPath = revisionPath;
    evidence.offlineReadVerified = true;
    await writeFile(path.join(values.evidence, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('Complete model revision pinned and verified');
  }
} finally {
  if (target) await target.close();
  if (source) await source.close();
  sourceLog.end(); targetLog.end();
}
