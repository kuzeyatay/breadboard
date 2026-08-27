/** Splits leading YAML frontmatter off a Markdown string and pulls its title. */
export function parseMarkdownFrontmatter(content: string): { body: string; title: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: content, title: "" };
  const titleLine = (match[1] ?? "")
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith("title:"));
  const title = titleLine
    ? titleLine.slice(titleLine.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "")
    : "";
  return {
    body: content.slice(match[0].length).replace(/^\r?\n/, ""),
    title,
  };
}
