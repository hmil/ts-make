import { task } from "../../..";
import { build, run } from "./awesome-consumer/make";

task('build', () => { build.run() })

task('run', () => { run.run() })
