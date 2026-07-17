import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export interface OrderRecord {
  id: string;
  customerEmail: string;
  totalCents: number;
  shopifyOrderId: string;
}

export async function insertOrder(order: OrderRecord): Promise<OrderRecord> {
  const result = await pool.query(
    "INSERT INTO orders (id, customer_email, total_cents, shopify_order_id) VALUES ($1, $2, $3, $4) RETURNING *",
    [order.id, order.customerEmail, order.totalCents, order.shopifyOrderId],
  );
  return result.rows[0] as OrderRecord;
}

export async function findOrderById(id: string): Promise<OrderRecord | null> {
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
  return (result.rows[0] as OrderRecord) ?? null;
}

export async function findUserByToken(token: string): Promise<{ id: string } | null> {
  const result = await pool.query("SELECT id FROM users WHERE api_token = $1", [token]);
  return (result.rows[0] as { id: string }) ?? null;
}

export async function removeOrder(id: string): Promise<void> {
  await pool.query("DELETE FROM orders WHERE id = $1", [id]);
}
