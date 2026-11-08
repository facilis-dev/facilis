import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { isContentHash } from "./hash.ts";
import { StorageError, type BlobSource, type PutResult, type StorageDriver } from "./types.ts";

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
 * Byte handling is streaming (D-117): put hashes while it writes a temp file and renames it
 * into place, get yields the file as a stream. Nothing buffers the whole upload/download.
 *
 * The VFS mirror ships these bytes to OPFS, so a dev upload survives a reload like the
 * dev database does (D-052/D-053). The directory is self-ignored for git.
 */
export function createLocalStorage(options: LocalStorageOptions): StorageDriver {
  const root = options.rootDir;
  const pathOf = (hash: string) => join(root, hash.slice(0, 2), hash);

  return {
    driver: "local",
    async put(source: BlobSource): Promise<PutResult> {
      await mkdir(root, { recursive: true });
      const ignore = join(root, ".gitignore");
      if (!(await existsPath(ignore))) await writeFile(ignore, "*\n");

      const temp = join(
        root,
        "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp",
      );
      const hash = createHash("sha256");
      let size = 0;
      // pipeline owns the write stream lifecycle: on a source error it closes the fd
      // before the catch unlinks the temp file, so a failed upload cannot leave a .tmp
      // orphan behind (D-117 review fix).
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          size += chunk.length;
          callback(null, chunk);
        },
      });
      try {
        await pipeline(Readable.from(source), meter, createWriteStream(temp, { mode: 0o600 }));
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error instanceof StorageError
          ? error
          : new StorageError("local storage: write failed", { cause: error });
      }

      const digest = hash.digest("hex");
      const target = pathOf(digest);
      try {
        if (await existsPath(target)) {
          await unlink(temp).catch(() => {});
        } else {
          await mkdir(dirname(target), { recursive: true });
          await rename(temp, target);
        }
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw new StorageError("local storage: store failed", { cause: error });
      }
      return { hash: digest, size };
    },
    async get(hash: string): Promise<BlobSource> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      const path = pathOf(hash);
      try {
        await stat(path);
      } catch (error) {
        throw new StorageError("blob " + hash + " is not stored here", { cause: error });
      }
      return (async function* readFile(): AsyncGenerator<Uint8Array> {
        try {
          for await (const chunk of createReadStream(path)) yield new Uint8Array(chunk as Buffer);
        } catch (error) {
          throw new StorageError("local storage: read failed", { cause: error });
        }
      })();
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
