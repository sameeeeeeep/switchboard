/** @type {import('next').NextConfig} */
// PORT OVERLAY (Switchboard Next preset). Same as brandbrain's real next.config, plus:
//  - output: "export" → emit a static frontend (the pages ship as-is; the /api routes are
//    removed before this build and bundled separately for the client fetch-router).
//  - images.unoptimized → static export has no image optimizer (brandbrain uses none, but safe).
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
      config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false, https: false, http: false };
    }
    return config;
  },
};

export default nextConfig;
