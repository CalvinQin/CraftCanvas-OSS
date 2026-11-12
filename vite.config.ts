import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: { port: 3000, host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:8787' }, '/auth': { target: 'http://127.0.0.1:8787' } } },
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client' },
  // 禁止把历史 VITE_* 密钥注入前端；统一使用服务端环境或站内设置。
  envPrefix: 'CRAFTCANVAS_PUBLIC_',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
