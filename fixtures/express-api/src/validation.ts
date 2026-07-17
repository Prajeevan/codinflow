export interface OrderInput {
  customerEmail?: string;
  totalCents?: number;
  shopifyOrderId?: string;
}

export class ValidationError extends Error {
  constructor(public readonly field: string) {
    super(`invalid field: ${field}`);
    this.name = "ValidationError";
  }
}

export function isValidShopifyOrder(order: OrderInput): boolean {
  if (!order.customerEmail || !order.customerEmail.includes("@")) {
    return false;
  }

  if (typeof order.totalCents !== "number" || order.totalCents <= 0) {
    return false;
  }

  return Boolean(order.shopifyOrderId);
}

export function assertValidOrder(order: OrderInput): void {
  if (!isValidShopifyOrder(order)) {
    throw new ValidationError("order");
  }
}
