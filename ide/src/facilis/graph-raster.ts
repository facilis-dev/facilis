// Browser-only painter for graph_screenshot (D-171): one 2D canvas, no DOM capture and no
// html2canvas. The scene already carries every coordinate, so this module only chooses the
// pixel scale, paints the primitives and encodes the JPEG. Everything it touches (document,
// canvas, Path2D) sits behind the function, so importing this module in a Node test is safe.

import type { GraphScene, GraphScenePalette } from "./graph-scene";

export interface GraphRasterOptions {
  /** Longest canvas side in CSS px (the scene is downscaled to fit, never upscaled). */
  readonly maxDimension: number;
  /** JPEG quality, 0..1. */
  readonly quality: number;
}

export interface GraphRasterImage {
  /** The `data:image/jpeg;base64,...` URL that travels on the host image channel. */
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  /** Base64 payload length, matching the preview screenshot's `bytes` convention. */
  readonly bytes: number;
}

const EDGE_WIDTH = 1.5;
const EDGE_DASH = [5, 3] as const;
const CARD_RADIUS = 6;
const LABEL_FONT = "500 11px ui-sans-serif, system-ui, sans-serif";
const KIND_FONT = "9px ui-sans-serif, system-ui, sans-serif";
const LABEL_INSET = 8;

function paintEdges(context: CanvasRenderingContext2D, scene: GraphScene): void {
  context.lineWidth = EDGE_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const edge of scene.edges) {
    context.strokeStyle = edge.stroke;
    context.setLineDash(edge.dashed ? [...EDGE_DASH] : []);
    context.stroke(new Path2D(edge.path));
  }
  context.setLineDash([]);
}

function paintNodes(
  context: CanvasRenderingContext2D,
  scene: GraphScene,
  palette: GraphScenePalette,
): void {
  for (const node of scene.nodes) {
    const { x, y, width, height } = node.rect;
    context.beginPath();
    context.roundRect(x, y, width, height, CARD_RADIUS);
    context.fillStyle = palette.card;
    context.fill();
    context.strokeStyle = palette.border;
    context.stroke();
    const maxWidth = Math.max(0, width - LABEL_INSET * 2);
    context.fillStyle = palette.text;
    context.font = LABEL_FONT;
    context.textBaseline = "middle";
    context.fillText(node.label, x + LABEL_INSET, y + height / 2, maxWidth);
    context.fillStyle = palette.muted;
    context.font = KIND_FONT;
    context.textAlign = "right";
    context.fillText(node.kind, x + width - LABEL_INSET, y + height / 2, maxWidth);
    context.textAlign = "left";
  }
}

function paint(
  context: CanvasRenderingContext2D,
  scene: GraphScene,
  palette: GraphScenePalette,
): void {
  context.fillStyle = palette.background;
  context.fillRect(0, 0, scene.width, scene.height);
  paintEdges(context, scene);
  paintNodes(context, scene, palette);
}

/** Paint the scene to a JPEG data URL, or null when this environment has no 2D canvas. */
export function rasterizeGraphScene(
  scene: GraphScene,
  palette: GraphScenePalette,
  options: GraphRasterOptions,
): GraphRasterImage | null {
  if (scene.width <= 0 || scene.height <= 0) return null;
  const longest = Math.max(scene.width, scene.height);
  const scale = Math.min(1, options.maxDimension / longest);
  const width = Math.max(1, Math.round(scene.width * scale));
  const height = Math.max(1, Math.round(scene.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.scale(scale, scale);
  paint(context, scene, palette);
  const dataUrl = canvas.toDataURL("image/jpeg", options.quality);
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  return { dataUrl, width, height, bytes: dataUrl.length - comma - 1 };
}
