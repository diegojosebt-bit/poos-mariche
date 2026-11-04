const MARKS = /[\u0300-\u036f]/g;
const SEPARATORS = /[^a-z0-9]+/g;
const MAX_TOKENS = 60;

/**
 * Normaliza texto para búsqueda: minúsculas, sin acentos y sin signos.
 * "Batería iPhone 11" -> "bateria iphone 11"
 */
export function normalizeText(input: string | undefined | null): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Genera tokens de búsqueda por prefijos (2–16 caracteres por palabra).
 * Se guardan en `searchTokens` y se consultan con `array-contains`.
 *
 * "Batería iPhone" -> ba, bat, bate, bater, bateri, bateria, ip, iph, ...
 */
export function buildSearchTokens(
  inputs: Array<string | string[] | undefined | null>,
  options: { min?: number; max?: number } = {},
): string[] {
  const min = options.min ?? 2;
  const max = options.max ?? 16;
  const tokens = new Set<string>();

  for (const input of inputs) {
    if (!input) continue;

    const text = normalizeText(Array.isArray(input) ? input.join(' ') : input);
    if (!text) continue;

    for (const word of text.split(' ')) {
      if (!word) continue;
      const limitTo = Math.min(word.length, max);
      for (let length = min; length <= limitTo; length++) {
        tokens.add(word.slice(0, length));
      }
      tokens.add(word);
      if (tokens.size >= MAX_TOKENS) return Array.from(tokens).slice(0, MAX_TOKENS);
    }
  }

  return Array.from(tokens);
}

/** Última palabra tecleada; es la que se consulta en el servidor. */
export function lastTokenOf(term: string): string {
  return normalizeText(term).split(' ').filter(Boolean).pop() ?? '';
}
