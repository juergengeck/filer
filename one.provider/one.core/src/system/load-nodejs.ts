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
import {setPlatformForQt} from './quic-transport.js';

import * as CH from './nodejs/crypto-helpers.js';
import * as CS from './nodejs/crypto-scrypt.js';
import * as FF from './nodejs/fetch-file.js';
import * as PJ from './nodejs/post-json.js';
import * as SS from './nodejs/settings-store.js';
import * as SB from './nodejs/storage-base.js';
import * as SBDF from './nodejs/storage-base-delete-file.js';
import * as SST from './nodejs/storage-streams.js';
import * as WS from './nodejs/websocket.js';
import {createNodeQuicTransport} from './nodejs/quic-transport.js';

setPlatformForCh(CH);
setPlatformForCs(CS);
setPlatformForFf(FF);
setPlatformForPj(PJ);
setPlatformForSs(SS);
setPlatformForSb(SB);
setPlatformForSbdf(SBDF);
setPlatformForSst(SST);
setPlatformForWs(WS);

// Initialize QUIC transport for Node.js
setPlatformForQt(createNodeQuicTransport());

setPlatformLoaded('nodejs');
