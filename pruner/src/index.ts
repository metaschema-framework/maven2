import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import * as yaml from 'js-yaml';

// ============== CONFIGURATION ==============

interface RetentionConfig {
    days: number;
    minBuilds: number;
}

interface PrunerConfig {
    baseDir: string;
    retention: RetentionConfig;
    logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    snapshotPattern: string;
}

const DEFAULT_CONFIG: PrunerConfig = {
    baseDir: '../dev',
    retention: {
        days: 30,
        minBuilds: 1
    },
    logLevel: 'INFO',
    snapshotPattern: '.*-SNAPSHOT'
};

function loadConfig(): PrunerConfig {
    const configPath = path.join(__dirname, '..', 'config.yml');
    try {
        const configFile = fs.readFileSync(configPath, 'utf8');
        const fileConfig = yaml.load(configFile) as Partial<PrunerConfig>;
        return {
            ...DEFAULT_CONFIG,
            ...fileConfig,
            retention: {
                ...DEFAULT_CONFIG.retention,
                ...(fileConfig.retention || {})
            }
        };
    } catch (error) {
        logger.warn(`Could not load config.yml, using defaults: ${error}`);
        return DEFAULT_CONFIG;
    }
}

// ============== LOGGING ==============

enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

class Logger {
    private level: LogLevel;

    constructor(level: string = 'INFO') {
        this.level = LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO;
    }

    setLevel(level: string): void {
        this.level = LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO;
    }

    debug(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.DEBUG) {
            console.log(`[DEBUG] ${message}`, ...args);
        }
    }

    info(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.INFO) {
            console.log(`[INFO] ${message}`, ...args);
        }
    }

    warn(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.WARN) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    }

    error(message: string, ...args: unknown[]): void {
        if (this.level <= LogLevel.ERROR) {
            console.error(`[ERROR] ${message}`, ...args);
        }
    }
}

const logger = new Logger();

// ============== INTERFACES ==============

interface SnapshotVersion {
    classifier?: string;
    extension: string;
    value: string;
    updated: string;
}

interface Versioning {
    lastUpdated: string;
    snapshot: {
        timestamp: string;
        buildNumber: number;
    };
    snapshotVersions: {
        snapshotVersion: SnapshotVersion | SnapshotVersion[];
    };
}

interface Metadata {
    metadata: {
        '@_modelVersion'?: string;
        groupId: string;
        artifactId: string;
        versioning: Versioning;
        version: string;
    };
}

interface BuildInfo {
    timestamp: string;
    buildNumber: number;
    date: Date;
    snapshotVersions: SnapshotVersion[];
}

interface PruneResult {
    directory: string;
    buildsKept: number;
    buildsDeleted: number;
    filesDeleted: string[];
    metadataUpdated: boolean;
}

// ============== UTILITY FUNCTIONS ==============

function findDirectories(baseDir: string, pattern: RegExp): string[] {
    const results: string[] = [];

    function traverse(dir: string) {
        let files: string[];
        try {
            files = fs.readdirSync(dir);
        } catch (error) {
            logger.warn(`Cannot read directory ${dir}: ${error}`);
            return;
        }

        for (const file of files) {
            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    if (pattern.test(file)) {
                        results.push(fullPath);
                    }
                    traverse(fullPath);
                }
            } catch (error) {
                logger.warn(`Cannot stat ${fullPath}: ${error}`);
            }
        }
    }

    traverse(baseDir);
    return results;
}

function parseTimestamp(timestamp: string): Date {
    // Format: YYYYMMDD.HHMMSS (e.g., 20251205.193728)
    const [datePart, timePart] = timestamp.split('.');
    if (!datePart || !timePart || datePart.length !== 8 || timePart.length !== 6) {
        throw new Error(`Invalid timestamp format: ${timestamp}`);
    }
    const year = parseInt(datePart.substring(0, 4));
    const month = parseInt(datePart.substring(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(datePart.substring(6, 8));
    const hour = parseInt(timePart.substring(0, 2));
    const minute = parseInt(timePart.substring(2, 4));
    const second = parseInt(timePart.substring(4, 6));
    return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function extractTimestampFromValue(value: string): string | null {
    // value format: "3.0.0.M1-20251205.193728-11"
    const match = value.match(/(\d{8}\.\d{6})-\d+$/);
    return match ? match[1] : null;
}

function extractBuildNumberFromValue(value: string): number | null {
    const match = value.match(/-(\d+)$/);
    return match ? parseInt(match[1]) : null;
}

function generateMD5(content: string): string {
    return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

function generateSHA1(content: string): string {
    return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

// ============== CORE FUNCTIONS ==============

function normalizeSnapshotVersions(versioning: Versioning): SnapshotVersion[] {
    const sv = versioning.snapshotVersions?.snapshotVersion;
    if (!sv) return [];
    return Array.isArray(sv) ? sv : [sv];
}

/**
 * Scan directory for all builds by examining filenames.
 * This is more reliable than metadata since maven-metadata.xml often only
 * contains the latest build's entries.
 */
function scanDirectoryForBuilds(
    dir: string,
    artifactId: string,
    versionPrefix: string
): Map<string, BuildInfo> {
    const builds = new Map<string, BuildInfo>();

    let files: string[];
    try {
        files = fs.readdirSync(dir);
    } catch (error) {
        logger.warn(`Cannot read directory ${dir}: ${error}`);
        return builds;
    }

    // Pattern: artifactId-versionPrefix-TIMESTAMP-BUILDNUM.extension
    // Example: metaschema-core-3.0.0.M1-20251205.193728-11.jar
    const prefix = `${artifactId}-${versionPrefix}-`;
    const pattern = new RegExp(`^${escapeRegex(prefix)}(\\d{8}\\.\\d{6})-(\\d+)`);

    for (const file of files) {
        const match = file.match(pattern);
        if (match) {
            const timestamp = match[1];
            const buildNumber = parseInt(match[2]);
            const key = `${timestamp}-${buildNumber}`;

            if (!builds.has(key)) {
                builds.set(key, {
                    timestamp,
                    buildNumber,
                    date: parseTimestamp(timestamp),
                    snapshotVersions: []
                });
            }
        }
    }

    return builds;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function groupByBuild(snapshotVersions: SnapshotVersion[]): Map<string, BuildInfo> {
    const builds = new Map<string, BuildInfo>();

    for (const sv of snapshotVersions) {
        const timestamp = extractTimestampFromValue(sv.value);
        const buildNumber = extractBuildNumberFromValue(sv.value);

        if (!timestamp || buildNumber === null) {
            logger.debug(`Skipping invalid snapshot version: ${sv.value}`);
            continue;
        }

        const key = `${timestamp}-${buildNumber}`;

        if (!builds.has(key)) {
            builds.set(key, {
                timestamp,
                buildNumber,
                date: parseTimestamp(timestamp),
                snapshotVersions: []
            });
        }

        builds.get(key)!.snapshotVersions.push(sv);
    }

    return builds;
}

function determineBuildsToKeep(
    builds: Map<string, BuildInfo>,
    retention: RetentionConfig
): { keep: BuildInfo[]; delete: BuildInfo[] } {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retention.days);

    const allBuilds = Array.from(builds.values());
    // Sort by date descending (newest first)
    allBuilds.sort((a, b) => b.date.getTime() - a.date.getTime());

    if (allBuilds.length === 0) {
        return { keep: [], delete: [] };
    }

    const recentBuilds = allBuilds.filter(b => b.date >= cutoffDate);
    const oldBuilds = allBuilds.filter(b => b.date < cutoffDate);

    const keep: BuildInfo[] = [...recentBuilds];
    const toDelete: BuildInfo[] = [];

    // Always keep at least minBuilds (the most recent ones)
    if (oldBuilds.length > 0) {
        // Keep the most recent old build to ensure we always have at least one
        keep.push(oldBuilds[0]);
        toDelete.push(...oldBuilds.slice(1));
    }

    // Ensure we always keep at least minBuilds
    if (keep.length < retention.minBuilds && allBuilds.length >= retention.minBuilds) {
        const needed = retention.minBuilds - keep.length;
        // Move some from toDelete to keep
        const toMove = toDelete.splice(0, needed);
        keep.push(...toMove);
    }

    // Final safety: never delete everything
    if (keep.length === 0 && allBuilds.length > 0) {
        keep.push(allBuilds[0]);
        const idx = toDelete.findIndex(b => b === allBuilds[0]);
        if (idx >= 0) toDelete.splice(idx, 1);
    }

    logger.debug(`Retention: ${recentBuilds.length} recent, ${oldBuilds.length} old, keeping ${keep.length}, deleting ${toDelete.length}`);

    return { keep, delete: toDelete };
}

function getFilesForBuild(
    dir: string,
    artifactId: string,
    versionPrefix: string,
    build: BuildInfo
): string[] {
    const files: string[] = [];
    const prefix = `${artifactId}-${versionPrefix}-${build.timestamp}-${build.buildNumber}`;

    let allFiles: string[];
    try {
        allFiles = fs.readdirSync(dir);
    } catch (error) {
        logger.warn(`Cannot read directory ${dir}: ${error}`);
        return files;
    }

    for (const file of allFiles) {
        if (file.startsWith(prefix)) {
            files.push(path.join(dir, file));
        }
    }

    return files;
}

function updateMavenMetadata(
    metadataPath: string,
    metadata: Metadata,
    keptBuilds: BuildInfo[],
    dryRun: boolean
): void {
    if (keptBuilds.length === 0) return;

    // Sort by date descending to get the latest
    const sortedBuilds = [...keptBuilds].sort(
        (a, b) => b.date.getTime() - a.date.getTime()
    );
    const latestBuild = sortedBuilds[0];

    // Collect all snapshot versions from kept builds
    const keptSnapshotVersions: SnapshotVersion[] = [];
    for (const build of sortedBuilds) {
        keptSnapshotVersions.push(...build.snapshotVersions);
    }

    // Update metadata structure
    metadata.metadata.versioning.snapshot = {
        timestamp: latestBuild.timestamp,
        buildNumber: latestBuild.buildNumber
    };

    // Update lastUpdated to latest build's timestamp (without dot)
    metadata.metadata.versioning.lastUpdated = latestBuild.timestamp.replace('.', '');

    // Update snapshotVersions
    metadata.metadata.versioning.snapshotVersions = {
        snapshotVersion: keptSnapshotVersions
    };

    const builder = new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        indentBy: '  ',
        suppressEmptyNode: true
    });

    const xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(metadata);

    if (dryRun) {
        logger.info(`[DRY RUN] Would update: ${metadataPath}`);
    } else {
        fs.writeFileSync(metadataPath, xmlContent);
        fs.writeFileSync(metadataPath + '.md5', generateMD5(xmlContent));
        fs.writeFileSync(metadataPath + '.sha1', generateSHA1(xmlContent));
        logger.info(`Updated: ${metadataPath}`);
    }
}

async function pruneSnapshotDirectory(
    dir: string,
    config: PrunerConfig,
    dryRun: boolean
): Promise<PruneResult> {
    const metadataPath = path.join(dir, 'maven-metadata.xml');
    const result: PruneResult = {
        directory: dir,
        buildsKept: 0,
        buildsDeleted: 0,
        filesDeleted: [],
        metadataUpdated: false
    };

    if (!fs.existsSync(metadataPath)) {
        logger.warn(`No maven-metadata.xml found in ${dir}`);
        return result;
    }

    let xml: string;
    try {
        xml = await fs.promises.readFile(metadataPath, 'utf8');
    } catch (error) {
        logger.error(`Cannot read ${metadataPath}: ${error}`);
        return result;
    }

    let metadata: Metadata;
    try {
        const parser = new XMLParser({
            ignoreAttributes: false
        });
        metadata = parser.parse(xml);
    } catch (error) {
        logger.error(`Cannot parse ${metadataPath}: ${error}`);
        return result;
    }

    const version = metadata.metadata.version;
    const versionPrefix = version.substring(0, version.length - '-SNAPSHOT'.length);
    const artifactId = metadata.metadata.artifactId;

    // Get builds from maven-metadata.xml (authoritative source)
    const snapshotVersions = normalizeSnapshotVersions(metadata.metadata.versioning);
    const builds = groupByBuild(snapshotVersions);

    logger.debug(`${dir}: Found ${builds.size} builds in metadata`);

    // Also scan directory to find orphaned files (not in metadata)
    const filesOnDisk = scanDirectoryForBuilds(dir, artifactId, versionPrefix);
    const orphanedBuilds: BuildInfo[] = [];
    for (const [key, build] of filesOnDisk) {
        if (!builds.has(key)) {
            orphanedBuilds.push(build);
        }
    }
    if (orphanedBuilds.length > 0) {
        logger.info(`${dir}: Found ${orphanedBuilds.length} orphaned builds (on disk but not in metadata)`);
    }

    const { keep, delete: toDelete } = determineBuildsToKeep(builds, config.retention);

    result.buildsKept = keep.length;
    result.buildsDeleted = toDelete.length;

    // Delete files for builds marked for deletion (based on retention policy)
    for (const build of toDelete) {
        const files = getFilesForBuild(dir, artifactId, versionPrefix, build);
        for (const file of files) {
            if (dryRun) {
                logger.info(`[DRY RUN] Would delete: ${file}`);
            } else {
                try {
                    fs.rmSync(file);
                    logger.info(`Deleted: ${file}`);
                } catch (error) {
                    logger.error(`Failed to delete ${file}: ${error}`);
                }
            }
            result.filesDeleted.push(file);
        }
    }

    // Delete orphaned files (on disk but not in metadata)
    for (const build of orphanedBuilds) {
        const files = getFilesForBuild(dir, artifactId, versionPrefix, build);
        for (const file of files) {
            if (dryRun) {
                logger.info(`[DRY RUN] Would delete orphaned: ${file}`);
            } else {
                try {
                    fs.rmSync(file);
                    logger.info(`Deleted orphaned: ${file}`);
                } catch (error) {
                    logger.error(`Failed to delete ${file}: ${error}`);
                }
            }
            result.filesDeleted.push(file);
        }
        result.buildsDeleted++;
    }

    // Update maven-metadata.xml if any builds were deleted
    if (toDelete.length > 0) {
        updateMavenMetadata(metadataPath, metadata, keep, dryRun);
        result.metadataUpdated = true;
    }

    return result;
}

// ============== MAIN ENTRY POINT ==============

async function main(): Promise<void> {
    const config = loadConfig();
    logger.setLevel(config.logLevel);

    const dryRun = process.env.PRUNER_DRY_RUN === 'true';

    console.log('='.repeat(50));
    console.log('Maven Snapshot Pruner');
    console.log('='.repeat(50));
    console.log(`Base directory: ${path.resolve(config.baseDir)}`);
    console.log(`Retention: ${config.retention.days} days, min ${config.retention.minBuilds} build(s)`);
    console.log(`Log level: ${config.logLevel}`);
    console.log(`Dry run: ${dryRun}`);
    console.log('='.repeat(50));
    console.log('');

    const pattern = new RegExp(config.snapshotPattern, 'i');
    const snapshotDirs = findDirectories(config.baseDir, pattern);

    logger.info(`Found ${snapshotDirs.length} snapshot directories`);

    const results: PruneResult[] = [];
    let totalFilesDeleted = 0;
    let totalBuildsDeleted = 0;

    for (const dir of snapshotDirs) {
        try {
            const result = await pruneSnapshotDirectory(dir, config, dryRun);
            results.push(result);
            totalFilesDeleted += result.filesDeleted.length;
            totalBuildsDeleted += result.buildsDeleted;

            if (result.buildsDeleted > 0) {
                logger.info(`${dir}: Kept ${result.buildsKept}, deleted ${result.buildsDeleted} builds (${result.filesDeleted.length} files)`);
            } else {
                logger.debug(`${dir}: No builds to delete (${result.buildsKept} kept)`);
            }
        } catch (error) {
            logger.error(`Error processing ${dir}: ${error}`);
        }
    }

    // Calculate additional metrics
    const totalBuildsKept = results.reduce((sum, r) => sum + r.buildsKept, 0);
    const directoriesWithDeletions = results.filter(r => r.buildsDeleted > 0).length;

    console.log('');
    console.log('='.repeat(50));
    console.log('Summary');
    console.log('='.repeat(50));
    console.log(`Directories processed: ${results.length}`);
    console.log(`Directories with deletions: ${directoriesWithDeletions}`);
    console.log(`Total builds kept: ${totalBuildsKept}`);
    console.log(`Total builds deleted: ${totalBuildsDeleted}`);
    console.log(`Total files deleted: ${totalFilesDeleted}`);

    if (dryRun) {
        console.log('');
        console.log('*** This was a DRY RUN. No files were actually deleted. ***');
    }

    // Write JSON summary for CI consumption
    const summaryFile = process.env.PRUNER_SUMMARY_FILE;
    if (summaryFile) {
        const summary = {
            dryRun,
            retention: {
                days: config.retention.days,
                minBuilds: config.retention.minBuilds
            },
            metrics: {
                directoriesProcessed: results.length,
                directoriesWithDeletions,
                buildsKept: totalBuildsKept,
                buildsDeleted: totalBuildsDeleted,
                filesDeleted: totalFilesDeleted
            }
        };
        fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
        logger.info(`Summary written to ${summaryFile}`);
    }
}

main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});
