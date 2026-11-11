import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function syncFrontendShared() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = path.join(root, 'backend/src/shared');
  const target = path.join(root, 'frontend/shared');
  let changed = 0;
  function visit(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const input = path.join(directory, item.name);
      if (item.isDirectory()) { visit(input); continue; }
      if (!item.name.endsWith('.ts')) continue;
      const output = path.join(target, path.relative(source, input));
      const content = readFileSync(input, 'utf8').replace(/\r\n/g, '\n');
      let previous = '';
      try { previous = readFileSync(output, 'utf8').replace(/\r\n/g, '\n'); } catch { /* First copy. */ }
      if (previous === content) continue;
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, content, 'utf8'); changed++;
    }
  }
  visit(source);
  console.log(`Frontend shared modules: ${changed} updated`);
}

syncFrontendShared();
