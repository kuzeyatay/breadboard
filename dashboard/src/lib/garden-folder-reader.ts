import { externalRuntimeFilesystem as fs } from './external-runtime-filesystem';
import { externalRuntimePath as path } from './external-runtime-path';
import { gardenContentRoot, gardenDirectory, GardenFilesystemError } from './garden-directory';
import { listGardenFolders } from './garden-filesystem';
import { existingGardenFolder } from './garden-folder-copy';

const quartzPath = (value: string) => value.replace(/\s/g, '-').replace(/&/g, '-and-')
  .replace(/%/g, '-percent').replace(/[?#]/g, '');

/** Called only after the folder route has authorized this Garden. */
export async function readGardenFolderPage(clusterSlug: string, requested: string) {
  const clusterDir = gardenDirectory(clusterSlug);
  const folders = listGardenFolders(clusterSlug);
  const folder = folders.find(entry => entry.folder === requested || quartzPath(entry.folder) === requested);
  if (!folder) throw new GardenFilesystemError('Folder not found', 404);
  existingGardenFolder(clusterDir, folder.folder);
  const files: { relativePath: string; content: string }[] = [];
  const walk = async (relative: string) => {
    const dir = path.join(clusterDir, relative);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    // Include empty subfolders in the same listing as published folder pages.
    if (!entries.some(entry => entry.isFile() && /^_?index\.md$/i.test(entry.name))) {
      const title = folders.find(entry => entry.folder === relative)?.name ?? relative.split('/').at(-1)!;
      files.push({ relativePath: `${clusterSlug}/${relative}/_index.md`, content: `---\ntitle: ${JSON.stringify(title)}\n---\n` });
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'assets') continue;
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push({ relativePath: `${clusterSlug}/${rel}`, content: await fs.promises.readFile(path.join(clusterDir, rel), 'utf8') });
      }
    }
  };
  await walk(folder.folder);
  const { renderQuartzFolder } = await import('./generated/quartz-reader.mjs');
  return renderQuartzFolder({ relativePath: `${clusterSlug}/${folder.folder}`,
    contentRoot: gardenContentRoot(), title: folder.name, files });
}
