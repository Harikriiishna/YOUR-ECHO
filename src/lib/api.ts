import type { MediaMeta, PendingOfflineMutation } from '../types/echo';
import {
  handleStandaloneApiRequest,
  isStandaloneLocalMode,
  standaloneFetchMediaUrl,
  standaloneUploadMedia,
} from './localStandaloneApi';

let inMemoryAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isStandaloneLocalMode()) {
    return handleStandaloneApiRequest<T>(path, options, inMemoryAuthToken);
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'ECHO');
  if (inMemoryAuthToken) {
    headers.set('Authorization', `Bearer ${inMemoryAuthToken}`);
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMessage = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) errMessage = data.error;
    } catch {
      // ignore non-json error
    }
    throw new Error(errMessage);
  }

  return (await res.json()) as T;
}

export async function uploadMediaFile(
  file: File | Blob,
  filename: string,
  contextType: string,
  onProgress?: (percent: number) => void
): Promise<MediaMeta> {
  if (isStandaloneLocalMode()) {
    onProgress?.(40);
    const meta = await standaloneUploadMedia(file, filename);
    onProgress?.(100);
    return meta;
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'ECHO');
    if (inMemoryAuthToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${inMemoryAuthToken}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgress) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as { media: MediaMeta };
          resolve(parsed.media);
        } catch {
          reject(new Error('Invalid upload response.'));
        }
      } else {
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during media upload.'));

    const form = new FormData();
    form.append('file', file, filename);
    form.append('contextType', contextType);
    xhr.send(form);
  });
}

export async function fetchProtectedMediaObjectUrl(mediaId: string): Promise<{ url: string; mimeType: string }> {
  if (isStandaloneLocalMode()) {
    return standaloneFetchMediaUrl(mediaId);
  }

  const headers = new Headers({ 'X-Requested-With': 'ECHO' });
  if (inMemoryAuthToken) {
    headers.set('Authorization', `Bearer ${inMemoryAuthToken}`);
  }
  const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}`, {
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Protected media unavailable.');
  }
  const blob = await res.blob();
  return {
    url: URL.createObjectURL(blob),
    mimeType: blob.type || 'application/octet-stream',
  };
}

// ==================== INDEXEDDB OFFLINE CACHE & PENDING SYNC QUEUE ====================
// Note: Used strictly for cached memories/draft queue when offline — NEVER for auth tokens.

const IDB_NAME = 'echo-offline-store';
const IDB_VERSION = 1;

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'clientMutationId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineCache(key: string, value: unknown): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put(value, key);
  } catch {
    // Ignore IDB failures in restricted environments
  }
}

export async function readOfflineCache<T>(key: string): Promise<T | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function enqueueOfflineMutation(mutation: PendingOfflineMutation): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(mutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listOfflineMutations(): Promise<PendingOfflineMutation[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve((req.result as PendingOfflineMutation[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function removeOfflineMutation(clientMutationId: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(clientMutationId);
  } catch {
    // ignore
  }
}
