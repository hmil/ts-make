
export function addToPath(path: string) {
    process.env['NODE_PATH'] = generatePath(currentPath().concat(path));
}

const delim = process.platform === 'win32' ? ';' : ':';

function currentPath(): string[] {
    const path = process.env['NODE_PATH'];
    if (path == null) {
        return [];
    }
    return path.split(delim);
}

function generatePath(parsed: string[]): string {
    return parsed.join(delim);
}
