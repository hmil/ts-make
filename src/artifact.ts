
import * as glob from 'fast-glob';
import { getCurrentTaskStorage } from './TaskStorage';

export interface Artifact {
    patterns: string[],
    files: string[]
};

export const artifact = (...patterns: string[]): Promise<Artifact> => getCurrentTaskStorage().scheduler.schedule(async () => {
    const files = await glob(patterns, {
        absolute: true
    }) as string[];
    return {
        patterns,
        files
    };
});
