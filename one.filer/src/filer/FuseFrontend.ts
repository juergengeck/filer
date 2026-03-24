/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem';
import fs from 'fs';
import FuseApiToIFileSystemAdapter from './FuseApiToIFileSystemAdapter';
import {splitRoutePath} from '../misc/fuseHelper';

import { Fuse, OPERATIONS } from '../fuse/native-fuse3.js';
import type { Stats as FuseStats } from '../fuse/native-fuse3.js';

import {isFunction} from '@refinio/one.core/lib/util/type-checks-basic';

/**
 *  This is a fuse frontend.
 */
export class FuseFrontend {
    private fuseInstance: null | Fuse = null;

    /** Start the fuse frontend.
     *
     *  @param rootFileSystem - The file system implementation that should be mounted
     *  @param mountPoint - Specifies the mount point where to mount the filesystem
     *  @param logCalls - If true log all calls to console
     */
    public async start(
        rootFileSystem: IFileSystem,
        mountPoint: string,
        logCalls: boolean = false
    ): Promise<void> {
        if (this.fuseInstance) {
            throw Error('Fuse frontend already started');
        }

        FuseFrontend.setupMountPoint(mountPoint);

        // If we plan to have multiple implementations of the fuse API, then we need to move
        // this part outside this class. But at the moment we don't plan to do it (The
        // IFileSystem hopefully fits all), so it is easier not to expose this extra layer to
        // the outside.
        const fuseFileSystemAdapter = new FuseApiToIFileSystemAdapter(
            rootFileSystem,
            mountPoint,
            logCalls
        );

        // Why fuseHandlers: Fuse.OPERATIONS
        // THE TYPE HAS BEEN ADDED TO THAT THE FUNCTIONS ARE CHECKED AGAINST Fuse.OPERATIONS
        // Fuse.OPERATIONS has all members set to "optional", which makes the type for
        // fuseHandlers less exact, but the advantages of getting the API of the functions
        // checked is higher than the inconvenience of getting an additional "undefined" into
        // this type (which needs type assertion workarounds down in "if (logCalls)").

        // Create map of file system handlers for fuse instance
        const fuseHandlers: Required<OPERATIONS> = {
            init: (cb: (err: number) => void) => {
                console.log('🔧 FUSE init called');
                fuseFileSystemAdapter.fuseInit(cb);
            },
            error: (err: Error) => {
                console.error('🔧 FUSE error called:', err);
                fuseFileSystemAdapter.fuseError(() => {});
            },
            getattr: (path: string, cb: (err: number, stat?: any) => void) => {
                console.log('🔧 FUSE getattr called:', path);
                fuseFileSystemAdapter.fuseGetattr(path, cb);
            },
            readdir: (path: string, cb: (err: number, files?: string[]) => void) => {
                console.log('🔧 FUSE readdir called:', path);
                fuseFileSystemAdapter.fuseReaddir(path, cb);
            },
            access: fuseFileSystemAdapter.fuseAccess.bind(fuseFileSystemAdapter),
            statfs: fuseFileSystemAdapter.fuseStatfs.bind(fuseFileSystemAdapter),
            fgetattr: fuseFileSystemAdapter.fuseFgetattr.bind(fuseFileSystemAdapter),
            flush: fuseFileSystemAdapter.fuseFlush.bind(fuseFileSystemAdapter),
            fsync: fuseFileSystemAdapter.fuseFsync.bind(fuseFileSystemAdapter),
            fsyncdir: fuseFileSystemAdapter.fuseFsyncdir.bind(fuseFileSystemAdapter),
            truncate: fuseFileSystemAdapter.fuseTruncate.bind(fuseFileSystemAdapter),
            ftruncate: fuseFileSystemAdapter.fuseFtruncate.bind(fuseFileSystemAdapter),
            readlink: fuseFileSystemAdapter.fuseReadlink.bind(fuseFileSystemAdapter),
            chown: fuseFileSystemAdapter.fuseChown.bind(fuseFileSystemAdapter),
            chmod: fuseFileSystemAdapter.fuseChmod.bind(fuseFileSystemAdapter),
            mknod: fuseFileSystemAdapter.fuseMknod.bind(fuseFileSystemAdapter),
            setxattr: fuseFileSystemAdapter.fuseSetxattr.bind(fuseFileSystemAdapter),
            getxattr: (path: string, name: string, cb: (err: number, value?: Buffer) => void) => {
                fuseFileSystemAdapter.fuseGetxattr(path, name, 0, (err: number, xattr?: Buffer | null) => {
                    cb(err, xattr || undefined);
                });
            },
            listxattr: fuseFileSystemAdapter.fuseListxattr.bind(fuseFileSystemAdapter),
            removexattr: fuseFileSystemAdapter.fuseRemovexattr.bind(fuseFileSystemAdapter),
            open: fuseFileSystemAdapter.fuseOpen.bind(fuseFileSystemAdapter),
            opendir: fuseFileSystemAdapter.fuseOpendir.bind(fuseFileSystemAdapter),
            read: fuseFileSystemAdapter.fuseRead.bind(fuseFileSystemAdapter),
            write: fuseFileSystemAdapter.fuseWrite.bind(fuseFileSystemAdapter),
            release: fuseFileSystemAdapter.fuseRelease.bind(fuseFileSystemAdapter),
            releasedir: fuseFileSystemAdapter.fuseReleasedir.bind(fuseFileSystemAdapter),
            create: fuseFileSystemAdapter.fuseCreate.bind(fuseFileSystemAdapter),
            utimens: (path: string, atime: number, mtime: number, cb: (err: number) => void) => {
                fuseFileSystemAdapter.fuseUtimens(path, new Date(atime * 1000), new Date(mtime * 1000), cb);
            },
            unlink: fuseFileSystemAdapter.fuseUnlink.bind(fuseFileSystemAdapter),
            rename: fuseFileSystemAdapter.fuseRename.bind(fuseFileSystemAdapter),
            link: fuseFileSystemAdapter.fuseLink.bind(fuseFileSystemAdapter),
            symlink: fuseFileSystemAdapter.fuseSymlink.bind(fuseFileSystemAdapter),
            mkdir: fuseFileSystemAdapter.fuseMkdir.bind(fuseFileSystemAdapter),
            rmdir: fuseFileSystemAdapter.fuseRmdir.bind(fuseFileSystemAdapter)
        };

        if (logCalls) {
            for (const handlerId in fuseHandlers) {
                const oldHandler = fuseHandlers[handlerId as keyof typeof fuseHandlers];

                if (handlerId === 'init') {
                    fuseHandlers[handlerId] = (...args: any[]) =>
                        FuseFrontend.logFuseCall(oldHandler, ...args);
                } else {
                    fuseHandlers[handlerId as keyof typeof fuseHandlers] = (...args: any[]) =>
                        FuseFrontend.logFuseCallCB(
                            handlerId,
                            oldHandler as NonNullable<typeof oldHandler>,
                            ...args
                        );
                }
            }
        }

        this.fuseInstance = new Fuse(mountPoint, fuseHandlers, {
            displayFolder: 'One FUSE'
        });

        await new Promise<void>((resolve, reject) => {
            if (this.fuseInstance === null) {
                reject(Error('Fuse frontend not yet started'));
            } else {
                this.fuseInstance.mount(err => (err === null ? resolve() : reject(err)));
            }
        });
    }

    /** Stop the fuse frontend. */
    public async stop(): Promise<void> {
        if (this.fuseInstance) {
            return new Promise((resolve, reject) => {
                if (this.fuseInstance === null) {
                    reject(Error('Fuse frontend not yet started'));
                } else {
                    this.fuseInstance.unmount(err => (err === null ? resolve() : reject(err)));
                }
            });
        }
    }

    public static async isFuseNativeConfigured(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            Fuse.isConfigured((err, isConfigured) => {
                if (err !== null) {
                    reject(err);
                }

                resolve(isConfigured);
            });
        });
    }

    public static async configureFuseNative(): Promise<void> {
        return new Promise((resolve, reject) => {
            Fuse.configure(errConfigure => {
                if (errConfigure) {
                    reject(new Error(`\x1b[31mError: ${errConfigure.message}\x1b[0m`));
                } else {
                    resolve();
                }
            });
        });
    }

    // ############### PRIVATE Interface ###############

    /**
     * Sets up the mount point correctly for the current platform.
     *
     * @param mountPoint
     */
    private static setupMountPoint(mountPoint: string): void {
        switch (process.platform) {
            case 'win32':
                // the mounting folder must not exist on win32
                if (fs.existsSync(mountPoint)) {
                    fs.rmdirSync(mountPoint);
                }
                break;
            default:
                if (!fs.existsSync(mountPoint)) {
                    fs.mkdirSync(mountPoint);
                }
                break;
        }
    }

    /** Function that logs a fuse call and forwards all arguments to the real handler.
     *
     *  This function is registered as fuse-native callback instead of the callback methods in this
     *  class. It then logs the call and forwards it to the real callback
     *
     *  @param  handler - -  The callback implemented by this class. Calls are forwarded to this
     *  handler
     *  @param  args   -  Arguments that shall be passed to the handler
     */
    private static logFuseCall(handler: (...args2: any[]) => void, ...args: any[]): void {
        handler(...args);
    }

    /** Function that logs a fuse call with callback and forwards all arguments to the real handler.
     *
     *  This function is registered as fuse-native callback instead of the callback methods in this
     *  class. It then logs the call and forwards it to the real callback. It is also possible to
     *  log the return values, but this is disabled at the moment because of a bug when executing
     *  the application in the webstorm terminal
     *
     *  @param  name -  Name of fuse callback that is called by fuse-native
     *  @param  handler - The callback implemented by this class. Calls are forwarded to it
     *  @param  args -  Arguments that shall be passed to the handler
     */
    private static logFuseCallCB(
        name: string,
        handler: (...args2: any[]) => void,
        ...args: unknown[]
    ): void {
        const normalArgs = args.slice(0, -1);
        const cbArg = args[args.length - 1];

        if (!isFunction(cbArg)) {
            throw new Error(`cbArg is not a function but ${typeof cbArg}: ${String(cbArg)}`);
        }

        // Call the normal arguments and with a special callback functions to intercept the answers
        handler(...normalArgs, (...argscb: unknown[]) => {
            /*
             * Enabling logging of return values triggers a bug in Jetbrains for the getattr call
             * when the *time fields contain a date object (only if you execute the process in
             *  the jetbrains terminal).
             * The result is jetbrains and the node process hangs.
             * I have absolutely no idea why, but consider this when enabling this line
             */
            const returnedCode = parseInt(argscb[0] as string, 10);
            const route =
                String(normalArgs[0]) === '/'
                    ? '\x1b[40mroot\x1b[0m'
                    : String(normalArgs[0]).includes('/')
                    ? `\x1b[40m${splitRoutePath(normalArgs[0] as string).prefix}\x1b[0m`
                    : '';

            if (route === '.git') {
                cbArg(...argscb);
                return;
            }

            // it returned an error code
            if (returnedCode < 0) {
                console.log(
                    '\x1b[33m[WARN]:\x1b[0m',
                    route,
                    `| \x1b[33m${name}(${String(normalArgs)}) -> `,
                    `\x1b[35m${String(argscb[0])}\x1b[0m`
                );
            } else {
                console.log(
                    '\x1b[32m[INFO]:\x1b[0m',
                    route,
                    `| ${name}(${String(normalArgs)}) -> \x1b[35m${String(argscb[0])}\x1b[0m`
                );
            }

            cbArg(...argscb);
        });
    }
}
