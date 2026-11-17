// The part of prismjs (which ships no typings) that server/highlight.ts uses. tsconfig includes server/, so this
// declaration is seen without being imported; @types/prismjs is not a dependency of this plugin.

declare module "prismjs" {
  /** What a token holds: text, one token, or a mix of both. */
  export type TokenStream = string | Token | Array<string | Token>;

  /** A matched piece of text: `type` names what it is (`keyword`, `string`…), `alias` gives further names. */
  export interface Token {
    type: string;
    content: TokenStream;
    alias?: string | string[];
    length: number;
  }

  /** A language's patterns. Opaque to the plugin: only passed back to `tokenize`. */
  export interface Grammar {
    [pattern: string]: unknown;
  }

  export interface PrismApi {
    /** Grammars by language name, with Prism's helper functions (`extend`, `insertBefore`, `DFS`) among them. */
    languages: Record<string, Grammar | undefined>;
    tokenize(text: string, grammar: Grammar): Array<string | Token>;
    hooks: {
      run(name: string, env: Record<string, unknown>): void;
    };
  }

  const Prism: PrismApi;
  export default Prism;
}
