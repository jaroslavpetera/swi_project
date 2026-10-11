import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { root, report } from './lib/runtime.mjs';

function files(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? files(relative) : relative.endsWith('.md') ? [relative] : [];
  });
}
const markdown = ['README.md', ...files('docs')];
const failures = [];
let checked = 0;
for (const file of markdown) {
  const text = readFileSync(path.join(root, file), 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^(https?:|mailto:)/.test(href) || href.startsWith('#')) continue;
    const [target] = href.split('#');
    const destination = path.resolve(path.dirname(path.join(root, file)), decodeURIComponent(target));
    checked++;
    if (!existsSync(destination) || !statSync(destination).isFile()) failures.push({ file, href });
  }
}
report('docs/evidence/c03-document-links.json', { completedAt: new Date().toISOString(),
  status: failures.length ? 'failed' : 'passed', markdownFiles: markdown.length, localFileLinksChecked: checked, failures,
  scope: 'Local Markdown file targets. External URLs, heading fragments and diagram rendering are not checked.' });
if (failures.length) { console.error(failures); process.exitCode = 1; }
