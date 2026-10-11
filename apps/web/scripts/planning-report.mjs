/** Print only safe metrics from an eval artifact (never its prompts or plan text). */
import { readFileSync } from 'node:fs';
const path = process.env.EVAL_REPORT_PATH ?? process.argv[2] ?? 'test-results/planning-offline.json';
const r = JSON.parse(readFileSync(path, 'utf8'));
process.stdout.write(`${r.mode} planning evals: ${r.caseCount} cases\n`);
for (const [name, rate] of Object.entries(r.passRates))
  process.stdout.write(`  ${name.padEnd(16)} ${(rate * 100).toFixed(0)}%\n`);
process.stdout.write(`same idea / different team: ${r.sameIdeaDifferentTeam}\nReport: ${path}\n`);
