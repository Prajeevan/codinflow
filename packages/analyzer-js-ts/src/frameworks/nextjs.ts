import ts from "typescript";
import type { AnalysisContext } from "../extract.js";
import { addRouteNode, defaultExportId, dynamicSegment, exportedHttpHandlers, linkHandler, segmentsOf } from "./shared.js";

/**
 * Next.js adapter (file-convention routing).
 *
 * These route files are ordinary `.ts`/`.tsx` in the TS program, so they flow
 * through the same per-source-file loop as the AST-based adapters — no directory
 * walk. Two routers are supported:
 *
 *   App Router   app/**\/route.ts   -> one API route per exported HTTP method
 *                app/**\/page.tsx   -> a PAGE route (default-export component)
 *   Pages Router pages/api/**       -> an API route (default-export handler)
 *                pages/**           -> a PAGE route
 *
 * Path rules: route groups `(group)` are stripped, `[param]` -> `:param`,
 * `[...slug]` / `[[...slug]]` -> `*`, `index` collapses to its directory.
 * Intercepting `(.)`/parallel `@slot` routes and private `_folder`s are skipped.
 */
export function extractNextRoutes(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  if (!context.frameworks.includes("Next.js")) return;

  const relativePath = context.relativePath(sourceFile);
  const segments = segmentsOf(relativePath);
  const fileName = segments[segments.length - 1] ?? "";
  const stem = fileName.replace(/\.(t|j)sx?$/, "");

  const appAt = rootIndex(segments, "app");
  const pagesAt = rootIndex(segments, "pages");

  if (appAt >= 0) {
    const between = segments.slice(appAt + 1, segments.length - 1);
    const routePath = appRoutePath(between);
    if (routePath === null) return; // intercepting/private route — skipped

    if (stem === "route") {
      for (const handler of exportedHttpHandlers(context, sourceFile)) {
        const routeId = addRouteNode(context, {
          applicationId,
          framework: "Next.js",
          frameworkRole: "nextjs-api",
          httpMethod: handler.method,
          routePath,
          filePath: relativePath,
          routeType: "api",
          source: handler.node,
        });
        if (handler.handlerId) linkHandler(context, routeId, handler.handlerId, "nextjs-handler", `${handler.method} ${routePath}`);
      }
      return;
    }

    if (stem === "page") {
      declarePage(context, sourceFile, applicationId, routePath, relativePath, "nextjs-page");
    }
    return;
  }

  if (pagesAt >= 0) {
    const between = segments.slice(pagesAt + 1, segments.length - 1);
    // Skip framework files that never define a route.
    if (/^(_app|_document|_error)$/.test(stem)) return;

    const isApi = between[0] === "api" || (between.length === 0 && stem === "api");
    const tail = stem === "index" ? [] : [stem];
    const routePath = pagesRoutePath([...between, ...tail]);
    if (routePath === null) return;

    if (isApi) {
      // pages/api handlers export a default function; the method is dynamic.
      const fallback = defaultExportId(context, sourceFile);
      const routeId = addRouteNode(context, {
        applicationId,
        framework: "Next.js",
        frameworkRole: "nextjs-api",
        httpMethod: "ANY",
        routePath,
        filePath: relativePath,
        routeType: "api",
        source: sourceFile,
      });
      if (fallback?.id) linkHandler(context, routeId, fallback.id, "nextjs-handler", `ANY ${routePath}`);
      return;
    }

    // Only .tsx/.jsx pages render UI; a bare .ts in pages/ is usually a helper.
    if (/\.(t|j)sx$/.test(fileName)) {
      declarePage(context, sourceFile, applicationId, routePath, relativePath, "nextjs-page");
    }
  }
}

function declarePage(
  context: AnalysisContext,
  sourceFile: ts.SourceFile,
  applicationId: string,
  routePath: string,
  filePath: string,
  frameworkRole: string,
): void {
  const component = defaultExportId(context, sourceFile);
  const routeId = addRouteNode(context, {
    applicationId,
    framework: "Next.js",
    frameworkRole,
    httpMethod: "PAGE",
    routePath,
    filePath,
    routeType: "page",
    source: sourceFile,
  });
  if (component?.id) linkHandler(context, routeId, component.id, frameworkRole, `PAGE ${routePath}`);
}

/**
 * Index of the routing directory (`app`/`pages`) in the path, or -1. Uses the
 * first exact segment match so it handles the repo root (`app/…`), `src/app/…`,
 * and monorepo layouts (`apps/web/app/…`) alike — `apps` never equals `app`, so
 * a workspace folder is not mistaken for the routing root.
 */
function rootIndex(segments: string[], name: string): number {
  const index = segments.indexOf(name);
  return index >= 0 && index < segments.length - 1 ? index : -1;
}

/** App Router path, or null when the route should not be listed. */
function appRoutePath(segments: string[]): string | null {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("_")) return null; // private folder
    if (/^\(\.+?\)/.test(segment)) return null; // intercepting route
    if (segment.startsWith("@")) continue; // parallel-route slot: not part of the URL
    if (/^\(.+\)$/.test(segment)) continue; // route group: stripped from the URL
    parts.push(dynamicSegment(segment));
  }
  return "/" + parts.join("/");
}

function pagesRoutePath(segments: string[]): string | null {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment === "api") continue; // already classified; not part of the shown path
    parts.push(dynamicSegment(segment));
  }
  return "/" + parts.join("/");
}
