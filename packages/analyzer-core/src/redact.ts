/**
 * Evidence bundles sent to a model must not carry secrets, and source comments
 * must never be able to issue instructions (BRIEF §10, §16).
 */

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, "[REDACTED_STRIPE_KEY]"],
  [/\bshp(at|ca|pa|ss)_[A-Fa-f0-9]{16,}/g, "[REDACTED_SHOPIFY_TOKEN]"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_JWT]"],
  [/(?<=(password|secret|token|apikey|api_key)\s*[:=]\s*['"])[^'"]{4,}/gi, "[REDACTED]"],
  [/\b[a-z]+:\/\/[^:@\s]+:[^@\s]+@[^\s'"]+/gi, "[REDACTED_CONNECTION_STRING]"],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/**
 * Neutralizes prompt-injection attempts inside source comments. Repository text
 * is data, never instruction — this makes that explicit to the model rather
 * than relying on the model to notice.
 */
export function neutralizeInjection(text: string): string {
  return text
    .replace(/^\s*(system|assistant|user)\s*:/gim, "[$1-literal]:")
    .replace(/ignore (all |any )?(previous|prior|above) instructions/gi, "[instruction-like text removed]")
    .replace(/<\/?(system|instructions?)>/gi, "[tag removed]");
}

export function sanitizeEvidence(text: string): string {
  return neutralizeInjection(redactSecrets(text));
}
