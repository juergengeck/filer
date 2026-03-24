/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */

import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';

import * as StorageTestInit from './_helpers.js';
import TestModel from './utils/TestModel.js';
import QuestionnaireModel from '../lib/models/QuestionnaireModel.js';
import {questionnaireResponseType} from '../lib/models/QuestionnaireModel.js';

import {SYSTEM} from '@refinio/one.core/lib/system/platform.js';
await import(`@refinio/one.core//lib/system/load-${SYSTEM}.js`);

let testModel: TestModel;

describe('Questionnaire model test', () => {
    before(async () => {
        await StorageTestInit.init();
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
    });

    after(async () => {
        await testModel.shutdown();
        await closeAndDeleteCurrentInstance();
    });

    it('post a questionnaire reponse', async () => {
        const qm = new QuestionnaireModel(testModel.channelManager);
        await qm.init();

        // Register a questionnaire
        qm.registerQuestionnaires([
            {
                resourceType: 'Questionnaire',
                language: 'de',
                url: 'http://refinio.one/test/questionaire/irgendetwas',
                name: 'irgendetwas',
                status: 'active',
                item: [
                    {
                        linkId: 'link1',
                        prefix: 'pre1',
                        text: 'Geben Sie irgendein Datum und irgendeine Uhrzeit ein',
                        type: 'date',
                        disabledDisplay: 'protected'
                    },
                    {
                        linkId: 'link2',
                        prefix: 'pre2',
                        text: 'Wählen Sie irgendetwas aus',
                        type: 'choice',
                        disabledDisplay: 'protected',
                        answerOption: [
                            {
                                valueCoding: {
                                    system: 'http://refinio.one/test/valueCoding/irgendetwas',
                                    version: '1.0',
                                    code: '0',
                                    display: 'Nichts'
                                }
                            },
                            {
                                valueCoding: {
                                    system: 'http://refinio.one/test/valueCoding/irgendetwas',
                                    version: '1.0',
                                    code: '1',
                                    display: 'irgendetwas'
                                }
                            },
                            {
                                valueCoding: {
                                    system: 'http://refinio.one/test/valueCoding/irgendetwas',
                                    version: '1.0',
                                    code: '2',
                                    display: 'Alles'
                                }
                            }
                        ]
                    },
                    {
                        linkId: 'link3',
                        prefix: 'pre3',
                        text: 'Geben Sie irgendetwas ein',
                        type: 'string',
                        disabledDisplay: 'protected'
                    }
                ]
            }
        ]);

        // Post the questionnaires
        await qm.postResponseCollection(
            [
                {
                    resourceType: questionnaireResponseType,
                    questionnaire: 'http://refinio.one/test/questionaire/irgendetwas',
                    status: 'completed',
                    item: [
                        {
                            linkId: 'link1',
                            answer: [{valueDate: '2020-15-07T00:10'}]
                        },
                        {
                            linkId: 'link2',
                            answer: [
                                {
                                    valueCoding: {
                                        system: 'http://refinio.one/test/valueCoding/irgendetwas',
                                        version: '1.0',
                                        code: '1'
                                    }
                                }
                            ]
                        },
                        {
                            linkId: 'link3',
                            answer: [
                                {
                                    valueString: 'irgendetwas'
                                }
                            ]
                        }
                    ]
                }
            ],
            'name',
            'type'
        );

        // Read the questionnaires
        const responses = await qm.responses();
        expect(responses.length).to.be.equal(1);

        await qm.shutdown();
    });
});
