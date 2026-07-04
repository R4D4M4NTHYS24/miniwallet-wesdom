import React, { FormEvent, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const tokenStorageKey = "miniwallet.jwt";
const apiBaseDisplay = apiBaseUrl.replace(/^https?:\/\//, "");

type User = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
};

type Wallet = {
  availableBalanceCents: string;
  pendingBalanceCents: string;
  currency: string;
};

type Transaction = {
  id: string;
  status: string;
  amountCents: string;
  currency: string;
  fromUserId: string;
  toUserId: string;
  riskReason: string | null;
  confirmedAt: string | null;
  reviewedAt?: string | null;
  reviewedByUserId?: string | null;
  createdAt?: string;
};

type ApiError = {
  code: string;
  message: string;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

function formatCents(value: string, currency: string) {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  const symbol = currency === "USD" ? "$" : `${currency} `;

  return `${symbol}${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as ApiError).code === "string" &&
    typeof (value as ApiError).message === "string"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    if (isApiError(data)) {
      throw data;
    }

    throw {
      code: `HTTP_${response.status}`,
      message: response.statusText || "Request failed"
    } satisfies ApiError;
  }

  return data as T;
}

function ErrorBanner({ error }: { error: ApiError | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="error" role="alert">
      <strong>{error.code}</strong>
      <span>{error.message}</span>
    </div>
  );
}

function formatStatusLabel(status: string) {
  return status.split("_").join(" ").toLowerCase();
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status.toLowerCase()}`}>{formatStatusLabel(status)}</span>;
}

function WalletGraphic({ wallet }: { wallet: Wallet }) {
  const available = BigInt(wallet.availableBalanceCents);
  const pending = BigInt(wallet.pendingBalanceCents);
  const total = available + pending;
  const pendingShare = total === 0n ? 0 : Number((pending * 100n) / total);
  const hasPendingExposure = pending > 0n;
  const pendingShareLabel = hasPendingExposure && pendingShare === 0 ? "<1%" : `${pendingShare}%`;

  return (
    <div
      className={`wallet-graphic ${hasPendingExposure ? "" : "wallet-graphic-empty"}`}
      style={{ "--pending-share": `${pendingShare}%` } as React.CSSProperties}
    >
      <div className="donut" aria-hidden="true">
        <span>{pendingShareLabel}</span>
      </div>
      <div>
        <strong>Pending exposure</strong>
        <p>
          {hasPendingExposure
            ? `${pendingShareLabel} of visible wallet funds are awaiting review.`
            : "No funds currently awaiting review."}
        </p>
      </div>
    </div>
  );
}

function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <p className="muted">No transactions to show.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Amount</th>
            <th>From</th>
            <th>To</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>
                <StatusBadge status={transaction.status} />
              </td>
              <td>{formatCents(transaction.amountCents, transaction.currency)}</td>
              <td className="mono">{transaction.fromUserId}</td>
              <td className="mono">{transaction.toUserId}</td>
              <td>{transaction.riskReason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenStorageKey) ?? "");
  const [email, setEmail] = useState("alice@miniwallet.local");
  const [password, setPassword] = useState("Password123!");
  const [toUserId, setToUserId] = useState("");
  const [amountCents, setAmountCents] = useState("1000");
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [adminQueue, setAdminQueue] = useState<Transaction[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(false);

  async function apiRequest<T>(path: string, options: RequestOptions = {}) {
    const headers: HeadersInit = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    return parseResponse<T>(response);
  }

  async function loadUserSession(currentUser?: User) {
    const [{ wallet: nextWallet }, transactionPage] = await Promise.all([
      apiRequest<{ wallet: Wallet }>("/wallet/me"),
      apiRequest<{ items: Transaction[] }>("/transactions?page=1&pageSize=20")
    ]);

    setWallet(nextWallet);
    setTransactions(transactionPage.items);

    const sessionUser = currentUser ?? user;
    if (sessionUser?.role === "ADMIN") {
      const queuePage = await apiRequest<{ items: Transaction[] }>(
        "/admin/suspicious-transactions?page=1&pageSize=20"
      );
      setAdminQueue(queuePage.items);
    } else {
      setAdminQueue([]);
    }
  }

  async function loadMe() {
    if (!token) {
      return;
    }

    try {
      setError(null);
      const { user: nextUser } = await apiRequest<{ user: User }>("/auth/me");
      setUser(nextUser);
      await loadUserSession(nextUser);
    } catch (caught) {
      const nextError = isApiError(caught) ? caught : { code: "CLIENT_ERROR", message: "Unable to load session" };

      if (nextError.code === "UNAUTHORIZED") {
        localStorage.removeItem(tokenStorageKey);
        setToken("");
      }

      setUser(null);
      setWallet(null);
      setTransactions([]);
      setAdminQueue([]);
      setError(nextError);
    }
  }

  async function handleRefreshSession() {
    setIsBusy(true);
    setError(null);

    try {
      await loadUserSession();
    } catch (caught) {
      setError(isApiError(caught) ? caught : { code: "CLIENT_ERROR", message: "Refresh failed" });
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    void loadMe();
  }, [token]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      const result = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }).then((response) => parseResponse<{ token: string; user: User }>(response));

      localStorage.setItem(tokenStorageKey, result.token);
      setToken(result.token);
      setUser(result.user);
    } catch (caught) {
      setError(isApiError(caught) ? caught : { code: "CLIENT_ERROR", message: "Login failed" });
    } finally {
      setIsBusy(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken("");
    setUser(null);
    setWallet(null);
    setTransactions([]);
    setAdminQueue([]);
    setError(null);
  }

  async function handleCreateTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      await apiRequest<{ transaction: Transaction }>("/transfers", {
        method: "POST",
        body: { toUserId, amountCents }
      });
      await loadUserSession();
    } catch (caught) {
      setError(isApiError(caught) ? caught : { code: "CLIENT_ERROR", message: "Transfer failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReview(transactionId: string, action: "approve" | "reject") {
    setIsBusy(true);
    setError(null);

    try {
      await apiRequest<{ transaction: Transaction }>(`/admin/transactions/${transactionId}/${action}`, {
        method: "POST"
      });
      await loadUserSession();
    } catch (caught) {
      setError(isApiError(caught) ? caught : { code: "CLIENT_ERROR", message: `Review ${action} failed` });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopyUserId() {
    if (!user) {
      return;
    }

    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedUserId(true);
      window.setTimeout(() => setCopiedUserId(false), 1600);
    } catch {
      setError({ code: "CLIPBOARD_ERROR", message: "Unable to copy User ID" });
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-copy">
          <div className="brand-mark">MW</div>
          <p className="eyebrow">MiniWallet review console</p>
          <h1>Wallet transfers with traceable review.</h1>
          <p>
            Authenticate users, send wallet transfers, inspect balances and history, and review suspicious
            high-value transactions from one focused fintech dashboard.
          </p>
          <div className="hero-meta" aria-label="Application metadata">
            <span className="meta-chip" title={apiBaseUrl}><strong>API</strong>{apiBaseDisplay}</span>
            <span className="meta-chip"><strong>Frontend</strong>React / Vite</span>
            <span className="meta-chip"><strong>Review threshold</strong>&gt; 100000 cents</span>
          </div>
        </div>
      </header>

      <ErrorBanner error={error} />

      <section className="grid two-columns">
        <form className="card login-card" onSubmit={handleLogin}>
          <div className="section-title">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Login</h2>
            </div>
            {user ? <button className="secondary" type="button" onClick={handleLogout}>Logout</button> : null}
          </div>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          <button disabled={isBusy} type="submit">Login to wallet</button>
          <div className="credentials">
            <strong>Seed credentials</strong>
            <span>admin@miniwallet.local / Password123!</span>
            <span>alice@miniwallet.local / Password123!</span>
            <span>bob@miniwallet.local / Password123!</span>
          </div>
        </form>

        <section className="card user-card">
          <p className="eyebrow">Session</p>
          <h2>Current User</h2>
          {user ? (
            <dl className="details">
              <dt>Email</dt>
              <dd>{user.email}</dd>
              <dt>Role</dt>
              <dd><span className="role-pill">{user.role}</span></dd>
              <dt>User ID</dt>
              <dd className="user-id-row">
                <span className="mono">{user.id}</span>
                <button className="copy-button secondary" type="button" onClick={() => void handleCopyUserId()}>
                  {copiedUserId ? "Copied" : "Copy"}
                </button>
              </dd>
            </dl>
          ) : (
            <p className="muted">Login to load /auth/me.</p>
          )}
        </section>
      </section>

      <section className="grid two-columns">
        <section className="card wallet-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Balance</p>
              <h2>Wallet</h2>
            </div>
            <button className="secondary" disabled={!token || isBusy} type="button" onClick={() => void handleRefreshSession()}>Refresh</button>
          </div>
          {wallet ? (
            <>
              <div className="balances">
                <div className="balance-tile primary-balance">
                  <span>Available</span>
                  <strong>{formatCents(wallet.availableBalanceCents, wallet.currency)}</strong>
                  <small>{wallet.availableBalanceCents} cents ready to send</small>
                </div>
                <div className="balance-tile">
                  <span>Pending review</span>
                  <strong>{formatCents(wallet.pendingBalanceCents, wallet.currency)}</strong>
                  <small>{wallet.pendingBalanceCents} cents reserved</small>
                </div>
              </div>
              <WalletGraphic wallet={wallet} />
            </>
          ) : (
            <p className="muted">Login to load /wallet/me.</p>
          )}
        </section>

        <form className="card transfer-card" onSubmit={handleCreateTransfer}>
          <p className="eyebrow">Action</p>
          <h2>Create Transfer</h2>
          <label>
            Recipient user ID
            <input value={toUserId} onChange={(event) => setToUserId(event.target.value)} placeholder="UUID" />
          </label>
          <p className="hint">Log in as Bob, copy Bob's User ID from the session card, then log back in as Alice to send a transfer.</p>
          <label>
            Amount cents
            <input value={amountCents} onChange={(event) => setAmountCents(event.target.value)} inputMode="numeric" />
          </label>
          <p className="hint">Amounts above 100000 cents enter pending admin review.</p>
          <button disabled={!token || isBusy} type="submit">Create transfer</button>
        </form>
      </section>

      <section className="card data-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">Ledger view</p>
            <h2>Transaction History</h2>
          </div>
          <span className="count-pill">{transactions.length} shown</span>
        </div>
        <TransactionTable transactions={transactions} />
      </section>

      {user?.role === "ADMIN" ? (
        <section className="card admin-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Admin controls</p>
              <h2>Suspicious Queue</h2>
            </div>
            <span className="count-pill">{adminQueue.length} pending</span>
          </div>
          {adminQueue.length === 0 ? (
            <p className="muted">No pending suspicious transactions.</p>
          ) : (
            <div className="admin-list">
              {adminQueue.map((transaction) => (
                <article className="review-item" key={transaction.id}>
                  <div>
                    <strong>{formatCents(transaction.amountCents, transaction.currency)}</strong>
                    <span className="mono">{transaction.id}</span>
                    <span>{transaction.riskReason}</span>
                    <StatusBadge status={transaction.status} />
                  </div>
                  <div className="actions">
                    <button disabled={isBusy} type="button" onClick={() => void handleReview(transaction.id, "approve")}>
                      Approve
                    </button>
                    <button disabled={isBusy} type="button" className="danger" onClick={() => void handleReview(transaction.id, "reject")}>
                      Reject
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
