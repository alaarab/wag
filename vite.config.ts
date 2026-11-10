import { defineConfig } from 'vite';

// fixed port so the links printed by `npm run new` are right
export default defineConfig({ server: { port: 5179, strictPort: true } });
