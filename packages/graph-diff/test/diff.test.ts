import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRepository } from "@codinflow/analyzer-js-ts";
import type { GraphSnapshot } from "@codinflow/graph-schema";
import { diffSnapshots, type GraphDiff } from "../src/index.js";

const root = (name: string) => path.resolve(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)));

let diff: GraphDiff;
let base: GraphSnapshot;

beforeAll(() => {
  base = analyzeRepository({ rootDir: root("express-api"), repositoryId: "fixture-express", commitSha: "fixture0" });
  const head = analyzeRepository({
    rootDir: root("express-api-v2"),
    repositoryId: "fixture-express",
    commitSha: "fixture1",
  });
  diff = diffSnapshots(base, head);
});

const kinds = (kind: string) => diff.changes.filter((change) => change.kind === kind);

describe("authentication changes", () => {
  it("classifies removed auth middleware as an authentication change", () => {
    const auth = kinds("authentication_changed").filter((change) => change.removed);
    expect(auth).toHaveLength(3);
  });

  it("leads the summary with the authentication removal", () => {
    expect(diff.summary).toMatch(/^Removes authentication from 3 routes/);
  });

  it("rates the commit high risk", () => {
    expect(diff.riskLevel).toBe("high");
  });
});

describe("behavioural change classification", () => {
  it("detects the added route", () => {
    expect(kinds("route_added").map((change) => change.name)).toEqual(["DELETE /api/orders/:id"]);
  });

  it("detects the added database write", () => {
    expect(kinds("database_write_added")).toHaveLength(1);
  });

  it("detects the changed signature", () => {
    expect(kinds("node_signature_changed").map((change) => change.name)).toContain("createOrder");
  });

  it("detects added functions", () => {
    const added = kinds("node_added").map((change) => change.name);
    expect(added).toEqual(expect.arrayContaining(["removeOrder", "deleteOrder", "deleteOrderHandler"]));
  });

  it("does not report unchanged symbols as changed", () => {
    const changed = kinds("node_implementation_changed").map((change) => change.name);
    expect(changed).not.toContain("findOrderById");
    expect(changed).not.toContain("insertOrder");
  });
});

describe("evidence", () => {
  it("gives every change a source location where one exists", () => {
    const located = diff.changes.filter((change) => change.filePath);
    expect(located.length).toBeGreaterThan(0);
    for (const change of located) {
      expect(change.line).toBeGreaterThan(0);
    }
  });

  it("mentions nothing in the summary that is not a classified change", () => {
    // Every claim in the summary must trace to a change record.
    if (diff.summary.includes("route")) expect(kinds("route_added").length + kinds("route_removed").length).toBeGreaterThan(0);
    if (diff.summary.includes("database write")) expect(kinds("database_write_added").length).toBeGreaterThan(0);
  });
});

describe("blast radius", () => {
  it("reports the caller of a changed function as directly affected", () => {
    const entry = diff.blastRadius.find((item) => item.name === "createOrderHandler");
    expect(entry?.level).toBe("directly_affected");
  });

  it("grades a second-hop caller lower", () => {
    const route = diff.blastRadius.find((item) => item.name === "POST /api/orders");
    expect(route?.level).toBe("probably_affected");
  });

  it("gives every entry a reason", () => {
    for (const entry of diff.blastRadius) {
      expect(entry.reason).toBeTruthy();
    }
  });
});

describe("stability", () => {
  it("reports no changes when comparing a snapshot with itself", () => {
    const identical = diffSnapshots(base, base);
    expect(identical.changes).toEqual([]);
    expect(identical.summary).toBe("No behavioural changes detected between these commits.");
    expect(identical.riskLevel).toBe("low");
  });
});
