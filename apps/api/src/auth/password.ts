import bcrypt from "bcryptjs";

const passwordHashRounds = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, passwordHashRounds);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
