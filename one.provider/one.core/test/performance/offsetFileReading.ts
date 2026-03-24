/*
  eslint-disable
  no-await-in-loop,
  no-console,
  require-jsdoc,
  no-sync,
  jsdoc/valid-types
 */

/**
 * @file Version map files consist of lines of fixed size. Accessing any line of a version map
 * can be done by calculating the offset and reading exactly the desired line. The last line for
 * the latest version requires a call to stat() to get the size of the file.
 * This test is to decide if - and when - using offset-reading is better than the naive solution
 * of always reading the entire version map followed by a string operation to get the desired line.
 */

import {access, mkdir, open, readFile, rm, writeFile} from 'fs/promises';
import {basename, dirname, join} from 'path';
import {fileURLToPath} from 'url';

import {createRandomSHA256Hash} from '../../lib/system/crypto-helpers.js';
import {SYSTEM} from '../../lib/system/platform.js';
import {serializeWithType} from '../../lib/util/promise.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DIR = join(__dirname, basename(__filename, '.js') + '.FILES');

const NR_FILES = 5;
const NR_ENTRIES = [10, 100, 500, 1000, 10000];

const LINE_LENGTH = 16 + 1 + 64 + 1 + 64 + 1;

/**
 * @param {string} file - A file or a directory name incl. path
 * @returns {Promise<boolean>}
 */
async function fileExists(file: string): Promise<boolean> {
    return await access(file)
        .then(() => true)
        .catch(err => {
            if (err.code === 'ENOENT') {
                return false;
            } else {
                throw new Error(err);
            }
        });
}

/**
 * Write a simulated version map file with varying nr. of entries
 * @param {number} nrEntries
 * @param {number} index
 * @returns {Promise<void>}
 */
async function createTestFile(nrEntries: number, index: number): Promise<void> {
    const contents = await Promise.all(
        Array(nrEntries)
            .fill(null)
            .map(
                async () =>
                    Date.now().toString().padStart(16, '0') +
                    ',' +
                    (await createRandomSHA256Hash()) +
                    ',' +
                    (await createRandomSHA256Hash())
            )
    );

    const filename = `${index}.${nrEntries}`;

    console.log(`Write test file ${filename} with ${nrEntries} entries`);

    await writeFile(join(TEST_DIR, filename), contents.join('\n') + '\n');
}

/**
 * @returns {Promise<boolean>} - Returns `true` if the test files and directory had to be
 * created, `false` if they already existed
 */
async function createTestFiles(): Promise<boolean> {
    const testDirExists = await fileExists(TEST_DIR);

    if (testDirExists) {
        console.log(`Test file directory ${TEST_DIR} already exists.`);
        return false;
    }

    await mkdir(TEST_DIR, {recursive: true});

    for (const nrEntries of NR_ENTRIES) {
        console.log(`Create ${NR_FILES} test files with ${nrEntries} entries`);

        await Promise.all(
            Array(NR_FILES)
                .fill(null)
                .map((_item, index) => createTestFile(nrEntries, index))
        );
    }

    return true;
}

/**
 * @param {string} filename - Filename without the test directory
 * @param {number} [index=-1] - The index of the entry (line) to retrieve. A negative value means
 * to start from the end of the file. The default of -1 retrieves the last entry/line.
 * @returns {Promise<string>>}
 */
function getNthLineSerializedFullFileRead(filename: string, index: number = -1): Promise<string> {
    async function getNthLineSerializedCb(): Promise<string> {
        let newIndex = index;

        const mapData = await readFile(join(TEST_DIR, filename), 'utf8');
        const total = mapData.length / LINE_LENGTH;

        if (newIndex > total - 1 || newIndex < -total) {
            throw Error(`VMQ-GNTH1: ${newIndex}/${total}`);
        }

        if (newIndex < 0) {
            newIndex = total + newIndex;
        }

        return mapData.slice(LINE_LENGTH * newIndex, LINE_LENGTH * newIndex + LINE_LENGTH);
    }

    return serializeWithType('VersionMap ' + filename, getNthLineSerializedCb);
}

/**
 * @param {string} filename - Filename without the test directory
 * @param {number} [index=-1] - The index of the entry (line) to retrieve. A negative value means
 * to start from the end of the file. The default of -1 retrieves the last entry/line.
 * @returns {Promise<string>>}
 */
function getNthLineSerializedPartialFileRead(
    filename: string,
    index: number = -1
): Promise<string> {
    async function getNthLineSerializedCb(): Promise<string> {
        let newIndex = index;

        const fd = await open(join(TEST_DIR, filename), 'r');

        const stats = await fd.stat();
        const total = stats.size / LINE_LENGTH;

        if (!Number.isInteger(total)) {
            throw Error(`File size ${stats.size} and line length ${LINE_LENGTH} lead to ${total}`);
        }

        if (newIndex > total - 1 || newIndex < -total) {
            throw Error(`VMQ-GNTH1: ${newIndex}/${total}`);
        }

        if (newIndex < 0) {
            newIndex = total + newIndex;
        }

        const {buffer} = await fd.read(
            Buffer.alloc(LINE_LENGTH),
            0,
            LINE_LENGTH,
            LINE_LENGTH * newIndex
        );

        await fd.close();

        return buffer.toString('utf-8');
    }

    return serializeWithType('VersionMap ' + filename, getNthLineSerializedCb);
}

/**
 * @param {(file: string, idx?: number) => Promise<string>} fn - The function to test and measure
 * @returns {Promise<Record<string, string[]>>}
 */
async function readAndMeasureReads(
    fn: (file: string, idx?: number) => Promise<string>
): Promise<Record<string, string[]>> {
    const results = {} as Record<string, string[]>;

    for (const nrEntries of NR_ENTRIES) {
        console.log(`Read test files with ${nrEntries} entries`);

        results[nrEntries.toString()] = new Array(NR_FILES).fill(undefined);

        for (let i = 0; i < NR_FILES; i++) {
            const start = process.hrtime.bigint();
            await fn(`${i}.${nrEntries}`);
            results[nrEntries.toString()][i] = (
                (process.hrtime.bigint() - start) /
                BigInt(1000)
            ).toLocaleString();
        }
    }

    return results;
}

/**
 * @returns {Promise<void>}
 */
async function run(): Promise<void> {
    await import(`../../lib/system/load-${SYSTEM}.js`);

    // TEST SETUP
    console.log('========== Begin Offset-File-Reading Performance Test ==============\n');

    const testDirExisted = await createTestFiles();

    // TEST 1: Full file reads
    console.log(await readAndMeasureReads(getNthLineSerializedFullFileRead));

    // TEST 2: Partial offset+length based file reads
    console.log(await readAndMeasureReads(getNthLineSerializedPartialFileRead));

    // TEST TAKE DOWN
    if (testDirExisted) {
        // Only remove what we created, don't remove files that already existed
        console.log(`Removing test files and directory ${TEST_DIR}`);
        await rm(TEST_DIR, {recursive: true, force: true});
    }
    console.log('\n========== Done Offset-File-Reading Performance Test ===============\n');
}

run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
