import {describe, it} from 'mocha';
import {expect} from 'chai';
import TemporaryFileSystem from '../lib/fileSystems/TemporaryFileSystem.js';
import EasyFileSystem from '../lib/fileSystems/utils/EasyFileSystem.js';

describe('TemporaryFileSystem', () => {
    it('should return directory mode for mount points', async () => {
        const tempFs = new TemporaryFileSystem();

        // Mount filesystems at different paths
        await tempFs.mountFileSystem('/chats', new EasyFileSystem());
        await tempFs.mountFileSystem('/debug', new EasyFileSystem());
        await tempFs.mountFileSystem('/objects', new EasyFileSystem());
        await tempFs.mountFileSystem('/types', new EasyFileSystem());
        await tempFs.mountFileSystem('/invites', new EasyFileSystem());

        // Check that mount points are recognized as directories
        const chatsStat = await tempFs.stat('/chats');
        const debugStat = await tempFs.stat('/debug');
        const objectsStat = await tempFs.stat('/objects');
        const typesStat = await tempFs.stat('/types');
        const invitesStat = await tempFs.stat('/invites');

        // Check mode has directory bit set (0o040000)
        expect(chatsStat.mode & 0o040000).to.equal(0o040000, '/chats should be a directory');
        expect(debugStat.mode & 0o040000).to.equal(0o040000, '/debug should be a directory');
        expect(objectsStat.mode & 0o040000).to.equal(0o040000, '/objects should be a directory');
        expect(typesStat.mode & 0o040000).to.equal(0o040000, '/types should be a directory');
        expect(invitesStat.mode & 0o040000).to.equal(0o040000, '/invites should be a directory');

        // Also check the exact mode value
        expect(chatsStat.mode).to.equal(0o0040555, '/chats should have mode 0o0040555');
        expect(debugStat.mode).to.equal(0o0040555, '/debug should have mode 0o0040555');
    });

    it('should return directory mode for root path', async () => {
        const tempFs = new TemporaryFileSystem();

        const rootStat = await tempFs.stat('/');

        // Check mode has directory bit set
        expect(rootStat.mode & 0o040000).to.equal(0o040000, '/ should be a directory');
        expect(rootStat.mode).to.equal(0o0040555, '/ should have mode 0o0040555');
    });

    it('should list mount points in root directory', async () => {
        const tempFs = new TemporaryFileSystem();

        // Mount filesystems
        await tempFs.mountFileSystem('/chats', new EasyFileSystem());
        await tempFs.mountFileSystem('/debug', new EasyFileSystem());
        await tempFs.mountFileSystem('/objects', new EasyFileSystem());

        const rootDir = await tempFs.readDir('/');

        expect(rootDir.children).to.be.an('array');
        expect(rootDir.children).to.include('chats');
        expect(rootDir.children).to.include('debug');
        expect(rootDir.children).to.include('objects');
    });
});