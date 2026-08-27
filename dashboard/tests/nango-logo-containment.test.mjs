import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readBoundedDirectRuntimeFile,
  UnsafeRuntimeFileError,
} from "../src/lib/bounded-runtime-file.ts";
import { externalRuntimeFilesystem } from "../src/lib/external-runtime-filesystem.ts";

function temporaryTree() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-nango-logo-"));
  const root = path.join(directory, "template-logos");
  fs.mkdirSync(root);
  return { directory, root };
}

async function rejectsUnsafe(operation) {
  await assert.rejects(operation, (error) => error instanceof UnsafeRuntimeFileError);
}

test("bounded runtime logo reads preserve direct files and reject containment escapes", async (t) => {
  const { directory, root } = temporaryTree();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const valid = path.join(root, "valid.svg");
  const validBytes = Buffer.from("<svg><path /></svg>");
  fs.writeFileSync(valid, validBytes);
  assert.deepEqual(
    await readBoundedDirectRuntimeFile({
      allowedRoot: root,
      filePath: valid,
      maximumBytes: 256 * 1024,
    }),
    validBytes,
  );

  const outside = path.join(directory, "outside.svg");
  fs.writeFileSync(outside, "<svg>outside</svg>");
  await rejectsUnsafe(
    readBoundedDirectRuntimeFile({
      allowedRoot: root,
      filePath: outside,
      maximumBytes: 256 * 1024,
    }),
  );

  const hardLink = path.join(root, "hard-link.svg");
  fs.linkSync(outside, hardLink);
  await rejectsUnsafe(
    readBoundedDirectRuntimeFile({
      allowedRoot: root,
      filePath: hardLink,
      maximumBytes: 256 * 1024,
    }),
  );

  const oversized = path.join(root, "oversized.svg");
  fs.writeFileSync(oversized, Buffer.alloc(33));
  await rejectsUnsafe(
    readBoundedDirectRuntimeFile({
      allowedRoot: root,
      filePath: oversized,
      maximumBytes: 32,
    }),
  );

  const fileLink = path.join(root, "file-link.svg");
  try {
    fs.symlinkSync(outside, fileLink, "file");
    await rejectsUnsafe(
      readBoundedDirectRuntimeFile({
        allowedRoot: root,
        filePath: fileLink,
        maximumBytes: 256 * 1024,
      }),
    );
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
    t.diagnostic("file symlink creation is unavailable on this Windows account");
  }

  const outsideDirectory = path.join(directory, "outside-directory");
  fs.mkdirSync(outsideDirectory);
  fs.writeFileSync(path.join(outsideDirectory, "junction.svg"), "<svg />");
  const linkedDirectory = path.join(root, "linked-directory");
  try {
    fs.symlinkSync(
      outsideDirectory,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await rejectsUnsafe(
      readBoundedDirectRuntimeFile({
        allowedRoot: root,
        filePath: path.join(linkedDirectory, "junction.svg"),
        maximumBytes: 256 * 1024,
      }),
    );
    await rejectsUnsafe(
      readBoundedDirectRuntimeFile({
        allowedRoot: linkedDirectory,
        filePath: path.join(linkedDirectory, "junction.svg"),
        maximumBytes: 256 * 1024,
      }),
    );
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
    t.diagnostic("directory link creation is unavailable on this Windows account");
  }
});

test("bounded runtime logo reads reject pathname replacement before and after open", async (t) => {
  const { directory, root } = temporaryTree();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const target = path.join(root, "race.svg");
  const held = path.join(root, "race-held.svg");
  fs.writeFileSync(target, "<svg>safe</svg>");

  const originalOpen = externalRuntimeFilesystem.promises.open;
  t.after(() => {
    externalRuntimeFilesystem.promises.open = originalOpen;
  });

  let replacedBeforeOpen = false;
  externalRuntimeFilesystem.promises.open = async function (...args) {
    if (!replacedBeforeOpen && path.resolve(String(args[0])) === path.resolve(target)) {
      replacedBeforeOpen = true;
      fs.renameSync(target, held);
      fs.writeFileSync(target, "<svg>evil</svg>");
    }
    return originalOpen.apply(this, args);
  };
  await rejectsUnsafe(
    readBoundedDirectRuntimeFile({
      allowedRoot: root,
      filePath: target,
      maximumBytes: 256 * 1024,
    }),
  );
  assert.equal(replacedBeforeOpen, true);

  fs.rmSync(target);
  fs.renameSync(held, target);
  const displaced = path.join(root, "race-displaced.svg");
  let replacedAfterOpen = false;
  externalRuntimeFilesystem.promises.open = async function (...args) {
    const handle = await originalOpen.apply(this, args);
    const originalReadFile = handle.readFile.bind(handle);
    handle.readFile = async (...readArgs) => {
      if (!replacedAfterOpen) {
        replacedAfterOpen = true;
        fs.renameSync(target, displaced);
        fs.writeFileSync(target, "<svg>evil</svg>");
      }
      return originalReadFile(...readArgs);
    };
    return handle;
  };
  await rejectsUnsafe(
    readBoundedDirectRuntimeFile({
      allowedRoot: root,
      filePath: target,
      maximumBytes: 256 * 1024,
    }),
  );
  assert.equal(replacedAfterOpen, true);
});
