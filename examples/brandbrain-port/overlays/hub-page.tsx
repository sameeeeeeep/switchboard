// PORT OVERLAY: the only static-export blocker. brandbrain's root used server `redirect()` from
// next/navigation, which has no runtime under `output: export`. A build-time meta refresh sends
// `/` → `/build` with zero server involvement — identical UX, export-safe.
export default function Home() {
  return (
    <>
      <meta httpEquiv="refresh" content="0;url=/build" />
      <noscript>
        <a href="/build">Continue to Brand Studio</a>
      </noscript>
    </>
  );
}
