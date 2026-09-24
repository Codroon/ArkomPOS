/**
 * pos.codroon.com — a placeholder until the landing page and the dashboard are
 * built. The ingest door underneath it is not a placeholder: a till that has
 * been given a code can link to this deployment today.
 */
export default function Home() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "#3f3f46" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 20, letterSpacing: ".14em" }}>CODROON POS</h1>
        <p style={{ fontSize: 13, color: "#6b6b70" }}>
          El TPV para tiendas de telefonía. Panel de control en preparación.
        </p>
      </div>
    </main>
  );
}
