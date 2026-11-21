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
// Matches the full card's >= 10 px base text (issue #60) so the screenshot and the canvas agree.
const KIND_FONT = "10px ui-sans-serif, system-ui, sans-serif";
const LABEL_INSET = 8;
/** The bridge apex text (issue #65), lifted like the canvas label's -1.3em of its 10 px font. */
const BRIDGE_FONT = "500 10px ui-sans-serif, system-ui, sans-serif";
const BRIDGE_LABEL_LIFT = 13;
/** The AI outline channel (issue #66): a brand halo under the stroke, a frame around the card. */
const OUTLINE_EDGE_WIDTH = 5;
const OUTLINE_CARD_WIDTH = 2;
const OUTLINE_CARD_OFFSET = 2.5;
const OUTLINE_OPACITY = 0.45;

/** Cluster frames (issue #62): an outline with its label, painted under everything else. */
function paintFrames(
  context: CanvasRenderingContext2D,
  scene: GraphScene,
  palette: GraphScenePalette,
): void {
  for (const frame of scene.frames) {
    const { x, y, width, height } = frame.rect;
    context.beginPath();
    context.roundRect(x, y, width, height, CARD_RADIUS);
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = palette.muted;
    context.font = KIND_FONT;
    context.textBaseline = "middle";
    context.fillText(frame.label, x + LABEL_INSET, y + 12, Math.max(0, width - LABEL_INSET * 2));
  }
}

function paintEdges(
  context: CanvasRenderingContext2D,
  scene: GraphScene,
  palette: GraphScenePalette,
): void {
  context.lineWidth = EDGE_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const edge of scene.edges) {
    const path = new Path2D(edge.path);
    // The halo is drawn first and keeps its own alpha: the AI channel stays visible even when
    // the user focus dims the edge itself (criterion 5).
    if (edge.outlined) {
      context.globalAlpha = OUTLINE_OPACITY;
      context.strokeStyle = palette.outline;
      context.lineWidth = OUTLINE_EDGE_WIDTH;
      context.setLineDash([]);
      context.stroke(path);
    }
    context.globalAlpha = edge.opacity;
    context.strokeStyle = edge.stroke;
    context.lineWidth = EDGE_WIDTH;
    context.setLineDash(edge.dashed ? [...EDGE_DASH] : []);
    context.stroke(path);
    // The bridge apex label, where the canvas draws it (issue #65): same text, same spot,
    // dimmed with its edge.
    if (edge.bridge !== undefined) {
      context.fillStyle = palette.muted;
      context.font = BRIDGE_FONT;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        edge.bridge.label,
        edge.bridge.apex.x,
        edge.bridge.apex.y - BRIDGE_LABEL_LIFT,
      );
      context.textAlign = "left";
    }
  }
  context.setLineDash([]);
  context.globalAlpha = 1;
}

function paintNodes(
  context: CanvasRenderingContext2D,
  scene: GraphScene,
  palette: GraphScenePalette,
): void {
  for (const node of scene.nodes) {
    const { x, y, width, height } = node.rect;
    context.globalAlpha = node.opacity;
    context.beginPath();
    context.roundRect(x, y, width, height, CARD_RADIUS);
    context.fillStyle = palette.card;
    context.fill();
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.stroke();
    if (node.outlined) {
      context.beginPath();
      context.roundRect(
        x - OUTLINE_CARD_OFFSET,
        y - OUTLINE_CARD_OFFSET,
        width + OUTLINE_CARD_OFFSET * 2,
        height + OUTLINE_CARD_OFFSET * 2,
        CARD_RADIUS + OUTLINE_CARD_OFFSET,
      );
      context.strokeStyle = palette.outline;
      context.lineWidth = OUTLINE_CARD_WIDTH;
      context.stroke();
    }
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
  context.globalAlpha = 1;
}

function paint(
  context: CanvasRenderingContext2D,
  scene: GraphScene,
  palette: GraphScenePalette,
): void {
  context.fillStyle = palette.background;
  context.fillRect(0, 0, scene.width, scene.height);
  paintFrames(context, scene, palette);
  paintEdges(context, scene, palette);
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
