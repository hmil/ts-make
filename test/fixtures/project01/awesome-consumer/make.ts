import { task, shell, npm, inputFiles } from '../../../..'
import { install } from '../awesome-package/make';
import { artifact } from '../../../../build/artifact';

const { npmInstall } = npm.register();

const importCustomPackage = task('importCustomPackage', async () => {
    const pkg = await install.artifacts
    shell(`npm install ${pkg.files[0]}`)
})

const installDependencies = task('installDependencies', () => {
    npmInstall.run()
    importCustomPackage.run()
})

export const build = task('build', () => {
    installDependencies.run()
    importCustomPackage.run()
    inputFiles('src/**/*.ts')
    shell('./node_modules/.bin/tsc -p .')
    return artifact('build/index.js', 'build/**/*.js', 'build/**/*.d.ts')
})

export const run = task('run', async () => {
    const bin = await build.artifacts;
    shell(`node ${bin.files[0]}`);
})
