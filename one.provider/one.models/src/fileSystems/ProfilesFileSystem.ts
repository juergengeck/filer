import {getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type LeuteModel from '../models/Leute/LeuteModel.js';
import type SomeoneModel from '../models/Leute/SomeoneModel.js';
import type {EasyDirectoryContent, EasyDirectoryEntry} from './utils/EasyFileSystem.js';
import EasyFileSystem from './utils/EasyFileSystem.js';

/**
 * Provides information about user profiles
 */
export default class ProfilesFileSystem extends EasyFileSystem {
    private readonly leuteModel: LeuteModel;

    /**
     * Constructor
     * @param leuteModel
     */
    constructor(leuteModel: LeuteModel) {
        super(true);
        this.leuteModel = leuteModel;
        this.setRootDirectory(this.createMainProfilesFolders.bind(this));
    }

    /**
     * creates main profile folders
     * @returns
     */
    async createMainProfilesFolders(): Promise<EasyDirectoryContent> {
        const dir = new Map<string, EasyDirectoryEntry>();
        const someones = [await this.leuteModel.me(), ...(await this.leuteModel.others())];

        await Promise.all(
            someones.map(async someone => {
                const mainProfile = await someone.mainProfile();
                const folderName = `${await this.leuteModel.getDefaultProfileDisplayName(
                    mainProfile.personId
                )}_${mainProfile.idHash}`;
                dir.set(folderName, {
                    type: 'directory',
                    content: this.createSomeoneFolders.bind(this, someone)
                });
            })
        );

        return dir;
    }

    /**
     * creates profile files for each someone identity profile
     * @param someone
     * @returns {EasyDirectoryContent}
     */
    async createSomeoneFolders(someone: SomeoneModel): Promise<EasyDirectoryContent> {
        const dir = new Map<string, EasyDirectoryEntry>();
        const mainProfile = await someone.mainProfile();
        const profiles = await someone.profiles();

        await Promise.all(
            profiles.map(async profile => {
                const profileObj = await getObjectByIdHash(profile.idHash);
                const personCerts = await this.leuteModel.trust.getCertificates(
                    profileObj.obj.personId
                );
                const profileCerts = await this.leuteModel.trust.getCertificates(profileObj.hash);
                const personNames = profile.descriptionsOfType('PersonName');
                const isMain = mainProfile.idHash === profile.idHash;
                const isDefault = profile.profileId === 'default';
                dir.set(
                    `${isMain ? 'Main_' : ''}${isDefault ? 'Default_' : ''}${
                        personNames.length > 0 ? `${personNames[0].name}_` : ''
                    }${profile.idHash}.txt`,
                    {
                        type: 'regularFile',
                        content: JSON.stringify(
                            {
                                profile: profileObj,
                                profileCertificates: profileCerts,
                                personCertificates: personCerts
                            },
                            null,
                            2
                        )
                    }
                );
            })
        );

        return dir;
    }
}
