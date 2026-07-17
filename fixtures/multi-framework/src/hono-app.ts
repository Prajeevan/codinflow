import { Hono } from "hono";
const app = new Hono();
function health() { return "ok"; }
app.get("/hono/health", health);
app.post("/hono/items", (c) => c.json({}));
