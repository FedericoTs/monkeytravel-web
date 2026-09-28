export interface CspManifest {
  v: 2;
  /** Per URL path: the page's SHA-256 digests concatenated, 44 base64 chars each. */
  pages: Record<string, string>;
}
export function inlineScriptHashes(html: string): string[];
export function urlPathFor(route: string): string;
export function buildManifest(nextDir: string): CspManifest;
export function embed(nextDir: string, manifest: CspManifest): number;
