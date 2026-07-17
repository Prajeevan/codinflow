import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, GraphSnapshot } from "@codinflow/graph-schema";
import { analyzeRepository } from "../src/extract.js";

const fixtureRoot = path.resolve(fileURLToPath(new URL("../../../fixtures/express-api", import.meta.url)));

let graph: GraphSnapshot;

const nodeNamed = (name: string): GraphNode | undefined => graph.nodes.find((n) => n.name === name);

const edgeBetween = (fromName: string, toName: string): GraphEdge | undefined => {
  const from = nodeNamed(fromName);
  const to = nodeNamed(toName);
  if (!from || !to) return undefined;
  return graph.edges.find((e) => e.sourceNodeId === from.id && e.targetNodeId === to.id);
};

beforeAll(() => {
  graph = analyzeRepository({
    rootDir: fixtureRoot,
    repositoryId: "fixture-express",
    commitSha: "fixture0",
  });
});

describe("framework detection", () => {
  it("detects Express from package.json", () => {
    expect(graph.frameworks.map((f) => f.name)).toContain("Express");
  });

  it("identifies the entry point", () => {
    expect(graph.entryPoints).toContain("src/index.ts");
  });
});

describe("route extraction", () => {
  it("extracts every declared route", () => {
    const routes = graph.nodes.filter((n) => n.kind === "route").map((n) => n.name).sort();
    expect(routes).toEqual(["GET /api/orders/:id", "GET /health", "POST /api/orders"]);
  });

  it("links a route to the handler the checker resolves", () => {
    const edge = edgeBetween("POST /api/orders", "createOrderHandler");
    expect(edge?.kind).toBe("routes_to");
  });

  it("records middleware as running before routes", () => {
    const edge = edgeBetween("authenticate", "POST /api/orders");
    expect(edge?.kind).toBe("runs_before");
  });

  it("tags the authentication middleware", () => {
    expect(nodeNamed("authenticate")?.tags).toContain("middleware");
  });
});

describe("call graph", () => {
  it("resolves cross-file calls through imports", () => {
    expect(edgeBetween("createOrderRecord", "normalizeOrder")?.kind).toBe("awaits");
    expect(edgeBetween("normalizeOrder", "fetchShopifyOrder")?.kind).toBe("awaits");
  });

  it("resolves every call site in the fixture", () => {
    expect(graph.stats.resolvedCallRatio).toBe(1);
  });

  it("reports no function as dynamically unresolved", () => {
    const unresolved = graph.nodes.filter((n) => n.tags.includes("unresolved-dynamic-call"));
    expect(unresolved).toEqual([]);
  });
});

describe("conditional execution", () => {
  it("labels the invalid-order branch and keeps the verbatim condition", () => {
    const edge = edgeBetween("createOrder", "rejectOrder");
    expect(edge?.condition).toBe("!isValidShopifyOrder(order)");
    expect(edge?.label).toBe("if not is valid shopify order");
    expect(edge?.metadata.conditional).toBe(true);
  });

  it("keeps a source location on the conditional edge", () => {
    const edge = edgeBetween("createOrder", "rejectOrder");
    expect(edge?.sourceLocation?.filePath).toBe("src/orders-service.ts");
    expect(edge?.sourceLocation?.line).toBeGreaterThan(0);
  });
});

describe("dependency boundaries", () => {
  it("collapses third-party packages instead of exposing internals", () => {
    const external = graph.nodes.filter((n) => !n.applicationOwned).map((n) => n.name).sort();
    expect(external).toEqual(["Express Router", "PostgreSQL", "Shopify Admin API"]);
  });

  it("never creates nodes for package internals", () => {
    expect(graph.nodes.some((n) => n.filePath?.includes("node_modules"))).toBe(false);
  });

  it("resolves a templated URL to a known service", () => {
    expect(edgeBetween("fetchShopifyOrder", "Shopify Admin API")?.kind).toBe("calls");
  });

  it("classifies a database write from its SQL", () => {
    expect(edgeBetween("insertOrder", "PostgreSQL")?.kind).toBe("writes");
    expect(nodeNamed("insertOrder")?.tags).toContain("writes-database");
  });

  it("classifies a database read from its SQL", () => {
    expect(edgeBetween("findOrderById", "PostgreSQL")?.kind).toBe("reads");
    expect(nodeNamed("findOrderById")?.tags).toContain("reads-database");
  });

  it("does not report framework calls as external API calls", () => {
    expect(nodeNamed("createOrderHandler")?.tags).not.toContain("calls-external-api");
    expect(nodeNamed("fetchShopifyOrder")?.tags).toContain("calls-external-api");
  });
});

describe("errors and environment", () => {
  it("extracts thrown error types", () => {
    expect(edgeBetween("assertValidOrder", "ValidationError")?.kind).toBe("throws");
  });

  it("extracts environment variable reads", () => {
    expect(edgeBetween("fetchShopifyOrder", "SHOPIFY_ACCESS_TOKEN")?.kind).toBe("reads");
    expect(nodeNamed("fetchShopifyOrder")?.tags).toContain("uses-env-var");
  });
});

describe("traceability", () => {
  it("gives every node provenance and a confidence score", () => {
    for (const node of graph.nodes) {
      expect(node.provenance.analyzer).toBe("analyzer-js-ts");
      expect(node.provenance.evidenceType).toBeDefined();
      expect(node.analysisConfidence).toBeGreaterThan(0);
    }
  });

  it("gives every application-owned symbol a source range", () => {
    const symbols = graph.nodes.filter((n) => ["function", "method", "class"].includes(n.kind));
    for (const symbol of symbols) {
      expect(symbol.source?.startLine).toBeGreaterThan(0);
      expect(symbol.filePath).toBeTruthy();
    }
  });

  it("never marks a deterministic relationship as AI-generated", () => {
    expect(graph.edges.some((e) => e.provenance.evidenceType === "ai_generated")).toBe(false);
  });
});

describe("stable symbol identity", () => {
  it("produces identical ids across runs of the same source", () => {
    const second = analyzeRepository({
      rootDir: fixtureRoot,
      repositoryId: "fixture-express",
      commitSha: "fixture0",
    });
    expect(second.nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  });

  it("does not encode line numbers into ids", () => {
    const before = nodeNamed("createOrder")!.id;
    const withDifferentCommit = analyzeRepository({
      rootDir: fixtureRoot,
      repositoryId: "fixture-express",
      commitSha: "someothersha",
    });
    expect(withDifferentCommit.nodes.find((n) => n.name === "createOrder")?.id).toBe(before);
  });
});
