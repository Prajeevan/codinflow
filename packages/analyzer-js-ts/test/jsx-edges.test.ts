import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@codinflow/graph-schema";
import { analyzeRepository } from "../src/extract.js";
import { buildReport, findSymbols } from "../src/query.js";
import { buildImpact } from "../src/impact.js";

const fixtureRoot = path.resolve(fileURLToPath(new URL("../../../fixtures/jsx-app", import.meta.url)));

let graph: GraphSnapshot;
const report = (name: string, outputs: Parameters<typeof buildReport>[2]) =>
  buildReport(graph, findSymbols(graph, name)[0]!, outputs);

beforeAll(() => {
  graph = analyzeRepository({ rootDir: fixtureRoot, repositoryId: "jsx-app", commitSha: "test" });
});

// Regression checks from the TanStack-repo bug report (Defects 1-3).

describe("JSX renders are edges (Defect 1)", () => {
  it("check 1: A renders imported <B/> → B.usedBy ⊇ {A}, A.calls ⊇ {B}", () => {
    const cart = report("CartButton", ["usedBy"]);
    expect(cart.usedBy!.map((g) => g.file)).toContain("src/components/Header.tsx");

    const header = report("Header", ["calls"]);
    expect(header.calls!.map((c) => c.name)).toContain("CartButton");
  });

  it("check 2: a locally-defined component rendered via JSX gets an edge both ways", () => {
    const badge = report("Badge", ["usedBy"]);
    expect(badge.usedBy!.map((g) => g.file)).toContain("src/components/Header.tsx");

    const header = report("Header", ["calls"]);
    expect(header.calls!.map((c) => c.name)).toContain("Badge");
  });

  it("render edges are tagged so they are distinguishable from plain calls", () => {
    const renderEdges = graph.edges.filter((e) => e.metadata?.render === true);
    expect(renderEdges.length).toBeGreaterThan(0);
    expect(renderEdges.every((e) => e.kind === "calls")).toBe(true);
    expect(renderEdges.some((e) => e.label?.startsWith("renders <"))).toBe(true);
  });
});

describe("importedBy reconciles with impact.importers (Defect 3)", () => {
  it("check 3: an export-default component only rendered → describe.importedBy == impact.importers, non-empty", () => {
    const header = report("Header", ["importedBy"]);
    const importedBy = header.importedBy!.map((g) => g.file);
    const importers = buildImpact(graph, findSymbols(graph, "Header")[0]!).importers;

    expect(importedBy.length).toBeGreaterThan(0);
    expect(importedBy).toEqual(importers);
  });

  it("usedBy stays symbol-precise and now carries the render caller", () => {
    const header = report("Header", ["usedBy"]);
    expect(header.usedBy!.map((g) => g.file)).toEqual(["src/routes/__root.tsx"]);
  });
});

describe("component change reports the mounting route (Defect 2)", () => {
  it("check 5: a component mounted under a route appears in impact.affectedRoutes", () => {
    const impact = buildImpact(graph, findSymbols(graph, "Header")[0]!);
    expect(impact.affectedRoutes.map((r) => r.name)).toContain("PAGE /");
  });

  // NOTE: this surfaces the ROOT route Header mounts in, not every leaf route.
  // Child routes mount via <Outlet/>, which is not an edge we model — a correct
  // partial answer, documented so it is not mistaken for "every page".
});

// Defect 4 (anonymous handler call sites collapsing) is intentionally NOT fixed
// in this pass — it is a separate, higher-risk change. See the deferred task.
describe.todo("Defect 4: two anonymous handlers each calling X → two distinct caller entries");
