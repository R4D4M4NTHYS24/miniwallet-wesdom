import cors from "cors";
import express from "express";
import { adminRouter } from "./admin/routes.js";
import { authRouter } from "./auth/routes.js";
import { errorHandler } from "./errors.js";
import { transactionsRouter } from "./transactions/routes.js";
import { transfersRouter } from "./transfers/routes.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "miniwallet-api",
    phase: "skeleton"
  });
});

app.use("/auth", authRouter);
app.use("/transfers", transfersRouter);
app.use("/transactions", transactionsRouter);
app.use("/admin", adminRouter);

app.use(errorHandler);
