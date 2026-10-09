/**
 * JSON Guard: Utility helpers to prevent circular structure serialization errors,
 * strip React Fiber/DOM nodes, and clean data objects without mutating native JSON.stringify.
 */

/**
 * Checks whether a value is a DOM Element, Node, Window, or React Fiber internal structure.
 */
export function isDOMOrFiber(val: any): boolean {
  if (!val || typeof val !== 'object') return false;

  try {
    // Browser DOM types
    if (typeof HTMLElement !== 'undefined' && val instanceof HTMLElement) return true;
    if (typeof Node !== 'undefined' && val instanceof Node) return true;
    if (typeof Window !== 'undefined' && val instanceof Window) return true;

    // React Element or internal fiber check
    if (val.$$typeof || val._reactInternals) return true;

    // Constructor name checks for environments where types may differ or SSR
    const cName = val.constructor?.name;
    if (
      cName &&
      (cName === 'HTMLElement' ||
        cName === 'HTMLDocument' ||
        cName === 'Window' ||
        cName === 'FiberNode' ||
        cName === 'SyntheticBaseEvent' ||
        cName.endsWith('Element'))
    ) {
      return true;
    }

    // React internal properties check
    const keys = Object.keys(val);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.startsWith('__reactFiber') || k.startsWith('__reactProps') || k.startsWith('__reactEvents')) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Safe version of JSON.stringify that never throws "Converting circular structure to JSON"
 * and gracefully converts HTMLElements and FiberNodes into friendly representations.
 */
export function safeJsonStringify(
  value: any,
  replacer?: ((this: any, key: string, value: any) => any) | (number | string)[] | null,
  space?: string | number
): string {
  const seen = new WeakSet();

  function cycleReplacer(this: any, key: string, val: any) {
    // Strip React internal Fiber/Props properties completely
    if (key && (key.startsWith('__reactFiber') || key.startsWith('__reactProps') || key.startsWith('__reactEvents'))) {
      return undefined;
    }

    if (typeof val === 'object' && val !== null) {
      if (isDOMOrFiber(val)) {
        try {
          const tagName = (val as HTMLElement)?.tagName?.toLowerCase();
          return tagName ? `[HTMLElement <${tagName}>]` : '[HTMLElement]';
        } catch {
          return '[HTMLElement]';
        }
      }
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }

    if (typeof replacer === 'function') {
      return replacer.call(this, key, val);
    }

    if (Array.isArray(replacer) && key !== '') {
      if (!replacer.includes(key as never)) {
        return undefined;
      }
    }

    return val;
  }

  try {
    return JSON.stringify(value, cycleReplacer, space);
  } catch (_err) {
    try {
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(String(value));
      }
      return 'null';
    } catch {
      return '"[Unserializable]"';
    }
  }
}

/**
 * Recursively cleans an object by removing undefined properties and circular references,
 * safe against DOM nodes and React elements while preserving Date and Firestore Timestamps.
 */
export function cleanObject<T = any>(obj: T, seen = new WeakSet()): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  // Preserve Date instances
  if (obj instanceof Date) {
    return obj;
  }

  // Preserve Firestore Timestamp or objects with toDate
  if (typeof (obj as any).toDate === 'function') {
    return obj;
  }

  if (isDOMOrFiber(obj)) {
    return undefined as any;
  }

  if (seen.has(obj as any)) {
    return undefined as any;
  }
  seen.add(obj as any);

  if (Array.isArray(obj)) {
    return obj
      .map((item) => (typeof item === 'object' && item !== null ? cleanObject(item, seen) : item))
      .filter((item) => item !== undefined) as any;
  }

  const cleaned: Record<string, any> = {};
  try {
    const keys = Object.keys(obj as any);
    for (const key of keys) {
      if (key.startsWith('__reactFiber') || key.startsWith('__reactProps') || key.startsWith('__reactEvents')) {
        continue;
      }
      const val = (obj as any)[key];
      if (val !== undefined && typeof val !== 'function') {
        if (typeof val === 'object' && val !== null) {
          const cleanedVal = cleanObject(val, seen);
          if (cleanedVal !== undefined) {
            cleaned[key] = cleanedVal;
          }
        } else {
          cleaned[key] = val;
        }
      }
    }
  } catch {
    return obj;
  }

  return cleaned as T;
}

