import express from "express";
import { authenticate } from "./auth.js";
import { createOrderHandler, getOrderHandler } from "./orders-controller.js";

const app = express();

app.use(express.json());
app.use(authenticate);

app.post("/api/orders", createOrderHandler);
app.get("/api/orders/:id", getOrderHandler);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(Number(process.env.PORT ?? 3000));

export default app;
