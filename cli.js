const task = process.argv[2];

if (!task) {
    console.log('Usage: ts-make <task>');
    return 1;
}
const tsmake = require(__dirname);
const path = require('path');

require('./build/nodePath.js').addToPath(path.join(__dirname, 'node_modules'));
require('module').Module._initPaths();
require('ts-node').register({
    compilerOptions: {
        lib: [
            'es2015'
        ]
    }
});
require(path.join(process.cwd(), 'make.ts'));

tsmake.run(task);
