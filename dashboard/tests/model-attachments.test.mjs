import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CHAT_ATTACHMENT_ACCEPT,
  chatMessageAttachments,
  normalizeChatMessageAttachments,
  reusableChatAttachments,
} from '../src/lib/chat-attachments.ts';
import {
  KERNEL_MODEL_FORMATS,
  defaultModelUpAxis,
  isModelBlobId,
  modelAttachmentFormat,
  modelAttachmentHref,
  modelAttachmentPromptText,
  modelExportHint,
  modelPreviewStrategy,
  normalizeModelAttachmentSummary,
} from '../src/lib/model-attachments.ts';
import { inspectModelUpload, ModelInspectionError } from '../src/lib/conversations/model-inspect.ts';
import {
  ModelBlobError,
  newModelBlobId,
  readModelBlob,
  removeModelBlob,
  writeModelBlob,
} from '../src/lib/conversations/model-blob-store.ts';
import { collectUploads } from '../src/lib/conversations/uploads.ts';

const BLOB_ID = 'mdl_0123456789abcdef0123456789abcdef';
const PREVIEW_BLOB_ID = 'mdl_fedcba9876543210fedcba9876543210';

function storageRoot() {
  return mkdtempSync(path.join(tmpdir(), 'breadboard-model-blobs-'));
}

/** A minimal but real binary STL: 80-byte header, count, one 50-byte facet. */
function binaryStl(triangles = [[0, 0, 0, 10, 0, 0, 0, 4, 0]]) {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write('breadboard test stl', 0, 'ascii');
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((corners, index) => {
    const base = 84 + index * 50 + 12;
    corners.forEach((value, offset) => buffer.writeFloatLE(value, base + offset * 4));
  });
  return buffer;
}

/** A minimal but real GLB: header plus one JSON chunk. */
function glb(document) {
  const json = Buffer.from(JSON.stringify(document), 'utf8');
  const padding = (4 - (json.byteLength % 4)) % 4;
  const chunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + chunk.byteLength, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(chunk.byteLength, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, chunk]);
}

// --- format contract ----------------------------------------------------

test('the chat file picker offers 3D files alongside documents', () => {
  for (const extension of ['.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx', '.3mf']) {
    assert.ok(
      CHAT_ATTACHMENT_ACCEPT.includes(extension),
      `${extension} should be offered by the chat file picker`,
    );
  }
  // The document formats it already accepted are still there.
  assert.ok(CHAT_ATTACHMENT_ACCEPT.includes('.pdf'));
  assert.ok(CHAT_ATTACHMENT_ACCEPT.includes('.png'));
});

test('a filename decides the format, and only for formats that are supported', () => {
  assert.equal(modelAttachmentFormat('bracket.STL'), 'stl');
  assert.equal(modelAttachmentFormat('scene.glb'), 'glb');
  assert.equal(modelAttachmentFormat('notes.pdf'), null);
  assert.equal(modelAttachmentFormat('stl'), null);
});

test('a Y-up format is turned to stand in the viewer, a Z-up one is left alone', () => {
  assert.equal(defaultModelUpAxis('glb'), 'y');
  assert.equal(defaultModelUpAxis('gltf'), 'y');
  assert.equal(defaultModelUpAxis('fbx'), 'y');
  assert.equal(defaultModelUpAxis('stl'), 'z');
  assert.equal(defaultModelUpAxis('3mf'), 'z');
  // Everything the CAD kernel reads is quoted Z-up.
  assert.equal(defaultModelUpAxis('step'), 'z');
});

test('every format declares how it is previewed, and the three routes are distinct', () => {
  // A browser loader exists for it.
  for (const format of ['glb', 'stl', 'obj', 'dae', 'wrl', 'gcode', 'pcd', 'vox']) {
    assert.equal(modelPreviewStrategy(format), 'three', format);
  }
  // OpenCascade reads it; the upload is tessellated on the way in.
  assert.deepEqual([...KERNEL_MODEL_FORMATS].sort(), ['brep', 'iges', 'igs', 'step', 'stp']);
  for (const format of KERNEL_MODEL_FORMATS) {
    assert.equal(modelPreviewStrategy(format), 'kernel', format);
  }
  // Nothing open can read it, so nothing here pretends to.
  for (const format of ['sldprt', 'sldasm', 'ipt', 'catpart', 'f3d']) {
    assert.equal(modelPreviewStrategy(format), 'none', format);
    assert.match(modelExportHint(format) ?? '', /STEP/);
  }
});

test('the picker offers the CAD and proprietary formats too', () => {
  for (const extension of ['.step', '.stp', '.iges', '.brep', '.sldprt', '.sldasm', '.dae', '.wrl']) {
    assert.ok(CHAT_ATTACHMENT_ACCEPT.includes(extension), `${extension} should be offered`);
  }
});

test('blob ids are opaque and only the generated shape is accepted', () => {
  assert.ok(isModelBlobId(newModelBlobId()));
  assert.ok(isModelBlobId(BLOB_ID));
  assert.equal(isModelBlobId('mdl_../../etc/passwd'), false);
  assert.equal(isModelBlobId('mdl_0123'), false);
  assert.equal(isModelBlobId('cadp_0123456789abcdef0123456789abcdef'), false);
  assert.equal(isModelBlobId(null), false);
});

test('the download link addresses the blob, not a filename', () => {
  assert.equal(modelAttachmentHref(BLOB_ID), `/api/chat-attachments/models/${BLOB_ID}`);
  assert.equal(
    modelAttachmentHref(BLOB_ID, { download: true }),
    `/api/chat-attachments/models/${BLOB_ID}?download=1`,
  );
});

// --- what the bytes turn out to be --------------------------------------

test('a binary STL is measured from its own vertex table', () => {
  const summary = inspectModelUpload(binaryStl(), 'stl');
  assert.equal(summary.triangles, 1);
  assert.equal(summary.vertices, 3);
  assert.deepEqual(summary.extent, { x: 10, y: 4, z: 0 });
});

test('an ASCII STL is counted by its facets', () => {
  const ascii = [
    'solid part',
    '  facet normal 0 0 1',
    '    outer loop',
    '      vertex 0 0 0',
    '      vertex 2 0 0',
    '      vertex 0 3 0',
    '    endloop',
    '  endfacet',
    'endsolid part',
  ].join('\n');
  const summary = inspectModelUpload(Buffer.from(ascii, 'utf8'), 'stl');
  assert.equal(summary.triangles, 1);
  assert.deepEqual(summary.extent, { x: 2, y: 3, z: 0 });
});

test('a GLB is read for triangle count, envelope and what produced it', () => {
  const summary = inspectModelUpload(
    glb({
      asset: { version: '2.0', generator: 'Blender 4.2' },
      accessors: [
        { count: 36 },
        { count: 24, min: [-1, -2, -3], max: [1, 2, 3] },
      ],
      meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }],
      materials: [{}, {}],
    }),
    'glb',
  );
  assert.equal(summary.triangles, 12);
  assert.equal(summary.vertices, 24);
  assert.equal(summary.meshes, 1);
  assert.equal(summary.materials, 2);
  assert.equal(summary.generator, 'Blender 4.2');
  assert.deepEqual(summary.extent, { x: 2, y: 4, z: 6 });
});

test('a glTF that needs files it did not bring says so', () => {
  const summary = inspectModelUpload(
    glb({
      asset: { version: '2.0' },
      buffers: [{ uri: 'scene.bin' }],
      images: [{ uri: 'colour.png' }],
      meshes: [],
    }),
    'glb',
  );
  assert.equal(summary.notes?.length, 1);
  assert.match(summary.notes[0], /2 external files/);
});

test('an OBJ counts triangles from faces of any corner count', () => {
  const obj = [
    'mtllib bracket.mtl',
    'o bracket',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'usemtl steel',
    'f 1 2 3',
    'f 1 2 3 4',
  ].join('\n');
  const summary = inspectModelUpload(Buffer.from(obj, 'utf8'), 'obj');
  assert.equal(summary.vertices, 4);
  // A triangle is one, a quad is two.
  assert.equal(summary.triangles, 3);
  assert.equal(summary.materials, 1);
  assert.deepEqual(summary.extent, { x: 1, y: 1, z: 0 });
  assert.match(summary.notes[0], /\.mtl material library/);
});

test('a PLY reports the counts its header declares', () => {
  const ply = [
    'ply',
    'format ascii 1.0',
    'element vertex 8',
    'property float x',
    'element face 12',
    'end_header',
  ].join('\n');
  const summary = inspectModelUpload(Buffer.from(`${ply}\n`, 'utf8'), 'ply');
  assert.equal(summary.vertices, 8);
  assert.equal(summary.triangles, 12);
});

test('the extension is a claim, and bytes that do not back it are refused', () => {
  const zip = Buffer.from('PK not a model at all', 'latin1');
  for (const [format, content] of [
    ['glb', zip],
    ['gltf', Buffer.from('not json', 'utf8')],
    ['stl', Buffer.from('just some prose', 'utf8')],
    ['obj', Buffer.from('# a comment and nothing else', 'utf8')],
    ['ply', zip],
    ['3mf', Buffer.from('plain text', 'utf8')],
    ['fbx', Buffer.from(' binary noise', 'latin1')],
  ]) {
    assert.throws(
      () => inspectModelUpload(content, format),
      ModelInspectionError,
      `a bogus .${format} should be refused`,
    );
  }
  // A real 3MF package is a zip, and passes.
  assert.deepEqual(inspectModelUpload(zip, '3mf'), {});
});

// --- storage ------------------------------------------------------------

test('stored bytes come back exactly, hashed, under a path built from the id', () => {
  const root = storageRoot();
  const content = binaryStl();
  const stored = writeModelBlob({ format: 'stl', content, storageRoot: root });

  assert.ok(isModelBlobId(stored.blobId));
  assert.equal(stored.byteSize, content.byteLength);
  assert.match(stored.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    readModelBlob({ blobId: stored.blobId, format: 'stl', storageRoot: root }),
    content,
  );

  // Sharded on the id, and named by it — never by anything the browser sent.
  const shard = stored.blobId.slice(4, 6);
  assert.deepEqual(
    readFileSync(path.join(root, shard, `${stored.blobId}.stl`)),
    content,
  );

  removeModelBlob(stored.blobId, 'stl', root);
  assert.throws(
    () => readModelBlob({ blobId: stored.blobId, format: 'stl', storageRoot: root }),
    ModelBlobError,
  );
});

test('a blob id that tries to leave its root cannot name a file', () => {
  const root = storageRoot();
  writeFileSync(path.join(root, 'secret.txt'), 'not yours');
  assert.throws(
    () => readModelBlob({ blobId: '../secret', format: 'stl', storageRoot: root }),
    ModelBlobError,
  );
  assert.throws(
    () => writeModelBlob({ format: 'stl', content: binaryStl(), blobId: 'mdl_x', storageRoot: root }),
    ModelBlobError,
  );
  assert.throws(
    () => writeModelBlob({ format: 'exe', content: binaryStl(), storageRoot: root }),
    ModelBlobError,
  );
});

test('an empty 3D file is not stored', () => {
  assert.throws(
    () => writeModelBlob({ format: 'stl', content: Buffer.alloc(0), storageRoot: storageRoot() }),
    ModelBlobError,
  );
});

// --- what the transcript keeps ------------------------------------------

const modelAttachment = {
  type: 'model',
  name: 'bracket.stl',
  blobId: BLOB_ID,
  format: 'stl',
  sizeBytes: 1024,
  summary: { triangles: 12, extent: { x: 10, y: 4, z: 2 } },
};

test('a sent model keeps its pointer, unlike a document which keeps only its name', () => {
  assert.deepEqual(
    chatMessageAttachments([
      modelAttachment,
      { type: 'text', name: 'notes.md', text: 'private extracted text' },
    ]),
    [modelAttachment, { type: 'file', name: 'notes.md' }],
  );
});

test('a model attachment read back out of a transcript is validated, not trusted', () => {
  assert.deepEqual(normalizeChatMessageAttachments([modelAttachment]), [modelAttachment]);
  assert.deepEqual(
    normalizeChatMessageAttachments([
      { type: 'model', name: 'escape.stl', blobId: '../../etc/passwd', format: 'stl' },
      { type: 'model', name: 'wrong.exe', blobId: BLOB_ID, format: 'exe' },
    ]),
    [],
  );
  // Nonsense inside the summary is dropped without taking the attachment down.
  assert.deepEqual(
    normalizeChatMessageAttachments([
      { ...modelAttachment, summary: { triangles: 'lots', extent: { x: 'wide' } } },
    ]),
    [{ type: 'model', name: 'bracket.stl', blobId: BLOB_ID, format: 'stl', sizeBytes: 1024 }],
  );
});

test('regenerating a turn reuses the stored model rather than asking for the file again', () => {
  assert.deepEqual(
    reusableChatAttachments([modelAttachment, { type: 'file', name: 'notes.md' }]),
    [modelAttachment],
  );
});

test('summaries survive a round trip through metadata and drop what does not belong', () => {
  assert.deepEqual(
    normalizeModelAttachmentSummary({
      triangles: 12.4,
      vertices: -3,
      generator: '  Blender 4.2  ',
      extent: { x: 1, y: 2, z: 3 },
      notes: ['  keep me  ', 42, ''],
      unexpected: 'dropped',
    }),
    {
      triangles: 12,
      generator: 'Blender 4.2',
      extent: { x: 1, y: 2, z: 3 },
      notes: ['keep me'],
    },
  );
  assert.equal(normalizeModelAttachmentSummary(null), undefined);
  assert.equal(normalizeModelAttachmentSummary({ nothing: true }), undefined);
});

test('the Uploads list can serve a model, and says so', () => {
  const [upload] = collectUploads([
    {
      message_id: 7,
      metadata: JSON.stringify({ attachments: [modelAttachment] }),
      created_at: '2026-08-05 10:00:00',
      conversation_public_id: 'conv_test',
      conversation_title: 'Parts',
      surface: 'dashboard_terminal',
    },
  ]);
  assert.equal(upload.kind, 'model');
  assert.equal(upload.hasContent, true);
  assert.equal(upload.previewAvailable, true);
  assert.equal(upload.previewFormat, 'stl');
  assert.equal(upload.sizeBytes, 1024);
  assert.equal(upload.id, '7-0');
});

// --- what the language model is told ------------------------------------

test('the model is given measurements and told it cannot see the geometry', () => {
  const prompt = modelAttachmentPromptText(modelAttachment);
  assert.match(prompt, /cannot see its geometry/);
  assert.match(prompt, /Format: STL \(\.stl\)/);
  assert.match(prompt, /Triangles: 12/);
  assert.match(prompt, /Bounding box: 10 × 4 × 2/);
  // Nothing is claimed about units the file never stated.
  assert.match(prompt, /the file's own units, which it does not state/);
});

test('a model with nothing measurable still reaches the prompt as itself', () => {
  const prompt = modelAttachmentPromptText({ name: 'scene.fbx', format: 'fbx' });
  assert.match(prompt, /Format: FBX \(\.fbx\)/);
  assert.doesNotMatch(prompt, /Triangles/);
});

test('the assistant is told plainly when a format cannot be opened at all', () => {
  const prompt = modelAttachmentPromptText({ name: 'bracket.sldprt', format: 'sldprt' });
  assert.match(prompt, /proprietary CAD format that Breadboard cannot open/);
  assert.match(prompt, /re-attach it as STEP/);
  assert.match(prompt, /Save As . STEP AP214/);
  // A STEP file is readable, so it gets no such warning.
  assert.doesNotMatch(
    modelAttachmentPromptText({ name: 'bracket.step', format: 'step' }),
    /cannot open/,
  );
});

// --- exchange and container formats -------------------------------------

test('a STEP file is recognised by its ISO header and left for the kernel to measure', () => {
  const step = 'ISO-10303-21;\nHEADER;\nFILE_NAME("part",...);\nENDSEC;\nDATA;\nENDSEC;\n';
  assert.deepEqual(inspectModelUpload(Buffer.from(step, 'utf8'), 'step'), {});
  assert.deepEqual(inspectModelUpload(Buffer.from(step, 'utf8'), 'stp'), {});
  assert.throws(
    () => inspectModelUpload(Buffer.from('solid nope', 'utf8'), 'step'),
    ModelInspectionError,
  );
});

test('a proprietary part file is stored without being parsed', () => {
  // Undocumented layout: there is no honest check to make, so none is made.
  assert.deepEqual(inspectModelUpload(Buffer.from('anything at all'), 'sldprt'), {});
  assert.deepEqual(inspectModelUpload(Buffer.from('anything at all'), 'catpart'), {});
});

test('the text and container formats are each held to their own marker', () => {
  const cases = [
    ['dae', '<?xml version="1.0"?><COLLADA xmlns="...">', true],
    ['dae', '<?xml version="1.0"?><svg>', false],
    ['wrl', '#VRML V2.0 utf8\nShape {}', true],
    ['wrl', 'solid something', false],
    ['vtk', '# vtk DataFile Version 3.0\n', true],
    ['vtk', 'random bytes', false],
    ['gcode', 'M104 S200\nG1 X10 Y10 E1\nG0 Z1\n', true],
    ['gcode', 'no moves in here\n', false],
    ['pdb', 'ATOM      1  N   MET A   1      1.0 2.0 3.0\n', true],
    ['pdb', 'HEADER only\n', false],
    ['3ds', Buffer.from([0x4d, 0x4d, 0, 0, 0, 0]), true],
    ['3ds', Buffer.from([0x00, 0x00, 0, 0, 0, 0]), false],
    ['vox', 'VOX \x96\x00\x00\x00', true],
    ['vox', 'BOX ', false],
  ];
  for (const [format, content, valid] of cases) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1');
    if (valid) {
      assert.doesNotThrow(() => inspectModelUpload(buffer, format), `${format} should be accepted`);
    } else {
      assert.throws(
        () => inspectModelUpload(buffer, format),
        ModelInspectionError,
        `${format} should be refused`,
      );
    }
  }
});

test('a point cloud is counted and measured', () => {
  const xyz = inspectModelUpload(Buffer.from('0 0 0\n1 2 3\n# comment\n4 4 4\n', 'utf8'), 'xyz');
  assert.equal(xyz.vertices, 3);
  assert.deepEqual(xyz.extent, { x: 4, y: 4, z: 4 });

  const pcd = inspectModelUpload(
    Buffer.from('# .PCD v0.7\nVERSION 0.7\nPOINTS 1024\nDATA ascii\n', 'utf8'),
    'pcd',
  );
  assert.equal(pcd.vertices, 1024);
});

// --- the derived preview -------------------------------------------------

const stepAttachment = {
  type: 'model',
  name: 'bracket.step',
  blobId: BLOB_ID,
  format: 'step',
  sizeBytes: 20224,
  previewBlobId: PREVIEW_BLOB_ID,
  previewFormat: 'glb',
};

test('a converted file keeps both pointers: the original downloads, the mesh draws', () => {
  assert.deepEqual(chatMessageAttachments([stepAttachment]), [stepAttachment]);
  assert.deepEqual(normalizeChatMessageAttachments([stepAttachment]), [stepAttachment]);
  assert.deepEqual(reusableChatAttachments([stepAttachment]), [stepAttachment]);
});

test('half a preview pointer is dropped rather than stored as a viewer that would fail', () => {
  const noFormat = { ...stepAttachment, previewFormat: undefined };
  const badBlob = { ...stepAttachment, previewBlobId: '../../etc/passwd' };
  for (const broken of [noFormat, badBlob]) {
    const [stored] = normalizeChatMessageAttachments([broken]);
    assert.equal(stored.previewBlobId, undefined);
    assert.equal(stored.previewFormat, undefined);
    // The attachment itself survives — only the preview is discarded.
    assert.equal(stored.blobId, BLOB_ID);
  }
});

// --- wiring -------------------------------------------------------------

function read(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
}

test('every chat that takes attachments stores a 3D file instead of extracting it', () => {
  // Three surfaces share extractChatAttachments; the Garden workspace has its
  // own loop and has to reach the same path explicitly.
  assert.match(
    read('src/lib/chat-attachments.ts'),
    /const modelFormat = modelAttachmentFormat\(file\.name\);\s+if \(modelFormat\) \{\s+attachments\.push\(await attachModelFile/,
  );
  const workspace = read('src/app/gardens/[clusterSlug]/workspace-client.tsx');
  assert.match(
    workspace,
    /const modelFormat = modelAttachmentFormat\(file\.name\);\s+if \(modelFormat\) \{\s+results\.push\(await attachModelFile/,
  );
  // ...and its picker has to offer them.
  assert.match(workspace, /accept=\{CHAT_ATTACHMENT_ACCEPT\}/);
});

test('a sent model is rendered by the 3D viewer, not listed as a nameless file', () => {
  const viewer = read('src/app/components/chat-message-attachments.tsx');
  assert.match(viewer, /attachment\.type === "model"/);
  assert.match(viewer, /<ModelAttachmentViewer/);
  // The generic file-chip list must not also claim it.
  assert.match(
    viewer,
    /attachment\.type !== "image" &&\s+attachment\.type !== "model"/,
  );
});

test('the chat viewer mounts one canvas at a time and only when asked', () => {
  const attachmentViewer = read('src/app/components/model-attachment-viewer.tsx');
  // Client-only: three.js needs a real WebGL context.
  assert.match(attachmentViewer, /ssr: false/);
  assert.match(attachmentViewer, /presentation="asset"/);
  assert.match(attachmentViewer, /mode === "inline"/);
  assert.match(attachmentViewer, /mode === "fullscreen"/);
  // Nothing renders in the resting state.
  assert.match(attachmentViewer, /useState<"closed" \| "inline" \| "fullscreen">\("closed"\)/);
});

test('the CAD viewer keeps its measured, millimetre, single-colour presentation', () => {
  const modelViewer = read('src/app/components/cad/model-viewer.tsx');
  // The generalised viewer's defaults are the CAD case, so the CAD caller does
  // not have to state them and cannot drift from them.
  assert.match(modelViewer, /format = "glb"/);
  assert.match(modelViewer, /presentation = "cad"/);
  assert.match(modelViewer, /upAxis = "y"/);
  assert.match(modelViewer, /gridUnit = "mm"/);
  const cadArtifact = read('src/app/components/cad/parametric-cad-artifact.tsx');
  assert.match(cadArtifact, /extent=\{measurements\.boundingBox\}/);
  assert.doesNotMatch(cadArtifact, /presentation=/);
});

test('deleting a conversation takes its stored models with it', () => {
  assert.match(
    read('src/lib/conversations/store.ts'),
    /removeConversationModelBlobs\(conversation\.id, database\);[\s\S]{0,200}?database\.prepare\("DELETE FROM conversations/,
  );
});
