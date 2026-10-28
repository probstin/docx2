import Head from "@docusaurus/Head";
import { Redirect } from "@docusaurus/router";
import useBaseUrl from "@docusaurus/useBaseUrl";

/**
 * The site root has no content of its own: the docs landing page lives at `/docs/`.
 * The meta refresh keeps the redirect working in the static HTML (no JavaScript, crawlers).
 */
export default function Home() {
  const target = useBaseUrl("/docs/");
  return (
    <>
      <Head>
        <meta httpEquiv="refresh" content={`0; url=${target}`} />
      </Head>
      <Redirect to={target} />
    </>
  );
}
