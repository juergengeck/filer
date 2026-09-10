/** Private stdio management client. SSH carries management; model content uses authenticated CHUM. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/** Quote one argument for the remote login shell. */
function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }

/** Start an isolated Filer owner locally or over SSH, returning its canonical operation surface. */
export async function startModelWeightsSession({node = process.execPath, runtime, config, ssh,
  hostScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-weights-host.mjs'), log = process.stderr}) {
  const args = [node, hostScript, runtime, config];
  const child = ssh ? spawn('ssh', ['-o', 'BatchMode=yes', ssh, args.map(quote).join(' ')], {stdio: ['pipe', 'pipe', 'pipe']})
    : spawn(node, args.slice(1), {stdio: ['pipe', 'pipe', 'pipe']});
  child.stderr.pipe(log, {end: false});
  let counter = 0;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const lines = createInterface({input: child.stdout});
  const exit = new Promise(resolve => child.once('exit', code => {
    const error = new Error(`Filer runtime exited (${code})`);
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear(); lines.close(); resolve(code);
  }));
  child.once('error', error => readyReject(error));
  lines.on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { readyReject(new Error('Invalid runtime response')); return; }
    if (response.ready) { readyResolve(response); return; }
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    response.success ? request.resolve(response.result) : request.reject(new Error(response.error?.message ?? 'Operation failed'));
  });
  return {ready: await ready,
    /** Call a public operation through the same registry used by the native host. */
    call(operation, request = {}) {
      const requestId = String(++counter);
      return new Promise((resolve, reject) => {
        pending.set(requestId, {resolve, reject});
        child.stdin.write(JSON.stringify({operation, request, requestId}) + '\n', error => {
          if (error) { pending.delete(requestId); reject(error); }
        });
      });
    },
    /** Let queued work and canonical shutdown finish before closing the session. */
    async close() { child.stdin.end(); return exit; }
  };
}
