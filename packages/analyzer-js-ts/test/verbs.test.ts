import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@codinflow/graph-schema";
import { analyzeRepository } from "../src/extract.js";
import { buildMap } from "../src/map.js";
import { buildImpact } from "../src/impact.js";
import { buildTrace, findRouteNodes } from "../src/trace.js";
import { buildReport, findSymbols } from "../src/query.js";

const fixtureRoot = path.resolve(fileURLToPath(new URL("../../../fixtures/express-api", import.meta.url)));

let graph: GraphSnapshot;

beforeAll(() => {
  graph = analyzeRepository({ rootDir: fixtureRoot, repositoryId: "fixture-express", commitSha: "fixture0" });
});

describe("map", () => {
  it("groups routes by framework with resolved handlers", () => {
    const map = buildMap(graph);
    const express = map.routesByFramework["Express"];
    expect(express?.map((route) => route.name).sort()).toEqual(["GET /api/orders/:id", "GET /health", "POST /api/orders"]);
    expect(express?.find((route) => route.name === "POST /api/orders")?.handler).toBe("createOrderHandler");
  });

  it("surfaces external systems and env vars", () => {
    const map = buildMap(graph);
    expect(map.externalSystems.map((system) => system.name)).toContain("PostgreSQL");
    expect(map.environmentVariables).toContain("DATABASE_URL");
  });

  it("marks file traits from symbol tags", () => {
    const map = buildMap(graph);
    const db = map.files.find((file) => file.path === "src/db.ts");
    expect(db?.traits).toContain("writes db");
  });
});

describe("impact", () => {
  it("walks transitive callers up to the route", () => {
    const [insertOrder] = findSymbols(graph, "insertOrder");
    const report = buildImpact(graph, insertOrder!);
    expect(report.callers.map((caller) => caller.name)).toContain("createOrderHandler");
    expect(report.affectedRoutes.map((route) => route.name)).toEqual(["POST /api/orders"]);
  });

  it("treats middleware impact as downstream: the routes it guards", () => {
    const [authenticate] = findSymbols(graph, "authenticate");
    const report = buildImpact(graph, authenticate!);
    expect(report.affectedRoutes.map((route) => route.name).sort()).toEqual([
      "GET /api/orders/:id",
      "GET /health",
      "POST /api/orders",
    ]);
    // All three routes are direct: middleware is one runs_before hop away.
    expect(report.callers.every((caller) => caller.kind !== "route" || caller.depth === 1)).toBe(true);
  });

  it("does NOT claim middleware is affected by a change below the route", () => {
    const [insertOrder] = findSymbols(graph, "insertOrder");
    const report = buildImpact(graph, insertOrder!);
    expect(report.callers.map((caller) => caller.name)).not.toContain("authenticate");
  });

  it("lists importing files as type invalidation", () => {
    const [insertOrder] = findSymbols(graph, "insertOrder");
    const report = buildImpact(graph, insertOrder!);
    expect(report.importers).toContain("src/orders-service.ts");
  });
});

describe("trace", () => {
  it("finds a route by method+path, path, or fragment", () => {
    expect(findRouteNodes(graph, "POST /api/orders")).toHaveLength(1);
    expect(findRouteNodes(graph, "/api/orders")).toHaveLength(1);
    expect(findRouteNodes(graph, "orders").length).toBeGreaterThanOrEqual(2);
  });

  it("orders middleware before the handler and collects touches", () => {
    const [route] = findRouteNodes(graph, "POST /api/orders");
    const trace = buildTrace(graph, route!);
    expect(trace.middleware.map((middleware) => middleware.name)).toEqual(["authenticate"]);
    expect(trace.touches.writes.some((entry) => entry.startsWith("PostgreSQL"))).toBe(true);
    expect(trace.touches.external.some((entry) => entry.startsWith("Shopify Admin API"))).toBe(true);
  });

  it("keeps guards on conditional steps in the tree", () => {
    const [route] = findRouteNodes(graph, "POST /api/orders");
    const trace = buildTrace(graph, route!);
    const flat: string[] = [];
    const walk = (steps: typeof trace.steps): void => {
      for (const step of steps) {
        if (step.guard) flat.push(`${step.guard} ${step.name}`);
        walk(step.children);
      }
    };
    walk(trace.steps);
    expect(flat.some((entry) => entry.includes("isValidShopifyOrder") && entry.includes("rejectOrder"))).toBe(true);
  });
});

describe("caller-side guards in query reports", () => {
  it("shows the verbatim guard on a conditional caller", () => {
    const [rejectOrder] = findSymbols(graph, "rejectOrder");
    const report = buildReport(graph, rejectOrder!, ["usedBy"]);
    const callers = report.usedBy!.flatMap((group) => group.callers);
    const guarded = callers.find((caller) => caller.name === "createOrder");
    expect(guarded?.guard).toBe("if (!isValidShopifyOrder(order))");
  });
});
