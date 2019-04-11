import { Task } from './Task';
import { log } from './logging';

const task_index: {[k: string]: Task<any>} = {};

export function addTask(k: string, t: Task<any>) {
    log(`Registering task: ${k} (${t.workdir} : ${t.name})`);
    if (k in task_index) {
        throw new Error(`Attempted to define task ${k} more than once!`);
    }
    task_index[k] = t;
}

export function getTask(k: string): Task<any> | undefined {
    // log(`GET TASK: ${k} ; Index= ${Object.keys(task_index).join(',')} ; ${task_index[k]}`)
    return task_index[k];
}
