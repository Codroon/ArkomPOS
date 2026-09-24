/** @type {import('next').NextConfig} */
const nextConfig = {
  /* @arkom/core ships as TypeScript source (it is a workspace package, never
     published), so Next has to compile it like the app's own files. It is the
     same file the till imports — that is the point: one envelope, two halves. */
  transpilePackages: ["@arkom/core"],
};

export default nextConfig;
