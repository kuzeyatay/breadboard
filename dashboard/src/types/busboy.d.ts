declare module "busboy" {
  import type { Writable } from "node:stream";

  interface BusboyConfig {
    headers: Record<string, string | string[] | undefined>;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      fieldSize?: number;
      parts?: number;
    };
  }

  interface BusboyFileInfo {
    filename: string;
    encoding: string;
    mimeType: string;
  }

  interface BusboyFileStream extends NodeJS.ReadableStream {
    truncated: boolean;
    on(event: "limit", listener: () => void): this;
    on(event: "data", listener: (chunk: Buffer) => void): this;
  }

  interface Busboy extends Writable {
    on(
      event: "file",
      listener: (name: string, stream: BusboyFileStream, info: BusboyFileInfo) => void,
    ): this;
    on(event: "field", listener: (name: string, value: string) => void): this;
    on(event: "filesLimit" | "fieldsLimit" | "partsLimit", listener: () => void): this;
  }

  export default function busboy(config: BusboyConfig): Busboy;
}
