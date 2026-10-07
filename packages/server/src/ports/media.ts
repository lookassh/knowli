/**
 * Przechowalnia niezmiennych blobów. Klucz jest adresowany treścią (hash);
 * putImmutable nigdy nie nadpisuje istniejących bajtów.
 */
export interface StoredBlob {
  storageKey: string;
  contentSha256: string;
  byteCount: number;
}

export interface MediaStore {
  putImmutable(bytes: Uint8Array, mimeType: string): Promise<StoredBlob>;
  get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}
