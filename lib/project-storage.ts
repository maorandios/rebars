import type { SlabGeometry } from "@/types/structure";

const databaseName = "rebars-project-storage";
const databaseVersion = 1;
const storeName = "projects";
export const importedProjectStorageKey = "rebars.importedSlabGeometry";

function openProjectDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
  });
}

export async function saveSlabGeometryProject(slabGeometry: SlabGeometry) {
  const database = await openProjectDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    store.put(slabGeometry, importedProjectStorageKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
  window.sessionStorage.setItem(importedProjectStorageKey, "indexeddb");
}

export async function loadSlabGeometryProject() {
  const database = await openProjectDatabase();
  const slabGeometry = await new Promise<SlabGeometry | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(importedProjectStorageKey);

    request.onsuccess = () => resolve((request.result as SlabGeometry) ?? null);
    request.onerror = () => reject(request.error);
  });

  database.close();
  return slabGeometry;
}

export async function removeSlabGeometryProject() {
  const database = await openProjectDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    store.delete(importedProjectStorageKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
  window.sessionStorage.removeItem(importedProjectStorageKey);
}

export function loadLegacySessionProject() {
  const storedProject = window.sessionStorage.getItem(importedProjectStorageKey);

  if (!storedProject || storedProject === "indexeddb") {
    return null;
  }

  return JSON.parse(storedProject) as SlabGeometry;
}
