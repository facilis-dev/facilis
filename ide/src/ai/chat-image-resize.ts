// Downscale and re-encode a pasted image before it joins the conversation (D-113).
//
// A Retina screenshot is a few megabytes; the chat replays pasted images with every later
// message, so the copy that travels is bounded: longest edge 1536 px (enough for a vision model
// to read a UI) and JPEG q0.85, which turns a 4 MB PNG into a couple hundred kilobytes.
//
// <img> + <canvas> instead of createImageBitmap/OffscreenCanvas: both are supported by every
// browser the IDE targets, so the paste path has no feature gap. An animated GIF becomes its
// first frame, which is what a still screenshot is anyway.

import { imageDataUrl } from "./chat-image";

/** Longest edge kept, in pixels. */
export const MAX_IMAGE_EDGE = 1536;

/** JPEG quality: text stays legible, the payload stays small. */
export const JPEG_QUALITY = 0.85;

/** JPEG has no alpha channel: transparent pixels are drawn on white, not on black. */
const BACKDROP = "#ffffff";

/** The scale that fits width × height inside `maxEdge` (1 when it already fits). */
export function scaleFor(width: number, height: number, maxEdge: number = MAX_IMAGE_EDGE): number {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return 1;
  return maxEdge / longest;
}

function decode(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the pasted image could not be decoded"));
    image.src = source;
  });
}

/** A smaller JPEG of the file, or the original when re-encoding would not shrink it. */
export async function compressImage(file: File): Promise<string> {
  const source = URL.createObjectURL(file);
  try {
    const image = await decode(source);
    const scale = scaleFor(image.naturalWidth, image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("the 2D canvas is unavailable");
    context.fillStyle = BACKDROP;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    // Base64 grows the raw bytes by ~4/3: keep the JPEG only when it is actually smaller.
    if (jpeg.length < Math.ceil((file.size * 4) / 3)) return jpeg;
    return (await imageDataUrl(file)) ?? jpeg;
  } finally {
    URL.revokeObjectURL(source);
  }
}
