/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import {setPlatformForCh} from './crypto-helpers.js';
import {setPlatformForCs} from './crypto-scrypt.js';
import {setPlatformForFf} from './fetch-file.js';
import {setPlatformLoaded} from './platform.js';
import {setPlatformForPj} from './post-json.js';
import {setPlatformForSs} from './settings-store.js';
import {setPlatformForSb} from './storage-base.js';
import {setPlatformForSbdf} from './storage-base-delete-file.js';
import {setPlatformForSst} from './storage-streams.js';
import {setPlatformForWs} from './websocket.js';

import * as CH from './browser/crypto-helpers.js';
import * as CS from './browser/crypto-scrypt.js';
import * as FF from './browser/fetch-file.js';
import * as PJ from './browser/post-json.js';
import * as SS from './browser/settings-store.js';
import * as SB from './browser/storage-base.js';
import * as SBDF from './browser/storage-base-delete-file.js';
import * as SST from './browser/storage-streams.js';
import * as WS from './browser/websocket.js';

setPlatformForCh(CH);
setPlatformForCs(CS);
setPlatformForFf(FF);
setPlatformForPj(PJ);
setPlatformForSs(SS);
setPlatformForSb(SB);
setPlatformForSbdf(SBDF);
setPlatformForSst(SST);
setPlatformForWs(WS);

setPlatformLoaded('browser');
