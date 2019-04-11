import * as path from 'path';
import { ZONE_STORE_KEY, MAKEFILE_NAME } from './constants';
import { Artifact } from './artifact';
import { Task } from './Task';
import { TaskInfo, file, File, TaskDependencies, computeFileHash } from './cache';
import { Scheduler } from './Scheduler';
import { log } from './logging';

export class TaskStorage {

    private inputPatterns: string[] = [];
    private inputFiles: File[] = [];
    private outputPatterns: string[] = [];
    private outputFiles: File[] = [];
    private taskDependencies: {
        [path: string]: TaskDependencies
    } = {};
    private artifacts: Artifact[] = [];

    public readonly scheduler: Scheduler = new Scheduler();

    async addInputFiles(patterns: string[], files: string[]) {
        log('Registering input files');
        this.inputFiles = this.inputFiles.concat(await Promise.all(files.map(file)));
        this.inputPatterns = this.inputPatterns.concat(patterns);
    }

    async addOutputFiles(patterns: string[], files: string[]) {
        log('Registering output files');
        this.outputFiles = this.outputFiles.concat(await Promise.all(files.map(file)));
        this.outputPatterns = this.outputPatterns.concat(patterns);
    }

    async addTaskDependency(task: Task<any>) {
        let deps = this.taskDependencies[task.workdir];
        if (deps === undefined) {
            this.taskDependencies[task.workdir] = deps = {
                hash: await computeFileHash(path.join(task.workdir, MAKEFILE_NAME)),
                tasks: []
            };
        } 
        deps.tasks.push(task.name);
    }

    addArtifact(artifact: Artifact) {
        this.artifacts.push(artifact);
    }

    clear() {
        this.inputFiles = [];
        this.taskDependencies = {};
        this.artifacts.length = 0;
    }

    asTaskInfo(selfHash: string): TaskInfo {
        return {
            inputFiles: this.inputFiles,
            inputPatterns: this.inputPatterns,
            taskDependencies: this.taskDependencies,
            outputPatterns: this.outputPatterns,
            outputFiles: this.outputFiles,
            selfHash: selfHash
        };
    }
}

export function getCurrentTaskStorage(): TaskStorage {
    const storage = Zone.current.get(ZONE_STORE_KEY) as unknown;
    if (storage instanceof TaskStorage) {
        return storage;
    }
    throw new Error(`Invalid zone: ${Zone.current.name}`);
}