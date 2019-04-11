import { task, npm, shell, inputFiles } from '../../../..'
import { artifact } from '../../../../build/artifact'
import path = require('path')

const { npmInstall, npmPack } = npm.register()

const build = task('build', () => {
    inputFiles('src/**/*.ts')
    npmInstall.run()
    shell('./node_modules/.bin/tsc -p .')

    return artifact('build/**/*.js', 'build/**/*.d.ts')
})

// TODO: The atomicTask API below would simplify working with compound tasks which shouldn't be visited by the cache resolver.
// But this introduces lots of risks around concurrency.
// The scheduler mechanism needs to be figured out first.
//
// const pack = atomicTask('package', async () => {
//     const inputs = await input(() => npmPack.artifacts)

//     const pkgName = inputs.files[0];
//     // TODO: provide ready-made move and copy tasks
//     shell(`mv ${pkgName} build/`)
//     return artifact(`build/${path.basename(pkgName)}`)
// })

const pack = task('package', async () => {
    const packaged = await npmPack.run({ noDependency: true })
    inputFiles(...packaged.inputs);

    const pkgName = packaged.outputs.files[0];
    shell(`mv ${pkgName} build/`)
    return artifact(`build/${path.basename(pkgName)}`)
});

export const install = task('install', () => {
    build.run()
    return pack.artifacts;
})

