import { z } from "zod";

export const authCredentialsSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128)
});

export type AuthCredentials = z.infer<typeof authCredentialsSchema>;
