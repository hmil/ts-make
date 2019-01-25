const task = process.argv[2];

if (!task) {
    console.log('Usage: ts-make <task>');
    return 1;
}
const tsmake = require(__dirname);
const path = require('path');
require('ts-node').register()
require(path.join(process.cwd(), 'make.ts'));

tsmake.run(task);