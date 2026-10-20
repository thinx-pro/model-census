// Write the test fixture project to a directory (default: ./demo-project) for demos and screenshots.
import { resolve } from 'node:path';
import { makeProject } from '../test/fixture.js';

const dir = resolve(process.argv[2] || 'demo-project');
makeProject(dir);
console.log(dir);
