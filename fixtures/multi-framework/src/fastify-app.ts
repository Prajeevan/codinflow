import Fastify from "fastify";
const fastify = Fastify();
function ping() { return "pong"; }
fastify.get("/fast/ping", ping);
fastify.route({ method: ["GET", "POST"], url: "/fast/multi", handler: ping });
