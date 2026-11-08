import { StorageError } from "./types.ts";

/**
 * Exact-read adapter over an async byte source. The encrypted format needs framing reads
 * (magic/header/chunk) across arbitrary source chunk boundaries, so the decryptor pulls
 * through this reader instead of assuming how the driver splits its output.
 *
 * Memory stays bounded: readAtMost allocates at most the requested size, and only source
 * chunks are queued, not the whole blob.
 */
export class StreamReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunks: Buffer[] = [];
  private offset = 0;
  private ended = false;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async pull(): Promise<boolean> {
    // Empty source chunks are legal in a byte stream and must not be mistaken for the end
    // of one: skip them and keep pulling until real bytes or EOF (D-117 review fix).
    while (!this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        return false;
      }
      if (next.value.length > 0) {
        this.chunks.push(Buffer.from(next.value));
        return true;
      }
    }
    return false;
  }

  async readExactly(length: number): Promise<Buffer> {
    const out = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      if (this.chunks.length === 0 && !(await this.pull())) {
        throw new StorageError("storage encryption: truncated blob");
      }
      const chunk = this.chunks[0];
      if (chunk === undefined) {
        throw new StorageError("storage encryption: truncated blob");
      }
      const available = chunk.length - this.offset;
      const take = Math.min(available, length - written);
      chunk.copy(out, written, this.offset, this.offset + take);
      written += take;
      this.offset += take;
      if (this.offset === chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return out;
  }

  /** Read up to length bytes; fewer means the source ended, zero means it is exhausted. */
  async readAtMost(length: number): Promise<Buffer> {
    const out = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      if (this.chunks.length === 0 && !(await this.pull())) break;
      const chunk = this.chunks[0];
      if (chunk === undefined) break;
      const available = chunk.length - this.offset;
      const take = Math.min(available, length - written);
      chunk.copy(out, written, this.offset, this.offset + take);
      written += take;
      this.offset += take;
      if (this.offset === chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return out.subarray(0, written);
  }

  /** One byte of lookahead, or null at end of source. Used to detect the final chunk. */
  async readByte(): Promise<Buffer | null> {
    if (this.chunks.length === 0 && !(await this.pull())) return null;
    const chunk = this.chunks[0];
    if (chunk === undefined) return null;
    const byte = Buffer.from(chunk.subarray(this.offset, this.offset + 1));
    this.offset += 1;
    if (this.offset === chunk.length) {
      this.chunks.shift();
      this.offset = 0;
    }
    return byte;
  }

  unshift(bytes: Buffer): void {
    if (bytes.length === 0) return;
    if (this.offset > 0) {
      const head = this.chunks[0];
      if (head !== undefined) this.chunks[0] = head.subarray(this.offset);
      this.offset = 0;
    }
    this.chunks.unshift(bytes);
  }

  get eof(): boolean {
    return this.ended && this.chunks.length === 0;
  }
}
