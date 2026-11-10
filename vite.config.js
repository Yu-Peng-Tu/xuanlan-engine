import { defineConfig } from 'vite';

// 纯静态构建。base 使用相对路径，保证 dist/ 可直接由任意静态服务器托管，
// 不绑定任何域名、本机绝对路径或编辑器宿主。
export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    // 构建脚本不隐式执行 npm install；依赖只在 npm install / npm ci 阶段解析。
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
  },
});
