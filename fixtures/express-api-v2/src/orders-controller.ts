import type { Request, Response } from "express";
import { createOrder, deleteOrder, getOrder } from "./orders-service.js";
import { ValidationError } from "./validation.js";

export async function createOrderHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await createOrder(req.body);

    if ("rejected" in result) {
      res.status(400).json({ error: result.reason });
      return;
    }

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(422).json({ error: error.message, field: error.field });
      return;
    }

    res.status(500).json({ error: "internal error" });
  }
}

export async function getOrderHandler(req: Request, res: Response): Promise<void> {
  const order = await getOrder(req.params.id);

  if (!order) {
    res.status(404).json({ error: "not found" });
    return;
  }

  res.json(order);
}

export async function deleteOrderHandler(req: Request, res: Response): Promise<void> {
  await deleteOrder(req.params.id);
  res.status(204).send();
}
