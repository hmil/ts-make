// TODO: This file should wrap all zone-related features; All per-thread data


// TODO: This leads to false debug statements. Should be tied to a zone
const taskStack: string[] = [];

export function currentTaskStack() {
    return taskStack.join(">");
}

export function pushTask(t: string) {
    taskStack.push(t);
}

export function popTask() {
    taskStack.pop();
}
