import {
  openPptx,
  type PackageArchive,
} from "../../vendor/genoffice/pptx-engine/src/index.ts";
import {
  buildRenderSlide,
  type RenderFill,
  type RenderNode,
  type RenderTextLayout,
} from "../../vendor/genoffice/pptx-render/src/index.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssColor(fill: RenderFill | undefined): string {
  if (!fill || fill.kind === "none" || fill.kind === "image" || fill.kind === "pattern") {
    return "transparent";
  }
  if (fill.kind === "solid") return fill.color;
  const stops = fill.stops.map((stop) => `${stop.color} ${Math.round(stop.pos * 100)}%`).join(",");
  return fill.radial
    ? `radial-gradient(circle,${stops})`
    : `linear-gradient(${fill.angleDeg}deg,${stops})`;
}

function transformCss(node: RenderNode): string {
  const transforms = [
    node.box.rotationDeg ? `rotate(${node.box.rotationDeg}deg)` : "",
    node.box.flipH ? "scaleX(-1)" : "",
    node.box.flipV ? "scaleY(-1)" : "",
  ].filter(Boolean);
  return transforms.length ? `transform:${transforms.join(" ")};` : "";
}

function textHtml(text: RenderTextLayout | undefined): string {
  if (!text) return "";
  return text.lines
    .map((line) =>
      `<div class="pptx-line" style="height:${line.height}px;text-align:${line.align ?? "left"}">${line.runs
        .filter((run) => !run.isBullet || run.text)
        .map(
          (run) =>
            `<span style="font-family:${escapeHtml(run.fontFamily)};font-size:${run.fontSizePx}px;color:${escapeHtml(run.color)};font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? "italic" : "normal"};text-decoration:${run.underline ? "underline" : run.strike ? "line-through" : "none"}">${escapeHtml(run.text)}</span>`,
        )
        .join("")}</div>`,
    )
    .join("");
}

function boxStyle(node: RenderNode): string {
  return `left:${node.box.x}px;top:${node.box.y}px;width:${node.box.w}px;height:${node.box.h}px;${transformCss(node)}`;
}

function nodeHtml(node: RenderNode): string {
  if (node.type === "group") {
    return `<div class="pptx-node pptx-group" style="${boxStyle(node)}">${node.children.map(nodeHtml).join("")}</div>`;
  }
  if (node.type === "picture") {
    const background = node.bgColor ? `background:${node.bgColor};` : "";
    const image = node.dataUrl
      ? `<img alt="" src="${escapeHtml(node.dataUrl)}" style="width:100%;height:100%;object-fit:fill;opacity:${node.opacity ?? 1}"/>`
      : "";
    return `<div class="pptx-node pptx-picture" style="${boxStyle(node)}${background}">${image}</div>`;
  }
  if (node.type === "table") {
    return `<div class="pptx-node pptx-table" style="${boxStyle(node)}">${node.cells
      .map(
        (cell) =>
          `<div class="pptx-cell" style="left:${cell.x}px;top:${cell.y}px;width:${cell.w}px;height:${cell.h}px;background:${cssColor(cell.fill)}">${textHtml(cell.text)}</div>`,
      )
      .join("")}</div>`;
  }
  if (node.type === "chart") {
    return `<div class="pptx-node pptx-chart" style="${boxStyle(node)}">${node.labels
      .map(
        (label) =>
          `<span style="position:absolute;left:${label.x}px;top:${label.y}px;font-size:${label.fontSizePx}px;color:${escapeHtml(label.color)}">${escapeHtml(label.text)}</span>`,
      )
      .join("")}</div>`;
  }
  if (node.type === "placeholder-chip") {
    return `<div class="pptx-node pptx-chip" style="${boxStyle(node)}">${escapeHtml(node.label)}</div>`;
  }
  const stroke = node.stroke
    ? `border:${Math.max(1, node.stroke.widthPx)}px solid ${node.stroke.color};`
    : "";
  return `<div class="pptx-node pptx-shape" style="${boxStyle(node)}background:${cssColor(node.fill)};${stroke}">${textHtml(node.text)}</div>`;
}

function mediaResolver(archive: PackageArchive): (mediaRef: string) => string | undefined {
  return (mediaRef) => {
    const bytes = archive.readBytes(mediaRef);
    if (!bytes || bytes.byteLength > 2 * 1024 * 1024) return undefined;
    const extension = mediaRef.split(".").pop()?.toLowerCase();
    const mime = extension === "png"
      ? "image/png"
      : extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "gif"
          ? "image/gif"
          : extension === "webp"
            ? "image/webp"
            : extension === "svg"
              ? "image/svg+xml"
              : undefined;
    return mime ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : undefined;
  };
}

/** Static, dependency-free fallback preview built from GenOffice's server-side RenderTree. */
export async function renderPptxPreviewHtml(buffer: Uint8Array): Promise<string> {
  const opened = await openPptx(buffer);
  const media = mediaResolver(opened.archive);
  const slides = opened.deck.slides.map((slide, index) => {
    const rendered = buildRenderSlide(slide, opened.deck.size, {
      fitWidthPx: 960,
      media,
      slideNo: index + 1,
    });
    return `<section class="pptx-slide" aria-label="Slide ${index + 1}" style="width:${rendered.widthPx}px;height:${rendered.heightPx}px;background:${cssColor(rendered.background)}">${rendered.nodes.map(nodeHtml).join("")}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html{background:#e5e7eb}body{margin:0;padding:32px;font-family:Arial,sans-serif}.pptx-slide{position:relative;overflow:hidden;margin:0 auto 32px;box-shadow:0 8px 30px #0003}.pptx-node,.pptx-cell{position:absolute;box-sizing:border-box;overflow:hidden}.pptx-group{left:0!important;top:0!important;overflow:visible}.pptx-line{white-space:pre;line-height:1.05}.pptx-chip{display:grid;place-items:center;border:1px dashed #94a3b8;background:#f8fafc;color:#475569;font-size:12px}.pptx-chart{background:#fff;border:1px solid #d1d5db}.pptx-picture img{display:block}</style></head><body>${slides.join("")}</body></html>`;
}
