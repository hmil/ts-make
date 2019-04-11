import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as glob from 'fast-glob';
import { Artifact, artifact } from './artifact';
import { MAKEFILE_NAME, rootDir } from './constants';
import { getTask } from './TaskRepo';
import { mkdir } from 'shelljs';

const CACHE_ROOT = path.join(os.tmpdir(), 'ts-make');

interface CacheFile {
    [k: string]: TaskInfo | undefined;
}

export interface File {
    path: string;
    hash: string;
}

export interface TaskDependencies {
    /**
     * Hash value of the file
     */
    hash: string;
    /**
     * Name of the tasks in this file
     */
    tasks: string[];
}

export interface TaskInfo {
    /**
     * Hash of the make.ts file
     */
    selfHash: string;
    /**
     * List of the input file patterns
     */
    inputPatterns: Array<string>;
    /**
     * List of the files that were matched by the input patterns during the last run
     */
    inputFiles: Array<File>;
    /**
     * List of the output file patterns
     */
    outputPatterns: Array<string>;
    /**
     * List of outputs that were created during the last run
     */
    outputFiles: Array<File>;
    /**
     * List of task dependencies
     */
    taskDependencies: {
        [path: string]: TaskDependencies
    }
}

export async function file(filePath: string): Promise<File> {
    return {
        hash: await computeFileHash(filePath),
        path: path.resolve(filePath)
    };
}

function cacheFilePath(workdir: string) {
    return path.join(CACHE_ROOT, workdir + '.json');
}

export function clearCache(workdir: string) {
    fs.unlinkSync(cacheFilePath(workdir));
}

function loadCacheFile(workdir: string): { file: CacheFile } | { error: Error } {
    try {
        return { file: JSON.parse(fs.readFileSync(cacheFilePath(workdir), { encoding: 'utf-8'})) as CacheFile };
    } catch (error ) {
        return { error };
    }
}

async function saveCacheFile(workdir: string, data: CacheFile): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const filePath = cacheFilePath(workdir);

            mkdir('-p', path.dirname(filePath));
            fs.writeFile(filePath, JSON.stringify(data), (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        } catch (e) {
            reject(e);
        }
    });
}

export function getTaskInfo(workdir: string, name: string): TaskInfo | { error: string } {
    const loadCacheResult = loadCacheFile(workdir);
    if ('error' in loadCacheResult) {
        return { error: `the cache file could not be loaded: ${loadCacheResult.error.message}` };
    }
    const cachedTask = loadCacheResult.file[name];
    if (cachedTask == undefined) {
        return { error: 'the task does not exist in cache' };
    }
    return cachedTask;
}

export function saveTaskInfo(workdir: string, name: string, taskInfo: TaskInfo): Promise<void> {
    const loadCacheResult = loadCacheFile(workdir);
    const cacheData: CacheFile = ('error' in loadCacheResult) ? {} : loadCacheResult.file;

    cacheData[name] = taskInfo;
    return saveCacheFile(workdir, cacheData);
}

export async function fileHasChanged(file: File): Promise<boolean> {
    return computeFileHash(file.path).then((hash) => hash !== file.hash);
}

export function computeFileHash(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // the file you want to get the hash    
        const fd = fs.createReadStream(path);
        const hash = crypto.createHash('sha1');
        hash.setEncoding('hex');

        fd.on('end', () => {
            hash.end();
            resolve(hash.read() as string); // the desired sha1sum
        });

        fd.on('error', (e) => {
            reject(e);
        })

        // read all file and pipe it (write it) to the hash object
        fd.pipe(hash);
    })
}

export interface CacheResult<outcome extends boolean> {
    readonly cacheHit: outcome;
}

export interface CacheMiss extends CacheResult<false> {
    readonly reason: string;
}

export interface CacheHit extends CacheResult<true> {
    readonly artifact: Artifact;
    readonly inputs: string[];
}

function cacheMiss(reason: string): CacheMiss {
    return {
        cacheHit: false,
        reason
    };
}

function cacheHit(artifact: Artifact, inputs: string[]): CacheHit {
    return {
        cacheHit: true,
        artifact,
        inputs
    };
}

export async function getTaskResultFromCache(workdir: string, name: string): Promise<CacheHit | CacheMiss> {
    const info = getTaskInfo(workdir, name);
    // If the cache is absent, or the task is not listed in the cache then this task needs to run
    if ('error' in info) {
        return cacheMiss(`task cache data could not be loaded because ${info.error}.`);
    }

    // If the task has no input and no dependent task, then this task needs to run
    if (info.inputPatterns.length === 0 && Object.keys(info.taskDependencies).length === 0) {
        return cacheMiss(`this task has neither file inputs nor task dependencies`);
    }
    // If the task has declared some output but the last run did not match any output artifact
    if (info.outputPatterns.length !== 0 && info.outputFiles.length === 0) {
        return cacheMiss(`this task has declared some ouputs but the last run did not generate any output`);
    }

    // If the make.ts file has changed, then this task needs to run
    try {
        const makefileHash = await computeFileHash(path.join(workdir, MAKEFILE_NAME));
        if (makefileHash !== info.selfHash) {
            return cacheMiss(`the makefile containing this task definition has changed.`);
        }
    } catch (e) {
        return cacheMiss(`the makefile hash could not be computed: ${e}`);
    }

    // If the set of files matched by the task's glob pattern has changed, then this task needs to run
    try {
        if (await patternMatchesADifferentFileSet(workdir, info.inputPatterns, info.inputFiles) === true) {
            return cacheMiss(`the set of matching input files has changed.`);
        }
    } catch (e) {
        return cacheMiss(`the set of input files could not be computed: ${e}`);
    }

    // If the input files have changed, then this task needs to run
    try {
        for (let inFile of info.inputFiles) {
            if (await fileHasChanged(inFile) === true) {
                return cacheMiss(`the file "${inFile.path}" has changed since the last successful run of this task.`);
            }
        }
    } catch(e) {
        return cacheMiss(`an error occured while trying to determine if the input files have changed: ${e}`)
    }

    // If the set of files matched by the task's output glob pattern has changed, then this task needs to run
    try {
        if (await patternMatchesADifferentFileSet(workdir, info.outputPatterns, info.outputFiles) === true) {
            return cacheMiss(`the set of matching output files has changed.\nworkdir:${workdir}\npatterns: ${info.outputPatterns.join(', ')}\nfiles:${info.outputFiles.map((f) => f.path).join(', ')}`);
        }
    } catch (e) {
        return cacheMiss(`the set of output files could not be computed: ${e}`);
    }

    // If an output file has changed, then this task needs to run
    try {
        for (let outFile of info.outputFiles) {
            if (await fileHasChanged(outFile) === true) {
                return cacheMiss(`output file ${outFile.path} has changed since the last successful run of this task.`);
            }
        }
    } catch (e) {
        return cacheMiss(`an error occured while trying to determine if the output files have changed: ${e}`);
    }

    // Evaluate if dependencies need to run
    for (let dependencyWorkdir in info.taskDependencies) {
        const dependencies = info.taskDependencies[dependencyWorkdir];
        const result = await shouldTaskDependenciesRun(dependencyWorkdir, dependencies);
        if (result.shouldRun) {
            return cacheMiss(`some task dependencies are out of date: ${result.reason}`)
        }
    }
    
    // We need to cast here because this is the product of a deserialization
    // However, if all of the tests above passed, then it is guaranteed that the serialized type matches
    // the expected artifact type.
    try {
        return cacheHit(
            await artifact(...info.outputFiles.map((f) => f.path)),
            info.inputPatterns);
    } catch (e) {
        return cacheMiss(`the final set of artifacts for this task could not be gathered: ${e}`);
    }
}

async function patternMatchesADifferentFileSet(workdir: string, patterns: string[], files: File[]): Promise<boolean> {
    const newMatchedFiles = await glob(patterns, {
        absolute: true,
        cwd: workdir
    }) as string[];
    // Poor man's file set comparison
    if (newMatchedFiles.sort().join(" ") !== files.map((f) => f.path).sort().join(" ")) {
        return true;
    }
    return false;
}

interface TaskDependenciesEvaluationOutcome<shouldRun extends boolean> {
    shouldRun: shouldRun;
}

interface TaskDependenciesShouldRun extends TaskDependenciesEvaluationOutcome<true> {
    reason: string;
}

interface TaskDependenciesUpToDate extends TaskDependenciesEvaluationOutcome<false> { }

function dependenciesShouldRun(reason: string): TaskDependenciesShouldRun {
    return {
        shouldRun: true,
        reason
    };
}

function dependenciesUpToDate(): TaskDependenciesUpToDate {
    return {
        shouldRun: false
    }
};

function buildMakefileTasksErrorMessage(dependencies: TaskDependencies) {
    return `This makefile contains the following dependencies: ${dependencies.tasks.join(", ")}`;
}

async function shouldTaskDependenciesRun(workdir: string, dependencies: TaskDependencies): Promise<TaskDependenciesUpToDate | TaskDependenciesShouldRun> {
    const makefile = path.join(workdir, MAKEFILE_NAME);
    try {
        if (!await fileExists(makefile)) {
            return dependenciesShouldRun(`makefile "${makefile}" does not exist.\n${buildMakefileTasksErrorMessage(dependencies)}`);
        }
    } catch (e) {
        return dependenciesShouldRun(`an error occurred while reading makefile "${makefile}": ${e.message}\n${buildMakefileTasksErrorMessage(dependencies)}`);
    }

    try {
        if (await fileHasChanged({ path: makefile, hash: dependencies.hash}) === true) {
            return dependenciesShouldRun(`makefile "${makefile}" has changed.\n${buildMakefileTasksErrorMessage(dependencies)}`);
        }
    } catch (e) {
        return dependenciesShouldRun(`it could not be determined if the makefile "${makefile}" has changed: ${e}\n${buildMakefileTasksErrorMessage(dependencies)}`);
    }

    for (let task of dependencies.tasks) {
        const retrievedTask = getTask(path.relative(rootDir, path.join(workdir, task)));
        if (retrievedTask === undefined) {
            return dependenciesShouldRun(`task "${task}" could not be found.`);
        }

        const retrievedTaskResult = await getTaskResultFromCache(retrievedTask.workdir, retrievedTask.name);
        if (retrievedTaskResult.cacheHit === false) {
            // TODO: This will cause infinite recursions for circular dependencies
            return dependenciesShouldRun(`task "${retrievedTask.name}" must re-run because ${retrievedTaskResult.reason}`);
        }
    }

    return dependenciesUpToDate();
}

function fileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => fs.stat(filePath, (err, stats) => {
        if (err) {
            if (err.code == "ENOENT") {
                resolve(false);
            } else {
                reject(err);
            }
        } else {
            resolve(stats.isFile());
        }
    }));
}