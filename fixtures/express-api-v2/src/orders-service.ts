import { randomUUID } from "node:crypto";
import { insertOrder, findOrderById, removeOrder, type OrderRecord } from "./db.js";
import { fetchShopifyOrder } from "./shopify.js";
import { assertValidOrder, isValidShopifyOrder, type OrderInput } from "./validation.js";

export function rejectOrder(order: OrderInput): { rejected: true; reason: string } {
  return { rejected: true, reason: `order failed validation for ${order.shopifyOrderId ?? "unknown"}` };
}

export async function normalizeOrder(order: OrderInput): Promise<OrderRecord> {
  assertValidOrder(order);

  const shopifyOrder = await fetchShopifyOrder(order.shopifyOrderId!);

  return {
    id: randomUUID(),
    customerEmail: shopifyOrder.email,
    totalCents: Math.round(Number(shopifyOrder.total_price) * 100),
    shopifyOrderId: shopifyOrder.id,
  };
}

export async function createOrderRecord(order: OrderInput): Promise<OrderRecord> {
  const normalized = await normalizeOrder(order);
  return insertOrder(normalized);
}

export async function createOrder(order: OrderInput) {
  if (!isValidShopifyOrder(order)) {
    // Behaviour change: invalid orders are no longer rejected outright.
    return createOrderRecord(order);
  }

  return createOrderRecord(order);
}

export async function deleteOrder(id: string): Promise<void> {
  await removeOrder(id);
}

export async function getOrder(id: string): Promise<OrderRecord | null> {
  return findOrderById(id);
}
