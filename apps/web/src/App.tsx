export function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeContent: 'center',
        gap: 12,
        textAlign: 'center',
        background: 'var(--bg)',
      }}
    >
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(48px, 10vw, 120px)', fontWeight: 400 }}>
        HEADWAY
      </h1>
      <p style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 18, opacity: 0.7 }}>foundation online</p>
    </main>
  );
}
