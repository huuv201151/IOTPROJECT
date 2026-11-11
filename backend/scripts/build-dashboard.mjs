import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.RENDER === 'true' || process.env.RAINSENSE_RENDER_DASHBOARD === '1') {
  const frontend = new URL('../../frontend/', import.meta.url);
  const require = createRequire(new URL('package.json', frontend));
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
