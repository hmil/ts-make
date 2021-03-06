import { Artifact } from './artifact';
import { ZONE_STORE_KEY, rootDir, MAKEFILE_NAME } from './constants';
import * as path from 'path';
import { TaskStorage, getCurrentTaskStorage } from './TaskStorage';
import { cd } from 'shelljs';
import { getTaskResultFromCache, saveTaskInfo, computeFileHash, getTaskInfo } from './cache';
import { log } from './logging';
import { pushTask, popTask, currentTaskStack } from './thread';

export type TaskParamType = Artifact | void;
type TaskRet<T extends TaskParamType> = T | Promise<T>;
export type TaskFn<T extends TaskParamType> = () => TaskRet<T>;

export interface TaskResult<T extends TaskParamType> {
    outputs: T;
    inputs: string[];
}

export interface RunOptions {
    /**
     * Do not register this task as a dependency of the current task.
     * 
     * This is useful when you don't want the incremental build algorithm to look at that inner task when it determines
     * whether the current task should run.
     * 
     * For instance, consider the following code:
     * 
     * ```ts
     * task('package', async () => {
     *     const packaged = await npmPack.run()
     *     shell(`mv ${packaged.files[0]} build/`)
     *     return artifact(`build/${path.basename(packaged.files[0])}`)
     * })
     * ```
     * 
     * The task `package` is always out of date because it moves the artifact generated by the task `npmPack`. The incremental build
     * algorithm will walk up into `npmPack`, discover that its output is out-of-date and re-trigger a run of everythingk.
     * 
     * To avoid this, consider using the `noDependency` parameter:
     * 
     * ```ts
     * task('package', async () => {
     *     // We have to manually specify the input files now because the npmPack task will no longer do it for us.
     *     await inputFiles(require('package.json').files || '*')
     *     const packaged = await npmPack.run({ noDependency: true })
     *     shell(`mv ${packaged.files[0]} build/`)
     *     return artifact(`build/${path.basename(packaged.files[0])}`)
     * }
     * ```
     * 
     * Default: false
     */
    noDependency?: boolean
}

// TODO: Break this down in an interface and an implementation to break dependency cycles
export class Task<T extends TaskParamType> {
    public readonly fqn: string;
    private pendingRun: Promise<TaskResult<T>> | null = null;
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

    public run = (options?: RunOptions): Promise<TaskResult<T>> => getCurrentTaskStorage().scheduler.schedule(async () => {
        options = options || {};
        if (!(options.noDependency === true)) {
            registerTaskDependency(this);
        }
        log(`VISITING ${this.fqn}`);
        pushTask(this.fqn);
        if (this.pendingRun != null) {
            log(`HAS PENDING ${this.fqn}`);
            popTask();
            return this.pendingRun;
        }
        this.pendingRun = new Promise<TaskResult<T>>(async (resolve, reject) => this.zone.run(async () => {
            getCurrentTaskStorage().scheduler.init();
            const cached = await getTaskResultFromCache(this.workdir, this.name);
            if (cached.cacheHit) {
                log(`CACHE HIT ${this.fqn}`);
                popTask();
                return resolve({
                    outputs: cached.artifact as T,
                    inputs: cached.inputs
                });
            }
            log(`CACHE MISS. Reason: ${cached.reason}`);
            try {
                resolve(await this._exec());
            } catch (e) {
                reject(e);
            } finally {
                this.pendingRun = null;
            }
        }));
        return this.pendingRun;
    });

    private async _exec(): Promise<TaskResult<T>> {
        const storage = getCurrentTaskStorage();
        storage.clear();
        const previousCwd = process.cwd();
        log(`START ${this.fqn}`);
        cd(this.workdir)
        let ret: T;
        try {
            ret = await this.fn();
            if (ret) {
                const r: Artifact = ret as Artifact;
                await getCurrentTaskStorage().addOutputFiles(r.patterns, r.files);
            }
            await getCurrentTaskStorage().scheduler.finalize();
            const makefileHash = await computeFileHash(path.join(this.workdir, MAKEFILE_NAME));
            const taskInfo = getCurrentTaskStorage().asTaskInfo(makefileHash);
            await saveTaskInfo(this.workdir, this.name, taskInfo);
            return { outputs: ret, inputs: taskInfo.inputPatterns };
        } catch (e) {
            throw new Error(`[${currentTaskStack()}] ${e.stack}`);
        } finally {
            log(`END ${this.fqn}`);
            popTask();
            log(`RESUME ${this.fqn}`);
            cd(previousCwd);
        }
    }

    get artifacts(): Promise<T> {
        return this.run().then((r) => r.outputs);
    }

    dumpCache(): string {
        return JSON.stringify(getTaskInfo(this.workdir, this.name), null, 4);
    }
}

function registerTaskDependency(dependency: Task<any>) {
    if (Zone.current != Zone.root) {
        getCurrentTaskStorage().addTaskDependency(dependency);
    }
}
