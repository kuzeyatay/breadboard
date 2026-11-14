/** Read a native file/folder drop while keeping empty directories and relative names. */
export async function droppedGardenFiles(transfer: DataTransfer) {
  const files: { file: File; path: string }[] = [], folders: string[] = [];
  let count = 0;
  const visit = async (entry: FileSystemEntry, parent = "", depth = 0): Promise<void> => {
    if (++count > 5000 || depth > 24) throw new Error("Add up to 5,000 files and folders at a time, with at most 24 nested folders.");
    const relative = `${parent}${entry.name}`;
    if (entry.isFile) files.push({ file: await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)), path: relative });
    else if (entry.isDirectory) {
      folders.push(relative);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, `${relative}/`, depth + 1);
      }
    }
  };
  const entries = Array.from(transfer.items ?? []).map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.length) for (const entry of entries) await visit(entry);
  else for (const file of Array.from(transfer.files)) {
    if (++count > 5000) throw new Error("Add up to 5,000 files at a time.");
    files.push({ file, path: file.webkitRelativePath || file.name });
  }
  return { files, folders };
}
