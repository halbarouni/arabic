#!/usr/bin/env node
// Regenerates fonts/fonts.json from whatever font files sit in fonts/.
// The browser cannot list a directory, so the app reads this manifest instead.
//   usage: node make-fonts-manifest.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'fonts');
const manifest = path.join(dir, 'fonts.json');

if (!fs.existsSync(dir)) {
  console.error('لا يوجد مجلّد fonts/ — أنشئه أولاً');
  process.exit(1);
}

// keep any Arabic display names already set for a file
let previous = {};
try {
  const old = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const item of old.fonts || []) if (typeof item === 'object' && item.file) previous[item.file] = item.name;
} catch (e) { /* first run */ }

const files = fs.readdirSync(dir)
  .filter(f => /\.(ttf|otf|woff2?|ttc)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, 'ar'));

const fonts = files.map(f => (previous[f] ? { file: f, name: previous[f] } : f));

fs.writeFileSync(manifest, JSON.stringify({
  note: 'وُلِّد بواسطة make-fonts-manifest.js — أعد تشغيله بعد إضافة أي خط',
  fonts
}, null, 2) + '\n', 'utf8');

console.log(`fonts/fonts.json: ${fonts.length} خط`);
for (const f of files) console.log('  •', f);
if (!fonts.length) console.log('  (المجلّد فارغ — ضع ملفات الخطوط فيه ثم أعد التشغيل)');
