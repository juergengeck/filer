import {useCallback, useEffect, useState} from 'react';
import type Model from '../../src/runtime/Model';

export interface PairedPeer {
    id: string;
    name: string;
    endpoints: number;
}

export function usePairedPeers(model: Model) {
    const [peers, setPeers] = useState<PairedPeer[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            if (!model.leute) {
                setPeers([]);
                return;
            }
            const others = await model.leute.others();
            const rows: PairedPeer[] = [];
            for (const someone of others) {
                const personId = await someone.mainIdentity();
                const id = personId as string;
                let name = id.slice(0, 8);
                try {
                    name = await model.leute.getPersonName(personId);
                } catch {
                    // Fall back to the id prefix.
                }
                let endpoints = 0;
                try {
                    endpoints = (await model.leute.findAllOneInstanceEndpointsForPerson(personId))
                        .length;
                } catch {
                    // Endpoints are best-effort here.
                }
                rows.push({id, name, endpoints});
            }
            setPeers(rows);
        } finally {
            setLoading(false);
        }
    }, [model]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {peers, loading, refresh};
}
