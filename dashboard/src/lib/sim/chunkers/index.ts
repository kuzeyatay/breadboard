// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/chunkers/index.ts;
// adapted for Breadboard. `DocsChunker` is deliberately not re-exported here:
// sim's version reads files off disk and calls out to an embedding model, and
// nothing in Breadboard's document pipeline needs a chunker with that coupling
// (see the other seven strategies below, which are pure text-in/chunks-out).

export { JsonYamlChunker } from './json-yaml-chunker.ts'
export { RecursiveChunker } from './recursive-chunker.ts'
export { RegexChunker } from './regex-chunker.ts'
export { SentenceChunker } from './sentence-chunker.ts'
export { StructuredDataChunker } from './structured-data-chunker.ts'
export { TextChunker } from './text-chunker.ts'
export { TokenChunker } from './token-chunker.ts'
export * from './types.ts'
