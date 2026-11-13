// What core/ uses that is not in its lib (ES2022, no DOM), for the type check (tsconfig.core.json):
// js-yaml from web/src/vendor/, which the page loads as a global, and the timers and TextEncoder, which the page and Node both have.
declare const jsyaml: {
  CORE_SCHEMA: object;
  load(text: string, options?: object): unknown;
  dump(value: unknown, options?: object): string;
};
declare function setTimeout(fn: (...args: unknown[]) => void, ms?: number): number;
declare function clearTimeout(id: number | undefined): void;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
