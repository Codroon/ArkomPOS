/**
 * The shape Supabase hands a cookie writer.
 *
 * Written out rather than inferred, because inference through `@supabase/ssr`'s
 * generics is not reliable across installs. Vercel's build runs
 * `pnpm install --filter @arkom/web...`, which lays out `node_modules`
 * differently from the full workspace install on a developer's machine; under
 * that layout the callback's parameter degraded to an implicit `any` and
 * `noImplicitAny` failed the build — after a local `pnpm build` had passed.
 *
 * An explicit annotation cannot be an implicit any, whatever resolves. It also
 * says out loud what the adapter is handed, which is worth more than the two
 * lines it costs.
 */
export interface CookieToSet {
  name: string;
  value: string;
  /** Supabase passes Next's own cookie options straight through. */
  options?: Record<string, unknown>;
}

export type CookieList = CookieToSet[];
