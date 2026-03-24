import type JournalModel from '../models/JournalModel.js';
import {DateToObjectDataTransformDirectory} from './cachedDirectories/DateToObjectDataTransformDirectory.js';
import {DaysDirectory} from './cachedDirectories/DaysDirectory.js';
import {MonthsDirectory} from './cachedDirectories/MonthsDirectory.js';
import {YearsDirectory} from './cachedDirectories/YearsDirectory.js';
import type {EasyDirectoryContent, EasyDirectoryEntry} from './utils/EasyFileSystem.js';
import EasyFileSystem from './utils/EasyFileSystem.js';
import type {ObjectData} from '../models/ChannelManager.js';

type ObjectDataType = unknown;

/**
 * Provides information about journal registered events
 */
export default class JournalFileSystem extends EasyFileSystem {
    /**
     * Constructor
     * @param journalModel
     */
    constructor(journalModel: JournalModel) {
        super(true);
        const iterator = journalModel.objectDataIterator.bind(journalModel);

        const rootDirectory = new YearsDirectory(iterator);
        rootDirectory
            .setSubDirectory(p => new MonthsDirectory(iterator, p))
            .setSubDirectory(p => new DaysDirectory(iterator, p))
            .setSubDirectory(
                p => new DateToObjectDataTransformDirectory<ObjectDataType>(iterator, p)
            )
            .setSubDirectoryAsFunction(JournalFileSystem.parseDataFilesContent);

        this.setRootDirectory(rootDirectory.createDirectoryContent.bind(rootDirectory));
        journalModel.onUpdated(rootDirectory.markCachesAsOutOfDate.bind(rootDirectory));
    }

    /**
     * @param data
     * @returns
     */
    private static parseDataFilesContent(data: {
        data: ObjectData<ObjectDataType>;
    }): EasyDirectoryContent {
        const objectData = data.data;
        const creationTime = objectData.creationTime;
        const channelOwnerAddon = objectData.channelOwner ? `_${objectData.channelOwner}` : '';
        const time = `${creationTime.getHours()}-${creationTime.getMinutes()}-${creationTime.getSeconds()}-${creationTime.getMilliseconds()}`;

        return new Map<string, EasyDirectoryEntry>([
            [
                `${time}${channelOwnerAddon}_${creationTime.getMilliseconds()}`,
                {
                    type: 'regularFile',
                    content: JSON.stringify(objectData)
                }
            ]
        ]);
    }
}
