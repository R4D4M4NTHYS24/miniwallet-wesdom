import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db.js";

const password = "Password123!";
const testRun = `phase7-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type TestUser = {
  id: string;
  email: string;
  token: string;
};

type Scenario = {
  prefix: string;
  admin: TestUser;
  alice: TestUser;
  bob: TestUser;
  unrelated: TestUser;
};

function email(prefix: string, name: string) {
  return `${testRun}-${prefix}-${name}@example.com`;
}

async function cleanupPrefix(prefix: string) {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: `${testRun}-${prefix}-` } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      OR: [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }]
    },
    select: { id: true }
  });
  const transactionIds = transactions.map((transaction) => transaction.id);

  if (transactionIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await prisma.transaction.deleteMany({ where: { id: { in: transactionIds } } });
  }

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createUserWithWallet(
  prefix: string,
  name: string,
  role: "USER" | "ADMIN",
  availableBalanceCents: bigint
) {
  const user = await prisma.user.create({
    data: {
      email: email(prefix, name),
      passwordHash: await bcrypt.hash(password, 4),
      role,
      wallet: {
        create: {
          availableBalanceCents,
          pendingBalanceCents: 0n,
          currency: "USD"
        }
      }
    },
    select: { id: true, email: true }
  });

  return user;
}

async function loginAs(userEmail: string) {
  const response = await request(app)
    .post("/auth/login")
    .send({ email: userEmail, password })
    .expect(200);

  return response.body.token as string;
}

async function createScenario(prefix: string, aliceBalance = 250_000n, bobBalance = 100_000n) {
  await cleanupPrefix(prefix);

  const [adminUser, aliceUser, bobUser, unrelatedUser] = await Promise.all([
    createUserWithWallet(prefix, "admin", "ADMIN", 0n),
    createUserWithWallet(prefix, "alice", "USER", aliceBalance),
    createUserWithWallet(prefix, "bob", "USER", bobBalance),
    createUserWithWallet(prefix, "unrelated", "USER", 0n)
  ]);

  return {
    prefix,
    admin: { ...adminUser, token: await loginAs(adminUser.email) },
    alice: { ...aliceUser, token: await loginAs(aliceUser.email) },
    bob: { ...bobUser, token: await loginAs(bobUser.email) },
    unrelated: { ...unrelatedUser, token: await loginAs(unrelatedUser.email) }
  } satisfies Scenario;
}

async function getWallet(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet;
}

async function getTransactionRows(transactionId: string) {
  const [transaction, ledgerEntries, auditLogs] = await Promise.all([
    prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } }),
    prisma.ledgerEntry.findMany({
      where: { transactionId },
      orderBy: [{ walletId: "asc" }, { direction: "asc" }, { balanceType: "asc" }]
    }),
    prisma.auditLog.findMany({ where: { transactionId } })
  ]);

  return { transaction, ledgerEntries, auditLogs };
}

async function createPendingTransfer(scenario: Scenario, amountCents = "100001") {
  const response = await request(app)
    .post("/transfers")
    .set("Authorization", `Bearer ${scenario.alice.token}`)
    .send({ toUserId: scenario.bob.id, amountCents })
    .expect(201);

  return response.body.transaction as { id: string; amountCents: string; status: string };
}

async function countRowsForUsers(userIds: string[]) {
  const transactions = await prisma.transaction.findMany({
    where: { OR: [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }] },
    select: { id: true }
  });
  const transactionIds = transactions.map((transaction) => transaction.id);

  return {
    transactions: transactionIds.length,
    ledgerEntries:
      transactionIds.length === 0
        ? 0
        : await prisma.ledgerEntry.count({ where: { transactionId: { in: transactionIds } } }),
    auditLogs:
      transactionIds.length === 0
        ? 0
        : await prisma.auditLog.count({ where: { transactionId: { in: transactionIds } } })
  };
}

function expectAuditAmountString(metadata: unknown, amountCents: string) {
  expect(metadata).toMatchObject({ amountCents });
  expect(typeof (metadata as { amountCents: unknown }).amountCents).toBe("string");
}

describe("MiniWallet API integration", () => {
  const prefixes: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "phase7-test-secret";
    await prisma.$connect();
  });

  afterEach(async () => {
    await Promise.all(prefixes.splice(0).map((prefix) => cleanupPrefix(prefix)));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function scenario(name: string, aliceBalance?: bigint, bobBalance?: bigint) {
    const prefix = `${name}-${prefixes.length}`;
    prefixes.push(prefix);
    return createScenario(prefix, aliceBalance, bobBalance);
  }

  it("sets up auth and rejects protected requests without a token", async () => {
    const test = await scenario("auth");

    expect(test.admin.token).toEqual(expect.any(String));
    expect(test.alice.token).toEqual(expect.any(String));

    const response = await request(app)
      .get("/transactions")
      .expect(401);

    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("creates a confirmed transfer with exact balances, ledger, and audit rows", async () => {
    const test = await scenario("confirmed");

    const response = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .send({ toUserId: test.bob.id, amountCents: "5000" })
      .expect(201);

    const transactionDto = response.body.transaction;
    expect(transactionDto.status).toBe("CONFIRMED");
    expect(transactionDto.amountCents).toBe("5000");
    expect(typeof transactionDto.amountCents).toBe("string");

    await expect(getWallet(test.alice.id)).resolves.toMatchObject({ availableBalanceCents: 245_000n });
    await expect(getWallet(test.bob.id)).resolves.toMatchObject({ availableBalanceCents: 105_000n });

    const { transaction, ledgerEntries, auditLogs } = await getTransactionRows(transactionDto.id);
    expect(transaction.status).toBe("CONFIRMED");
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "DEBIT", balanceType: "AVAILABLE", entryType: "TRANSFER_OUT", amountCents: 5000n }),
        expect.objectContaining({ direction: "CREDIT", balanceType: "AVAILABLE", entryType: "TRANSFER_IN", amountCents: 5000n })
      ])
    );
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({ action: "TRANSFER_CONFIRMED" });
    expectAuditAmountString(auditLogs[0].metadata, "5000");
  });

  it("creates a pending-review transfer without crediting the recipient", async () => {
    const test = await scenario("pending");

    const response = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .send({ toUserId: test.bob.id, amountCents: "100001" })
      .expect(201);

    const transactionDto = response.body.transaction;
    expect(transactionDto.status).toBe("PENDING_REVIEW");
    expect(transactionDto.riskReason).toBe("AMOUNT_ABOVE_REVIEW_THRESHOLD");

    await expect(getWallet(test.alice.id)).resolves.toMatchObject({
      availableBalanceCents: 149_999n,
      pendingBalanceCents: 100_001n
    });
    await expect(getWallet(test.bob.id)).resolves.toMatchObject({ availableBalanceCents: 100_000n });

    const { ledgerEntries, auditLogs } = await getTransactionRows(transactionDto.id);
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "DEBIT", balanceType: "AVAILABLE", entryType: "HOLD", amountCents: 100_001n }),
        expect.objectContaining({ direction: "CREDIT", balanceType: "PENDING", entryType: "HOLD", amountCents: 100_001n })
      ])
    );
    expect(auditLogs[0]).toMatchObject({ action: "TRANSFER_PENDING_REVIEW" });
    expectAuditAmountString(auditLogs[0].metadata, "100001");
  });

  it("rolls back insufficient funds without financial side effects", async () => {
    const test = await scenario("insufficient", 1000n, 0n);
    const beforeAlice = await getWallet(test.alice.id);
    const beforeCounts = await countRowsForUsers([test.alice.id, test.bob.id]);

    const response = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .send({ toUserId: test.bob.id, amountCents: "5000" })
      .expect(409);

    expect(response.body.code).toBe("INSUFFICIENT_FUNDS");
    await expect(getWallet(test.alice.id)).resolves.toMatchObject({
      availableBalanceCents: beforeAlice.availableBalanceCents,
      pendingBalanceCents: beforeAlice.pendingBalanceCents
    });
    await expect(countRowsForUsers([test.alice.id, test.bob.id])).resolves.toEqual(beforeCounts);
  });

  it("rejects invalid amountCents values with VALIDATION_ERROR", async () => {
    const test = await scenario("amount-validation");
    const invalidValues = [5000, "0", "-1", "10.50", "1,000", "9223372036854775808"];

    for (const amountCents of invalidValues) {
      const response = await request(app)
        .post("/transfers")
        .set("Authorization", `Bearer ${test.alice.token}`)
        .send({ toUserId: test.bob.id, amountCents })
        .expect(400);

      expect(response.body.code).toBe("VALIDATION_ERROR");
    }
  });

  it("approves a pending transfer with exact balances, ledger, and audit rows", async () => {
    const test = await scenario("approve");
    const pending = await createPendingTransfer(test);

    const response = await request(app)
      .post(`/admin/transactions/${pending.id}/approve`)
      .set("Authorization", `Bearer ${test.admin.token}`)
      .expect(200);

    expect(response.body.transaction).toMatchObject({
      id: pending.id,
      status: "CONFIRMED",
      amountCents: "100001",
      reviewedByUserId: test.admin.id
    });
    expect(response.body.transaction.reviewedAt).toEqual(expect.any(String));
    expect(response.body.transaction.confirmedAt).toEqual(expect.any(String));

    await expect(getWallet(test.alice.id)).resolves.toMatchObject({
      availableBalanceCents: 149_999n,
      pendingBalanceCents: 0n
    });
    await expect(getWallet(test.bob.id)).resolves.toMatchObject({ availableBalanceCents: 200_001n });

    const { ledgerEntries, auditLogs } = await getTransactionRows(pending.id);
    expect(ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "DEBIT", balanceType: "PENDING", entryType: "RELEASE", amountCents: 100_001n }),
        expect.objectContaining({ direction: "CREDIT", balanceType: "AVAILABLE", entryType: "TRANSFER_IN", amountCents: 100_001n })
      ])
    );
    expect(auditLogs).toEqual(expect.arrayContaining([expect.objectContaining({ action: "TRANSFER_APPROVED" })]));
    expectAuditAmountString(auditLogs.find((log) => log.action === "TRANSFER_APPROVED")?.metadata, "100001");
  });

  it("rejects a pending transfer and restores sender funds without crediting recipient", async () => {
    const test = await scenario("reject");
    const pending = await createPendingTransfer(test);

    const response = await request(app)
      .post(`/admin/transactions/${pending.id}/reject`)
      .set("Authorization", `Bearer ${test.admin.token}`)
      .expect(200);

    expect(response.body.transaction).toMatchObject({
      id: pending.id,
      status: "REJECTED",
      amountCents: "100001",
      reviewedByUserId: test.admin.id,
      confirmedAt: null
    });
    expect(response.body.transaction.reviewedAt).toEqual(expect.any(String));

    await expect(getWallet(test.alice.id)).resolves.toMatchObject({
      availableBalanceCents: 250_000n,
      pendingBalanceCents: 0n
    });
    await expect(getWallet(test.bob.id)).resolves.toMatchObject({ availableBalanceCents: 100_000n });

    const { ledgerEntries, auditLogs } = await getTransactionRows(pending.id);
    expect(ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "DEBIT", balanceType: "PENDING", entryType: "REVERSAL", amountCents: 100_001n }),
        expect.objectContaining({ direction: "CREDIT", balanceType: "AVAILABLE", entryType: "REVERSAL", amountCents: 100_001n })
      ])
    );
    expect(auditLogs).toEqual(expect.arrayContaining([expect.objectContaining({ action: "TRANSFER_REJECTED" })]));
    expectAuditAmountString(auditLogs.find((log) => log.action === "TRANSFER_REJECTED")?.metadata, "100001");
  });

  it("blocks review of non-pending transactions without extra ledger or audit rows", async () => {
    const test = await scenario("review-guard");
    const transfer = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .send({ toUserId: test.bob.id, amountCents: "5000" })
      .expect(201);
    const transactionId = transfer.body.transaction.id as string;
    const before = await getTransactionRows(transactionId);

    const response = await request(app)
      .post(`/admin/transactions/${transactionId}/approve`)
      .set("Authorization", `Bearer ${test.admin.token}`)
      .expect(409);

    expect(response.body.code).toBe("TRANSACTION_NOT_REVIEWABLE");
    const after = await getTransactionRows(transactionId);
    expect(after.ledgerEntries).toHaveLength(before.ledgerEntries.length);
    expect(after.auditLogs).toHaveLength(before.auditLogs.length);
  });

  it("enforces transaction history and admin access control", async () => {
    const test = await scenario("access");
    const transfer = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .send({ toUserId: test.bob.id, amountCents: "5000" })
      .expect(201);
    const transactionId = transfer.body.transaction.id as string;

    await request(app)
      .get("/admin/suspicious-transactions")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .expect(403)
      .expect((response) => expect(response.body.code).toBe("FORBIDDEN"));

    await request(app)
      .get(`/transactions/${transactionId}`)
      .set("Authorization", `Bearer ${test.unrelated.token}`)
      .expect(403)
      .expect((response) => expect(response.body.code).toBe("FORBIDDEN"));

    await request(app)
      .get(`/transactions/${transactionId}`)
      .set("Authorization", `Bearer ${test.admin.token}`)
      .expect(200)
      .expect((response) => expect(response.body.transaction.id).toBe(transactionId));

    await request(app)
      .get("/transactions")
      .set("Authorization", `Bearer ${test.admin.token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toHaveLength(0);
        expect(response.body.total).toBe(0);
      });
  });

  it("returns own transaction history with pagination and validates pagination inputs", async () => {
    const test = await scenario("history");
    const transfer = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .send({ toUserId: test.bob.id, amountCents: "5000" })
      .expect(201);

    await request(app)
      .get("/transactions?page=1&pageSize=20")
      .set("Authorization", `Bearer ${test.alice.token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
        expect(response.body.items).toHaveLength(1);
        expect(response.body.items[0]).toMatchObject({ id: transfer.body.transaction.id, amountCents: "5000" });
      });

    for (const query of [
      "page=0&pageSize=20",
      "page=1.5&pageSize=20",
      "page=1&pageSize=101",
      "page=999999999999999999999999&pageSize=20",
      "page=1&pageSize=999999999999999999999999",
      "page=9007199254740991&pageSize=100"
    ]) {
      await request(app)
        .get(`/transactions?${query}`)
        .set("Authorization", `Bearer ${test.alice.token}`)
        .expect(400)
        .expect((response) => expect(response.body.code).toBe("VALIDATION_ERROR"));
    }
  });

  it("prevents overspending under concurrent transfers", async () => {
    const test = await scenario("concurrency", 10_000n, 0n);

    const requests = ["7000", "7000", "7000"].map((amountCents) =>
      request(app)
        .post("/transfers")
        .set("Authorization", `Bearer ${test.alice.token}`)
        .send({ toUserId: test.bob.id, amountCents })
    );
    const results = await Promise.allSettled(requests);
    const responses = results.map((result) => {
      if (result.status === "rejected") {
        throw result.reason;
      }

      return result.value;
    });
    const successes = responses.filter((response) => response.status === 201);
    const failures = responses.filter((response) => response.status !== 201);
    const successfulTotal = successes.reduce(
      (total, response) => total + BigInt(response.body.transaction.amountCents),
      0n
    );

    expect(successes.length).toBeGreaterThan(0);
    expect(successes.length).toBeLessThan(3);
    expect(successfulTotal).toBeLessThanOrEqual(10_000n);
    expect(failures.every((response) => response.body.code === "INSUFFICIENT_FUNDS")).toBe(true);

    const senderWallet = await getWallet(test.alice.id);
    const recipientWallet = await getWallet(test.bob.id);
    expect(senderWallet.availableBalanceCents).toBeGreaterThanOrEqual(0n);
    expect(senderWallet.availableBalanceCents).toBe(10_000n - successfulTotal);
    expect(recipientWallet.availableBalanceCents).toBe(successfulTotal);

    const counts = await countRowsForUsers([test.alice.id, test.bob.id]);
    expect(counts.transactions).toBe(successes.length);
    expect(counts.ledgerEntries).toBe(successes.length * 2);
    expect(counts.auditLogs).toBe(successes.length);
  });
});
