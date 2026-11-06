import { fileURLToPath } from 'node:url';
import { guardMinimatchBackport } from './minimatch-backport.mjs';

const [command, ...args] = process.argv.slice(2);
const tools = {
  check: { entry: '../node_modules/typescript/bin/tsc', args: ['--noEmit'] },
  lint: { entry: '../node_modules/eslint/bin/eslint.js', args: ['.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next'] },
};
if (!Object.hasOwn(tools, command)) throw new Error('Expected check or lint.');
guardMinimatchBackport({ check: true, requireTarget: true });
const tool = tools[command];
const cli = new URL(tool.entry, import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), ...tool.args, ...args];
await import(cli.href);
