/**
 * masking sensitive information.
 * before inserting raw material into LLM prompt, remove keys, tokens, emails etc.
 * avoid excessive masking by targeting only high-entropy/explicit secret patterns.
 */

interface Rule {
  re: RegExp;
  replace: string | ((m: string, ...g: string[]) => string);
}

const RULES: Rule[] = [
  // JWT (eyJ... . ... . ...)
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replace: "[REDACTED_JWT]" },
  // Anthropic / OpenAI style keys
  { re: /sk-ant-[A-Za-z0-9_-]{12,}/g, replace: "[REDACTED_KEY]" },
  { re: /sk-[A-Za-z0-9]{20,}/g, replace: "[REDACTED_KEY]" },
  // GitHub tokens
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replace: "[REDACTED_KEY]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: "[REDACTED_KEY]" },
  // AWS access key id
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[REDACTED_KEY]" },
  // Bearer tokens
  { re: /\bBearer\s+[A-Za-z0-9._\-]{12,}/g, replace: "Bearer [REDACTED_TOKEN]" },
  // explicit assignment: api_key=..., token: "...", password=..., secret=...
  {
    re: /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd)\b(\s*[:=]\s*)(["']?)([^\s"',}]{6,})\3/gi,
    replace: (_m, key: string, sep: string, q: string) => `${key}${sep}${q}[REDACTED]${q}`,
  },
  // email
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: "[REDACTED_EMAIL]" },
];

export function maskSensitive(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, rule.replace as any);
  }
  return out;
}
