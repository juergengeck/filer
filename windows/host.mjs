import {Console} from 'node:console';
import {IFSProjFSProvider} from '../one.projfs/IFSProjFSProvider.js';

// The desktop process owns the private pipe and sends one bootstrap frame.
globalThis.console = new Console({stdout: process.stderr, stderr: process.stderr});
const {runFilerGlueHost} = await import('@refinio/filer.runtime/host');
await runFilerGlueHost({providerFactory: options => new IFSProjFSProvider(options)});
