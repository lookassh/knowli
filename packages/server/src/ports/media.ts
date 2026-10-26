/**
 * Przechowalnia niezmiennych blobów. Klucz jest adresowany treścią (hash);
 * putImmutable nigdy nie nadpisuje istniejących bajtów.
 */
export interface StoredBlob {
  storageKey: string;
  contentSha256: string;
  byteCount: number;
}

/** Blob czytany strumieniowo: porcje bajtów bez ładowania całości do pamięci. */
export interface StreamedBlob {
  body: AsyncIterable<Uint8Array>;
  mimeType: string;
  byteCount: number | null;
}

export interface MediaStore {
  putImmutable(bytes: Uint8Array, mimeType: string): Promise<StoredBlob>;
  get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  /**
   * Opcjonalny odczyt strumieniowy (serwowanie mediów klientowi): host bez
   * tej metody zostaje przy `get`, a warstwa serwująca sama degraduje się
   * do jednorazowej porcji bajtów.
   */
  getStream?(storageKey: string): Promise<StreamedBlob | null>;
}
