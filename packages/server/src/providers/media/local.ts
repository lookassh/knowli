import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MediaStore, StoredBlob } from "../../ports/media";

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "image/png": "png",
  "image/jpeg": "jpg",
};

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg",
};

// storageKey ma zawsze postać "xx/hash.ext" — odrzucamy wszystko inne.
const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}\.(mp3|png|jpg)$/;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Prywatny wolumen: klucz adresowany treścią, zapis atomowy bez nadpisywania
 * (flaga "wx"). Istniejący blob o tym samym hashu jest weryfikowany i użyty
 * ponownie; sprzeczna zawartość to błąd, nigdy cicha podmiana.
 */
export function createLocalMediaStore(rootDir: string): MediaStore {
  const pathOf = (storageKey: string) => join(rootDir, storageKey);

  return {
    async putImmutable(bytes: Uint8Array, mimeType: string): Promise<StoredBlob> {
      const ext = EXT_BY_MIME[mimeType];
      if (!ext) {
        throw new Error(`unsupported media type: ${mimeType}`);
      }
      const contentSha256 = sha256(bytes);
      const storageKey = `${contentSha256.slice(0, 2)}/${contentSha256}.${ext}`;
      const target = pathOf(storageKey);
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const existing = await readFile(target);
        if (sha256(Uint8Array.from(existing)) !== contentSha256) {
          throw new Error(`blob collision at ${storageKey}: content mismatch`);
        }
      }
      return { storageKey, contentSha256, byteCount: bytes.byteLength };
    },

    async get(storageKey: string) {
      if (!KEY_PATTERN.test(storageKey)) {
        return null;
      }
      try {
        const bytes = await readFile(pathOf(storageKey));
        const ext = storageKey.split(".")[1]!;
        return { bytes: Uint8Array.from(bytes), mimeType: MIME_BY_EXT[ext] };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
  };
}
