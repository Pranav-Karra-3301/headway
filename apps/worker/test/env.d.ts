// Vite `?raw` imports (used to load D1 migrations into the test database).
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
