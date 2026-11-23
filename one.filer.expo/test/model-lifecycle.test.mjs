import {strict as assert} from 'node:assert';
import test from 'node:test';
import {importBundled} from './helpers/bundle.mjs';

const hostCalls = [];
const shareCalls = [];

async function importModel() {
    return importBundled('../../src/runtime/Model.ts', {
        'expo-file-system': `
            export class Directory {
                constructor(uri, name) { this.uri = uri + '/' + name; }
                get exists() { return false; }
                delete() {}
            }
        `,
        'react-native': 'export const Platform = {OS: "web"};',
        '@refinio/filer.expo/host': `
            export const filerHostRecipes = [];
            export const filerHostReverseMaps = [];
            export function hasNativeFilerHost() { return true; }
            export async function getFilerOneStorageUri() { return "file:///shared/one-storage"; }
            export async function clearFilerHostStorage() { globalThis.filerModelTestHostCalls.push("clear"); }
            export async function startFilerHostProjection() {
                globalThis.filerModelTestHostCalls.push("start-projection");
                return async () => { globalThis.filerModelTestHostCalls.push("close-projection"); };
            }
        `,
        '@refinio/filer.expo/share-receiver': `
            export function createFilerChumSyncOptions() { return {}; }
            export function createFilerBasicImportFilter() { return async () => true; }
            export function createFilerBasicExportFilter() { return async () => true; }
            export async function startFilerShareReceiver() {
                globalThis.filerModelTestShareCalls.push("start-receiver");
                return {
                    refresh: async () => { globalThis.filerModelTestShareCalls.push("refresh"); },
                    close: async () => { globalThis.filerModelTestShareCalls.push("close-receiver"); }
                };
            }
        `
    });
}

test('loginOrRegister surfaces init failures instead of hanging on LoginScreen', async t => {
    globalThis.filerModelTestHostCalls = hostCalls;
    globalThis.filerModelTestShareCalls = shareCalls;
    t.after(() => {
        delete globalThis.filerModelTestHostCalls;
        delete globalThis.filerModelTestShareCalls;
    });
    const {default: Model} = await importModel();
    const calls = [];
    const model = new Model({storageDirectory: 'test-storage'});
    model.one = {
        loginOrRegister: async () => {
            calls.push('login');
        },
        logoutAndErase: async () => {
            calls.push('logout');
        },
        onLogin: () => {},
        onLogout: () => {}
    };
    model.init = async () => {
        calls.push('init');
        throw new Error('init boom');
    };
    await assert.rejects(
        () => model.loginOrRegister('user@one.filer', 'secret', 'user@one.filer'),
        /init boom/
    );
    assert.deepEqual(calls, ['login', 'init']);
});

test('reset tears down before erasing before clearing storage', async t => {
    globalThis.filerModelTestHostCalls = hostCalls;
    globalThis.filerModelTestShareCalls = shareCalls;
    t.after(() => {
        delete globalThis.filerModelTestHostCalls;
        delete globalThis.filerModelTestShareCalls;
    });
    const {default: Model} = await importModel();
    class ProbeModel extends Model {
        async teardown() {
            this.calls.push('teardown');
            return super.teardown();
        }
    }
    const model = new ProbeModel({storageDirectory: 'test-storage'});
    model.calls = [];
    model.one = {
        loginOrRegister: async () => {},
        logoutAndErase: async () => {
            model.calls.push('logout');
        },
        onLogin: () => {},
        onLogout: () => {}
    };
    hostCalls.length = 0;
    await model.reset();
    // A second reset must stay null-safe: the onLogout listener re-enters
    // teardown(), which is a no-op once the first pass has run.
    await model.reset();
    assert.deepEqual(model.calls, ['teardown', 'logout', 'teardown', 'logout']);
    assert.deepEqual(hostCalls, ['clear', 'clear']);
});
