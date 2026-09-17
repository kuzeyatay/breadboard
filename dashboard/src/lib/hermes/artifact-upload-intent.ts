/** Only the user's message is authoritative here, never extracted file text. */
export function requestsUploadArtifact(request: string, attachmentName: string): boolean {
  const name = attachmentName.trim().toLocaleLowerCase("en-US");
  // Replace the exact filename before splitting sentences (filenames contain dots).
  const normalized = request.toLocaleLowerCase("en-US");
  const text = name ? normalized.split(name).join(" attached file ") : normalized;
  const source = String.raw`(?:(?:(?:the|my|this|that|these|those)\s+)?(?:original|attached|uploaded|source)\s+(?:file|document|pdf|image|video|audio|upload|attachment)s?|(?:(?:the|my|this|that|these|those)\s+)?(?:attachment|upload)s?|(?:this|that)\s+(?:file|document|pdf|image|video|audio))`;
  const saveSource = new RegExp(String.raw`\b(?:save|store|keep|preserve|import|copy)\s+(?:a\s+copy\s+of\s+)?${source}\b`);
  const makeArtifact = new RegExp(String.raw`\b(?:save|store|keep|preserve|import|copy|attach|add|make|turn)\s+(?:${source}|this|that|it|these|those)\s+(?:as|into|to)?\s*(?:an?\s+|the\s+|my\s+)?artifacts?\b`);
  return text.split(/[.!?;\n]+/).some((sentence) => {
    if (/\b(?:do not|don't|dont|never|without|no need to)\b/.test(sentence)) return false;
    return saveSource.test(sentence) || makeArtifact.test(sentence);
  });
}
