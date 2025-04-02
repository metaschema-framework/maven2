import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

function findDirectories(baseDir: string, pattern: RegExp): string[] {
    const results: string[] = [];

    function traverse(dir: string) {
        const files = fs.readdirSync(dir);

        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                if (pattern.test(file)) {
                    results.push(fullPath);
                }
                traverse(fullPath); // Recurse into subdirectory
            }
        }
    }

    traverse(baseDir);
    return results;
}

interface Versioning {
    lastUpdated: string,
    snapshot: {
        timestamp: string,
        buildNumber: number
    },
    snapshotVersions: Snapshot[]
}

interface Snapshot {
    classifier?: string,
    extension: string,
    value: string,
    updated: string
}

interface Metadata {
    metadata: {
        groupId: string,
        artifactId: string
        versioning: Versioning,
        version: string
    }
}

async function readMetadata(file: string): Promise<Metadata> {
    const xml = await fs.promises.readFile(file, 'utf8');

    const parser = new XMLParser({
      ignoreAttributes: false,
    });
    return parser.parse(xml);
}

// Example usage:
const directory = '../dev'; // Current directory
const namePattern = /.*-SNAPSHOT/i; // Case-insensitive pattern for names containing "test"

const matchingDirectories = findDirectories(directory, namePattern);
for (const dir of matchingDirectories) {
    readMetadata(dir + "/maven-metadata.xml").then(data => {
        const version = data.metadata.version;
        const versionPrefix = version.substring(0, version.length - "-SNAPSHOT".length);
        const artifact = data.metadata.artifactId;
        const commonPrefix =  artifact +
            "-" +
            versionPrefix +
            "-";
        const fullPrefix =  commonPrefix +
            data.metadata.versioning.snapshot.timestamp;
        console.log("common prefix: "+commonPrefix);
        console.log("full prefix: "+fullPrefix);
        const files = fs.readdirSync(dir);

        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (file.startsWith(commonPrefix)) {
                if (!file.startsWith(fullPrefix)) {
                    fs.rmSync(fullPath);
                    console.log("removed: "+fullPath);
                }
            }
        }
    });
}

