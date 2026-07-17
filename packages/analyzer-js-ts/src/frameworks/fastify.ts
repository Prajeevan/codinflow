import ts from "typescript";
import type { AnalysisContext } from "../extract.js";
import { HTTP_METHODS, addRouteNode, linkHandler, resolveHandlerId } from "./shared.js";

const METHODS = new Set<string>(HTTP_METHODS);

/**
 * Fastify adapter.
 *
 * Handles both shapes Fastify accepts:
 *   fastify.get('/path', handler)
 *   fastify.route({ method: 'GET' | ['GET','POST'], url: '/path', handler })
 * Route prefixes applied via `register(plugin, { prefix })` are not composed yet
 * — a prefixed route lists under its own literal `url`.
 */
export function extractFastifyRoutes(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  if (!context.frameworks.includes("Fastify") || !usesFastify(sourceFile)) return;

  const relativePath = context.relativePath(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const receiver = node.expression.expression;

      if (isFastifyReceiver(context, receiver)) {
        if (METHODS.has(method)) {
          declareRoute(context, node, method.toUpperCase(), node.arguments[0], node.arguments.slice(1), applicationId, relativePath);
        } else if (method === "route") {
          declareObjectRoute(context, node, node.arguments[0], applicationId, relativePath);
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

  const routeId = addRouteNode(context, {
    applicationId,
    framework: "Fastify",
    frameworkRole: "fastify-route",
    httpMethod,
    routePath,
    filePath,
    routeType: "api",
    source: node,
    confidence: 0.95,
  });

  // The first handler-ish argument is a function or an options object whose
  // `handler` property is the function; resolve either.
  for (const argument of handlerArgs) {
    const handlerId = resolveHandlerId(context, argument) ?? handlerFromOptions(context, argument);
    if (handlerId) linkHandler(context, routeId, handlerId, "fastify-handler", `${httpMethod} ${routePath}`);
  }
}

function declareObjectRoute(
  context: AnalysisContext,
  node: ts.CallExpression,
  optionsArg: ts.Expression | undefined,
  applicationId: string,
  filePath: string,
): void {
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return;

  const url = stringProperty(optionsArg, "url");
  if (!url) return;
  const methods = methodProperty(optionsArg);
  const handlerId = handlerFromOptions(context, optionsArg);

  for (const method of methods) {
    const routeId = addRouteNode(context, {
      applicationId,
      framework: "Fastify",
      frameworkRole: "fastify-route",
      httpMethod: method,
      routePath: url,
      filePath,
      routeType: "api",
      source: node,
      confidence: 0.95,
    });
    if (handlerId) linkHandler(context, routeId, handlerId, "fastify-handler", `${method} ${url}`);
  }
}

function methodProperty(object: ts.ObjectLiteralExpression): string[] {
  const property = object.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) && propertyName(member) === "method",
  );
  if (!property) return ["ANY"];
  const value = property.initializer;
  if (ts.isStringLiteralLike(value)) return [value.text.toUpperCase()];
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.filter(ts.isStringLiteralLike).map((element) => element.text.toUpperCase());
  }
  return ["ANY"];
}

function handlerFromOptions(context: AnalysisContext, expression: ts.Expression): string | undefined {
  if (!ts.isObjectLiteralExpression(expression)) return undefined;
  const property = expression.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) && propertyName(member) === "handler",
  );
  return property ? resolveHandlerId(context, property.initializer) : undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = object.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) && propertyName(member) === name,
  );
  return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : undefined;
}

function propertyName(member: ts.PropertyAssignment): string | undefined {
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : undefined;
}

function usesFastify(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith("fastify"),
  );
}

function isFastifyReceiver(context: AnalysisContext, expression: ts.Expression): boolean {
  const text = expression.getText(expression.getSourceFile());
  if (/^(app|fastify|server|instance)$/i.test(text)) return true;
  const type = context.checker.getTypeAtLocation(expression);
  return /\bFastify(Instance)?\b/.test(context.checker.typeToString(type));
}
