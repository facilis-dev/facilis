// Git blob identity without a git client (D-078).
//
// A remote tree lists each file's git blob SHA-1 (GitHub \`sha\`, GitLab \`id\`, Gitea
// \`sha\`). Recomputing the same hash from the VFS bytes is what lets "publish" show a
// real diff against the branch the project would be pushed to, instead of guessing from
// timestamps or re-downloading the whole repository.
//
// WebCrypto has no synchronous SHA-1 and isomorphic-git's hashBlob drags its ~1 MB
// chunk in on first use; this digest only ever sees file bytes, so it lives here.

const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

function rol(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** SHA-1 of the bytes, lowercase hex. */
export function sha1Hex(input: Uint8Array): string {
  const bitLength = input.length * 8;
  // 0x80 terminator, then the 64-bit big-endian length, in 64-byte blocks.
  const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const round = Math.floor(i / 20);
      const f =
        round === 0
          ? (b & c) | (~b & d)
          : round === 1
            ? b ^ c ^ d
            : round === 2
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const t = (rol(a, 5) + f + e + K[round] + w[i]) >>> 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  let hex = "";
  for (const word of [h0, h1, h2, h3, h4]) {
    hex += word.toString(16).padStart(8, "0");
  }
  return hex;
}

/** The id git would store a file's contents under: sha1("blob <length>\\0" + bytes). */
export function gitBlobSha(bytes: Uint8Array): string {
  const header = new TextEncoder().encode("blob " + bytes.length + "\0");
  const framed = new Uint8Array(header.length + bytes.length);
  framed.set(header);
  framed.set(bytes, header.length);
  return sha1Hex(framed);
}

/** One path/id pair, whether read from the VFS or from a host's tree endpoint. */
export interface TreeEntry {
  path: string;
  sha: string;
}

export interface TreeChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

/** What a push would change on the remote: path lists, sorted for a stable display. */
export function diffTrees(local: readonly TreeEntry[], remote: readonly TreeEntry[]): TreeChanges {
  const remoteByPath = new Map(remote.map((entry) => [entry.path, entry.sha]));
  const localPaths = new Set<string>();
  const added: string[] = [];
  const modified: string[] = [];
  for (const entry of local) {
    localPaths.add(entry.path);
    const remoteSha = remoteByPath.get(entry.path);
    if (remoteSha === undefined) added.push(entry.path);
    else if (remoteSha !== entry.sha) modified.push(entry.path);
  }
  const deleted: string[] = [];
  for (const entry of remote) {
    if (!localPaths.has(entry.path)) deleted.push(entry.path);
  }
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

/** True when a push would change nothing. */
export function isClean(changes: TreeChanges): boolean {
  return changes.added.length === 0 && changes.modified.length === 0 && changes.deleted.length === 0;
}
