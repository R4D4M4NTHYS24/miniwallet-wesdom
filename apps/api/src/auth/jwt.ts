import jwt from "jsonwebtoken";

export type AuthTokenPayload = {
  sub: string;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }

  return "miniwallet-local-development-secret";
}

export function signAuthToken(userId: string) {
  return jwt.sign({ sub: userId } satisfies AuthTokenPayload, getJwtSecret(), {
    expiresIn: "1h"
  });
}

export function verifyAuthToken(token: string) {
  let payload: string | jwt.JwtPayload;

  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }

  if (typeof payload !== "object" || typeof payload.sub !== "string") {
    return null;
  }

  return { sub: payload.sub } satisfies AuthTokenPayload;
}
