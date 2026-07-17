/**
 * Dependency boundaries (BRIEF §4).
 *
 * Third-party packages collapse into a single named semantic node rather than
 * exposing their internals. Anything not listed here still collapses — it just
 * gets the package name as its label.
 */
import type { NodeKind } from "@codinflow/graph-schema";

export interface BoundaryDefinition {
  /** Package name or URL host that identifies this boundary. */
  match: string;
  label: string;
  kind: NodeKind;
  /**
   * A framework the app runs *inside*, rather than a service it reaches out to.
   * Calls into these must not be reported as external API calls.
   */
  framework?: boolean;
}

export const DEPENDENCY_BOUNDARIES: BoundaryDefinition[] = [
  { match: "express", label: "Express Router", kind: "module", framework: true },
  { match: "hono", label: "Hono Router", kind: "module", framework: true },
  { match: "fastify", label: "Fastify", kind: "module", framework: true },
  { match: "react", label: "React", kind: "module", framework: true },
  { match: "next", label: "Next.js", kind: "module", framework: true },
  { match: "pg", label: "PostgreSQL", kind: "database" },
  { match: "postgres", label: "PostgreSQL", kind: "database" },
  { match: "mysql2", label: "MySQL", kind: "database" },
  { match: "ioredis", label: "Redis", kind: "database" },
  { match: "redis", label: "Redis", kind: "database" },
  { match: "mongodb", label: "MongoDB", kind: "database" },
  { match: "@prisma/client", label: "Prisma", kind: "database" },
  { match: "drizzle-orm", label: "Drizzle ORM", kind: "database" },
  { match: "stripe", label: "Stripe API", kind: "external_api" },
  { match: "@shopify/shopify-api", label: "Shopify Admin API", kind: "external_api" },
  { match: "myshopify.com", label: "Shopify Admin API", kind: "external_api" },
  { match: "api.stripe.com", label: "Stripe API", kind: "external_api" },
  { match: "resend", label: "Email Provider", kind: "external_api" },
  { match: "nodemailer", label: "Email Provider", kind: "external_api" },
  { match: "@aws-sdk/client-sqs", label: "Message Queue", kind: "queue" },
];

export function resolveBoundary(specifier: string): BoundaryDefinition | undefined {
  const name = normalizePackageName(specifier);
  return DEPENDENCY_BOUNDARIES.find((boundary) => name === boundary.match || name.startsWith(`${boundary.match}/`));
}

/**
 * Maps a module specifier or a file path inside node_modules to a package name.
 *
 * Handles two things that bite in practice: pnpm's virtual store nests a second
 * node_modules (so the *last* segment is the real package), and a `@types/x`
 * declaration file stands in for the runtime package `x`.
 */
export function normalizePackageName(specifier: string): string {
  let name = specifier;

  const lastNodeModules = name.lastIndexOf("node_modules/");
  if (lastNodeModules !== -1) {
    const after = name.slice(lastNodeModules + "node_modules/".length);
    const match = after.match(/^((?:@[^/]+\/)?[^/]+)/);
    name = match?.[1] ?? after;
  }

  if (name.startsWith("@types/")) {
    const bare = name.slice("@types/".length);
    // @types/foo__bar is the DefinitelyTyped encoding of @foo/bar.
    name = bare.includes("__") ? `@${bare.replace("__", "/")}` : bare;
  }

  return name;
}

export function resolveBoundaryForUrl(url: string): BoundaryDefinition | undefined {
  return DEPENDENCY_BOUNDARIES.find((boundary) => url.includes(boundary.match));
}

const SQL_WRITE = /^\s*(insert|update|delete|upsert|merge|replace|create|drop|alter|truncate)\b/i;
// No trailing \b: method names are camelCase, so `insertOne` must still match.
const METHOD_WRITE = /\b(insert|update|delete|upsert|create|save|put|set|add|remove|destroy)/i;

/**
 * Decides read vs write for a database call.
 *
 * A SQL string is authoritative when present — matching on the surrounding call
 * text alone misclassifies (a SELECT whose column list happens to contain the
 * word "update", for instance). Falls back to the method name otherwise.
 */
export function isDatabaseWrite(callText: string, sqlText?: string): boolean {
  if (sqlText) return SQL_WRITE.test(sqlText);
  return METHOD_WRITE.test(callText);
}
