import 'zone.js';

import { exec, cd } from "shelljs";
import * as callsite from 'callsite';
import * as path from 'path';
import * as glob from 'fast-glob';

const ZONE_STORE_KEY = 'tsmake.private';

type TaskFn<T> = () => T | Promise<T>;

class Task<T> {
    private readonly fqn: string;
    private pendingRun: Promise<T> | null = null;
    private readonly zone: Zone;

    constructor(
            public readonly name: string,
            public readonly workdir: string,
            public readonly fn: TaskFn<T>) {

        this.fqn = path.relative(rootDir, path.join(workdir, name));
        this.zone = Zone.current.fork({
            name: this.fqn,
            onInvokeTask: (delegate, _current, target, task, applyThis, applyArgs) => {
                delegate.invokeTask(target, task, applyThis, applyArgs);
                cd(this.workdir);
            },
            properties: {
                [ZONE_STORE_KEY]: new TaskStorage
            }
        });
    }

    public exec = async (): Promise<T> => {
        registerTaskDependency(this);
        console.log(`\n[VISITING] ${this.fqn}`);
        if (this.pendingRun != null) {
            console.log(`  Task is already running!`);
            return this.pendingRun;
        }
        console.log(`  Running task...`);
        this.pendingRun = this._exec();
        try {
            return await this.pendingRun;
        } finally {
            this.pendingRun = null;
        }
    }

    private _exec() {
        return new Promise<T>(async (resolve, reject) => {
            const storage = this.zone.get(ZONE_STORE_KEY) as TaskStorage;
            storage.clear();
            this.zone.run(async () => {
                taskStack.push(this.fqn);
                const previousCwd = process.cwd();
                console.log(`[START] ${currentTaskStack()}`);
                cd(this.workdir)
                let ret;
                try {
                    ret = await this.fn()
                } catch (e) {
                    reject(e)
                    return;
                } finally {
                    cd(previousCwd)
                    console.log(`\n[END] ${currentTaskStack()}`);
                    taskStack.pop();
                    
                    const usedFiles = getCurrentTaskStorage().getInputFiles();
                    console.log(`This task used ${usedFiles.length} files:`)
                    console.log(usedFiles.join('\n'))
                    
                    const tasks = getCurrentTaskStorage().getTaskDependencies();
                    console.log(`This task depends on ${tasks.length} other tasks:`)
                    console.log(tasks.map((t) => t.fqn).join('\n'))

                    console.log(`\n[RESUME] ${currentTaskStack()}`);
                }
                getCurrentTaskStorage().setArtifact(ret);
                resolve(ret)
            })
        });
    }

    get artifacts(): Promise<T> {
        return this.exec();
    }
}

export function task<T>(name: string, fn: TaskFn<T>): Task<T> {
    const stack = callsite();
    const workdir = path.dirname(stack[1].getFileName());
    return _task(name, workdir, fn);
}

function _task<T>(name: string, workdir: string, fn: TaskFn<T>) {
    const fqn = path.relative(rootDir, path.join(workdir, name));
    const t = new Task(name, workdir, fn);
    addTask(fqn, t);
    return t;
}


class TaskStorage {

    private inputFiles: string[] = [];
    private taskDependencies: Task<any>[] = [];
    private artifact: Artifact | null = null;

    addInputFiles(files: string[]) {
        this.inputFiles = this.inputFiles.concat(files);
    }

    getInputFiles() {
        return this.inputFiles.slice();
    }

    addTaskDependency(task: Task<any>) {
        this.taskDependencies.push(task);
    }

    getTaskDependencies() {
        return this.taskDependencies.slice();
    }

    setArtifact(artifact: Artifact) {
        this.artifact = artifact;
    }

    clear() {
        this.inputFiles = [];
        this.taskDependencies = [];
        this.artifact = null;
    }
}

function getCurrentTaskStorage(): TaskStorage {
    const storage = Zone.current.get(ZONE_STORE_KEY) as unknown;
    if (storage instanceof TaskStorage) {
        return storage;
    }
    throw new Error(`Invalid zone: ${Zone.current.name}`);
}

export async function inputFiles(...patterns: string[]) {
    const files = await glob(patterns, {
        absolute: true
    }) as string[];
    getCurrentTaskStorage().addInputFiles(files);
}

function registerTaskDependency(dependency: Task<any>) {
    if (Zone.current != Zone.root) {
        getCurrentTaskStorage().addTaskDependency(dependency);
    }
}

interface Artifact {
    files: string[]
};

export async function artifact(...patterns: string[]): Artifact {
    const files = await glob(patterns, {
        absolute: true
    }) as string[];
    return {
        files
    };
}

export async function runTasks(...tasks: Task<any>[]) {
    return Promise.all(tasks.map((t) => t.exec()));
}

const rootDir = process.cwd();

const taskStack: string[] = [];


function currentTaskStack() {
    return taskStack.join(" > ");
}

const task_index: {[k: string]: Task<any>} = {};


function addTask(k: string, t: Task<any>) {
    console.log('Registering task: ' + k);
    if (k in task_index) {
        throw new Error(`Attempted to define task ${k} more than once!`);
    }
    task_index[k] = t;
}

/**
 * Runs a task. This is intended for CLI usage.
 */
export function run(taskName: string) {
    const t = task_index[taskName];
    if (t == null) {
        throw new Error(`No such task: ${taskName}`);
    }
    t.exec();
}


/**
 * Useful tasks
 */
export const yarn = {
    installDeps() {
        const stack = callsite();
        const workdir = path.dirname(stack[1].getFileName());
        const t = task_index[path.relative(rootDir, path.join(workdir, 'yarn'))];
        if (t) {
            return t;
        }
        return _task('yarn', workdir, () => {
            exec('yarn')
        })
    }
};



// TODO: Async support and build avoidance
// Need to collect task inputs as it is running (can store in Zone storage)
// Collect the task's artifacts (todo: rename to output?)
// Store the task's input and outputs somewhere where it persists.
// 
// Then, later:
// Before a task runs, check if it needs to run:
// - If the cache directory is absent
// - OR if the task is not listed in the cache
// - OR If the make.ts file has changed
// - OR If the set of the task's input files has changed
// - OR If one of the input files has a timestamp newer than the task's last run
// - Could also boil down the last 2 into: compute a hash of the input files and compare this hash.

