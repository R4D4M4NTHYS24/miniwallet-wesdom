import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function App() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Phase 2 skeleton</p>
        <h1>MiniWallet</h1>
        <p>
          This placeholder confirms the React/Vite frontend is running. Business
          logic, authentication, transfers, and admin review are intentionally
          not implemented yet.
        </p>
        <dl>
          <dt>API base URL</dt>
          <dd>{apiBaseUrl}</dd>
          <dt>Health endpoint</dt>
          <dd>{apiBaseUrl}/health</dd>
        </dl>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
