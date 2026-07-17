import ts from "typescript";
import type { AnalysisContext } from "../extract.js";
import { addRouteNode, defaultExportId, dynamicSegment, exportedHttpHandlers, linkHandler, segmentsOf } from "./shared.js";

/**
 * SvelteKit adapter (file-convention routing under `src/routes`).
 *
 *   +server.ts        -> one API route per exported HTTP method
 *   +page.server.ts   -> a PAGE route (its `load`/actions run on the server)
 *   +page.ts          -> a PAGE route
 *
 * Pure `+page.svelte` routes with no `.ts` sibling are not in the TS program and
 * are not listed here (a deliberate deferral). Path rules match SvelteKit:
 * route groups `(group)` stripped, `[param]` -> `:param`, `[...rest]` -> `*`,
 * `[[optional]]` -> `*`.
 */
export function extractSvelteKitRoutes(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  if (!context.frameworks.includes("SvelteKit")) return;

  const relativePath = context.relativePath(sourceFile);
  const segments = segmentsOf(relativePath);
  const fileName = segments[segments.length - 1] ?? "";

  const routesAt = routesRootIndex(segments);
  if (routesAt < 0) return;

  const between = segments.slice(routesAt + 1, segments.length - 1);
  const routePath = routePathOf(between);

  if (/^\+server\.(t|j)s$/.test(fileName)) {
    for (const handler of exportedHttpHandlers(context, sourceFile)) {
      const routeId = addRouteNode(context, {
        applicationId,
        framework: "SvelteKit",
        frameworkRole: "sveltekit-endpoint",
        httpMethod: handler.method,
        routePath,
        filePath: relativePath,
        routeType: "api",
        source: handler.node,
      });
      if (handler.handlerId) linkHandler(context, routeId, handler.handlerId, "sveltekit-handler", `${handler.method} ${routePath}`);
    }
    return;
  }

  if (/^\+page(\.server)?\.(t|j)s$/.test(fileName)) {
    const component = defaultExportId(context, sourceFile);
    const routeId = addRouteNode(context, {
      applicationId,
      framework: "SvelteKit",
      frameworkRole: "sveltekit-page",
      httpMethod: "PAGE",
      routePath,
      filePath: relativePath,
      routeType: "page",
      source: sourceFile,
    });
    if (component?.id) linkHandler(context, routeId, component.id, "sveltekit-page", `PAGE ${routePath}`);
  }
}

function routesRootIndex(segments: string[]): number {
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === "routes" && segments[i - 1] === "src") return i;
  }
  return -1;
}

function routePathOf(segments: string[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (/^\(.+\)$/.test(segment)) continue; // route group
    parts.push(dynamicSegment(segment));
  }
  return "/" + parts.join("/");
}
