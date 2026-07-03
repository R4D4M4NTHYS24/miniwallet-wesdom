# MiniWallet Container Diagram

```mermaid
flowchart LR
  subgraph compose["Docker Compose network"]
    web["mini-wallet-web\nTechnology: React + Vite + TypeScript\nResponsibility: browser UI for auth, transfers, history, and admin review"]
    api["mini-wallet-api\nTechnology: Node.js + TypeScript + Express\nResponsibility: JWT auth, validation, transfer orchestration, transaction history, admin review, audit writes"]
    db[("mini-wallet-db\nTechnology: PostgreSQL\nResponsibility: source of truth for users, wallets, transactions, ledger entries, audit logs, and row-level locks")]
  end

  browser["User/Admin Browser"]

  browser -->|HTTP: loads React app assets| web
  web -->|HTTP/JSON: login, transfers, history, admin review with JWT| api
  api -->|SQL: ACID transactions, SELECT FOR UPDATE locks, persisted audit/ledger data| db
```
