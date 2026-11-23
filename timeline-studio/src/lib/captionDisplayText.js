// Presentation only: keep caption.text intact for editing and speech synthesis.
export function getCaptionDisplayText(value) {
  const text = String(value ?? "");
  const suffix = text.match(/([,，;；。．.]+)(["'”’」』）》】）\])}]*)(\s*)$/u);
  if (!suffix) return text;
  const body = text.slice(0, suffix.index);
  // Do not erase symbol-only captions, ellipses, initials or abbreviations.
  if (!/[\p{L}\p{N}]/u.test(body) || /\.{2,}|．{2,}/u.test(suffix[1])) return text;
  if (suffix[1] === "." && (
    /(?:\b\p{L}\.){2,}$/u.test(body + ".")
    || /(?:^|\s)\p{Lu}$/u.test(body)
    || /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Mme|Mlle|M|Srta|Sra|Dra|Ing|Sig|Sigra)\.$/iu.test(body + ".")
  )) return text;
  return body + suffix[2] + suffix[3];
}
