import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

const placeholderPasswordHash = "phase3-placeholder-password-hash";

const seedUsers = [
  {
    email: "admin@miniwallet.local",
    role: UserRole.ADMIN,
    availableBalanceCents: 0n
  },
  {
    email: "alice@miniwallet.local",
    role: UserRole.USER,
    availableBalanceCents: 250_000n
  },
  {
    email: "bob@miniwallet.local",
    role: UserRole.USER,
    availableBalanceCents: 100_000n
  }
];

async function main() {
  for (const seedUser of seedUsers) {
    await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        role: seedUser.role,
        wallet: {
          upsert: {
            create: {
              availableBalanceCents: seedUser.availableBalanceCents,
              pendingBalanceCents: 0n,
              currency: "USD"
            },
            update: {
              availableBalanceCents: seedUser.availableBalanceCents,
              pendingBalanceCents: 0n,
              currency: "USD"
            }
          }
        }
      },
      create: {
        email: seedUser.email,
        passwordHash: placeholderPasswordHash,
        role: seedUser.role,
        wallet: {
          create: {
            availableBalanceCents: seedUser.availableBalanceCents,
            pendingBalanceCents: 0n,
            currency: "USD"
          }
        }
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
