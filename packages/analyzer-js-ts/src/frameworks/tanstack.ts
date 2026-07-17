import ts from "typescript";
import type { AnalysisContext } from "../extract.js";
import { addRouteNode, linkHandler, resolveHandlerId } from "./shared.js";

/**
 * TanStack Router / Start adapter.
 *
 * File-based routes are declared in code via `createFileRoute('/path')(...)`,
 * and code-based routes via `createRoute({ path, component })`. The route path is
 * read from the call's string argument (more reliable than inferring it from the
 * filename), and `createRootRoute()` maps to `/`. Covers both TanStack Router and
 * TanStack Start, which share these factories.
 */
export function extractTanStackRoutes(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  if (!context.frameworks.includes("TanStack Router") && !context.frameworks.includes("TanStack Start")) return;
  if (!usesTanStack(sourceFile)) return;

  const relativePath = context.relativePath(sourceFile);
  const framework = context.frameworks.includes("TanStack Start") ? "TanStack Start" : "TanStack Router";

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const factory = node.expression.text;

      if (factory === "createRootRoute") {
        declare(context, node, "/", node.arguments[0], applicationId, relativePath, framework);
      } else if (factory === "createFileRoute") {
        const routePath = literalPath(node.arguments[0]);
        // createFileRoute('/path')({ component }) — the options are the next call.
        if (routePath !== undefined) {
          const options = ts.isCallExpression(node.parent) ? node.parent.arguments[0] : undefined;
          declare(context, node, routePath, options, applicationId, relativePath, framework);
        }
      } else if (factory === "createRoute") {
        const options = node.arguments[0];
        const routePath = options && ts.isObjectLiteralExpression(options) ? stringProperty(options, "path") : undefined;
        if (routePath !== undefined) declare(context, node, routePath, options, applicationId, relativePath, framework);
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
}

function declare(
  context: AnalysisContext,
  node: ts.CallExpression,
  routePath: string,
  options: ts.Expression | undefined,
  applicationId: string,
  filePath: string,
  framework: string,
): void {
  const normalized = routePath === "" ? "/" : routePath;
  const routeId = addRouteNode(context, {
    applicationId,
    framework,
    frameworkRole: "tanstack-route",
    httpMethod: "PAGE",
    routePath: normalized,
    filePath,
    routeType: "page",
    source: node,
  });

  // Link the route to its `component` when the options object names one.
  if (options && ts.isObjectLiteralExpression(options)) {
    const component = propertyValue(options, "component");
    const handlerId = component ? resolveHandlerId(context, component) : undefined;
    if (handlerId) linkHandler(context, routeId, handlerId, "tanstack-component", `PAGE ${normalized}`);
  }
}

function literalPath(argument: ts.Expression | undefined): string | undefined {
  return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const value = propertyValue(object, name);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function propertyValue(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
      member.name.text === name,
  );
  return property?.initializer;
}

function usesTanStack(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith("@tanstack/"),
  );
}
