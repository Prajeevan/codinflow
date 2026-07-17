import ts from "typescript";
import { TAGS } from "@codinflow/graph-schema";
import type { AnalysisContext } from "../extract.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all"];

/**
 * Express adapter (BRIEF §8).
 *
 * Detects `app.<method>(path, ...handlers)` and `router.<method>(...)`, plus
 * `app.use(...)` middleware, and links each route to the handler the type
 * checker resolves it to. Middleware registered before a route is connected with
 * `runs_before`, preserving Express's ordering semantics.
 */
export function extractExpressRoutes(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  if (!usesExpress(sourceFile)) return;

  const relativePath = context.relativePath(sourceFile);
  const middlewareIds: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const receiver = node.expression.expression.getText(sourceFile);

      if (!isExpressReceiver(context, node.expression.expression, receiver)) {
        ts.forEachChild(node, visit);
        return;
      }

      if (method === "use") {
        for (const handlerId of resolveHandlers(context, node.arguments)) {
          const handler = context.nodes.get(handlerId);
          if (handler) {
            pushTag(handler, TAGS.MIDDLEWARE);
            handler.frameworkRole = "express-middleware";
            handler.zoomLevel = 2;
          }
          middlewareIds.push(handlerId);
          context.addEdge({
            sourceNodeId: applicationId,
            targetNodeId: handlerId,
            kind: "runs_before",
            label: "registered as middleware",
            analysisConfidence: 0.9,
            provenance: context.provenance("framework_inferred"),
            sourceLocation: locationOf(context, node),
            metadata: { framework: "express", order: middlewareIds.length },
          });
        }
      }

      if (HTTP_METHODS.includes(method)) {
        const pathArgument = node.arguments[0];
        if (pathArgument && ts.isStringLiteral(pathArgument)) {
          declareRoute(context, node, method, pathArgument.text, applicationId, middlewareIds, relativePath);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
}

function usesExpress(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === "express" || statement.moduleSpecifier.text.startsWith("express/")),
  );
}

/** Confirms the receiver is an Express app/router via its resolved type. */
function isExpressReceiver(context: AnalysisContext, expression: ts.Expression, text: string): boolean {
  if (/^(app|router|server)$/i.test(text)) return true;

  const type = context.checker.getTypeAtLocation(expression);
  const typeName = context.checker.typeToString(type);
  return /\b(Express|Application|Router|IRouter)\b/.test(typeName);
}

function declareRoute(
  context: AnalysisContext,
  node: ts.CallExpression,
  method: string,
  routePath: string,
  applicationId: string,
  middlewareIds: string[],
  relativePath: string,
): void {
  const httpMethod = method === "all" ? "ALL" : method.toUpperCase();
  const name = `${httpMethod} ${routePath}`;
  const routeId = `${context.options.repositoryId}:route:${httpMethod}:${routePath}`;

  context.addNode({
    id: routeId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language: "typescript",
    kind: "route",
    name,
    qualifiedName: name,
    parentId: applicationId,
    filePath: relativePath,
    source: context.rangeOf(node),
    tags: [TAGS.ROUTE_HANDLER],
    visibility: "public",
    frameworkRole: "express-route",
    analysisConfidence: 0.95,
    provenance: context.provenance("framework_inferred"),
    zoomLevel: 2,
    applicationOwned: true,
    metadata: { framework: "Express", httpMethod, path: routePath, routeType: "api" },
  });

  const handlerIds = resolveHandlers(context, node.arguments.slice(1));

  for (const middlewareId of middlewareIds) {
    context.addEdge({
      sourceNodeId: middlewareId,
      targetNodeId: routeId,
      kind: "runs_before",
      label: "middleware runs before route",
      analysisConfidence: 0.85,
      provenance: context.provenance("framework_inferred"),
      sourceLocation: locationOf(context, node),
      metadata: { framework: "express" },
    });
  }

  for (const handlerId of handlerIds) {
    const handler = context.nodes.get(handlerId);
    if (handler) {
      pushTag(handler, TAGS.ROUTE_HANDLER);
      handler.frameworkRole = "express-handler";
      handler.zoomLevel = 3;
    }

    context.addEdge({
      sourceNodeId: routeId,
      targetNodeId: handlerId,
      kind: "routes_to",
      label: `handles ${name}`,
      analysisConfidence: 0.95,
      provenance: context.provenance("framework_inferred"),
      sourceLocation: locationOf(context, node),
      metadata: { framework: "express" },
    });
  }
}

function resolveHandlers(context: AnalysisContext, args: readonly ts.Expression[] | ts.NodeArray<ts.Expression>): string[] {
  const ids: string[] = [];

  for (const argument of args) {
    if (ts.isStringLiteral(argument)) continue;

    let symbol = context.checker.getSymbolAtLocation(argument);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = context.checker.getAliasedSymbol(symbol);
      } catch {
        /* keep the local symbol */
      }
    }

    for (const declaration of symbol?.declarations ?? []) {
      const id =
        context.declarationIds.get(declaration) ??
        (ts.isVariableDeclaration(declaration) && declaration.initializer
          ? context.declarationIds.get(declaration.initializer)
          : undefined);
      if (id) ids.push(id);
    }
  }

  return ids;
}

function locationOf(context: AnalysisContext, node: ts.Node) {
  const range = context.rangeOf(node);
  return {
    filePath: context.relativePath(node.getSourceFile()),
    line: range.startLine,
    column: range.startColumn,
  };
}

function pushTag(node: { tags: string[] }, tag: string): void {
  if (!node.tags.includes(tag)) node.tags.push(tag);
}
