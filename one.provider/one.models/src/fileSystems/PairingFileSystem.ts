import type {Instance} from '@refinio/one.core/lib/recipes.js';
import type {Invitation} from '../misc/ConnectionEstablishment/PairingManager.js';
import type {
    FileDescription,
    FileSystemDirectory,
    FileSystemFile,
    IFileSystem
} from './IFileSystem.js';
import {createError} from '@refinio/one.core/lib/errors.js';
import {FS_ERRORS} from './FileSystemErrors.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import qrcode from 'qrcode';
import type ConnectionsModel from '../models/ConnectionsModel.js';
import type IoMManager from '../models/IoM/IoMManager.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import { getArrayBuffer } from '@refinio/one.core/lib/util/buffer.js';

/**
 * This file systems provides pairing information so that other instances can pair to this instance.
 *
 * Pairing information is provided as QR-Code and invite url as text. The following files exist:
 * - /iom_invite.png: QR invite for IoM pairing - This will automatically create an IoM Request
 *                    after successful pairing.
 * - /iom_invite.txt: URL invite for IoM pairing - This will automatically create an IoM Request
 *                    after successful pairing.
 * - /iop_invite.png: QR invite for IoP pairing
 * - /iop_invite.txt: URL invite for IoP pairing
 *
 */
export default class PairingFileSystem implements IFileSystem {
    private iomInvite: Invitation | undefined; // Pairing information for IoM invite
    private iopInvite: Invitation | undefined; // Pairing information for IoP invite

    private readonly connectionsModel: ConnectionsModel;
    private readonly iomManager: IoMManager;

    private readonly inviteUrlPrefix: string; // Url prefix used for the invite url

    // Internally used list of provided files
    private static readonly files = [
        'iom_invite.png',
        'iom_invite.txt',
        'iop_invite.png',
        'iop_invite.txt'
    ];

    /**
     * Constructor
     *
     * @param connectionsModel
     * @param iomManager
     * @param inviteUrlPrefix
     * @param iomRequestMode
     */
    constructor(
        connectionsModel: ConnectionsModel,
        iomManager: IoMManager,
        inviteUrlPrefix: string,
        iomRequestMode: 'full' | 'light' = 'full'
    ) {
        this.connectionsModel = connectionsModel;
        this.iomManager = iomManager;
        this.inviteUrlPrefix = inviteUrlPrefix;

        connectionsModel.pairing.onPairingSuccess(
            (
                initiatedLocally: boolean,
                localPersonId: SHA256IdHash<Person>,
                localInstanceId: SHA256IdHash<Instance>,
                remotePersonId: SHA256IdHash<Person>,
                remoteInstanceId: SHA256IdHash<Instance>,
                token: string
            ) => {
                if (this.iomInvite && token === this.iomInvite.token) {
                    this.refreshIomInvite().catch(console.error);
                    this.iomManager.requestManager
                        .createIoMRequest(
                            localPersonId,
                            remotePersonId,
                            localPersonId,
                            iomRequestMode
                        )
                        .catch(console.error);
                }
                if (this.iopInvite && token === this.iopInvite.token) {
                    this.refreshIomInvite().catch(console.error);
                }
            }
        );
    }

    async createDir(directoryPath: string, dirMode: number): Promise<void> {
        throw await this.getNoWritePermissionError(directoryPath);
    }

    async createFile(
        directoryPath: string,
        fileHash: SHA256Hash<BLOB>,
        fileName: string,
        fileMode: number
    ): Promise<void> {
        throw await this.getNoWritePermissionError(directoryPath);
    }

    async exists(path: string): Promise<boolean> {
        // remove the leading '/' with slice
        return PairingFileSystem.files.includes(path.slice(1));
    }

    async readDir(dirPath: string): Promise<FileSystemDirectory> {
        if (dirPath !== '/') {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: dirPath
            });
        }

        return {children: PairingFileSystem.files};
    }

    async readFile(filePath: string): Promise<FileSystemFile> {
        console.log(`[PairingFileSystem] readFile() called for: ${filePath}`);
        switch (filePath) {
            case '/iom_invite.png':
                return {
                    content: await this.convertPairingInformationToQrCode(
                        await this.getAndRefreshIomInviteIfNoneExists()
                    )
                };
            case '/iom_invite.txt':
                return {
                    content: getArrayBuffer(new TextEncoder().encode(
                        this.convertInvitationToUrl(await this.getAndRefreshIomInviteIfNoneExists())
                    ))
                };
            case '/iop_invite.png':
                return {
                    content: await this.convertPairingInformationToQrCode(
                        await this.getAndRefreshIopInviteIfNoneExists()
                    )
                };
            case '/iop_invite.txt': {
                const invitation = await this.getAndRefreshIopInviteIfNoneExists();
                const url = this.convertInvitationToUrl(invitation);
                console.log(`[PairingFileSystem] Returning IoP invite with token: ${invitation.token.substring(0, 16)}...`);
                console.log(`[PairingFileSystem] Invite URL length: ${url.length} bytes`);
                return {
                    content: getArrayBuffer(new TextEncoder().encode(url))
                };
            }
            default:
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: filePath
                });
        }
    }

    async readFileInChunks(
        filePath: string,
        length: number,
        position: number
    ): Promise<FileSystemFile> {
        return {
            content: (await this.readFile(filePath)).content.slice(position, position + length)
        };
    }

    async chmod(pathName: string, mode: number): Promise<number> {
        throw await this.getNoWritePermissionError(pathName);
    }

    async rename(src: string, dest: string): Promise<number> {
        throw await this.getNoWritePermissionError(dest);
    }

    async rmdir(pathName: string): Promise<number> {
        throw await this.getNoWritePermissionError(pathName);
    }

    async unlink(pathName: string): Promise<number> {
        throw await this.getNoWritePermissionError(pathName);
    }

    async stat(path: string): Promise<FileDescription> {
        if (path === '/') {
            return {mode: 0o0040555, size: 0};
        }

        if (await this.exists(path)) {
            const file = await this.readFile(path);
            if (file) {
                return {mode: 0o0100444, size: file.content.byteLength};
            }
        }

        throw createError('FSE-ENOENT', {message: FS_ERRORS['FSE-ENOENT'].message, path: path});
    }

    async symlink(src: string, dest: string): Promise<void> {
        throw createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message,
            functionName: 'symlink()',
            path: src
        });
    }

    async readlink(filePath: string): Promise<FileSystemFile> {
        throw createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message,
            functionName: 'readLink()',
            path: filePath
        });
    }

    supportsChunkedReading(path?: string): boolean {
        return true;
    }

    // ######## manage invites ########

    /**
     * Creates a new IoM invite and stores it in this.iomInvite
     */
    private async refreshIomInvite(): Promise<void> {
        this.iomInvite = await this.connectionsModel.pairing.createInvitation();
    }

    /**
     * Creates a new IoM invite and stores it in this.iomInvite if this.iomInvite is undefined.
     */
    private async getAndRefreshIomInviteIfNoneExists(): Promise<Invitation> {
        console.log(`[PairingFileSystem] Creating new IoM invitation...`);
        const pairingInformation = await this.connectionsModel.pairing.createInvitation();
        this.iomInvite = pairingInformation;
        console.log(`[PairingFileSystem] ✅ IoM invitation created:`);
        console.log(`  - Token: ${pairingInformation.token.substring(0, 16)}... (${pairingInformation.token.length} chars)`);
        console.log(`  - PublicKey: ${pairingInformation.publicKey.substring(0, 32)}... (${pairingInformation.publicKey.length} chars)`);
        console.log(`  - Connection URL: ${pairingInformation.url}`);
        console.log(`  - Invite URL: ${this.convertInvitationToUrl(pairingInformation)}`);
        return pairingInformation;
    }

    /**
     * Creates a new IoP invite and stores it in this.iopInvite
     */
    private async refreshIopInvite(): Promise<void> {
        this.iopInvite = await this.connectionsModel.pairing.createInvitation();
    }

    /**
     * Creates a new IoP invite and stores it in this.iopInvite if this.iopInvite is undefined.
     */
    private async getAndRefreshIopInviteIfNoneExists(): Promise<Invitation> {
        console.log(`[PairingFileSystem] Creating new IoP invitation...`);
        const pairingInformation = await this.connectionsModel.pairing.createInvitation();
        this.iopInvite = pairingInformation;
        console.log(`[PairingFileSystem] ✅ IoP invitation created:`);
        console.log(`  - Token: ${pairingInformation.token.substring(0, 16)}... (${pairingInformation.token.length} chars)`);
        console.log(`  - PublicKey: ${pairingInformation.publicKey.substring(0, 32)}... (${pairingInformation.publicKey.length} chars)`);
        console.log(`  - Connection URL: ${pairingInformation.url}`);
        console.log(`  - Invite URL: ${this.convertInvitationToUrl(pairingInformation)}`);
        return pairingInformation;
    }

    // ######## convert pairing information to url or qr code ########

    /**
     * Transforms the pairing information to an url.
     *
     * @param invitation
     */
    private convertInvitationToUrl(invitation: Invitation): string {
        const encodedInformation = encodeURIComponent(JSON.stringify(invitation));
        return `${this.inviteUrlPrefix}#${encodedInformation}`;
    }

    /**
     * Transforms the pairing information to an url and stores it inside an QR code image as png.
     *
     * @param invitation
     */
    private async convertPairingInformationToQrCode(invitation: Invitation): Promise<ArrayBuffer> {
        const buffer = await qrcode.toBuffer(this.convertInvitationToUrl(invitation));
        return getArrayBuffer(buffer);
    }

    /**
     * This will construct the appropriate error for not having write permissions.
     *
     * If the file does not exist, then it will return ENOENT, otherwise it will return EACCESS.
     *
     * @param path
     */
    private async getNoWritePermissionError(path: string): Promise<Error> {
        if (await this.exists(path)) {
            return createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path
            });
        } else {
            return createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path
            });
        }
    }
}
