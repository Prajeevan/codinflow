import ts from "typescript";
import type { AnalysisContext } from "../extract.js";
import { HTTP_METHODS, addRouteNode, linkHandler, resolveHandlerId } from "./shared.js";

const METHODS = new Set<string>(HTTP_METHODS);

/**
 * Hono adapter.
 *
 * Detects `app.<method>('/path', ...handlers)` and `app.on('METHOD', '/path', h)`
 * on a Hono app/router, mirroring the Express adapter's route shape. Route
 * grouping via `app.route('/prefix', sub)` (prefix composition) is not resolved
 * yet — each sub-route still lists under its own literal path.
 */
export function extractHonoRoutes(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  if (!context.frameworks.includes("Hono") || !usesHono(sourceFile)) return;

  const relativePath = context.relativePath(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const receiver = node.expression.expression;

      if (isHonoReceiver(context, receiver)) {
        if (METHODS.has(method)) {
          declareRoute(context, node, method.toUpperCase(), node.arguments[0], node.arguments.slice(1), applicationId, relativePath);
        } else if (method === "on") {
          // app.on('GET' | ['GET','POST'], '/path', handler)
          const [methodArg, pathArg, ...handlers] = node.arguments;
          for (const verb of literalMethods(methodArg)) {
            declareRoute(context, node, verb, pathArg, handlers, applicationId, relativePath);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
}

function declareRoute(
  context: AnalysisContext,
  node: ts.CallExpression,
  httpMethod: string,
  pathArgument: ts.Expression | undefined,
  handlerArgs: ts.Expression[],
  applicationId: string,
  filePath: string,
): void {
  if (!pathArgument || !ts.isStringLiteralLike(pathArgument)) return;
  const routePath = pathArgument.text || "/";
  const method = httpMethod === "ALL" ? "ALL" : httpMethod;

  const routeId = addRouteNode(context, {
    applicationId,
    framework: "Hono",
    frameworkRole: "hono-route",
    httpMethod: method,
    routePath,
    filePath,
    routeType: "api",
    source: node,
    confidence: 0.95,
  });

  for (const argument of handlerArgs) {
    const handlerId = resolveHandlerId(context, argument);
    if (handlerId) linkHandler(context, routeId, handlerId, "hono-handler", `${method} ${routePath}`);
  }
}

function literalMethods(argument: ts.Expression | undefined): string[] {
  if (!argument) return [];
  if (ts.isStringLiteralLike(argument)) return [argument.text.toUpperCase()];
  if (ts.isArrayLiteralExpression(argument)) {
    return argument.elements.filter(ts.isStringLiteralLike).map((element) => element.text.toUpperCase());
  }
  return [];
}

function usesHono(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === "hono" || statement.moduleSpecifier.text.startsWith("hono/")),
  );
}

/** Confirms the receiver is a Hono app/router via its name or resolved type. */
function isHonoReceiver(context: AnalysisContext, expression: ts.Expression): boolean {
  const text = expression.getText(expression.getSourceFile());
  if (/^(app|router|api|hono)$/i.test(text)) return true;
  const type = context.checker.getTypeAtLocation(expression);
  return /\bHono\b/.test(context.checker.typeToString(type));
}
