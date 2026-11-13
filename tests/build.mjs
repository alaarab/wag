// Before the tests: the made-up decks, built into tests/.out. The guided deck's walk is made first,
// so a session can play it. No voice is needed: without one the lines are only shown.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const run = (args, env = {}) => execFileSync(process.execPath, args, { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env } });
run(['scripts/make.mjs', 'guided']);
run(['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], { WAG_OUT: 'tests/.out', WAG_DECKS: '' });
