import {readFile} from 'node:fs/promises';
import {createFotosApi} from './fotos-api.mjs';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {onVersionedObj} from '@refinio/one.core/lib/storage-versioned-objects.js';

const api = await createFotosApi(JSON.parse(process.env.FOTOS_TEST_CONFIG));
const rootId = await api.fotos.getRootId();
const disconnect = onVersionedObj.addListener(result => {
    if (result.idHash === rootId) process.send({event: 'manifest', hash: result.hash, count: result.obj.entries.size});
});
api.runtime.getConnectionsModel().pairing.onPairingSuccessCommitted(
    (_initiated, _localPerson, _localInstance, remotePerson) => {
        process.send({event: 'paired', person: remotePerson});
    },
);
process.on('message', async ({id, method, params = {}}) => {
    try {
        let result;
        if (method === 'import') {
            const bytes = await readFile(params.path);
            await api.fotos.importFile(params.name, Uint8Array.from(bytes).buffer);
        } else if (method === 'invite') {
            result = await api.runtime.getConnectionsModel().pairing.createInvitation();
        } else if (method === 'pair') {
            await api.runtime.getConnectionsModel().pairing.connectUsingInvitation(params.invitation);
        } else if (method === 'share') {
            await createAccess([{id: rootId, person: [params.person], hashGroup: [], mode: SET_ACCESS_MODE.ADD}]);
        } else if (method === 'stop') {
            disconnect();
            await api.stop();
        } else throw new Error(`Unknown integration command: ${method}`);
        process.send({id, result: result ?? null});
        if (method === 'stop') process.disconnect();
    } catch (error) {
        process.send({id, error: error.stack ?? String(error)});
    }
});
process.send({event: 'ready', person: getInstanceOwnerIdHash(), rootId});
