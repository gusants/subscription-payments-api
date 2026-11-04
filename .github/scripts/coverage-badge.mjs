import { readFileSync, writeFileSync } from 'node:fs';

const [summaryPath, outputPath] = process.argv.slice(2);
if (!summaryPath || !outputPath) {
  console.error('usage: coverage-badge.mjs <coverage-summary.json> <output.json>');
  process.exit(2);
}

const COLOR_BY_MIN_PCT = [
  [90, 'brightgreen'],
  [80, 'green'],
  [70, 'yellowgreen'],
  [60, 'yellow'],
  [50, 'orange'],
  [0, 'red'],
];

const pct = Number(JSON.parse(readFileSync(summaryPath, 'utf8')).total?.lines?.pct);
if (!Number.isFinite(pct)) {
  console.error(`total.lines.pct missing or not numeric in ${summaryPath}`);
  process.exit(1);
}

const [, color] = COLOR_BY_MIN_PCT.find(([min]) => pct >= min);
const badge = { schemaVersion: 1, label: 'coverage', message: `${pct.toFixed(1)}%`, color };
writeFileSync(outputPath, `${JSON.stringify(badge, null, 2)}\n`);
