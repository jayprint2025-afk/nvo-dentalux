import type { VoiceProfile, VoiceProfileScope } from "./types";

const DB_NAME = "cliniqone_f1_voice_profiles";
const DB_VERSION = 1;
const STORE_NAME = "profiles";

export function voiceProfileKey(scope: VoiceProfileScope): string {
  return [
    String(scope.tenantId || "tenant"),
    String(scope.userId || "user"),
    String(scope.branchKey || "sucursal_1"),
  ].join(":");
}

export class VoiceProfileStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async get(scope: VoiceProfileScope): Promise<VoiceProfile | null> {
    const db = await this.open();
    const key = voiceProfileKey(scope);

    return new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key);

      request.onsuccess = () =>
        resolve((request.result as VoiceProfile | undefined) ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error("No fue posible leer el perfil de voz"));
    });
  }

  async put(profile: VoiceProfile): Promise<void> {
    const db = await this.open();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(profile);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("No fue posible guardar el perfil"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Se canceló el guardado del perfil"));
    });
  }

  async delete(scope: VoiceProfileScope): Promise<void> {
    const db = await this.open();
    const key = voiceProfileKey(scope);

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("No fue posible eliminar el perfil"));
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("No fue posible abrir IndexedDB"));
    });

    return this.dbPromise;
  }
}
