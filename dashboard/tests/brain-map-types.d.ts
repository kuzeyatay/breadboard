// Narrow declarations for optional packages pulled through Profile's existing
// server imports. They keep the feature-specific typecheck independent from
// whether a developer has installed those optional runtime integrations.
declare module "svg-to-pdfkit" {
  const renderSvg: (...args: unknown[]) => unknown;
  export default renderSvg;
}

declare module "mem0ai/oss" {
  export class Memory {
    constructor(options?: unknown);
    [key: string]: unknown;
  }
}
