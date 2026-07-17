import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { GraphNode, GraphSnapshot } from "@codinflow/graph-schema";
import { analyzeRepository } from "../src/extract.js";

/**
 * One fixture repository whose package.json declares Next.js, SvelteKit, Hono,
 * Fastify and TanStack Router, laid out with each framework's real routing
 * conventions — including the cases that bit against live repos: route groups,
 * catch-all params, private folders, monorepo-style paths and Fastify's object
 * route form. Guards the five route extractors against regression.
 */
const fixtureRoot = path.resolve(fileURLToPath(new URL("../../../fixtures/multi-framework", import.meta.url)));

let graph: GraphSnapshot;

const routes = (): GraphNode[] => graph.nodes.filter((node) => node.kind === "route");

/** The set of "METHOD path" strings the analyzer produced. */
const routeSet = (): Set<string> =>
  new Set(routes().map((node) => `${node.metadata.httpMethod} ${node.metadata.path}`));

const routeByPath = (method: string, routePath: string): GraphNode | undefined =>
  routes().find((node) => node.metadata.httpMethod === method && node.metadata.path === routePath);

beforeAll(() => {
  graph = analyzeRepository({
    rootDir: fixtureRoot,
    repositoryId: "fixture-multi",
    commitSha: "fixture0",
  });
});

describe("framework detection", () => {
  it("detects every declared framework", () => {
    const names = graph.frameworks.map((framework) => framework.name);
    for (const expected of ["Next.js", "SvelteKit", "Hono", "Fastify", "TanStack Router"]) {
      expect(names).toContain(expected);
    }
  });
});

describe("Next.js routes", () => {
  it("emits one API route per exported HTTP method", () => {
    expect(routeSet()).toContain("GET /users/:id");
    expect(routeSet()).toContain("POST /users/:id");
  });

  it("maps app-router pages, catch-all params and strips route groups", () => {
    expect(routeSet()).toContain("PAGE /blog/*"); // [...slug] catch-all
    expect(routeSet()).toContain("PAGE /about"); // (marketing) group stripped
  });

  it("skips private folders", () => {
    // app/_private/page.tsx must not become a route.
    expect([...routeSet()].some((route) => route.includes("_private"))).toBe(false);
  });

  it("maps the pages router, including pages/api with an ANY method", () => {
    expect(routeSet()).toContain("ANY /hello");
    expect(routeSet()).toContain("PAGE /posts/:slug");
  });

  it("tags Next routes with the capitalized framework name", () => {
    expect(routeByPath("GET", "/users/:id")?.metadata.framework).toBe("Next.js");
  });
});

describe("SvelteKit routes", () => {
  it("emits one endpoint route per exported method and strips route groups", () => {
    expect(routeSet()).toContain("GET /blog/:slug");
    expect(routeSet()).toContain("DELETE /blog/:slug");
    expect(routeSet()).toContain("PAGE /dashboard"); // (app) group stripped
  });
});

describe("Hono routes", () => {
  it("reads app.<method>(path, handler) calls", () => {
    expect(routeSet()).toContain("GET /hono/health");
    expect(routeSet()).toContain("POST /hono/items");
  });
});

describe("Fastify routes", () => {
  it("reads the shorthand and object route forms, expanding method arrays", () => {
    expect(routeSet()).toContain("GET /fast/ping");
    expect(routeSet()).toContain("GET /fast/multi");
    expect(routeSet()).toContain("POST /fast/multi");
  });
});

describe("TanStack routes", () => {
  it("reads the path from createFileRoute()", () => {
    expect(routeSet()).toContain("PAGE /tan/dashboard");
  });
});

describe("handler linking", () => {
  it("links resolvable handlers to their route with routes_to edges", () => {
    const route = routeByPath("GET", "/hono/health");
    expect(route).toBeDefined();
    const linked = graph.edges.some((edge) => edge.sourceNodeId === route!.id && edge.kind === "routes_to");
    expect(linked).toBe(true);
  });
});
