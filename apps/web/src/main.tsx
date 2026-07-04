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
  token?: string;
};

type AuthMode = "login" | "register";

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

function countByStatus(transactions: Transaction[], status: string) {
  return transactions.filter((transaction) => transaction.status === status).length;
}

function ReviewInsights({
  wallet,
  transactions,
  adminQueue
}: {
  wallet: Wallet | null;
  transactions: Transaction[];
  adminQueue: Transaction[];
}) {
  const confirmedCount = countByStatus(transactions, "CONFIRMED");
  const pendingCount = countByStatus(transactions, "PENDING_REVIEW");
  const rejectedCount = countByStatus(transactions, "REJECTED");

  return (
    <section className="card insights-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">Risk overview</p>
          <h2>Review Insights</h2>
        </div>
        <span className="count-pill">&gt; 100000 cents</span>
      </div>
      {wallet ? <WalletGraphic wallet={wallet} /> : <p className="muted">Wallet exposure loads after sign in.</p>}
      <div className="insight-grid" aria-label="Transaction status counts">
        <div className="insight-tile">
          <span>Confirmed</span>
          <strong>{confirmedCount}</strong>
        </div>
        <div className="insight-tile">
          <span>Pending</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="insight-tile">
          <span>Rejected</span>
          <strong>{rejectedCount}</strong>
        </div>
      </div>
      <p className="hint">
        {adminQueue.length > 0
          ? `${adminQueue.length} transaction${adminQueue.length === 1 ? "" : "s"} waiting in the admin review queue.`
          : "No admin review items are currently loaded for this session."}
      </p>
    </section>
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(() => Boolean(localStorage.getItem(tokenStorageKey)));
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

    const requestToken = options.token ?? token;

    if (requestToken) {
      headers.Authorization = `Bearer ${requestToken}`;
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    return parseResponse<T>(response);
  }

  async function loadUserSession(currentUser?: User, requestToken?: string) {
    const [{ wallet: nextWallet }, transactionPage] = await Promise.all([
      apiRequest<{ wallet: Wallet }>("/wallet/me", { token: requestToken }),
      apiRequest<{ items: Transaction[] }>("/transactions?page=1&pageSize=20", { token: requestToken })
    ]);

    setWallet(nextWallet);
    setTransactions(transactionPage.items);

    const sessionUser = currentUser ?? user;
    if (sessionUser?.role === "ADMIN") {
      const queuePage = await apiRequest<{ items: Transaction[] }>(
        "/admin/suspicious-transactions?page=1&pageSize=20",
        { token: requestToken }
      );
      setAdminQueue(queuePage.items);
    } else {
      setAdminQueue([]);
    }
  }

  async function loadMe(requestToken = token) {
    if (!requestToken) {
      setIsSessionLoading(false);
      return;
    }

    try {
      setError(null);
      const { user: nextUser } = await apiRequest<{ user: User }>("/auth/me", { token: requestToken });
      setUser(nextUser);
      await loadUserSession(nextUser, requestToken);
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
    } finally {
      setIsSessionLoading(false);
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
    if (token) {
      setIsSessionLoading(true);
      void loadMe();
    } else {
      setIsSessionLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!isDemoModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDemoModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDemoModalOpen]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      const result = await fetch(`${apiBaseUrl}/auth/${authMode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }).then((response) => parseResponse<{ token: string; user: User }>(response));

      localStorage.setItem(tokenStorageKey, result.token);
      setIsSessionLoading(true);
      setToken(result.token);
    } catch (caught) {
      const fallbackMessage = authMode === "login" ? "Login failed" : "Registration failed";

      setError(isApiError(caught) ? caught : { code: "CLIENT_ERROR", message: fallbackMessage });
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
    setIsSessionLoading(false);
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

  if (!user) {
    return (
      <main className="shell auth-shell">
        <section className="auth-screen">
          <header className="hero auth-hero">
            <div className="hero-copy">
              <div className="auth-hero-top">
                <div className="brand-mark">MW</div>
              </div>
              <div className="auth-hero-main">
                <p className="eyebrow">MiniWallet</p>
                <h1>Enter your wallet console.</h1>
                <p>
                  Sign in to inspect balances, send wallet transfers, and review suspicious high-value activity.
                  Create a basic account when you only need to verify registration and JWT authentication.
                </p>
                <div className="hero-meta" aria-label="Application metadata">
                  <span className="meta-chip" title={apiBaseUrl}><strong>API</strong>{apiBaseDisplay}</span>
                  <span className="meta-chip"><strong>Auth</strong>JWT sessions</span>
                  <span className="meta-chip"><strong>Demo</strong>Seeded reviewers</span>
                </div>
              </div>
            </div>
          </header>

          <form className="card auth-card" onSubmit={handleAuthSubmit}>
            <div className="section-title">
              <div>
                <p className="eyebrow">Access</p>
                <h2>{authMode === "login" ? "Sign in" : "Create account"}</h2>
              </div>
            </div>
            <ErrorBanner error={error} />
            {isSessionLoading ? <p className="hint">Restoring saved session...</p> : null}
            <div className="auth-toggle" aria-label="Access mode">
              <button
                aria-pressed={authMode === "login"}
                className={authMode === "login" ? "active" : ""}
                type="button"
                onClick={() => setAuthMode("login")}
              >
                Sign in
              </button>
              <button
                aria-pressed={authMode === "register"}
                className={authMode === "register" ? "active" : ""}
                type="button"
                onClick={() => setAuthMode("register")}
              >
                Create account
              </button>
            </div>
            <label>
              Email
              <input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label>
              Password
              <input required value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
            </label>
            <button disabled={isBusy || isSessionLoading} type="submit">
              {authMode === "login" ? "Sign in to wallet" : "Create account"}
            </button>
            <button className="secondary" type="button" onClick={() => setIsDemoModalOpen(true)}>
              View reviewer demo accounts
            </button>
            {authMode === "register" ? (
              <p className="hint">New accounts start with a zero-balance user wallet. Use seed accounts for transfer and admin review demos.</p>
            ) : null}
          </form>
          {isDemoModalOpen ? (
            <div className="modal-backdrop" role="presentation" onClick={() => setIsDemoModalOpen(false)}>
              <section
                className="demo-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="demo-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="section-title">
                  <div>
                    <p className="eyebrow">Local review</p>
                    <h2 id="demo-modal-title">Reviewer demo accounts</h2>
                  </div>
                  <button className="secondary copy-button" type="button" onClick={() => setIsDemoModalOpen(false)}>
                    Close
                  </button>
                </div>
                <p className="hint">
                  These local seeded accounts are intended for the full technical review flow. Alice and Bob have
                  balances for transfers, and admin has review access. Newly registered accounts start with zero balance.
                </p>
                <div className="demo-account-list">
                  <div>
                    <span>Admin</span>
                    <strong>admin@miniwallet.local / Password123!</strong>
                  </div>
                  <div>
                    <span>Alice</span>
                    <strong>alice@miniwallet.local / Password123!</strong>
                  </div>
                  <div>
                    <span>Bob</span>
                    <strong>bob@miniwallet.local / Password123!</strong>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="hero dashboard-hero">
        <div className="hero-copy">
          <div className="dashboard-brand-row">
            <div className="brand-mark">MW</div>
          </div>
          <p className="eyebrow">MiniWallet dashboard</p>
          <h1>Wallet transfers with traceable review.</h1>
          <p>
            Send wallet transfers, inspect balances and history, and review suspicious high-value transactions
            from one focused fintech dashboard.
          </p>
          <div className="hero-meta" aria-label="Application metadata">
            <span className="meta-chip" title={apiBaseUrl}><strong>API</strong>{apiBaseDisplay}</span>
            <span className="meta-chip"><strong>Signed in</strong>{user.email}</span>
            <span className="meta-chip"><strong>Review threshold</strong>&gt; 100000 cents</span>
          </div>
        </div>
        <button className="secondary hero-logout" type="button" onClick={handleLogout}>Logout</button>
      </header>

      <ErrorBanner error={error} />

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
          ) : (
            <p className="muted">Wallet data is not loaded yet. Use Refresh to retry.</p>
          )}
        </section>

        <section className="card user-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Session</p>
              <h2>Current User</h2>
            </div>
          </div>
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

        <ReviewInsights wallet={wallet} transactions={transactions} adminQueue={adminQueue} />
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
