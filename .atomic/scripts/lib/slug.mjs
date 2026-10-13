/**
 * ASCII kebab-case slug normalization and collision avoidance.
 * Intent language is chosen by the parent LLM; this module only validates and dedupes.
 */

const MAX_SLUG_LENGTH = 40;
const FALLBACK_SLUG = "work";

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeSlug(text) {
  let s = String(text ?? "").toLowerCase();
  s = s.replace(/[^\x00-\x7f]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > MAX_SLUG_LENGTH) {
    s = s.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  }
  return s.length > 0 ? s : FALLBACK_SLUG;
}

/**
 * @param {string[]} existing Already-used slugs in the repo or docs home.
 * @param {string} base Normalized base slug (use normalizeSlug first).
 * @returns {string}
 */
export function uniqueSlug(existing, base) {
  const taken = new Set(existing);
  if (!taken.has(base)) {
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}
