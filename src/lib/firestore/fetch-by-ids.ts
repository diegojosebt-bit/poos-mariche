import { collection, documentId, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { countServerReads } from './read-meter';
import { queryCache, type WithId } from './query-cache';

const CHUNK_SIZE = 10;
const MAX_IDS = 30;

/**
 * Trae documentos por id (máx. 30) y los fusiona al catálogo cacheado.
 *
 * Se usa cuando el catálogo está paginado (100 productos) y aparece una
 * referencia a un producto que no está en la página: restaurar una venta
 * retenida, componentes de un combo o repuestos de una reparación.
 *
 * Coste: 1 lectura por documento encontrado (máx. 30). Sin esto, el sistema
 * asumiría stock 0 y costo 0 para esos productos.
 */
export async function fetchDocsByIds<T>(
  firestore: Firestore,
  uid: string,
  collectionName: string,
  ids: string[],
  options: { merge?: boolean } = {},
): Promise<WithId<T>[]> {
  if (!firestore || !uid) return [];

  const unique = Array.from(
    new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0)),
  ).slice(0, MAX_IDS);

  if (!unique.length) return [];

  const results: WithId<T>[] = [];

  for (let index = 0; index < unique.length; index += CHUNK_SIZE) {
    const chunk = unique.slice(index, index + CHUNK_SIZE);

    try {
      const snapshot = await getDocs(
        query(
          collection(firestore, 'users', uid, collectionName),
          where(documentId(), 'in', chunk),
        ),
      );

      countServerReads(snapshot.size, `${collectionName}:byId`);

      snapshot.forEach((doc) => {
        results.push({
          ...(doc.data() as Record<string, unknown>),
          id: doc.id,
        } as unknown as WithId<T>);
      });
    } catch (error) {
      console.warn(`[fetchDocsByIds] ${collectionName}:`, error);
    }
  }

  if (options.merge !== false && results.length > 0) {
    queryCache.mergeIntoCatalog(uid, collectionName, results);
  }

  return results;
}
