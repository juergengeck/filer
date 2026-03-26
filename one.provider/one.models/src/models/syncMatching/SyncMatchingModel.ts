import {createAccess} from '@refinio/one.core/lib/access.js';
import {getInstanceIdHash} from '@refinio/one.core/lib/instance.js';
import type {Access, IdAccess, Person} from '@refinio/one.core/lib/recipes.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {
    getObjectByIdHash,
    getObjectByIdObj,
    storeVersionedObject,
    type VersionedObjectResult
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import {OEvent} from '../../misc/OEvent.js';
import type {Profile} from '../../recipes/Leute/Profile.js';
import type {
    ScopedTrieRoot,
    SyncDemand,
    SyncMatch,
    SyncSelectorKind,
    SyncSupply,
    SyncTrieName,
    SyncTrustLevel
} from '../../recipes/SyncMatchingRecipes.js';
import type LeuteModel from '../Leute/LeuteModel.js';
import {Model} from '../Model.js';
import {evaluateSyncMatch, type EvaluatedSyncMatch} from './SyncMatchingUtils.js';

export type PublishScopedTrieRootInput = {
    id: string;
    contentType: string;
    selectorKind: SyncSelectorKind;
    selector: string;
    trie: SyncTrieName;
    subjectId?: string;
    owner?: SHA256IdHash<Person>;
    root?: string;
    rootId?: string;
};

export type PublishSyncDemandInput = {
    id: string;
    contentType: string;
    selectorKind: SyncSelectorKind;
    selector: string;
    trie: SyncTrieName;
    subjectId?: string;
    owner?: SHA256IdHash<Person>;
    minTrustLevel: SyncTrustLevel;
    isActive?: boolean;
};

export type PublishSyncSupplyInput = {
    id: string;
    scopedRoot: SHA256IdHash<ScopedTrieRoot>;
    owner?: SHA256IdHash<Person>;
    minTrustLevel: SyncTrustLevel;
    isActive?: boolean;
};

type MatchSide = 'demand' | 'supply';

/**
 * Channel-free matching model for root-scoped demand and supply declarations.
 */
export default class SyncMatchingModel extends Model {
    public onMatch = new OEvent<(match: EvaluatedSyncMatch) => void>();

    private readonly leuteModel: LeuteModel;
    private readonly scopedRoots = new Map<string, ScopedTrieRoot>();
    private readonly demands = new Map<string, SyncDemand>();
    private readonly supplies = new Map<string, SyncSupply>();
    private readonly disconnects: Array<() => void> = [];

    constructor(leuteModel: LeuteModel) {
        super();
        this.leuteModel = leuteModel;
    }

    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        this.disconnects.push(
            objectEvents.onNewVersion(
                async result => {
                    this.scopedRoots.set(result.obj.id, result.obj);
                    this.onUpdated.emit();
                },
                'SyncMatchingModel: ScopedTrieRoot updated',
                'ScopedTrieRoot'
            ),
            objectEvents.onNewVersion(
                async result => {
                    this.demands.set(result.obj.id, result.obj);
                    await this.emitMatchesForDeclaration(result.obj, 'demand');
                    this.onUpdated.emit();
                },
                'SyncMatchingModel: SyncDemand updated',
                'SyncDemand'
            ),
            objectEvents.onNewVersion(
                async result => {
                    this.supplies.set(result.obj.id, result.obj);
                    await this.emitMatchesForDeclaration(result.obj, 'supply');
                    this.onUpdated.emit();
                },
                'SyncMatchingModel: SyncSupply updated',
                'SyncSupply'
            )
        );

        this.state.triggerEvent('init');
    }

    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        while (this.disconnects.length > 0) {
            const disconnect = this.disconnects.pop();
            disconnect && disconnect();
        }

        this.scopedRoots.clear();
        this.demands.clear();
        this.supplies.clear();
        this.state.triggerEvent('shutdown');
    }

    /**
     * Publish or update a scoped trie root capability.
     */
    async publishScopedTrieRoot(
        input: PublishScopedTrieRootInput
    ): Promise<VersionedObjectResult<ScopedTrieRoot>> {
        this.state.assertCurrentState('Initialised');

        const owner = input.owner || (await this.leuteModel.myMainIdentity());
        const result = await serializeWithType(`ScopedTrieRoot:${input.id}`, async () =>
            storeVersionedObject({
                $type$: 'ScopedTrieRoot',
                id: input.id,
                owner,
                contentType: input.contentType,
                selectorKind: input.selectorKind,
                selector: input.selector,
                trie: input.trie,
                subjectId: input.subjectId,
                root: input.root,
                rootId: input.rootId
            })
        );

        this.scopedRoots.set(result.obj.id, result.obj);
        return result;
    }

    /**
     * Publish or update a sync demand declaration.
     */
    async publishDemand(input: PublishSyncDemandInput): Promise<VersionedObjectResult<SyncDemand>> {
        this.state.assertCurrentState('Initialised');

        const owner = input.owner || (await this.leuteModel.myMainIdentity());
        const existing = await this.loadVersionedById<SyncDemand>('SyncDemand', input.id);
        const createdAt = existing?.obj.createdAt ?? Date.now();

        const result = await serializeWithType(`SyncDemand:${input.id}`, async () =>
            storeVersionedObject({
                $type$: 'SyncDemand',
                id: input.id,
                owner,
                instanceId: this.getRequiredInstanceId(),
                contentType: input.contentType,
                selectorKind: input.selectorKind,
                selector: input.selector,
                trie: input.trie,
                subjectId: input.subjectId,
                minTrustLevel: input.minTrustLevel,
                isActive: input.isActive ?? true,
                createdAt,
                updatedAt: Date.now()
            })
        );

        this.demands.set(result.obj.id, result.obj);
        return result;
    }

    /**
     * Publish or update a sync supply declaration.
     */
    async publishSupply(input: PublishSyncSupplyInput): Promise<VersionedObjectResult<SyncSupply>> {
        this.state.assertCurrentState('Initialised');

        const owner = input.owner || (await this.leuteModel.myMainIdentity());
        const existing = await this.loadVersionedById<SyncSupply>('SyncSupply', input.id);
        const createdAt = existing?.obj.createdAt ?? Date.now();
        const scopedRootResult = await getObjectByIdHash(input.scopedRoot);

        const result = await serializeWithType(`SyncSupply:${input.id}`, async () =>
            storeVersionedObject({
                $type$: 'SyncSupply',
                id: input.id,
                owner,
                instanceId: this.getRequiredInstanceId(),
                contentType: scopedRootResult.obj.contentType,
                selectorKind: scopedRootResult.obj.selectorKind,
                selector: scopedRootResult.obj.selector,
                trie: scopedRootResult.obj.trie,
                subjectId: scopedRootResult.obj.subjectId,
                scopedRoot: input.scopedRoot,
                minTrustLevel: input.minTrustLevel,
                isActive: input.isActive ?? true,
                createdAt,
                updatedAt: Date.now()
            })
        );

        this.supplies.set(result.obj.id, result.obj);
        return result;
    }

    /**
     * List all currently eligible matches that involve at least one local declaration.
     */
    async listMatches(): Promise<EvaluatedSyncMatch[]> {
        this.state.assertCurrentState('Initialised');

        const seen = new Set<string>();
        const matches: EvaluatedSyncMatch[] = [];

        for (const demand of this.demands.values()) {
            for (const supply of this.supplies.values()) {
                const match = await this.evaluateLocalAwareMatch(demand, supply);
                if (!match) {
                    continue;
                }

                const key = this.createMatchKey(match.demand.id, match.supply.id, match.demand.owner);
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                matches.push(match);
            }
        }

        return matches;
    }

    /**
     * Derive the local trust level for a person.
     */
    async getTrustLevel(personId: SHA256IdHash<Person>): Promise<SyncTrustLevel> {
        this.state.assertCurrentState('Initialised');

        if (await this.isLocalIdentity(personId)) {
            return 'inner-circle';
        }

        const trustedKeys = await this.leuteModel.trust.getTrustedKeysForPerson(personId);
        if (trustedKeys.length === 0) {
            return 'public';
        }

        let trustLevel: SyncTrustLevel = 'known-key';
        const someone = await this.leuteModel.getSomeone(personId);
        if (someone === undefined) {
            return trustLevel;
        }

        for (const profile of await someone.profiles(personId)) {
            const loadedVersion = profile.loadedVersion;
            if (loadedVersion === undefined) {
                continue;
            }

            if (await this.hasTrustedCertificate(loadedVersion, 'AffirmationCertificate')) {
                trustLevel = 'affirmed';
            }

            if (await this.hasTrustedCertificate(loadedVersion, 'TrustKeysCertificate')) {
                trustLevel = 'delegated';
                break;
            }
        }

        return trustLevel;
    }

    /**
     * Grant a locally-owned supply to the owner of a matching demand and persist the match.
     */
    async grantMatch(match: EvaluatedSyncMatch): Promise<{
        access: VersionedObjectResult<Access | IdAccess>;
        syncMatch: VersionedObjectResult<SyncMatch>;
    }> {
        this.state.assertCurrentState('Initialised');

        if (!(await this.isLocalIdentity(match.supply.owner))) {
            throw new Error('Only locally-owned supplies can be granted by this instance.');
        }

        const [access] = await createAccess([
            {
                id: match.supply.scopedRoot,
                person: [match.demand.owner],
                group: [],
                mode: SET_ACCESS_MODE.ADD
            }
        ]);

        const syncMatch = await this.storeMatch(match);

        return {
            access,
            syncMatch
        };
    }

    private async emitMatchesForDeclaration(
        declaration: SyncDemand | SyncSupply,
        side: MatchSide
    ): Promise<void> {
        const oppositeDeclarations =
            side === 'demand' ? this.supplies.values() : this.demands.values();

        for (const opposite of oppositeDeclarations) {
            const match =
                side === 'demand'
                    ? await this.evaluateLocalAwareMatch(declaration, opposite)
                    : await this.evaluateLocalAwareMatch(opposite, declaration);

            if (match) {
                this.onMatch.emit(match);
            }
        }
    }

    private async evaluateLocalAwareMatch(
        demand: SyncDemand,
        supply: SyncSupply
    ): Promise<EvaluatedSyncMatch | null> {
        const counterparty = await this.getCounterpartyIdentity(demand, supply);
        if (counterparty === undefined) {
            return null;
        }

        const remoteTrustLevel = await this.getTrustLevel(counterparty);
        return evaluateSyncMatch(demand, supply, remoteTrustLevel);
    }

    private async getCounterpartyIdentity(
        demand: SyncDemand,
        supply: SyncSupply
    ): Promise<SHA256IdHash<Person> | undefined> {
        const demandIsLocal = await this.isLocalIdentity(demand.owner);
        const supplyIsLocal = await this.isLocalIdentity(supply.owner);

        if (demandIsLocal && !supplyIsLocal) {
            return supply.owner;
        }

        if (!demandIsLocal && supplyIsLocal) {
            return demand.owner;
        }

        if (demandIsLocal && supplyIsLocal) {
            return demand.owner;
        }

        return undefined;
    }

    private async isLocalIdentity(personId: SHA256IdHash<Person>): Promise<boolean> {
        const me = await this.leuteModel.me();
        return me.managesIdentity(personId);
    }

    private async hasTrustedCertificate(
        profileHash: SHA256Hash<Profile>,
        certificateType: 'AffirmationCertificate' | 'TrustKeysCertificate'
    ): Promise<boolean> {
        const certificates = await this.leuteModel.trust.getCertificatesOfType(
            profileHash,
            certificateType
        );

        return certificates.some(certificate => certificate.trusted);
    }

    private async storeMatch(match: EvaluatedSyncMatch): Promise<VersionedObjectResult<SyncMatch>> {
        const grantedBy = await this.leuteModel.myMainIdentity();
        const demandIdHash = await this.calculateVersionedIdHash<SyncDemand>(
            'SyncDemand',
            match.demand.id
        );
        const supplyIdHash = await this.calculateVersionedIdHash<SyncSupply>(
            'SyncSupply',
            match.supply.id
        );
        const matchId = this.createMatchKey(match.demand.id, match.supply.id, match.demand.owner);

        return await serializeWithType(`SyncMatch:${matchId}`, async () =>
            storeVersionedObject({
                $type$: 'SyncMatch',
                id: matchId,
                demand: demandIdHash,
                supply: supplyIdHash,
                scopedRoot: match.supply.scopedRoot,
                grantedBy,
                grantedTo: match.demand.owner,
                trustLevel: match.remoteTrustLevel,
                createdAt: Date.now()
            })
        );
    }

    private createMatchKey(
        demandId: string,
        supplyId: string,
        grantedTo: SHA256IdHash<Person>
    ): string {
        return `${demandId}:${supplyId}:${grantedTo}`;
    }

    private async calculateVersionedIdHash<T extends ScopedTrieRoot | SyncDemand | SyncSupply | SyncMatch>(
        type: T['$type$'],
        id: string
    ): Promise<SHA256IdHash<T>> {
        return (await calculateIdHashOfObj({
            $type$: type,
            id
        })) as SHA256IdHash<T>;
    }

    private async loadVersionedById<T extends ScopedTrieRoot | SyncDemand | SyncSupply | SyncMatch>(
        type: T['$type$'],
        id: string
    ): Promise<VersionedObjectResult<T> | undefined> {
        try {
            return (await getObjectByIdObj({
                $type$: type,
                id
            })) as VersionedObjectResult<T>;
        } catch (error) {
            if (error.name === 'FileNotFoundError') {
                return undefined;
            }

            throw error;
        }
    }

    private getRequiredInstanceId(): SHA256IdHash {
        const instanceId = getInstanceIdHash();
        if (instanceId === undefined) {
            throw new Error('The instance is not initialized.');
        }

        return instanceId;
    }
}
