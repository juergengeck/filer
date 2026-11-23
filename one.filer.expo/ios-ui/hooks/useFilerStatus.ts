import {useEffect, useState} from 'react';
import type Model from '../../src/runtime/Model';
import type {FilerFolderModes} from '@refinio/filer.core';

/** Live folder modes; subscribes to IoM-driven updates. */
export function useFolderModes(model: Model): FilerFolderModes | null {
    const [modes, setModes] = useState<FilerFolderModes | null>(model.folderModes);
    useEffect(() => {
        // A reset() + re-login reuses the Model instance with nulled state;
        // resync on (re)subscribe so hooks never show the previous session.
        setModes(model.folderModes);
        return model.onFolderModesChange.listen(setModes);
    }, [model]);
    return modes;
}

/** Live comm-server reachability; false until the connection stack is up. */
export function useOnlineState(model: Model): boolean {
    const [online, setOnline] = useState(model.connections?.onlineState ?? false);
    useEffect(() => {
        setOnline(model.connections?.onlineState ?? false);
        return model.connections?.onOnlineStateChange.listen(setOnline);
    }, [model]);
    return online;
}
