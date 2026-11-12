import { cpSync, createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

// WAG_DECKS names a folder outside this repo that holds more decks: its *.ts files are decks and
// its public/ folder is served like the repo's own. Decks made from private material live there,
// so nothing of theirs can end up in a commit.
const home = process.env.WAG_DECKS ? resolve(process.env.WAG_DECKS) : null;
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function outsideDecks(): Plugin {
  const id = 'virtual:wag-decks';
  let out = '';
  return {
    name: 'wag-outside-decks',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loaded) {
      if (loaded !== `\0${id}`) return;
      const files = home && existsSync(home) ? readdirSync(home).filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts')) : [];
      const entries = files.map((name) => `${JSON.stringify(name.slice(0, -3))}: () => import(${JSON.stringify(join(home!, name))})`);
      return `export default {${entries.join(',')}};`;
    },
    configureServer(server) {
      if (!home) return;
      const root = join(home, 'public');
      server.middlewares.use((req, res, next) => {
        const file = join(root, normalize(decodeURIComponent((req.url ?? '/').split('?')[0])));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (home && out && existsSync(join(home, 'public'))) cpSync(join(home, 'public'), out, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [outsideDecks()],
  // decks import 'wag' wherever they live
  resolve: { alias: { wag: join(here, 'src/index.ts') } },
  // fixed port so the links printed by `npm run new` are right
  server: { port: 5179, strictPort: true, fs: { allow: [here, ...(home ? [home] : [])] } },
  // WAG_OUT puts a build somewhere else, for a deck that must stay out of the repo
  build: { outDir: process.env.WAG_OUT ? resolve(process.env.WAG_OUT) : 'dist', emptyOutDir: true, target: 'es2022' },
});
