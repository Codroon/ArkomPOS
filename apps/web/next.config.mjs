/** @type {import('next').NextConfig} */
const nextConfig = {
  /* @arkom/core ships as TypeScript source (it is a workspace package, never
     published), so Next has to compile it like the app's own files. It is the
     same file the till imports — that is the point: one envelope, two halves. */
  transpilePackages: ["@arkom/core"],

  /**
   * Dev gets its own directory.
   *
   * `next dev` and `next build` both write to `.next` by default, and a build
   * run while the dev server is up replaces the assets that server is still
   * advertising — the page then asks for a stylesheet that no longer exists and
   * renders as unstyled HTML. That cost two rounds of head-scratching, once
   * misdiagnosed as a corrupted cache.
   *
   * Production keeps the conventional `.next`, so nothing about deployment
   * changes; it is the local dev server that moves out of the way.
   */
  distDir: process.env.npm_lifecycle_event === "dev" ? ".next-dev" : ".next",
};

export default nextConfig;
