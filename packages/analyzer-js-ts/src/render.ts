import type { RepoMap } from "./map.js";
import type { ImpactReport } from "./impact.js";
import type { RouteTrace, TraceStep } from "./trace.js";
import type { Staleness, SymbolReport } from "./query.js";

/**
 * Human renderers for the CLI verbs. Everything prints to stderr (stdout is
 * reserved for --json), colored only when stderr is an interactive terminal.
 */

const useColor = process.stderr.isTTY === true && process.env.NO_COLOR === undefined;
const paint = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);

export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
};

const out = (line = ""): void => console.error(line);

const loc = (filePath?: string, line?: number): string =>
  filePath ? c.dim(`${filePath}${line ? `:${line}` : ""}`) : "";

export function humanAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function printStaleness(staleness: Staleness): void {
  const banner =
    staleness.verdict === "fresh"
      ? c.green(`✓ graph current`)
      : staleness.verdict === "stale-affected"
        ? c.red(
            `⚠ graph ${humanAge(staleness.ageSeconds)} old — files this answer depends on CHANGED: ${staleness.affectedFiles.join(", ")}. Re-run with --refresh.`,
          )
        : c.yellow(`~ graph ${humanAge(staleness.ageSeconds)} old, but nothing this answer depends on changed.`);
  out();
  out(banner);
  out();
}

// ---------------------------------------------------------------------------
// map

export function printMap(map: RepoMap): void {
  const s = map.stats;
  const n = (count: number, word: string, pluralForm = `${word}s`): string => `${count} ${count === 1 ? word : pluralForm}`;
  out(
    `  ${c.bold(map.repositoryId)} ${c.dim(`@ ${map.commitSha}`)} — ${n(s.fileCount, "file")}, ${n(s.functionCount, "function")}, ${n(s.classCount, "class", "classes")}, ${n(s.routeCount, "route")}`,
  );
  out(`  frameworks   ${map.frameworks.length ? map.frameworks.map((f) => c.cyan(f)).join(", ") : c.dim("none detected")}`);
  if (map.entryPoints.length) out(`  entry        ${map.entryPoints.join(", ")}`);
  if (map.externalSystems.length)
    out(`  external     ${map.externalSystems.map((system) => `${c.magenta(system.name)} ${c.dim(`(${system.kind})`)}`).join(", ")}`);
  if (map.dependencies.length) out(`  dependencies ${c.dim(map.dependencies.join(", "))}`);
  if (map.environmentVariables.length) out(`  env vars     ${map.environmentVariables.join(", ")}`);
  if (map.warningCount > 0) out(`  warnings     ${c.yellow(String(map.warningCount))}`);

  const frameworks = Object.keys(map.routesByFramework);
  if (frameworks.length > 0) {
    out();
    out(`  ${c.bold("Routes")}`);
    for (const framework of frameworks) {
      const routes = map.routesByFramework[framework]!;
      out(`    ${c.cyan(framework)} ${c.dim(`(${routes.length})`)}`);
      for (const route of routes.slice(0, 40)) {
        const label = route.method && route.path ? `${c.yellow(route.method.padEnd(6))} ${route.path}` : route.name;
        out(`      ${label}${route.handler ? c.dim(` → ${route.handler}()`) : ""}  ${loc(route.file)}`);
      }
      if (routes.length > 40) out(`      ${c.dim(`… ${routes.length - 40} more`)}`);
    }
  }

  out();
  out(`  ${c.bold("Files")} ${c.dim("(by cross-file traffic — start reading at the top)")}`);
  for (const file of map.files.slice(0, 20)) {
    const bits = [
      `${file.symbolCount} symbols`,
      file.exports.length ? `${file.exports.length} exported` : undefined,
      file.routeCount ? c.yellow(`${file.routeCount} routes`) : undefined,
      file.traits.length ? c.magenta(file.traits.join(" · ")) : undefined,
      c.dim(`in ${file.fanIn} / out ${file.fanOut}`),
    ].filter((bit): bit is string => bit !== undefined);
    out(`    ${c.bold(file.path.padEnd(Math.min(36, longestPath(map))))}  ${bits.join(" · ")}`);
  }
  if (map.files.length > 20) out(`    ${c.dim(`… ${map.files.length - 20} more files`)}`);
  out();
}

const longestPath = (map: RepoMap): number =>
  Math.max(...map.files.slice(0, 20).map((file) => file.path.length), 0) + 2;

// ---------------------------------------------------------------------------
// impact

export function printImpact(report: ImpactReport): void {
  const t = report.target;
  out(
    `  ${c.bold(t.name)}${t.exported ? c.green(" (exported)") : ""} — ${t.kind}  ${loc(t.filePath, t.startLine)}`,
  );
  out();

  const headline = [
    `${c.bold(String(report.affectedFiles.length))} file${report.affectedFiles.length === 1 ? "" : "s"}`,
    report.affectedRoutes.length ? c.yellow(`${report.affectedRoutes.length} route${report.affectedRoutes.length === 1 ? "" : "s"}`) : undefined,
    report.testFiles.length ? `${report.testFiles.length} test file${report.testFiles.length === 1 ? "" : "s"}` : undefined,
    report.guardedCallerCount ? c.magenta(`${report.guardedCallerCount} guarded caller${report.guardedCallerCount === 1 ? "" : "s"}`) : undefined,
  ].filter((bit): bit is string => bit !== undefined);
  out(`  ${c.bold("Blast radius:")} ${headline.join(", ")} ${c.dim(`(caller depth ${report.maxDepthReached})`)}`);

  if (report.callers.length > 0) {
    out();
    out(`  ${c.bold("Callers")} ${c.dim("(breadth-first; depth 1 calls it directly)")}`);
    for (const caller of report.callers.slice(0, 30)) {
      const guard = caller.guard ? ` ${c.magenta(caller.guard)}` : "";
      out(`    ${c.dim(`[${caller.depth}]`)} ${caller.kind === "route" ? c.yellow(caller.name) : `${caller.name}()`}${guard}  ${loc(caller.filePath, caller.line)}`);
    }
    if (report.callers.length > 30) out(`    ${c.dim(`… ${report.callers.length - 30} more`)}`);
  } else {
    out(`  ${c.dim("No callers found in the graph — it may be an entry point, exported API, or dynamically invoked.")}`);
  }

  if (report.affectedRoutes.length > 0) {
    out();
    out(`  ${c.bold("Reachable from routes")}`);
    for (const route of report.affectedRoutes) out(`    ${c.yellow(route.name)}${route.framework ? c.dim(` · ${route.framework}`) : ""}`);
  }

  if (report.importers.length > 0) {
    out();
    out(`  ${c.bold("Type invalidation")} ${c.dim("— files importing " + (t.filePath ?? "the target file"))}`);
    for (const importer of report.importers) out(`    ${importer}`);
  }
  out();
}

// ---------------------------------------------------------------------------
// describe

export function printDescribe(report: SymbolReport): void {
  const s = report.symbol;
  const range = s.startLine ? `:${s.startLine}${s.endLine ? `–${s.endLine}` : ""}` : "";
  out(`  ${c.bold(s.name)}${s.exported ? c.green(" (exported)") : ""} — ${s.kind}  ${s.filePath ? c.dim(`${s.filePath}${range}`) : ""}`);
  if (s.signature) out(`  ${c.dim("signature")}  ${s.signature}`);
  const traits = s.tags.filter((tag) => !["exported"].includes(tag));
  if (traits.length) out(`  ${c.dim("traits")}     ${c.magenta(traits.join(" · "))}`);
  out(`  ${c.dim("summary")}    ${s.description}`);

  // usedBy is the precise "who calls or renders this" (includes JSX renders);
  // importedBy is the coarser file-import relationship.
  if (report.usedBy?.length) {
    out();
    out(`  ${c.bold("Used by")} ${c.dim(`(${report.usedBy.length} file${report.usedBy.length === 1 ? "" : "s"})`)}`);
    for (const group of report.usedBy) {
      out(`    ${group.file}`);
      for (const caller of group.callers) {
        const guard = caller.guard ? ` ${c.magenta(caller.guard)}` : "";
        out(`      ${caller.name}${caller.line ? c.dim(`:${caller.line}`) : ""}${guard}`);
      }
    }
  }
  if (report.importedBy?.length) {
    out();
    out(`  ${c.bold("Imported by")} ${c.dim(`(${report.importedBy.length} file${report.importedBy.length === 1 ? "" : "s"}, file-level)`)}`);
    for (const group of report.importedBy) out(`    ${group.file}`);
  }

  if (report.calls?.length) {
    out();
    out(`  ${c.bold("Calls")}`);
    for (const call of report.calls) {
      out(`    ${call.guard ? `${c.magenta(call.guard)} → ` : "→ "}${call.name}()  ${loc(call.filePath, call.line)}`);
    }
  }

  const refLine = (label: string, refs: SymbolReport["reads"]): void => {
    if (!refs?.length) return;
    out(`  ${c.bold(label)}  ${refs.map((ref) => `${ref.name} ${c.dim(`(${ref.kind})`)}`).join(", ")}`);
  };
  if (report.reads?.length || report.writes?.length || report.throws?.length || report.external?.length) out();
  refLine("Reads   ", report.reads);
  refLine("Writes  ", report.writes);
  refLine("Throws  ", report.throws);
  refLine("External", report.external);
  out();
}

// ---------------------------------------------------------------------------
// trace

export function printTrace(trace: RouteTrace): void {
  const r = trace.route;
  const title = r.method && r.path ? `${c.yellow(r.method)} ${c.bold(r.path)}` : c.bold(r.name);
  out(`  ${title}${r.framework ? c.dim(` — ${r.framework}${r.routeType ? ` (${r.routeType})` : ""}`) : ""}  ${loc(r.file)}`);

  if (trace.middleware.length > 0) {
    out();
    out(`  ${c.bold("Middleware")} ${c.dim("(runs first, in order)")}`);
    trace.middleware.forEach((middleware, index) => {
      const auth = middleware.tags.includes("authentication") ? ` ${c.magenta("[auth]")}` : "";
      out(`    ${index + 1}. ${middleware.name}${auth}  ${loc(middleware.filePath)}`);
    });
  }

  out();
  out(`  ${c.bold("Execution path")}`);
  const printSteps = (steps: TraceStep[], indent: string): void => {
    for (const step of steps) {
      const guard = step.guard ? `${c.magenta(step.guard)} ` : "";
      if (step.edgeKind === "writes" || step.edgeKind === "reads" || step.edgeKind === "throws") {
        const verb = step.edgeKind === "throws" ? c.red("throws") : c.cyan(step.edgeKind);
        out(`${indent}${guard}${verb} ${step.name}`);
        continue;
      }
      if (step.kind === "external_api" || step.kind === "database" || step.kind === "queue" || step.kind === "event") {
        out(`${indent}${guard}${c.cyan("calls")} ${step.name} ${c.dim(`(${step.kind.replace("_", " ")})`)}`);
        continue;
      }
      const suffix = step.repeated ? c.dim(" (see above)") : "";
      out(`${indent}${guard}→ ${c.bold(step.name)}()${suffix}  ${loc(step.filePath, step.line)}`);
      printSteps(step.children, `${indent}  `);
    }
  };
  printSteps(trace.steps, "    ");
  if (trace.truncatedAtDepth) out(`    ${c.dim("… deeper calls omitted (raise --depth)")}`);

  const summary = [
    trace.touches.writes.length ? `writes ${trace.touches.writes.join(", ")}` : undefined,
    trace.touches.reads.length ? `reads ${trace.touches.reads.join(", ")}` : undefined,
    trace.touches.external.length ? `external ${trace.touches.external.join(", ")}` : undefined,
    trace.touches.env.length ? `env ${trace.touches.env.join(", ")}` : undefined,
    trace.touches.throws.length ? c.red(`throws ${trace.touches.throws.join(", ")}`) : undefined,
  ].filter((bit): bit is string => bit !== undefined);
  if (summary.length > 0) {
    out();
    out(`  ${c.bold("Touches")}  ${summary.join(" · ")}`);
  }
  out();
}
