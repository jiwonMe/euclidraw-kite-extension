/**
 * Minimal ambient types for the pieces of MathJax the worker uses.
 * `mathjax-full` ships no TypeScript declarations; the worker is bundled by
 * Vite and only uses `convert()` and `outerHTML()`.
 */
declare module 'mathjax-full/js/mathjax.js' {
  export const mathjax: { document(input: string, options: unknown): { convert(source: string, options?: { display?: boolean }): unknown } };
}
declare module 'mathjax-full/js/input/tex.js' {
  export const TeX: new (options: { packages: unknown }) => unknown;
}
declare module 'mathjax-full/js/output/svg.js' {
  export const SVG: new (options: { fontCache: string }) => unknown;
}
declare module 'mathjax-full/js/input/tex/AllPackages.js' {
  export const AllPackages: readonly string[];
}
declare module 'mathjax-full/js/adaptors/liteAdaptor.js' {
  export const liteAdaptor: () => { outerHTML(node: unknown): string };
}
declare module 'mathjax-full/js/handlers/html.js' {
  export const RegisterHTMLHandler: (adaptor: unknown) => void;
}
