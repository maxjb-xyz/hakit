import { readFileSync } from 'node:fs';
import { hfEmbeddings, QWEN_MODEL, QWEN_DIM } from '../src/worker/services/embeddings/providers.ts';

let token = process.env.HF_TOKEN;
if (!token) {
  try {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((line) => /^\s*HF_TOKEN\s*=/.test(line));
    token = line
      ?.slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    /* Report missing configuration without displaying contents. */
  }
}
if (!token) {
  console.error('HF_TOKEN is missing; set it in apps/web/.dev.vars.');
  process.exit(1);
}
try {
  const provider = hfEmbeddings({ token, model: QWEN_MODEL, dim: QWEN_DIM });
  const [vector] = await provider.embed(['Build a React user interface'], 'query');
  const labels = ['React frontend developer', 'Embedded hardware developer'];
  const documents = await provider.embed(
    [
      'I build React and TypeScript web interfaces.',
      'I design electronic circuits and program microcontrollers.',
    ],
    'document',
  );
  const scores = documents.map((document, i) => ({
    profile: labels[i],
    similarity: Number(document.reduce((sum, value, index) => sum + value * vector[index], 0).toFixed(4)),
  }));
  console.log(
    JSON.stringify({
      ok: true,
      provider: provider.name,
      model: provider.model,
      dimension: vector.length,
      norm: Math.hypot(...vector),
      matches: scores.sort((a, b) => b.similarity - a.similarity),
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
