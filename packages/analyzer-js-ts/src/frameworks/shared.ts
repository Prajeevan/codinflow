import ts from "typescript";
import { TAGS } from "@codinflow/graph-schema";
import type { AnalysisContext } from "../extract.js";

/** HTTP verbs a route can be defined for. `ALL`/`ANY` mean "any method". */
export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all"] as const;

/** Exported symbol names that name an HTTP handler in file-convention routers. */
export const HTTP_METHOD_EXPORTS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export interface RouteNodeInput {
  applicationId: string;
  framework: string;
  frameworkRole: string;
  /** Upper-case HTTP verb, or a sentinel: `PAGE` (a rendered page) / `ANY`. */
  httpMethod: string;
  routePath: string;
  filePath: string;
  routeType?: "api" | "page";
  source?: ts.Node;
  confidence?: number;
}

/**
 * Declares a `route` node with the exact shape the Express adapter emits, so
 * every framework's routes render, trace and diff identically. Returns the node
 * id (stable across frameworks: `${repo}:route:${METHOD}:${path}`).
 */
export function addRouteNode(context: AnalysisContext, input: RouteNodeInput): string {
  const name = `${input.httpMethod} ${input.routePath}`;
  const routeId = `${context.options.repositoryId}:route:${input.httpMethod}:${input.routePath}`;

  context.addNode({
    id: routeId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language: "typescript",
    kind: "route",
    name,
    qualifiedName: name,
    parentId: input.applicationId,
    filePath: input.filePath,
    source: input.source ? context.rangeOf(input.source) : undefined,
    tags: [TAGS.ROUTE_HANDLER],
    visibility: "public",
    frameworkRole: input.frameworkRole,
    analysisConfidence: input.confidence ?? 0.9,
    provenance: context.provenance("framework_inferred"),
    zoomLevel: 2,
    applicationOwned: true,
    metadata: {
      framework: input.framework,
      httpMethod: input.httpMethod,
      path: input.routePath,
      ...(input.routeType ? { routeType: input.routeType } : {}),
    },
  });

  return routeId;
}

/** Links a route to the handler node it dispatches to, tagging the handler. */
export function linkHandler(
  context: AnalysisContext,
  routeId: string,
  handlerId: string,
  frameworkRole: string,
  routeName: string,
): void {
  const handler = context.nodes.get(handlerId);
  if (handler) {
    if (!handler.tags.includes(TAGS.ROUTE_HANDLER)) handler.tags.push(TAGS.ROUTE_HANDLER);
    handler.frameworkRole = frameworkRole;
  }

  context.addEdge({
    sourceNodeId: routeId,
    targetNodeId: handlerId,
    kind: "routes_to",
    label: `handles ${routeName}`,
    analysisConfidence: 0.9,
    provenance: context.provenance("framework_inferred"),
    metadata: {},
  });
}

/**
 * Resolves a handler expression (an argument, or an exported symbol) to the
 * graph node of the function it names, following import aliases. Mirrors the
 * Express adapter's resolution so handlers declared elsewhere still link.
 */
export function resolveHandlerId(context: AnalysisContext, expression: ts.Expression): string | undefined {
  let symbol = context.checker.getSymbolAtLocation(expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = context.checker.getAliasedSymbol(symbol);
    } catch {
      /* keep the local symbol */
    }
  }

  for (const declaration of symbol?.declarations ?? []) {
    const direct = context.declarationIds.get(declaration);
    if (direct) return direct;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const viaInit = context.declarationIds.get(declaration.initializer);
      if (viaInit) return viaInit;
    }
  }
  return undefined;
}

/**
 * The graph-node id of a function-like declaration in this file, whether it is
 * `export function GET() {}` or `export const GET = () => {}`. Returns undefined
 * when the symbol was never promoted to a node (e.g. an inline object literal).
 */
export function localDeclarationId(context: AnalysisContext, declaration: ts.Node, initializer?: ts.Node): string | undefined {
  return (
    context.declarationIds.get(declaration) ??
    (initializer ? context.declarationIds.get(initializer) : undefined)
  );
}

export interface ExportedHandler {
  /** Upper-case HTTP verb (GET/POST/…). */
  method: string;
  handlerId?: string;
  node: ts.Node;
}

/**
 * The exported HTTP-method handlers of a file-convention route module
 * (`export function GET`, `export const POST = …`). This is how Next.js App
 * Router route handlers and SvelteKit `+server` endpoints declare their methods.
 */
export function exportedHttpHandlers(context: AnalysisContext, sourceFile: ts.SourceFile): ExportedHandler[] {
  const handlers: ExportedHandler[] = [];

  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name && HTTP_METHOD_EXPORTS.has(statement.name.text)) {
      handlers.push({
        method: statement.name.text,
        handlerId: localDeclarationId(context, statement),
        node: statement,
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          HTTP_METHOD_EXPORTS.has(declaration.name.text) &&
          declaration.initializer
        ) {
          handlers.push({
            method: declaration.name.text,
            handlerId: localDeclarationId(context, declaration.initializer, declaration.initializer),
            node: declaration.initializer,
          });
        }
      }
    }
  }

  return handlers;
}

/** The node id of a file's default export, when it resolves to a declared symbol. */
export function defaultExportId(context: AnalysisContext, sourceFile: ts.SourceFile): { id?: string; node: ts.Node } | undefined {
  for (const statement of sourceFile.statements) {
    // `export default function Page() {}`
    if (ts.isFunctionDeclaration(statement) && hasDefaultModifier(statement)) {
      return { id: localDeclarationId(context, statement), node: statement };
    }
    // `export default Foo;`
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const id = ts.isIdentifier(statement.expression)
        ? resolveHandlerId(context, statement.expression)
        : undefined;
      return { id, node: statement.expression };
    }
  }
  return undefined;
}

export function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function hasDefaultModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

/** Splits a repository-relative path into POSIX segments, tolerating Windows separators. */
export function segmentsOf(relativePath: string): string[] {
  return relativePath.split(/[\\/]/).filter(Boolean);
}

/**
 * Rewrites dynamic-route brackets inside one path segment, shared by the file
 * convention adapters (Next.js and SvelteKit use the same `[param]` grammar).
 * Replacement is done *within* the segment, not only when the whole segment is a
 * bracket, so literals mix with params: `@[user]` -> `@:user`, `page-[id]` ->
 * `page-:id`. Catch-all `[...slug]` / `[[...slug]]` collapse to `*`; SvelteKit
 * param matchers `[id=int]` keep just the name.
 */
export function dynamicSegment(segment: string): string {
  return segment
    .replace(/\[\[?\.\.\.[^\]]+?\]?\]/g, "*") // catch-all, optional or not
    .replace(/\[\[([^\]=]+?)(?:=[^\]]*?)?\]\]/g, ":$1") // optional param
    .replace(/\[([^\]=]+?)(?:=[^\]]*?)?\]/g, ":$1"); // required param (drops matcher)
}
