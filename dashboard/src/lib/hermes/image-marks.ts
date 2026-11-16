import sharp from "sharp";

type Shape = { kind: "box" | "ellipse" | "line" | "arrow"; x: number; y: number; x2: number; y2: number };
type Label = { kind: "label"; x: number; y: number; text: string };
type Mark = Shape | Label;

/** The same compact drawing instructions travel in the tool call and the durable image URL. */
function parseMarks(values: unknown): Mark[] {
  if (!Array.isArray(values) || !values.length || values.length > 24) {
    throw new Error("Choose between 1 and 24 image marks.");
  }
  function coordinate(value?: string) {
    if (!value || !/^\d{1,4}$/.test(value.trim()) || Number(value) > 1000) {
      throw new Error("Mark coordinates must be integers from 0 to 1000.");
    }
    return Number(value);
  }
  return values.map((value): Mark => {
    if (typeof value !== "string" || value.length > 128) throw new Error("Invalid image mark.");
    const [kind, left, top, ...end] = value.split(",");
    const x = coordinate(left), y = coordinate(top);
    if (kind === "label") {
      const text = end.join(",").trim();
      if (!text || text.length > 64 || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error("Use a short, single-line label.");
      return { kind, x, y, text };
    }
    if ((kind !== "box" && kind !== "ellipse" && kind !== "line" && kind !== "arrow") || end.length !== 2) {
      throw new Error("Unknown mark or missing endpoints.");
    }
    const x2 = coordinate(end[0]), y2 = coordinate(end[1]);
    if (kind === "box" || kind === "ellipse") {
      if (x2 <= x || y2 <= y) throw new Error("The second corner must be below and to the right of the first.");
    } else if (x === x2 && y === y2) throw new Error("A line needs two different endpoints.");
    return { kind, x, y, x2, y2 };
  });
}

function escapeText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function overlaySvg(marks: Mark[], width: number, height: number) {
  const scale = Math.min(width, height);
  const pen = Math.max(1, scale / 240);
  const shapes = await Promise.all(marks.map(async mark => {
    const x = mark.x * width / 1000, y = mark.y * height / 1000;
    if (mark.kind === "label") {
      // Anchor is the top left. Shift labels away from the right/bottom edges.
      const size = Math.max(10, Math.round(scale / 44));
      const text = await sharp({ text: { text: `<span foreground="white">${escapeText(mark.text)}</span>`,
        font: `sans-serif bold ${size}`, rgba: true } }).png().toBuffer({ resolveWithObject: true });
      const inset = Math.ceil(size * 0.38);
      const w = text.info.width + 2 * inset, h = text.info.height + 2 * inset;
      const fit = Math.min(1, width / w, height / h);
      const left = Math.min(x, width - w * fit), top = Math.min(y, height - h * fit);
      return `<g transform="translate(${left} ${top}) scale(${fit})">
        <rect width="${w}" height="${h}" rx="${size / 3}" fill="#145c59"/>
        <image x="${inset}" y="${inset}" width="${text.info.width}" height="${text.info.height}" xlink:href="data:image/png;base64,${text.data.toString("base64")}"/></g>`;
    }
    const ex = mark.x2 * width / 1000, ey = mark.y2 * height / 1000;
    const w = ex - x, h = ey - y;
    let path: string;
    if (mark.kind === "box") path = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w / 6, h / 6, pen * 1.6)}"/>`;
    else if (mark.kind === "ellipse") path = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
    else {
      let d = `M${x} ${y} L${ex} ${ey}`;
      if (mark.kind === "arrow") {
        const distance = Math.hypot(w, h);
        const head = Math.min(pen * 4, distance / 2);
        const dx = head * w / distance, dy = head * h / distance;
        d += ` M${ex - dx - dy * 0.55} ${ey - dy + dx * 0.55} L${ex} ${ey} L${ex - dx + dy * 0.55} ${ey - dy - dx * 0.55}`;
      }
      path = `<path d="${d}"/>`;
    }
    return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="white" stroke-width="${pen * 1.8}">${path}</g><g stroke="#14716a" stroke-width="${pen}">${path}</g></g>`;
  }));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">${shapes.join("")}</svg>`);
}

/** Draw over the decoded, upright first frame. The retained upload is never written. */
export async function drawImageMarks(bytes: Buffer, instructions: unknown) {
  const marks = parseMarks(instructions);
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Image exceeds the annotation size limit.");
  const input = sharp(bytes, { limitInputPixels: 40_000_000 });
  const meta = await input.metadata();
  if (!["png", "jpeg", "webp", "gif"].includes(meta.format)) throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  const { width, height } = meta.autoOrient;
  // Keep ordinary screenshots pixel-for-pixel and bound large-image overlays.
  const scale = Math.min(1, 4096 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const png = await input.autoOrient().resize(w, h, { fit: "fill" })
    .composite([{ input: await overlaySvg(marks, w, h) }]).png().toBuffer();
  return { png, originalWidth: width, originalHeight: height };
}

export async function markedImageResponse(bytes: Buffer, instructions: string[], download = false) {
  try {
    const { png } = await drawImageMarks(bytes, instructions);
    return new Response(new Uint8Array(png), { headers: {
      "Content-Type": "image/png", "Cache-Control": "private, max-age=300",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="annotated-image.png"`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "Invalid image or drawing instructions." }, { status: 400 });
  }
}
