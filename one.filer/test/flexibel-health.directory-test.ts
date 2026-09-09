import {expect} from 'chai';
import type {Person} from '@refinio/one.core/lib/recipes';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks';
import FlexibelHealthFileSystem from '../lib/fileSystems/FlexibelHealthFileSystem';
import type {
    FlexibelHealthDataSource,
    FlexibelHealthEntry
} from '../lib/fileSystems/FlexibelHealthFileSystem';

function personId(character: string): SHA256IdHash<Person> {
    return character.repeat(64) as SHA256IdHash<Person>;
}

describe('Flexibel health directory', () => {
    const patientId = personId('a');
    const entry: FlexibelHealthEntry = {
        id: 'glue:clinical:assessment:42',
        patientId,
        domain: 'Assessments',
        recordedAt: '2026-09-02T10:15:00.000Z',
        label: 'Spastik',
        extension: 'json'
    };
    const source: FlexibelHealthDataSource = {
        listPatients: async () => [{id: patientId, label: 'Ada Beispiel'}],
        listEntries: async id => id === patientId ? [entry] : [],
        readEntry: async selected => JSON.stringify({
            id: selected.id,
            patient: selected.patientId,
            score: 3
        })
    };

    it('renders the feed-forward projection below canonical patient and domain paths', async () => {
        const fileSystem = new FlexibelHealthFileSystem(source);
        const root = await fileSystem.readDir('/');
        expect(root.children).to.have.length(1);
        expect(root.children[0]).to.contain('Ada Beispiel');

        const patientPath = `/${root.children[0]}`;
        expect((await fileSystem.readDir(patientPath)).children).to.deep.equal(['Assessments']);

        const domainPath = `${patientPath}/Assessments`;
        const files = await fileSystem.readDir(domainPath);
        expect(files.children).to.have.length(1);
        expect(files.children[0]).to.contain('[glueːcli]');

        const content = Buffer.from(
            (await fileSystem.readFile(`${domainPath}/${files.children[0]}`)).content
        ).toString('utf8');
        expect(JSON.parse(content)).to.deep.equal({
            id: entry.id,
            patient: patientId,
            score: 3
        });
    });

    it('rejects an entry projected beneath the wrong canonical patient', async () => {
        const invalidSource: FlexibelHealthDataSource = {
            ...source,
            listEntries: async () => [{...entry, patientId: personId('b')}]
        };
        const fileSystem = new FlexibelHealthFileSystem(invalidSource);
        const patientDirectory = (await fileSystem.readDir('/')).children[0];

        let error: Error | undefined;
        try {
            await fileSystem.readDir(`/${patientDirectory}`);
        } catch (caught) {
            error = caught as Error;
        }
        expect(error?.message).to.contain('belongs to another canonical patient');
    });
});
