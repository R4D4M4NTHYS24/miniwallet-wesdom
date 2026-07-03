import { PrismaClient, type UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const seedPassword = "Password123!";

type SeedUser = {
  email: string;
  role: UserRole;
  availableBalanceCents: bigint;
};

const seedUsers: SeedUser[] = [
  {
    email: "admin@miniwallet.local",
    role: "ADMIN",
    availableBalanceCents: 0n
  },
  {
    email: "alice@miniwallet.local",
    role: "USER",
    availableBalanceCents: 250_000n
  },
  {
    email: "bob@miniwallet.local",
    role: "USER",
    availableBalanceCents: 100_000n
  }
];

async function main() {
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  for (const seedUser of seedUsers) {
    await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        passwordHash,
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
        passwordHash,
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
