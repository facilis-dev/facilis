// Images the user pastes into the chat with Ctrl+V (D-113).
//
// The clipboard hands the composer image files; each is downscaled and re-encoded by
// chat-image-resize.ts, and the resulting data URL rides on the user's turn, where D-112's wire
// path already turns it into the provider's content parts for a vision preset. Nothing touches
// the project and nothing is persisted: the caps below keep one paste from blowing up the
// request or the transcript.

const ACCEPTED_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

/**
 * Source size cap, before compression. The copy that travels to the provider is the compressed
 * one, so this only guards decoding a huge file in the main thread.
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Images that travel with one user message. */
export const MAX_IMAGES = 4;

/** `btoa()` over a whole multi-megabyte string would blow the call stack: encode in slices. */
const CHUNK = 0x8000;

/** Whether a pasted file is an image the providers accept. */
export function isImageFile(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** One image file as a data URL; null for an unsupported type or an oversized file. */
export async function imageDataUrl(file: File): Promise<string | null> {
  if (!isImageFile(file) || file.size > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return "data:" + file.type + ";base64," + base64(bytes);
}

/**
 * Turns one pasted file into the data URL that travels with the message. Injected so the reading
 * and the caps stay testable outside a browser (chat-image-resize.ts is the real one).
 */
export type ImageCompressor = (file: File) => Promise<string>;

export interface ReadImages {
  /** Data URLs in clipboard order, at most `MAX_IMAGES`. */
  images: string[];
  /** Files dropped: unsupported type, too large, beyond the per-message limit, or undecodable. */
  skipped: number;
}

/** Turn the clipboard's files into data URLs, reporting how many were dropped. */
export async function readImages(
  files: readonly File[],
  compress: ImageCompressor,
): Promise<ReadImages> {
  const images: string[] = [];
  let skipped = 0;
  for (const file of files) {
    if (images.length >= MAX_IMAGES || !isImageFile(file) || file.size > MAX_IMAGE_BYTES) {
      skipped += 1;
      continue;
    }
    try {
      images.push(await compress(file));
    } catch {
      // A file the canvas could not decode is not worth sending raw: report it as dropped.
      skipped += 1;
    }
  }
  return { images, skipped };
}
