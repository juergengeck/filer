import MultiUser from '@refinio/one.models/lib/models/Authenticator/MultiUser.js';
import LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import {OEvent} from '@refinio/one.models/lib/misc/OEvent.js';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import type {Instance, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    InstanceSettingsStorage,
    SettingsPlan,
    registerBuiltInSettings
} from '@refinio/settings.core';
import {registerDeviceSettings} from '@refinio/settings.devices';
import {
    decodeFilerFolderModes,
    FILER_FOLDER_SETTINGS_MODULE,
    registerFilerFolderSettings,
    type FilerFolderModes
} from '@refinio/filer.core';
import {
    createFilerBasicExportFilter,
    createFilerBasicImportFilter,
    createFilerChumSyncOptions,
    startFilerShareReceiver
} from '@refinio/filer.expo/share-receiver';
import {
    clearFilerHostStorage,
    hasNativeFilerHost,
    startFilerHostProjection
} from '@refinio/filer.expo/host';
import {filerHostPlatform} from './filer-platform';
import {
    getFilerHistoryDeclarations,
    getFilerRuntimeRecipes,
    getFilerRuntimeReverseMaps,
    getFilerRuntimeReverseMapsForIdObjects
} from './filer-runtime-recipes';

const COMM_SERVER_URL_DEFAULT = 'wss://api.glue.one/comm';

export interface FilerModelOptions {
    storageDirectory: string;
    commServerUrl?: string;
}

/**
 * ONE Filer mobile runtime: auth, relay pairing, share intake and owned-head
 * projection into the App Group File Provider catalog.
 */
export default class Model {
    public onOneModelsReady = new OEvent<() => void>();
    public onFolderModesChange = new OEvent<(modes: FilerFolderModes) => void>();
    public initialized = false;

    public readonly one: MultiUser;
    public leute: LeuteModel | null = null;
    public connections: ConnectionsModel | null = null;
    public settingsPlan: SettingsPlan | null = null;
    public folderModes: FilerFolderModes | null = null;

    private readonly commServerUrl: string;
    private closeShareReceiver: (() => Promise<void>) | null = null;
    private closeHostProjection: (() => Promise<void>) | null = null;
    private unsubscribeSettings: (() => void) | null = null;
    private initInFlight: Promise<void> | null = null;

    get ownerId(): string | undefined {
        return getInstanceOwnerIdHash();
    }

    get instanceId(): string | undefined {
        return getInstanceIdHash();
    }

    constructor(options: FilerModelOptions) {
        this.commServerUrl = options.commServerUrl ?? COMM_SERVER_URL_DEFAULT;
        this.one = new MultiUser({
            directory: options.storageDirectory,
            recipes: getFilerRuntimeRecipes() as never,
            reverseMaps: getFilerRuntimeReverseMaps() as never,
            reverseMapsForIdObjects: getFilerRuntimeReverseMapsForIdObjects() as never,
            objectHistoryDeclarations: getFilerHistoryDeclarations() as never,
            storageInitTimeout: 20000
        });
        this.one.onLogin(() => {
            void this.init().catch(error =>
                console.error('[Filer] Post-login init failed:', error));
        });
        this.one.onLogout(() => {
            void this.teardown().catch(error =>
                console.error('[Filer] Logout teardown failed:', error));
        });
    }

    async loginOrRegister(email: string, secret: string, instanceName: string): Promise<void> {
        await this.one.loginOrRegister(email, secret, instanceName);
        // Surface post-login startup failures on the login screen instead of
        // leaving them in the fire-and-forget onLogin listener. init() is
        // idempotent across the listener and concurrent login attempts.
        await this.init();
    }

    async login(email: string, secret: string, instanceName: string): Promise<void> {
        await this.one.login(email, secret, instanceName);
        await this.init();
    }

    /** Erase local ONE state, the host projection catalog and storage. */
    async reset(): Promise<void> {
        await this.teardown();
        // Close and erase the open instance before removing its directories;
        // the onLogout listener re-enters teardown(), which is a null-guarded
        // no-op once the first pass has run.
        await this.one.logoutAndErase();
        if (hasNativeFilerHost(filerHostPlatform)) {
            await clearFilerHostStorage(filerHostPlatform);
        }
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        if (this.initInFlight) return this.initInFlight;
        this.initInFlight = this.initInner().finally(() => {
            this.initInFlight = null;
        });
        return this.initInFlight;
    }

    private async initInner(): Promise<void> {
        const owner = getInstanceOwnerIdHash();
        const instance = getInstanceIdHash();
        if (!owner || !instance) {
            throw new Error('[Filer] Login must complete before init');
        }
        const ownerId = owner as SHA256IdHash<Person>;
        const instanceId = instance as SHA256IdHash<Instance>;

        // A partial startup must not leak the Leute stack or receiver
        // listeners: tear down and let the next login retry from clean state.
        try {
            const leute = new LeuteModel(this.commServerUrl);
            await leute.init();
            this.leute = leute;

            // Install the share receiver before CHUM lanes start importing.
            const receiver = await startFilerShareReceiver(ownerId, () => ({
                getPersonName: id => leute.getPersonName(id),
                trust: leute.trust
            }), {handlerIdPrefix: 'filer.expo.filer', logPrefix: '[Filer Share]'});
            this.closeShareReceiver = () => receiver.close();

            const connections = new ConnectionsModel(leute, {
                commServerUrl: this.commServerUrl,
                publicCommServerUrl: this.commServerUrl,
                allowPairing: true,
                chumSyncOptions: createFilerChumSyncOptions(),
                importFilter: createFilerBasicImportFilter(),
                objectFilter: createFilerBasicExportFilter()
            });
            await connections.init();
            this.connections = connections;
            await receiver.refresh();

            await this.initSettings(instanceId, ownerId);
            // A persisted `hidden` mode must not flash the domain: skip the
            // initial publish and let the visibility sync own the projection.
            if (this.folderModes?.files !== 'hidden') {
                this.closeHostProjection = await startFilerHostProjection(ownerId, instanceId, {
                    displayName: 'ONE Filer',
                    keepDomainRegisteredWhenEmpty: true
                });
            }

            this.initialized = true;
            this.onOneModelsReady.emit();
            await this.syncProjectionWithFolderModes();
        } catch (error) {
            await this.teardown();
            throw error;
        }
    }

    private folderSyncTail: Promise<void> = Promise.resolve();

    /**
     * Pause the Files projection (leaving the registered domain empty) while
     * `files` is hidden, and republish it when visible again. Serialized so
     * rapid toggles cannot interleave a stop with a restart.
     */
    private syncProjectionWithFolderModes(): Promise<void> {
        const run = this.folderSyncTail.then(() => this.applyFolderVisibility());
        this.folderSyncTail = run.catch(error =>
            console.error('[Filer] Folder visibility sync failed:', error));
        return run;
    }

    private async applyFolderVisibility(): Promise<void> {
        const owner = getInstanceOwnerIdHash() as SHA256IdHash<Person> | undefined;
        const instance = getInstanceIdHash() as SHA256IdHash<Instance> | undefined;
        if (!owner || !instance) return;
        const hidden = this.folderModes?.files === 'hidden';
        if (hidden && this.closeHostProjection) {
            const close = this.closeHostProjection;
            this.closeHostProjection = null;
            // close() unregisters the domain; resuming starts a fresh
            // publisher that republishes the current head.
            await close();
        } else if (!hidden && !this.closeHostProjection && this.initialized && this.connections) {
            this.closeHostProjection = await startFilerHostProjection(owner, instance, {
                displayName: 'ONE Filer',
                keepDomainRegisteredWhenEmpty: true
            });
        }
    }

    private async initSettings(
        instanceId: SHA256IdHash<Instance>,
        ownerId: SHA256IdHash<Person>
    ): Promise<void> {
        registerBuiltInSettings();
        registerDeviceSettings();
        registerFilerFolderSettings();
        const storage = new InstanceSettingsStorage({
            instanceIdHash: instanceId,
            ownerPersonIdHash: ownerId
        });
        const plan = new SettingsPlan(storage);
        this.settingsPlan = plan;
        await this.refreshFolderModes();
        // Tabs mount after init completes, but emit anyway so late subscribers
        // and same-instance re-logins never observe stale modes.
        if (this.folderModes) this.onFolderModesChange.emit(this.folderModes);
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = plan.subscribe(settings => {
            const section = settings?.[FILER_FOLDER_SETTINGS_MODULE];
            if (!section) return;
            try {
                const modes = decodeFilerFolderModes(section);
                this.folderModes = modes;
                this.onFolderModesChange.emit(modes);
                void this.syncProjectionWithFolderModes();
            } catch (error) {
                console.warn('[Filer] Ignoring invalid folder modes:', error);
            }
        });
    }

    async refreshFolderModes(): Promise<FilerFolderModes | null> {
        if (!this.settingsPlan) return null;
        const response = await this.settingsPlan.getSection({
            moduleId: FILER_FOLDER_SETTINGS_MODULE
        });
        const modes = decodeFilerFolderModes(response.values);
        this.folderModes = modes;
        return modes;
    }

    async setFolderMode(
        folder: keyof FilerFolderModes,
        mode: FilerFolderModes[keyof FilerFolderModes]
    ): Promise<void> {
        if (!this.settingsPlan) throw new Error('[Filer] Settings are not ready');
        await this.settingsPlan.updateSection({
            moduleId: FILER_FOLDER_SETTINGS_MODULE,
            values: {[folder]: mode}
        });
        await this.refreshFolderModes();
        await this.syncProjectionWithFolderModes();
    }

    private async teardown(): Promise<void> {
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;
        this.settingsPlan = null;
        this.folderModes = null;
        if (this.closeShareReceiver) {
            const close = this.closeShareReceiver;
            this.closeShareReceiver = null;
            await close();
        }
        if (this.closeHostProjection) {
            const close = this.closeHostProjection;
            this.closeHostProjection = null;
            await close();
        }
        if (this.connections) {
            const connections = this.connections;
            this.connections = null;
            await connections.shutdown();
        }
        if (this.leute) {
            const leute = this.leute;
            this.leute = null;
            await leute.shutdown();
        }
        this.initialized = false;
    }
}
