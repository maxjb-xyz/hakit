import { readFileSync } from 'node:fs';
import {
  hfEmbeddings,
  QWEN_MODEL,
  QWEN_DIM,
  workersAiEmbeddings,
} from '../src/worker/services/embeddings/providers.ts';

function variable(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
    return line
      ?.slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined; // Report missing configuration without displaying contents.
  }
}
const accountId = variable('CLOUDFLARE_ACCOUNT_ID'),
  apiToken = variable('CLOUDFLARE_API_TOKEN'),
  token = variable('HF_TOKEN');
/** Workers AI over REST (the worker uses the AI binding); same model and instruction as the worker. */
const restRun = async (model, inputs, { signal }) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(inputs),
  });
  if (!response.ok) throw new Error(`Workers AI HTTP ${response.status}`);
  return (await response.json()).result;
};
if (!(accountId && apiToken) && !token) {
  console.error(
    'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI) or HF_TOKEN in apps/web/.dev.vars.',
  );
  process.exit(1);
}
try {
  const provider =
    accountId && apiToken
      ? workersAiEmbeddings({ run: restRun, model: QWEN_MODEL, dim: QWEN_DIM })
      : hfEmbeddings({ token, model: QWEN_MODEL, dim: QWEN_DIM });
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
