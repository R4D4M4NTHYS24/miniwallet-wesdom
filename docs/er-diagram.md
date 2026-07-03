# MiniWallet ER Diagram

```mermaid
erDiagram
  User ||--o| Wallet : owns
  User ||--o{ Transaction : sends
  User ||--o{ Transaction : receives
  User ||--o{ Transaction : reviews
  User ||--o{ AuditLog : acts
  Wallet ||--o{ Transaction : source_wallet
  Wallet ||--o{ Transaction : destination_wallet
  Wallet ||--o{ LedgerEntry : records
  Transaction ||--o{ LedgerEntry : explains_money_movement
  Transaction ||--o{ AuditLog : audited_by

  User {
    uuid id PK
    string email UK
    string passwordHash
    UserRole role
  }

  Wallet {
    uuid id PK
    uuid userId FK_UK
    bigint availableBalanceCents
    bigint pendingBalanceCents
    string currency
  }

  Transaction {
    uuid id PK
    bigint amountCents
    TransactionStatus status
    RiskReason riskReason
    uuid fromUserId FK
    uuid toUserId FK
    uuid fromWalletId FK
    uuid toWalletId FK
    uuid reviewedByUserId FK
    datetime confirmedAt
    datetime reviewedAt
  }

  LedgerEntry {
    uuid id PK
    uuid transactionId FK
    uuid walletId FK
    LedgerDirection direction
    LedgerBalanceType balanceType
    LedgerEntryType entryType
    bigint amountCents
  }

  AuditLog {
    uuid id PK
    uuid actorUserId FK
    string action
    string entityType
    uuid entityId
    uuid transactionId FK
    json metadata
  }
```

`User` and `Wallet` are one-to-one because each user owns a single wallet and `Wallet.userId` is unique. This supports simple balance locking and avoids cross-wallet ambiguity for the technical test.

`Transaction` stores both users and wallets so history can be queried by user while financial mutations remain tied to concrete wallet rows. Composite foreign keys enforce that `(fromWalletId, fromUserId)` and `(toWalletId, toUserId)` reference matching `wallets(id, userId)` pairs.

`Transaction` represents business state, `LedgerEntry` records immutable financial movements, and `AuditLog` records actions/events such as transfer creation or admin review.

Money fields use integer cents: `amountCents`, `availableBalanceCents`, and `pendingBalanceCents`. This avoids floating-point precision issues and makes available vs reserved funds explicit.

Database `CHECK` constraints protect core financial invariants such as positive amounts, non-negative balances, USD-only currency, different sender/receiver wallets, and required risk reason for `PENDING_REVIEW` transactions.
