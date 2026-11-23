import {strict as assert} from 'node:assert';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

async function importCodec() {
    const source = await readFile(new URL('../src/runtime/invitation-codec.ts', import.meta.url), 'utf8');
    const {code} = await transform(source, {loader: 'ts', format: 'esm'});
    const url = 'data:text/javascript,' + encodeURIComponent(code);
    return import(url);
}

const invitation = {
    token: 'test-token',
    publicKey: 'listener-key',
    url: 'wss://relay.example/comm'
};

test('parses desktop and one:// invitation URLs', async () => {
    const {parseInvitationInput} = await importCodec();
    for (const raw of [
        `https://vger.one/invites/invitePartner/?invited=true#${encodeURIComponent(JSON.stringify(invitation))}`,
        `one://one.filer/invites/inviteDevice?invited=true#${encodeURIComponent(JSON.stringify(invitation))}`,
        JSON.stringify(invitation),
        `  ${JSON.stringify(invitation)}  `
    ]) {
        assert.deepEqual(parseInvitationInput(raw), invitation);
    }
});

test('rejects malformed invitations with a clear error', async () => {
    const {parseInvitationInput} = await importCodec();
    assert.throws(() => parseInvitationInput(''), /empty/);
    assert.throws(() => parseInvitationInput('not-json{{{'), /neither/);
    assert.throws(
        () => parseInvitationInput('https://vger.one/invites/invitePartner/?invited=true#oops'),
        /neither/
    );
    assert.throws(
        () => parseInvitationInput(JSON.stringify({token: 'only-token'})),
        /missing required field/
    );
});

test('formats shareable IoM/IoP invitation URLs', async () => {
    const {formatInvitationUrl, parseInvitationInput} = await importCodec();
    const iom = formatInvitationUrl(invitation, 'IoM');
    const iop = formatInvitationUrl(invitation, 'IoP');
    assert.match(iom, /^https:\/\/one\.filer\/invites\/inviteDevice\?invited=true#/);
    assert.match(iop, /^https:\/\/one\.filer\/invites\/invitePartner\?invited=true#/);
    assert.deepEqual(parseInvitationInput(iom), invitation);
    assert.deepEqual(parseInvitationInput(iop), invitation);
});
