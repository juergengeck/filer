import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks';
import type {Person} from '@refinio/one.core/lib/recipes';
import type {
    EasyDirectoryContent,
    EasyDirectoryEntry
} from '@refinio/one.models/lib/fileSystems/utils/EasyFileSystem';
import EasyFileSystem from '@refinio/one.models/lib/fileSystems/utils/EasyFileSystem';

export interface FlexibelHealthPatient {
    /** Canonical clinical subject. Runtime owner/device identities never replace this id. */
    id: SHA256IdHash<Person>;
    label: string;
}

export interface FlexibelHealthEntry {
    /** Stable domain id; Glue-backed domains supply their Glue id here. */
    id: string;
    patientId: SHA256IdHash<Person>;
    domain: string;
    recordedAt: string;
    label?: string;
    extension?: string;
}

/**
 * Flexibel-owned adapter boundary consumed by Filer.
 *
 * Implementations read Flexibel's feed-forward clinical projection. They must not
 * scan unrestricted ONE storage or synthesize authorization from local files.
 */
export interface FlexibelHealthDataSource {
    init?(): Promise<void>;
    shutdown?(): Promise<void>;
    listPatients(): Promise<FlexibelHealthPatient[]>;
    listEntries(patientId: SHA256IdHash<Person>): Promise<FlexibelHealthEntry[]>;
    readEntry(entry: FlexibelHealthEntry): Promise<string | Uint8Array>;
}

function normalizedText(value: unknown, fallback: string): string {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function shortId(value: string): string {
    return value.slice(0, 8);
}

function entryFileName(entry: FlexibelHealthEntry): string {
    const time = Date.parse(entry.recordedAt);
    if (!Number.isFinite(time)) {
        throw new Error(`Flexibel health entry ${entry.id} has invalid recordedAt`);
    }
    const timestamp = new Date(time).toISOString().replace(/:/g, '-');
    const label = normalizedText(entry.label, normalizedText(entry.domain, 'Eintrag'));
    const extension = normalizedText(entry.extension, 'json').replace(/^\.+/, '');
    return `${timestamp} ${label} [${shortId(entry.id)}].${extension}`;
}

/** Read-only `/Gesundheit` view over the Flexibel-owned clinical projection. */
export default class FlexibelHealthFileSystem extends EasyFileSystem {
    constructor(private readonly source: FlexibelHealthDataSource) {
        super(true);
        this.setRootDirectory(this.createRoot.bind(this));
    }

    private async createRoot(): Promise<EasyDirectoryContent> {
        const patients = await this.source.listPatients();
        const root = new Map<string, EasyDirectoryEntry>();
        const labelCounts = new Map<string, number>();
        for (const patient of patients) {
            const label = normalizedText(patient.label, 'Patient');
            labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        }
        for (const patient of patients) {
            const label = normalizedText(patient.label, 'Patient');
            const name = labelCounts.get(label) === 1
                ? label
                : `${label} [${shortId(patient.id)}]`;
            if (root.has(name)) {
                throw new Error(`Flexibel health projection has duplicate patient path '${name}'`);
            }
            root.set(name, {
                type: 'directory',
                content: () => this.createPatientDirectory(patient)
            });
        }
        return root;
    }

    private async createPatientDirectory(
        patient: FlexibelHealthPatient
    ): Promise<EasyDirectoryContent> {
        const entries = await this.source.listEntries(patient.id);
        const domains = new Map<string, FlexibelHealthEntry[]>();
        for (const entry of entries) {
            if (entry.patientId !== patient.id) {
                throw new Error(
                    `Flexibel health entry ${entry.id} belongs to another canonical patient`
                );
            }
            const domain = normalizedText(entry.domain, 'Sonstiges');
            const domainEntries = domains.get(domain) ?? [];
            domainEntries.push(entry);
            domains.set(domain, domainEntries);
        }

        return new Map(
            [...domains.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([domain, domainEntries]) => [domain, {
                    type: 'directory' as const,
                    content: this.createDomainDirectory(domainEntries)
                }])
        );
    }

    private createDomainDirectory(entries: FlexibelHealthEntry[]): EasyDirectoryContent {
        const directory = new Map<string, EasyDirectoryEntry>();
        for (const entry of [...entries].sort((left, right) =>
            left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id)
        )) {
            const name = entryFileName(entry);
            if (directory.has(name)) {
                throw new Error(`Flexibel health projection has duplicate entry path '${name}'`);
            }
            directory.set(name, {
                type: 'regularFile',
                content: () => this.source.readEntry(entry)
            });
        }
        return directory;
    }
}
