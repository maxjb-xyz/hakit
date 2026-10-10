/**
 * Scrub credentials from strings before they reach logs (RISKS S-1). Upstream errors can echo request data, so
 * every logged error string goes through this.
 */
const PATTERNS: [RegExp, string][] = [
  [/\bgh[opsur]_[A-Za-z0-9_]{8,}/g, 'gh*_[redacted]'], // GitHub OAuth/app/user tokens
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, 'github_pat_[redacted]'],
  [/\bhk_at_[A-Za-z0-9_-]{8,}/g, 'hk_at_[redacted]'], // Hakit agent tokens
  [/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1[redacted]@'], // connection-string passwords
  [/\b(key|secret|password|code|state)=([^&\s"']+)/gi, '$1=[redacted]'], // query-string credentials
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]'],
];

export function redact(value: string): string {
  return PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), value);
}
