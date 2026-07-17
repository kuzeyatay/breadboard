import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { glob } from 'node:fs';
import path from 'path';

process.env.NODE_ENV = 'test';
async function main() {
    const files = await new Promise<string[]>((resolve, reject) => {
        glob(path.join(__dirname, 'unit', '*.test.js'), (err, found) => {
            if (err) reject(err);
            else resolve(found);
        });
    });

    const stream = run({
        files,
        concurrency: false,
        timeout: 10_000,
        isolation: 'none',
        forceExit: true,
        watch: false,
    });

    stream.compose(spec).pipe(process.stdout);
}

main();
