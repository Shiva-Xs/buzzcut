// Builds the website's script: site/buzzcut-web.js, the analyzer and roast for the browser.
//   npm run build:site   (then deploy the site/ folder, see RELEASING.md)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// The browser path never touches the file system, git or processes, but some modules it
// imports also have Node-only helpers. They get stubs that throw if anything calls them.
const NODE_STUB = `
const no = (name) => () => { throw new Error(name + ' is not available in the browser'); };
export const existsSync = () => false;
export const readFileSync = no('readFileSync'), writeFileSync = no('writeFileSync'), appendFileSync = no('appendFileSync');
export const mkdirSync = no('mkdirSync'), rmSync = no('rmSync'), statSync = no('statSync'), readdirSync = no('readdirSync');
export const chmodSync = no('chmodSync'), copyFileSync = no('copyFileSync'), unlinkSync = no('unlinkSync');
export const execFileSync = no('execFileSync'), spawnSync = no('spawnSync');
export const createHash = no('createHash'), homedir = no('homedir'), tmpdir = no('tmpdir'), fileURLToPath = no('fileURLToPath');
export const join = (...p) => p.join('/'), resolve = (...p) => p.join('/'), dirname = (p) => p.split('/').slice(0, -1).join('/');
export const relative = (a, b) => b, basename = (p) => p.split('/').pop(), delimiter = ':', sep = '/';
export default {};
`;

const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');
const webhook = [['src/webhook.ts', 7, 2]];

// The page's examples, all made up: the same kind of change written three ways.
const SAMPLES = {
  yappy: { title: 'Add comprehensive retry mechanism', body: fixture('slop-pr.md'), files: webhook, number: 482 },
  decent: { title: 'Fix duplicate rows on page 2 of the orders list', body: fixture('decent-pr.md'), files: [['src/orders/list.ts', 6, 3], ['src/orders/types.ts', 2, 2]], number: 231 },
  clean: { title: 'Retry webhook deliveries on 5xx and 429', body: fixture('good-pr.md'), files: webhook, number: 483 },
};

await build({
  entryPoints: [new URL('../src/web.ts', import.meta.url).pathname],
  bundle: true,
  format: 'iife',
  globalName: 'buzzcut',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile: new URL('../site/buzzcut-web.js', import.meta.url).pathname,
  footer: { js: `buzzcut.SAMPLES = ${JSON.stringify(SAMPLES)};` },
  plugins: [
    {
      name: 'node-stubs',
      setup(b) {
        b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({ contents: NODE_STUB, loader: 'js' }));
      },
    },
  ],
  logLevel: 'warning',
});
console.log('site/buzzcut-web.js built');
