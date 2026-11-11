import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.RENDER === 'true' || process.env.RAINSENSE_RENDER_DASHBOARD === '1') {
  const frontend = new URL('../../frontend/', import.meta.url);
  const require = createRequire(new URL('package.json', frontend));
  const packages = ['next/dist/bin/next', 'tailwindcss', 'postcss', 'autoprefixer'];
  const hasFrontendDependencies = packages.every((name) => {
    try { return Boolean(require.resolve(name)); } catch { return false; }
  });
  if (!hasFrontendDependencies) {
    // An existing Render service can still use the backend workspace as its install directory.
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Use npm run build --workspace=backend to build the dashboard');
    const install = spawnSync(process.execPath, [npm, 'ci', '--include=dev'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: 'inherit'
    });
    if (install.error) throw install.error;
    if (install.status !== 0) process.exit(install.status ?? 1);
  }
  const build = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
    cwd: fileURLToPath(frontend),
    env: { ...process.env, RAINSENSE_RENDER_DASHBOARD: '1', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit'
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
  const exported = new URL('.dashboard-export/', frontend);
  if (!existsSync(new URL('overview/index.html', exported))) throw new Error('RainSense dashboard export is missing');
  cpSync(exported, new URL('../dist/dashboard/', import.meta.url), { recursive: true });
}
