export interface ShopifyOrder {
  id: string;
  email: string;
  total_price: string;
  financial_status: string;
}

const SHOPIFY_BASE = "https://myshop.myshopify.com/admin/api/2024-10";

export async function fetchShopifyOrder(shopifyOrderId: string): Promise<ShopifyOrder> {
  const response = await fetch(`${SHOPIFY_BASE}/orders/${shopifyOrderId}.json`, {
    headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN ?? "" },
  });

  if (!response.ok) {
    throw new Error(`Shopify order lookup failed: ${response.status}`);
  }

  const body = (await response.json()) as { order: ShopifyOrder };
  return body.order;
}
