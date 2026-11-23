// The static page: no data dependency, prerendered at build time.
export function HomePage() {
  return (
    <section id="home-content">
      <h1>Prerendered landing page</h1>
      <p>Static content rendered at build time from the same React tree the browser hydrates.</p>
    </section>
  );
}
