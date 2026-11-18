#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, stat, writeFile, watch} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fotosUi = path.resolve(root, '../fotos/fotos.browser/browser-ui');
const require = createRequire(path.join(fotosUi, 'package.json'));
const {chromium} = require('playwright');
const automatic = process.env.IOM_AUTOMATIC_REPLICATION === '1';
const checkpoint = process.env.IOM_RESUME_REPORT
    ? JSON.parse(await readFile(process.env.IOM_RESUME_REPORT, 'utf8')) : undefined;
if (automatic) assert.ok(checkpoint, 'Automatic replication checks reuse a proven enrolled account');
const run = automatic ? randomUUID().slice(0, 8) : (checkpoint?.run ?? randomUUID().slice(0, 8));
assert.match(run, /^[a-f0-9]{8}$/);
const directory = process.env.IOM_EVIDENCE_DIRECTORY ?? `/tmp/gecko-iom-${run}`;
const build = process.env.FOTOS_BUILD_DIRECTORY ?? path.join(fotosUi, 'dist');
const host = process.env.FILER_HOST ?? '/Applications/OneFiler.app/Contents/MacOS/OneFilerHost';
const domain = process.env.FILER_DOMAIN ?? 'Gecko';
const identity = process.env.GLUE_IDENTITY ?? 'gecko@glue.one';
const origin = 'https://fotos.one';
if (checkpoint) {
    assert.equal(checkpoint.identity, identity);
    assert.equal(checkpoint.domain, domain);
}
const report = {run, identity, domain, mode: automatic ? 'automatic-owned-library' : 'shared-collection',
    status: 'starting', steps: automatic ? [] : [...(checkpoint?.steps ?? [])], directory};
const exec = promisify(execFile);
let context;

/** Save bounded, public evidence as each meaningful step completes. */
async function record(step, result) {
    report.steps.push({step, at: new Date().toISOString(), result});
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), {mode: 0o600});
    console.log(`[${step}] ${JSON.stringify(result)}`);
}

/** Execute a supported signed-host operation; invitation secrets stay on stdin. */
async function native(args, input) {
    if (input === undefined) {
        const {stdout} = await exec(host, args, {timeout: 75_000, maxBuffer: 4 * 1024 * 1024});
        return stdout;
    }
    return await new Promise((resolve, reject) => {
        const child = execFile(host, args, {timeout: 75_000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => {
            if (error) {
                let detail = '';
                if (args[0] === '--qa-domain') {
                    try { detail = `: ${JSON.parse(stdout).error?.message ?? 'QA operation failed'}`; }
                    catch { /* Retain the exit result when the host did not return JSON. */ }
                }
                reject(new Error(`Signed-host ${args[0]} failed (exit ${error.code ?? 'unknown'})${detail}`));
            }
            else resolve(stdout);
        });
        child.stdin.end(input);
    });
}

/** Call the same application-owned operation surface used by the Fotos runner. */
async function operation(page, name, method, params = {}) {
    return await page.evaluate(async ({name, method, params}) => {
        return await window.__api(name, method, params);
    }, {name, method, params});
}

/** Wait for the rendered gallery's exporter, which settles after the incoming catalog entry. */
async function waitForVisiblePhoto(page, hash) {
    await page.waitForFunction(async hash => {
        const photos = await window.__api('fotos', 'listVisiblePhotos', {});
        return photos.some(photo => photo.hash === hash);
    }, hash, {timeout: 30_000, polling: 100});
}

/** Resolve only the locally built Fotos assets, keeping real Glue authentication and relay traffic. */
async function serveBuild(route) {
    const url = new URL(route.request().url());
    if (url.origin !== origin || !url.pathname.startsWith('/app/')) return await route.continue();
    const relative = decodeURIComponent(url.pathname.slice('/app/'.length));
    let target = path.resolve(build, relative || 'index.html');
    if (!target.startsWith(path.resolve(build) + path.sep)) return await route.abort('accessdenied');
    try {
        const info = await stat(target);
        if (info.isDirectory()) target = path.join(target, 'index.html');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (path.extname(relative)) return await route.fulfill({status: 404, body: 'Not found'});
        target = path.join(build, 'index.html');
    }
    const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
        '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json'};
    await route.fulfill({status: 200, body: await readFile(target), contentType: mime[path.extname(target)] ?? 'application/octet-stream',
        headers: {'Cache-Control': 'no-store'}});
}

try {
    await mkdir(directory, {recursive: true, mode: 0o700});
    await stat(path.join(build, 'index.html'));
    const response = await fetch(`https://api.glue.one/api/registration/cert/${encodeURIComponent(identity)}`,
        {signal: AbortSignal.timeout(15_000)});
    const discovery = await response.json();
    assert.equal(response.status, 200);
    assert.equal(discovery.success, true);
    const owner = discovery.data.cert.subject;
    assert.match(owner, /^[a-f0-9]{64}$/);
    if (!process.env.IOM_DEFER_NATIVE) {
        const before = JSON.parse(await native(['--qa-domain', domain, 'getFotosSnapshot']));
        assert.equal(before.success, true);
        assert.equal(before.result.ownerId, owner, 'Filer must own the exact registered Gecko Person');
        await record('discovery', {personId: owner, filerOwnerId: before.result.ownerId});
    } else {
        await record('discovery', {personId: owner, nativeVerificationPending: true});
    }

    context = await chromium.launchPersistentContext(process.env.IOM_BROWSER_PROFILE ?? path.join(directory, 'chrome-fotos'), {
        // Follow the real window: an emulated taller viewport hides the bottom of scroll panes.
        channel: 'chrome', headless: false, serviceWorkers: 'block', viewport: null,
        // This is a real Mac TrustKey ceremony, so use its normal credential providers.
        ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
    });
    context.on('page', async popup => {
        try {
            await popup.waitForLoadState('domcontentloaded');
            await popup.bringToFront();
            await popup.screenshot({path: path.join(directory, 'auth-surface.png')});
        } catch { /* Navigation or closure can precede this diagnostic capture. */ }
    });
    await context.route(`${origin}/**`, serveBuild);
    const page = context.pages()[0] ?? await context.newPage();
    await page.bringToFront();
    page.setDefaultTimeout(60_000);
    await page.goto(`${origin}/app/?task=settings`);
    await page.waitForFunction(() => typeof window.__api === 'function');
    await operation(page, 'fotos-qa', 'waitForAppReady', {timeoutMs: 120_000});
    const windowSize = await page.evaluate(() => ({innerHeight, outerHeight}));
    assert.equal(page.viewportSize(), null, 'The test browser must use its native window viewport');
    assert.ok(windowSize.innerHeight <= windowSize.outerHeight, 'Fotos content must fit the real Chrome window');
    await record('browser-window', windowSize);
    const fixtureRoot = path.join(fotosUi, 'src/lib/__fixtures__/photos');
    let forward = await readFile(path.join(fixtureRoot, 'rose-detail.png'));
    let reverse = await readFile(path.join(fixtureRoot, 'rose-center.jpg'));
    if (automatic) {
        // New pixel dimensions produce fresh test media without touching the source fixtures.
        const height = 120 + parseInt(run.slice(0, 4), 16) % 360;
        const width = 120 + parseInt(run.slice(4), 16) % 360;
        const forwardInput = path.join(directory, 'automatic-browser-input.png');
        const reverseInput = path.join(directory, 'automatic-finder-input.jpg');
        await exec('/usr/bin/sips', ['--resampleHeightWidth', String(height), String(width), '-s', 'format', 'png',
            path.join(fixtureRoot, 'rose-detail.png'), '--out', forwardInput], {timeout: 15_000});
        await exec('/usr/bin/sips', ['--resampleHeightWidth', String(height + 31), String(width + 7), '-s', 'format', 'jpeg',
            path.join(fixtureRoot, 'rose-center.jpg'), '--out', reverseInput], {timeout: 15_000});
        forward = await readFile(forwardInput);
        reverse = await readFile(reverseInput);
    }
    const setup = await readFile(path.join(fixtureRoot, 'rose-top-left.jpg'));
    const forwardName = `fotos-to-filer-${run}.png`;
    let reverseName = `filer-to-fotos-${run}${checkpoint ? '-' + randomUUID().slice(0, 6) : ''}.jpg`;
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    let fotosIdentity = await operation(page, 'fotos-qa', 'getIdentity');
    const resumed = fotosIdentity.ownerId === owner && fotosIdentity.publicationIdentity === owner
        && fotosIdentity.syncEnabled === true;
    if (!resumed) {
        const snapshot = await operation(page, 'fotos-qa', 'getOperationSnapshot');
        if (!snapshot.gallery.items.some(photo => photo.name === 'visitor-setup.jpg')) {
            await operation(page, 'fotos-qa', 'importPhotoFixture', {
                name: 'visitor-setup.jpg', mimeType: 'image/jpeg', bytesBase64: setup.toString('base64'),
            });
        }
        await page.getByPlaceholder('Your name on glue.one').fill(identity);
        await page.evaluate(() => { document.title = 'Gecko IoM test — fotos.one'; });
        await page.screenshot({path: path.join(directory, 'ready.png')});
        await record('authentication-ready', {browser: 'local Fotos build on its registered origin', action: 'Complete the Mac passkey prompt'});
        const authTimeout = Number(process.env.IOM_AUTH_TIMEOUT_MS ?? (process.env.IOM_MANUAL_AUTH ? 900_000 : 180_000));
        assert.ok(Number.isFinite(authTimeout) && authTimeout > 0 && authTimeout <= 14_400_000);
        const navigated = page.waitForEvent('domcontentloaded', {timeout: authTimeout});
        if (!process.env.IOM_MANUAL_AUTH) await page.getByRole('button', {name: 'Sign in with glue.one', exact: true}).click();
        await navigated;
        await page.waitForFunction(() => typeof window.__api === 'function');
        await operation(page, 'fotos-qa', 'waitForAppReady', {timeoutMs: 120_000});
        fotosIdentity = await operation(page, 'fotos-qa', 'getIdentity');
    }
    assert.equal(fotosIdentity.ownerId, owner);
    assert.equal(fotosIdentity.publicationIdentity, owner);
    assert.equal(fotosIdentity.syncEnabled, true);
    await record('fotos-native-owner', {ownerId: fotosIdentity.ownerId, instanceId: fotosIdentity.deviceInstanceId, resumed});

    const readyFile = process.env.IOM_NATIVE_READY_FILE;
    if (readyFile) {
        const events = watch(path.dirname(readyFile), {signal: AbortSignal.timeout(600_000)});
        try {
            try { await stat(readyFile); } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                await record('waiting-for-native-build', {status: 'authenticated'});
                for await (const event of events) {
                    if (event.filename === path.basename(readyFile)) { await stat(readyFile); break; }
                }
            }
        } finally { await events.return(); }
        await page.reload();
        await page.waitForFunction(() => typeof window.__api === 'function');
        await operation(page, 'fotos-qa', 'waitForAppReady', {timeoutMs: 120_000});
        assert.equal((await operation(page, 'fotos-qa', 'getIdentity')).ownerId, owner);
    }

    const nativeIdentity = JSON.parse(await native(['--qa-domain', domain, 'getFotosSnapshot']));
    assert.equal(nativeIdentity.success, true);
    assert.equal(nativeIdentity.result.ownerId, owner);
    let storedReverse = false;
    if (checkpoint && !automatic) {
        const pattern = new RegExp(`^filer-to-fotos-${run}(?:-[a-f0-9]{6})?\\.jpg$`);
        const originals = nativeIdentity.result.collections.filter(item => item.path === '/Fotos')
            .flatMap(item => item.files).filter(file => pattern.test(file.name)
                && file.sha256 === digest(reverse) && file.size === reverse.length);
        assert.ok(originals.length <= 1, 'Reverse checkpoint must identify one exact stored original');
        if (originals.length === 1) {
            reverseName = originals[0].name;
            storedReverse = true;
            await record('native-reverse-retained', {name: reverseName, bytes: reverse.length, sha256: digest(reverse)});
        }
    }
    if (checkpoint) {
        const enrolled = checkpoint.steps.findLast(step => step.step === 'iom-enrollment');
        const previousOwner = checkpoint.steps.findLast(step => step.step === 'fotos-native-owner');
        assert.equal(enrolled?.result.status, 'committed');
        assert.equal(enrolled.result.sameOwner, owner);
        assert.equal(previousOwner?.result.instanceId, fotosIdentity.deviceInstanceId);
        await record('iom-resume', {sameOwner: owner, instanceId: fotosIdentity.deviceInstanceId, enrollment: 'retained'});
        if (automatic) {
            const waiting = native(['--qa-domain', domain, 'waitForFotos'], JSON.stringify({
                collectionPath: '/Fotos', files: [{name: forwardName, sha256: digest(forward)}],
                allowAdditionalFiles: true, timeoutMs: 60_000,
            }));
            void waiting.catch(() => {});
            await operation(page, 'fotos-qa', 'importPhotoFixture', {
                name: forwardName, mimeType: 'image/png', bytesBase64: forward.toString('base64'),
            });
            assert.equal(JSON.parse(await waiting).success, true);
            await record('fotos-to-filer', {name: forwardName, bytes: forward.length, sha256: digest(forward),
                collectionPath: '/Fotos', verifiedBy: 'automatic ONE owned-library replication; native original read'});
        } else {
            const previousForward = checkpoint.steps.findLast(step => step.step === 'fotos-to-filer');
            assert.equal(previousForward?.result.sha256, digest(forward));
            const collection = nativeIdentity.result.collections.find(item => item.path !== '/Fotos'
                && item.files.some(file => file.name === forwardName && file.sha256 === digest(forward) && file.size === forward.length));
            assert.ok(collection, 'The previously transferred original must still exist in its verified native shared collection');
            await record('fotos-to-filer', {name: forwardName, bytes: forward.length, sha256: digest(forward),
                collectionPath: collection.path, verifiedBy: 'native runtime original read after resume'});
        }
    } else {
        const invitation = await operation(page, 'fotos-qa', 'createDeviceEnrollmentInvitation');
        const enrollmentUrl = new URL(invitation.url);
        assert.equal(enrollmentUrl.searchParams.get('fdi'), owner);
        await native(['--enroll-domain', domain, '--owner', owner], invitation.url);
        await record('iom-enrollment', {sameOwner: owner, status: 'committed'});

        const imported = await operation(page, 'fotos-qa', 'importPhotoFixture', {
            name: forwardName, mimeType: 'image/png', bytesBase64: forward.toString('base64'),
        });
        const collection = await operation(page, 'fotos-qa', 'createCollection', {name: `Gecko media ${run}`, photoHashes: [imported.hash]});
        const collectionPath = `/Fotos/${encodeURIComponent(collection.id).replace(/\./g, '%2E')} (${owner})`;
        const waiting = native(['--qa-domain', domain, 'waitForFotos'], JSON.stringify({
            collectionPath, files: [{name: forwardName, sha256: digest(forward)}], timeoutMs: 60_000,
        }));
        void waiting.catch(() => {});
        await operation(page, 'fotos-qa', 'setCollectionRecipients', {collectionId: collection.id, personIds: [owner]});
        const received = JSON.parse(await waiting);
        assert.equal(received.success, true);
        await record('fotos-to-filer', {name: forwardName, bytes: forward.length, sha256: digest(forward), verifiedBy: 'native runtime original read'});
    }
    const allPhotos = page.getByRole('navigation', {name: 'Breadcrumb'}).getByRole('button', {name: 'Photos', exact: true});
    await page.getByRole('button', {name: 'Show images', exact: true}).click();
    if (await allPhotos.count()) await allPhotos.click();

    const mount = path.join(process.env.HOME, 'Library/CloudStorage', `OneFiler-${domain}`);
    const roots = (await exec('/bin/ls', ['-1', mount], {timeout: 25_000})).stdout.trim().split('\n');
    const photos = roots.find(name => name === 'Photos' || name === 'Fotos');
    assert.ok(photos, 'The native Finder domain must expose its Photos import folder');
    const reverseFile = path.join(directory, reverseName);
    const arrival = operation(page, 'fotos-qa', 'waitForGalleryPhoto', {name: reverseName, timeoutMs: 120_000});
    void arrival.catch(() => {});
    if (!storedReverse) {
        await writeFile(reverseFile, reverse, {mode: 0o600});
        await exec('/bin/cp', [reverseFile, path.join(mount, photos, reverseName)], {timeout: 60_000});
    }
    const photo = await arrival;
    await record('filer-to-fotos-catalog', {name: reverseName, hash: photo.hash});
    await waitForVisiblePhoto(page, photo.hash);
    const exported = await operation(page, 'fotos', 'exportVisiblePhoto', {hash: photo.hash});
    const bytes = Buffer.from(exported.dataUrl.slice(exported.dataUrl.indexOf(',') + 1), 'base64');
    assert.deepEqual(bytes, reverse);
    await record('filer-to-fotos', {name: reverseName, bytes: bytes.length, sha256: digest(bytes), verifiedBy: 'Fotos browser original export'});
    await page.reload();
    await page.waitForFunction(() => typeof window.__api === 'function');
    await operation(page, 'fotos-qa', 'waitForAppReady', {timeoutMs: 120_000});
    const reopened = await operation(page, 'fotos-qa', 'getIdentity');
    assert.equal(reopened.ownerId, owner);
    const restored = await operation(page, 'fotos-qa', 'waitForGalleryPhoto', {name: reverseName, timeoutMs: 60_000});
    await waitForVisiblePhoto(page, restored.hash);
    const restoredExport = await operation(page, 'fotos', 'exportVisiblePhoto', {hash: restored.hash});
    assert.deepEqual(Buffer.from(restoredExport.dataUrl.split(',')[1], 'base64'), reverse);
    await record('reopen', {ownerId: reopened.ownerId, restoredOriginalSha256: digest(reverse)});
    await page.screenshot({path: path.join(directory, 'fotos-after-swap.png')});
    report.status = 'passed';
    await record('complete', {directionsVerified: 2, browserLeftRunning: true});
    console.log(`PASS: ${path.join(directory, 'report.json')}`);
    await new Promise(resolve => process.once('SIGTERM', resolve));
} catch (error) {
    report.status = 'failed';
    // Never serialize authentication payloads, invitation URLs or private browser state.
    await record('failure', {message: String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]')});
    if (context?.pages()[0]) await context.pages()[0].screenshot({path: path.join(directory, 'failure.png')}).catch(() => {});
    process.exitCode = 1;
} finally {
    await context?.close();
}
