import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { contentHash, isContentHash } from "./hash.ts";
import { StorageError, type PutResult, type StorageDriver } from "./types.ts";

export interface LocalStorageOptions {
  /**
   * Root directory for blobs. In a generated project this is
   * <project>/.facilis/binary; the driver shards by the first hash byte.
   */
  readonly rootDir: string;
}

/**
 * Dev storage: content-addressed files under .facilis/binary/<hh>/<hash>.
 *
 * The VFS mirror ships these bytes to OPFS, so a dev upload survives a reload like the
 * dev database does (D-052/D-053). The directory is self-ignored for git.
 */
export function createLocalStorage(options: LocalStorageOptions): StorageDriver {
  const root = options.rootDir;
  const pathOf = (hash: string) => join(root, hash.slice(0, 2), hash);

  return {
    driver: "local",
    async put(bytes: Uint8Array): Promise<PutResult> {
      const hash = contentHash(bytes);
      const target = pathOf(hash);
      if (await existsPath(target)) return { hash, size: bytes.length };
      await mkdir(dirname(target), { recursive: true });
      await mkdir(root, { recursive: true });
      const ignore = join(root, ".gitignore");
      if (!(await existsPath(ignore))) await writeFile(ignore, "*\n");
      const temp = target + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
      await writeFile(temp, bytes);
      await rename(temp, target);
      return { hash, size: bytes.length };
    },
    async get(hash: string): Promise<Uint8Array> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      try {
        return new Uint8Array(await readFile(pathOf(hash)));
      } catch (error) {
        throw new StorageError("blob " + hash + " is not stored here", { cause: error });
      }
    },
    async exists(hash: string): Promise<boolean> {
      return isContentHash(hash) && existsPath(pathOf(hash));
    },
    async delete(hash: string): Promise<void> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      try {
        await unlink(pathOf(hash));
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
      }
    },
  };
}

async function existsPath(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
