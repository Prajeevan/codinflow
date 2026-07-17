import express from "express";
import { createOrderHandler, deleteOrderHandler, getOrderHandler } from "./orders-controller.js";

const app = express();

app.use(express.json());

app.post("/api/orders", createOrderHandler);
app.get("/api/orders/:id", getOrderHandler);

app.delete("/api/orders/:id", deleteOrderHandler);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(Number(process.env.PORT ?? 3000));

export default app;
