// PORT OVERLAY: the only static-export blocker. brandbrain's root used server `redirect()` from
// next/navigation, which has no runtime under `output: export`. A build-time meta refresh sends
// `/` → `/build` with zero server involvement — identical UX, export-safe.
// PORT_BASE_PATH prefixes the target so the redirect resolves under a subpath deploy (e.g. GitHub
// Pages project site at /<repo>); basePath does not rewrite a raw <meta>/<a>, so we prefix here.
export default function Home() {
  const base = process.env.PORT_BASE_PATH || "";
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${base}/build`} />
      <noscript>
        <a href={`${base}/build`}>Continue to Brand Studio</a>
      </noscript>
    </>
  );
}
