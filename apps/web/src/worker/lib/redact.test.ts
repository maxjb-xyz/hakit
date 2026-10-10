import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('scrubs tokens, bearer headers, connection passwords, query secrets and keys', () => {
    const s = redact(
      'gho_abcdefgh1234 ghr_zzzzzzzz9 hk_at_AbCdEf123456 Authorization: Bearer abc.def.ghi123 ' +
        'postgres://tsdbadmin:hunter2@host:5432/tsdb ?code=xyz&state=abc&ok=1 ' +
        '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----',
    );
    for (const secret of [
      'abcdefgh1234',
      'zzzzzzzz9',
      'AbCdEf123456',
      'abc.def.ghi123',
      'hunter2',
      'xyz',
      'MIIE',
    ])
      expect(s).not.toContain(secret);
    expect(s).toContain('ok=1');
    expect(s).toContain('postgres://tsdbadmin:[redacted]@host');
  });
});
