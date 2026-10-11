import { run, root } from './lib/runtime.mjs';
import path from 'node:path';
await run(process.execPath, ['--check', path.join(root, 'public/app.js')]);
