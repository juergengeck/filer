import type QuestionnaireModel from '../models/QuestionnaireModel.js';
import type {QuestionnaireResponses} from '../models/QuestionnaireModel.js';
import {DateToObjectDataTransformDirectory} from './cachedDirectories/DateToObjectDataTransformDirectory.js';
import {DaysDirectory} from './cachedDirectories/DaysDirectory.js';
import {MonthsDirectory} from './cachedDirectories/MonthsDirectory.js';
import {YearsDirectory} from './cachedDirectories/YearsDirectory.js';
import type {EasyDirectoryContent, EasyDirectoryEntry} from './utils/EasyFileSystem.js';
import EasyFileSystem from './utils/EasyFileSystem.js';
import type {ObjectData} from '../models/ChannelManager.js';

type ObjectDataType = QuestionnaireResponses;

/**
 * Provides a file system about questionnaire responses
 */
export default class QuestionnairesFileSystem extends EasyFileSystem {
    /**
     * Constructor
     * @param questionnaireModel
     */
    constructor(questionnaireModel: QuestionnaireModel) {
        super(true);
        const iterator = questionnaireModel.responsesIterator.bind(questionnaireModel);

        const rootDirectory = new YearsDirectory(iterator);
        rootDirectory
            .setSubDirectory(p => new MonthsDirectory(iterator, p))
            .setSubDirectory(p => new DaysDirectory(iterator, p))
            .setSubDirectory(
                p => new DateToObjectDataTransformDirectory<ObjectDataType>(iterator, p)
            )
            .setSubDirectoryAsFunction(this.parseDataFilesContent.bind(this));

        /*const rootDirectory2 = new DateObjectDataDirectories(iterator).setSubDirectoryAsFunction(
            this.parseDataFilesContent.bind(this)
        );*/

        this.setRootDirectory(rootDirectory.createDirectoryContent.bind(rootDirectory));
        questionnaireModel.onUpdated(rootDirectory.markCachesAsOutOfDate.bind(rootDirectory));
    }

    /**
     * @param data
     * @returns
     */
    private parseDataFilesContent(data: {data: ObjectData<ObjectDataType>}): EasyDirectoryContent {
        const objectData = data.data;

        const dir = new Map<string, EasyDirectoryEntry>();
        const creationTime = objectData.creationTime;
        const channelOwnerAddon = objectData.channelOwner ? `_${objectData.channelOwner}` : '';
        const time = `${creationTime.getHours()}-${creationTime.getMinutes()}-${creationTime.getSeconds()}-${creationTime.getMilliseconds()}`;

        objectData.data.response.forEach(response => {
            const nameAddon = `${response.status}${
                response.questionnaire ? `_${response.questionnaire}` : ''
            }`;
            dir.set(
                `${time}_${nameAddon}${channelOwnerAddon}_${creationTime.getMilliseconds()}.json`,
                {
                    type: 'regularFile',
                    content: JSON.stringify(response, null, 4)
                }
            );
        });

        return dir;
    }
}
