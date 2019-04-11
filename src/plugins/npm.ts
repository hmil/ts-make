import { Task, TaskFn, TaskParamType } from '../Task';
import { Artifact, artifact } from '../artifact';
import callsite = require('callsite');
import path = require('path');
import fs = require('fs');
import { getTask } from '../TaskRepo';
import { rootDir } from '../constants';
import { _task, inputFiles, shell } from '..';
import { log } from '../logging';

export interface NpmPlugin {
    npmInstall: Task<Artifact>;
    npmPack: Task<Artifact>;
}

export const npm = {
    register(): NpmPlugin {
        const stack = callsite();
        const workdir = path.dirname(stack[1].getFileName());
        return {
            npmInstall: registerTaskOnce(workdir, 'npmInstall', async () => {
                log('Running npm install')
                await inputFiles(path.join(workdir, 'package.json'), path.join(workdir, 'package-lock.json'));
                shell('npm install');
        
                // The goal of the canary is to detect when the node_modules directory is removed.
                // We do not consider small modifications of the node_modules directory for multiple reasons:
                // - It is huge and would take a lot of time to evaluate
                // - There are use cases where you want to manually hack into the node_modules directory after running npm install.
                //   In those cases, you don't want the node_modules directory to be considered dirty.
                // On the other hand, it is quite common to remove the whole node_modules directory at once when you want to
                // perform a deep clean of the project. It is this scenario we are interested in.
                const canary = path.join(workdir, 'node_modules/.tsmake-canary');
                shell(`mkdir -p ${path.dirname(canary)}`) // Make sure the node_modules directory exists. 
                fs.writeFileSync(canary, (~~(Math.random() * 0x100000000)).toString(16));
                return await artifact(canary);
            }),
            npmPack: registerTaskOnce(workdir, 'npmPack', async () => {
                const f = await inputFiles('package.json');
                if (f.length != 1) {
                    throw new Error('package.json not found for this project.')
                }
                const pkgjson = require(f[0]);
                await inputFiles(
                    'README', 'CHANGES', 'CHANGELOG', 'HISTORY', 'LICENSE', 'LICENCE', 'NOTICE',
                    pkgjson.main || '',
                    ...(pkgjson.files || ['*']),
                );
                shell('npm pack');
                return artifact(`${pkgjson.name}-${pkgjson.version}.tgz`);
            })
        };
    }
};

function registerTaskOnce<T extends TaskParamType>(workdir: string, name: string, fn: TaskFn<T>) {
    const t = getTask(path.relative(rootDir, path.join(workdir, name)));
    if (t) {
        return t;
    }
    return _task(name, workdir, fn);
}