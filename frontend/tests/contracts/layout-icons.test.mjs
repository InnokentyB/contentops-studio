import assert from 'node:assert/strict';
import fs from 'node:fs';

const layout = fs.readFileSync(new URL('../../src/components/Layout.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

assert.match(layout, /function ShellIcon/);
assert.match(layout, /<ShellIcon name=\{item\.icon\}/);
assert.match(layout, /<ShellIcon name=\{sidebarCollapsed \? 'chevron_right' : 'chevron_left'\}/);
assert.match(styles, /font-family:\s*['"]Material Symbols Outlined['"]/);
assert.match(styles, /overflow:\s*hidden/);
assert.match(styles, /inline-size:\s*1em/);

console.log('layout icon resilience contract: ok');
