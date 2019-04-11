import 'zone.js';

import { exec } from 'shelljs';
import * as callsite from 'callsite';
import * as path from 'path';
import * as glob from 'fast-glob';
import { Task, TaskFn, TaskParamType } from './Task';
import { rootDir, ZONE_STORE_KEY } from './constants';
import { getCurrentTaskStorage, TaskStorage } from './TaskStorage';
import { getTask, addTask } from './TaskRepo';
import { log } from './logging';
import { clearCache } from './cache';

export { npm } from './plugins/npm';


export function task<T extends TaskParamType>(name: string, fn: TaskFn<T>): Task<T> {
    const stack = callsite();
    const workdir = path.dirname(stack[1].getFileName());
    return _task(name, workdir, fn);
}

/**
 * For internal use only
 */
export function _task<T extends TaskParamType>(name: string, workdir: string, fn: TaskFn<T>) {
    const fqn = path.relative(rootDir, path.join(workdir, name));
    const t = new Task(name, workdir, fn);
    addTask(fqn, t);
    return t;
}

export const inputFiles = (...patterns: string[]) => getCurrentTaskStorage().scheduler.schedule(async () =>{
    const files = await glob(patterns, {
        absolute: true
    }) as string[];
    await getCurrentTaskStorage().addInputFiles(patterns, files);
    return files;
})

/**
 * Runs a task. This is intended for CLI usage.
 */
export function run(taskName: string) {
    Zone.current.fork({
        name: 'root task',
        properties: {
            [ZONE_STORE_KEY]: new TaskStorage
        }
    }).run(async () => {
        getCurrentTaskStorage().scheduler.run();
        const t = getTask(taskName);
        if (t == null) {
            throw new Error(`No such task: ${taskName}`);
        }
        await t.run();
        await getCurrentTaskStorage().scheduler.finalize();
    });
}

export const shell = (cmd: string) => getCurrentTaskStorage().scheduler.schedule<void>(async () => {
    console.log('$ ' + cmd);
    exec(cmd);
})

/**
 * Built-in tasks. For debugging mostly
 */

_task('debug:dumpCache', rootDir, async () => {
    const taskName = process.env['task'];
    if (taskName === undefined || taskName == '') {
        log('Please specify a task using the "task" environment variable');
        return;
    }
    const task = getTask(taskName);
    if (task === undefined) {
        log(`No such task: ${taskName}`);
        return;
    }
    log(task.dumpCache());
});

/**
 * Built-in tasks. For debugging mostly
 */

_task('debug:clearCache', rootDir, async () => {
    clearCache(rootDir);
    log('Cache cleared');
});
