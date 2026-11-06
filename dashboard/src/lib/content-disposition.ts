/** Encode display names without putting Unicode or controls in HTTP headers. */
export function contentDisposition(
  filename: string,
  disposition: "inline" | "attachment" = "inline",
): string {
  const name = filename.toWellFormed().replace(/[\x00-\x1f\x7f]/g, "_") || "document";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // RFC 8187's extended value carries the original UTF-8 name. Apostrophes,
  // parentheses and asterisks need escaping beyond encodeURIComponent.
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
