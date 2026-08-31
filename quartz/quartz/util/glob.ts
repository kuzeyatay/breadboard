import path from "path"
import { FilePath } from "./path"
import { globby } from "globby"

export function toPosixPath(fp: string): string {
  return fp.split(path.sep).join("/")
}

export async function glob(
  pattern: string,
  cwd: string,
  ignorePatterns: string[],
): Promise<FilePath[]> {
  const fps = (
    await globby(pattern, {
      cwd,
      ignore: ignorePatterns,
      // Garden content is mutable user data and the repository deliberately
      // ignores the whole content root. Parent Git rules must not make a live
      // Garden disappear from the site build; still honor ignore files owned
      // by the content tree itself.
      gitignore: false,
      ignoreFiles: [".gitignore", "**/.gitignore"],
    })
  ).map(toPosixPath)
  return fps as FilePath[]
}
