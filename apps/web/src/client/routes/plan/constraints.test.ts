import { describe, expect, it } from 'vitest';
import { constraints, knightHacksIX } from '@hakit/contracts/fixtures';
import { fromPutConstraints, toPutConstraints } from './ConstraintsStep';

describe('constraint state <-> PutConstraints', () => {
  it('restores the saved set into editor state', () => {
    expect(fromPutConstraints(constraints)).toEqual({
      challengeIds: [knightHacksIX.challenges[0]!.id],
      required: ['cloudflare-workers'],
      excluded: ['react-native'],
      custom: ['Demo must run from a single laptop'],
      judging: { general: 0.75 },
    });
  });
  it('round-trips through toPutConstraints', () => {
    const back = toPutConstraints(fromPutConstraints(constraints), knightHacksIX);
    expect(new Set(back.constraints.map((k) => JSON.stringify(k)))).toEqual(
      new Set(constraints.constraints.map((k) => JSON.stringify(k))),
    );
  });
  it('ignores a challenge constraint without a ref', () => {
    expect(
      fromPutConstraints({ constraints: [{ kind: 'challenge', refId: null, value: 'x', weight: 1 }] })
        .challengeIds,
    ).toEqual([]);
  });
});
