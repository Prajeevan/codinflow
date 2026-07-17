import path from "node:path";
import ts from "typescript";
import {
  isDatabaseWrite,
  isTestFile,
  normalizePackageName,
  resolveBoundary,
  resolveBoundaryForUrl,
  sourceFingerprint,
  stableSymbolId,
} from "@codinflow/analyzer-core";
import {
  GRAPH_SCHEMA_VERSION,
  TAGS,
  type AnalysisWarning,
  type EdgeKind,
  type FileDefinition,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type Language,
  type Provenance,
  type SourceRange,
} from "@codinflow/graph-schema";
import { ANALYZER_NAME, ANALYZER_VERSION } from "./version.js";
import { loadProject } from "./program.js";
import { extractExpressRoutes } from "./frameworks/express.js";
import { extractHonoRoutes } from "./frameworks/hono.js";
import { extractFastifyRoutes } from "./frameworks/fastify.js";
import { extractNextRoutes } from "./frameworks/nextjs.js";
import { extractSvelteKitRoutes } from "./frameworks/sveltekit.js";
import { extractTanStackRoutes } from "./frameworks/tanstack.js";

export interface AnalyzeOptions {
  rootDir: string;
  repositoryId: string;
  commitSha: string;
}

/** Mutable analysis state shared with framework adapters. */
export interface AnalysisContext {
  options: AnalyzeOptions;
  checker: ts.TypeChecker;
  rootDir: string;
  pathAliases: string[];
  /** Names of frameworks detected in this repository (from package.json). */
  frameworks: string[];
  warnings: AnalysisWarning[];
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** Function-like declaration -> graph node id, for resolving call targets. */
  declarationIds: Map<ts.Node, string>;
  addNode(node: GraphNode): void;
  addEdge(edge: Omit<GraphEdge, "id" | "repositoryId" | "commitSha">): void;
  relativePath(sourceFile: ts.SourceFile): string;
  rangeOf(node: ts.Node): SourceRange;
  provenance(evidenceType: Provenance["evidenceType"], language?: Language): Provenance;
}

export function analyzeRepository(options: AnalyzeOptions): GraphSnapshot {
  const project = loadProject(options.rootDir);
  const context = createContext(
    options,
    project.checker,
    project.rootDir,
    project.pathAliases,
    project.frameworks.map((framework) => framework.name),
  );

  const sourceFiles = project.program
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile && file.fileName.startsWith(project.rootDir))
    .filter((file) => !file.fileName.includes("node_modules"));

  const applicationId = `${options.repositoryId}:application`;
  context.addNode({
    id: applicationId,
    repositoryId: options.repositoryId,
    commitSha: options.commitSha,
    language: "typescript",
    kind: "application",
    name: path.basename(project.rootDir),
    tags: [],
    analysisConfidence: 1,
    provenance: context.provenance("syntactic"),
    zoomLevel: 1,
    applicationOwned: true,
    metadata: { frameworks: project.frameworks.map((f) => f.name) },
  });

  // Pass 1: declare every file and symbol so call resolution in pass 2 can
  // reference targets that appear later in the program.
  for (const sourceFile of sourceFiles) {
    extractFile(context, sourceFile, applicationId);
  }

  // Pass 2: relationships, which depend on the full symbol table existing.
  let callSites = 0;
  let resolvedCalls = 0;
  for (const sourceFile of sourceFiles) {
    const counts = extractRelationships(context, sourceFile);
    callSites += counts.callSites;
    resolvedCalls += counts.resolved;
  }

  for (const sourceFile of sourceFiles) {
    extractExpressRoutes(context, sourceFile, applicationId);
    extractHonoRoutes(context, sourceFile, applicationId);
    extractFastifyRoutes(context, sourceFile, applicationId);
    extractNextRoutes(context, sourceFile, applicationId);
    extractSvelteKitRoutes(context, sourceFile, applicationId);
    extractTanStackRoutes(context, sourceFile, applicationId);
  }

  applyDerivedTags(context);

  const nodes = [...context.nodes.values()];
  const sources: Record<string, string> = {};
  for (const sourceFile of sourceFiles) {
    sources[context.relativePath(sourceFile)] = sourceFile.getFullText();
  }

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    repositoryId: options.repositoryId,
    commitSha: options.commitSha,
    analyzerVersion: ANALYZER_VERSION,
    generatedAt: new Date().toISOString(),
    frameworks: project.frameworks,
    entryPoints: project.entryPoints,
    nodes,
    edges: context.edges,
    stats: {
      fileCount: nodes.filter((n) => n.kind === "file").length,
      functionCount: nodes.filter((n) => n.kind === "function" || n.kind === "method").length,
      classCount: nodes.filter((n) => n.kind === "class").length,
      routeCount: nodes.filter((n) => n.kind === "route").length,
      externalApiCount: nodes.filter((n) => n.kind === "external_api").length,
      databaseCount: nodes.filter((n) => n.kind === "database").length,
      resolvedCallRatio: callSites === 0 ? 1 : Number((resolvedCalls / callSites).toFixed(3)),
    },
    warnings: [...project.warnings, ...context.warnings],
    sources,
  };
}

function createContext(
  options: AnalyzeOptions,
  checker: ts.TypeChecker,
  rootDir: string,
  pathAliases: string[],
  frameworks: string[],
): AnalysisContext {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  return {
    options,
    checker,
    rootDir,
    pathAliases,
    frameworks,
    warnings: [],
    nodes,
    edges,
    declarationIds: new Map(),
    addNode(node) {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    },
    addEdge(edge) {
      const key = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.kind}|${edge.condition ?? ""}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      edges.push({
        ...edge,
        id: `e:${edges.length}:${key.slice(0, 40)}`,
        repositoryId: options.repositoryId,
        commitSha: options.commitSha,
      });
    },
    relativePath(sourceFile) {
      return path.relative(rootDir, sourceFile.fileName);
    },
    rangeOf(node) {
      const sourceFile = node.getSourceFile();
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      return {
        startLine: start.line + 1,
        startColumn: start.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
      };
    },
    provenance(evidenceType, language = "typescript") {
      return { analyzer: ANALYZER_NAME, analyzerVersion: ANALYZER_VERSION, language, evidenceType };
    },
  };
}

function languageOf(filePath: string): Language {
  return /\.(ts|tsx|mts|cts)$/.test(filePath) ? "typescript" : "javascript";
}

/**
 * Module-level declarations a reader would scan first: the `const`/`let`/`var`,
 * types, interfaces and enums at the top of a file.
 *
 * These are listed on the file container rather than promoted to graph nodes —
 * a node per constant would bury the structure the graph exists to show
 * (BRIEF §8, "do not create permanent graph nodes for every local variable").
 */
function extractDefinitions(context: AnalysisContext, sourceFile: ts.SourceFile): FileDefinition[] {
  const definitions: FileDefinition[] = [];

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const flags = statement.declarationList.flags;
      const keyword = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";

      for (const declaration of statement.declarationList.declarations) {
        // Function-valued variables become function nodes, not definitions.
        if (
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
        ) {
          continue;
        }
        if (!ts.isIdentifier(declaration.name)) continue;

        definitions.push({
          name: declaration.name.text,
          keyword,
          line: lineOf(statement),
          exported: isExported(statement),
          typeText: typeTextOf(context, declaration),
        });
      }
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      definitions.push({ name: statement.name.text, keyword: "type", line: lineOf(statement), exported: isExported(statement) });
    } else if (ts.isInterfaceDeclaration(statement)) {
      definitions.push({ name: statement.name.text, keyword: "interface", line: lineOf(statement), exported: isExported(statement) });
    } else if (ts.isEnumDeclaration(statement)) {
      definitions.push({ name: statement.name.text, keyword: "enum", line: lineOf(statement), exported: isExported(statement) });
    }
  }

  return definitions;
}

function typeTextOf(context: AnalysisContext, declaration: ts.VariableDeclaration): string | undefined {
  try {
    const type = context.checker.getTypeAtLocation(declaration);
    const text = context.checker.typeToString(type);
    // A fully-expanded object literal type is noise in a one-line list.
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  } catch {
    return undefined;
  }
}

/** Import specifiers, for the file container's header. */
function extractImportSummary(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements
    .filter((statement): statement is ts.ImportDeclaration => ts.isImportDeclaration(statement))
    .map((statement) => (ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : ""))
    .filter(Boolean);
}

function extractFile(context: AnalysisContext, sourceFile: ts.SourceFile, applicationId: string): void {
  const relativePath = context.relativePath(sourceFile);
  const language = languageOf(relativePath);
  const fileId = stableSymbolId({
    repositoryId: context.options.repositoryId,
    language,
    workspace: ".",
    filePath: relativePath,
    qualifiedName: relativePath,
    kind: "file",
  });

  context.addNode({
    id: fileId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language,
    kind: "file",
    name: path.basename(relativePath),
    qualifiedName: relativePath,
    parentId: applicationId,
    filePath: relativePath,
    tags: isTestFile(relativePath) ? ["test"] : [],
    analysisConfidence: 1,
    provenance: context.provenance("syntactic", language),
    zoomLevel: 3,
    applicationOwned: true,
    metadata: {
      definitions: extractDefinitions(context, sourceFile),
      imports: extractImportSummary(sourceFile),
      lineCount: sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1,
    },
  });

  const visit = (node: ts.Node, parentId: string, parentQualifiedName?: string): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const classId = declareSymbol(context, node, node.name.text, "class", fileId, parentQualifiedName, relativePath);
      for (const member of node.members) {
        if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) && member.body) {
          const name = ts.isConstructorDeclaration(member) ? "constructor" : member.name.getText(sourceFile);
          declareSymbol(context, member, name, "method", classId, node.name.text, relativePath);
        }
      }

      for (const heritage of node.heritageClauses ?? []) {
        const kind: EdgeKind = heritage.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
        for (const type of heritage.types) {
          const targetId = resolveDeclarationId(context, type.expression);
          if (targetId) {
            context.addEdge({
              sourceNodeId: classId,
              targetNodeId: targetId,
              kind,
              analysisConfidence: 0.95,
              provenance: context.provenance("semantic", languageOf(relativePath)),
              sourceLocation: locationOf(context, type),
              metadata: {},
            });
          }
        }
      }
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      declareSymbol(context, node, node.name.text, "function", parentId, parentQualifiedName, relativePath);
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) &&
          ts.isIdentifier(declaration.name)
        ) {
          declareSymbol(
            context,
            declaration.initializer,
            declaration.name.text,
            "function",
            parentId,
            parentQualifiedName,
            relativePath,
            node,
          );
        }
      }
      return;
    }

    ts.forEachChild(node, (child) => visit(child, parentId, parentQualifiedName));
  };

  ts.forEachChild(sourceFile, (child) => visit(child, fileId));
}

function declareSymbol(
  context: AnalysisContext,
  declaration: ts.Node,
  name: string,
  kind: "function" | "method" | "class",
  parentId: string,
  parentQualifiedName: string | undefined,
  relativePath: string,
  rangeNode: ts.Node = declaration,
): string {
  const language = languageOf(relativePath);
  const qualifiedName = parentQualifiedName ? `${parentQualifiedName}.${name}` : name;
  const id = stableSymbolId({
    repositoryId: context.options.repositoryId,
    language,
    workspace: ".",
    filePath: relativePath,
    qualifiedName,
    kind,
    parentQualifiedName,
  });

  const tags: string[] = [];
  const modifiers = ts.canHaveModifiers(rangeNode) ? (ts.getModifiers(rangeNode) ?? []) : [];
  if (modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) tags.push(TAGS.EXPORTED);
  if (ts.canHaveModifiers(declaration)) {
    const own = ts.getModifiers(declaration) ?? [];
    if (own.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) tags.push(TAGS.ASYNC);
  }
  if (
    (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) &&
    declaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    if (!tags.includes(TAGS.ASYNC)) tags.push(TAGS.ASYNC);
  }
  if (/validate|isvalid|assert|check/i.test(name)) tags.push(TAGS.VALIDATION);
  if (/auth|login|token|session|permission/i.test(name)) tags.push(TAGS.AUTHENTICATION);

  context.addNode({
    id,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language,
    kind,
    name,
    qualifiedName,
    parentId,
    filePath: relativePath,
    source: context.rangeOf(rangeNode),
    signature: signatureOf(context, declaration),
    tags,
    visibility: tags.includes(TAGS.EXPORTED) ? "public" : "private",
    analysisConfidence: 1,
    sourceFingerprint: sourceFingerprint(declaration.getText()),
    provenance: context.provenance("syntactic", language),
    zoomLevel: 3,
    applicationOwned: true,
    metadata: {},
  });

  context.declarationIds.set(declaration, id);
  if (rangeNode !== declaration) context.declarationIds.set(rangeNode, id);
  return id;
}

function signatureOf(context: AnalysisContext, declaration: ts.Node): string | undefined {
  const symbol = context.checker.getSymbolAtLocation(
    (declaration as ts.NamedDeclaration).name ?? declaration,
  );
  if (!symbol) return undefined;
  const type = context.checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const signatures = type.getCallSignatures();
  const signature = signatures[0];
  return signature ? context.checker.signatureToString(signature) : undefined;
}

function locationOf(context: AnalysisContext, node: ts.Node) {
  const range = context.rangeOf(node);
  return {
    filePath: context.relativePath(node.getSourceFile()),
    line: range.startLine,
    column: range.startColumn,
  };
}

/**
 * Resolves an expression to the graph node of the declaration it refers to,
 * following import aliases. This is the TypeChecker doing the work a syntax-only
 * parser cannot: proving which function a call actually reaches.
 */
function resolveDeclarationId(context: AnalysisContext, expression: ts.Expression): string | undefined {
  let symbol = context.checker.getSymbolAtLocation(expression);

  if (!symbol && ts.isPropertyAccessExpression(expression)) {
    symbol = context.checker.getSymbolAtLocation(expression.name);
  }
  if (!symbol) return undefined;

  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = context.checker.getAliasedSymbol(symbol);
    } catch {
      /* unresolvable alias; fall through to the local symbol */
    }
  }

  for (const declaration of symbol.declarations ?? []) {
    const direct = context.declarationIds.get(declaration);
    if (direct) return direct;

    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const viaInitializer = context.declarationIds.get(declaration.initializer);
      if (viaInitializer) return viaInitializer;
    }
  }

  return undefined;
}

/** Walks up to the nearest enclosing declared function/method node. */
function enclosingSymbolId(context: AnalysisContext, node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    const id = context.declarationIds.get(current);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

function extractRelationships(
  context: AnalysisContext,
  sourceFile: ts.SourceFile,
): { callSites: number; resolved: number } {
  const relativePath = context.relativePath(sourceFile);
  const language = languageOf(relativePath);
  const fileId = stableSymbolId({
    repositoryId: context.options.repositoryId,
    language,
    workspace: ".",
    filePath: relativePath,
    qualifiedName: relativePath,
    kind: "file",
  });

  let callSites = 0;
  let resolved = 0;

  // Calls that a conditional edge already describes. Emitting a plain `calls`
  // edge for these as well would claim the call is unconditional.
  const conditionalCalls = collectConditionalCalls(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      extractImport(context, node.moduleSpecifier.text, fileId, node.moduleSpecifier, language);
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      extractImport(context, node.moduleSpecifier.text, fileId, node.moduleSpecifier, language);
    }

    if (ts.isCallExpression(node)) {
      callSites += 1;
      if (conditionalCalls.has(node)) {
        resolved += 1;
      } else if (extractCall(context, node, fileId, language)) {
        resolved += 1;
      }
    }

    if (ts.isThrowStatement(node)) {
      extractThrow(context, node, language);
    }

    if (ts.isIfStatement(node)) {
      extractCondition(context, node, language);
    }

    if (ts.isPropertyAccessExpression(node) && node.expression.getText(sourceFile) === "process.env") {
      extractEnvVar(context, node, language);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return { callSites, resolved };
}

function extractImport(
  context: AnalysisContext,
  specifier: string,
  fileId: string,
  node: ts.Node,
  language: Language,
): void {
  // Resolve through the compiler rather than by prefix, so a tsconfig `paths`
  // alias ("@/components/x") is correctly seen as the app's own source instead of
  // a third-party package.
  const resolvedFile = resolveImportedFile(context, node, specifier);

  if (resolvedFile) {
    context.addEdge({
      sourceNodeId: fileId,
      targetNodeId: resolvedFile,
      kind: "imports",
      label: `imports ${specifier}`,
      analysisConfidence: 1,
      provenance: context.provenance("semantic", language),
      sourceLocation: locationOf(context, node),
      metadata: {},
    });
    return;
  }

  if (isNodeBuiltin(specifier)) return;

  // An alias import is the app's own source, never a package. Bundler aliases
  // ("@/x") are frequently declared in vite/webpack config rather than tsconfig,
  // so the compiler cannot resolve them — but "@/x" is not even a legal npm name
  // (an npm scope cannot be empty), so calling it a dependency is always wrong.
  if (isInternalAlias(context, specifier)) {
    const aliased = resolveAliasByConvention(context, specifier);

    if (aliased) {
      context.addEdge({
        sourceNodeId: fileId,
        targetNodeId: aliased,
        kind: "imports",
        label: `imports ${specifier}`,
        // Inferred from an alias convention, then confirmed against a file that
        // actually exists — weaker than compiler resolution, so it says so.
        analysisConfidence: 0.85,
        provenance: context.provenance("framework_inferred", language),
        sourceLocation: locationOf(context, node),
        metadata: { alias: specifier },
      });
      return;
    }

    const message = `Import "${specifier}" uses a path alias this analyzer could not resolve. It is application code, not a dependency; its edges are missing from the graph.`;
    if (!context.warnings.some((warning) => warning.message === message)) {
      context.warnings.push({ code: "UNRESOLVED_INTERNAL_IMPORT", message, filePath: specifier });
    }
    return;
  }

  const boundary = resolveBoundary(specifier);
  const packageName = normalizePackageName(specifier);
  const boundaryId = `${context.options.repositoryId}:boundary:${boundary?.label ?? packageName}`;

  context.addNode({
    id: boundaryId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language,
    // An unrecognized package is a dependency, not an external service. Calling
    // it "external_api" would claim the app talks to a network service it does
    // not — only a known service or a real HTTP call earns that kind.
    kind: boundary?.kind ?? "module",
    name: boundary?.label ?? packageName,
    tags: [],
    analysisConfidence: boundary ? 0.9 : 0.6,
    provenance: context.provenance("framework_inferred", language),
    zoomLevel: 1,
    applicationOwned: false,
    metadata: { package: packageName, collapsed: true, framework: boundary?.framework === true },
  });

  context.addEdge({
    sourceNodeId: fileId,
    targetNodeId: boundaryId,
    kind: "depends_on",
    label: `imports ${specifier}`,
    analysisConfidence: 1,
    provenance: context.provenance("syntactic", language),
    sourceLocation: locationOf(context, node),
    metadata: {},
  });
}

/** True when a specifier names the app's own source through an alias. */
function isInternalAlias(context: AnalysisContext, specifier: string): boolean {
  if (/^(@\/|~\/|~$|#)/.test(specifier)) return true;
  return context.pathAliases.some((alias) => alias.length > 0 && specifier.startsWith(alias));
}

/**
 * Maps an alias import onto a real file, trying the conventional roots. The edge
 * is only claimed when a matching file node exists — the convention is a
 * hypothesis, and an existing file is the evidence for it.
 */
function resolveAliasByConvention(context: AnalysisContext, specifier: string): string | undefined {
  const bare = specifier.replace(/^(@\/|~\/|#)/, "").replace(/^~/, "");
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

  for (const root of ["src", "app", "."]) {
    for (const extension of extensions) {
      const candidate = path.join(root, `${bare}${extension}`);
      const id = stableSymbolId({
        repositoryId: context.options.repositoryId,
        language: languageOf(candidate),
        workspace: ".",
        filePath: candidate,
        qualifiedName: candidate,
        kind: "file",
      });
      if (context.nodes.has(id)) return id;
    }
  }

  return undefined;
}

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "crypto", "dns", "events", "fs", "http", "http2",
  "https", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream",
  "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTINS.has(specifier.split("/")[0] ?? "");
}

/**
 * Resolves an import to a file node of this repository, or undefined when it
 * leaves the repository.
 *
 * Uses the compiler's own resolution so `paths` aliases, extensionless imports
 * and `.js`-to-`.ts` mapping all work; a file inside the repository but under
 * node_modules is still a dependency.
 */
function resolveImportedFile(context: AnalysisContext, node: ts.Node, specifier: string): string | undefined {
  const fileNameOf = (): string | undefined => {
    const symbol = context.checker.getSymbolAtLocation(node);
    const declared = symbol?.declarations?.[0]?.getSourceFile().fileName;
    if (declared) return declared;

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;

    // Fall back to path arithmetic for a module that exports no symbol.
    const fromDir = path.dirname(node.getSourceFile().fileName);
    return path.resolve(fromDir, specifier.replace(/\.js$/, ".ts"));
  };

  const target = fileNameOf();
  if (!target) return undefined;
  if (!target.startsWith(context.rootDir) || target.includes("node_modules")) return undefined;

  const relative = path.relative(context.rootDir, target);
  const id = stableSymbolId({
    repositoryId: context.options.repositoryId,
    language: languageOf(relative),
    workspace: ".",
    filePath: relative,
    qualifiedName: relative,
    kind: "file",
  });
  return context.nodes.has(id) ? id : undefined;
}

function extractCall(context: AnalysisContext, node: ts.CallExpression, fileId: string, language: Language): boolean {
  const callerId = enclosingSymbolId(context, node) ?? fileId;
  const calleeText = node.expression.getText(node.getSourceFile());
  const isAwaited = node.parent && ts.isAwaitExpression(node.parent);

  if (calleeText === "fetch" || calleeText.endsWith(".fetch")) {
    extractFetch(context, node, callerId, language);
    return true;
  }

  const targetId = resolveDeclarationId(context, node.expression);

  if (!targetId) {
    if (externalCallBoundary(context, node, callerId, calleeText, language)) return true;

    // Only a call the checker could not resolve to *any* declaration is truly
    // dynamic. A call into an un-modelled library resolves fine — it just has no
    // boundary worth drawing, and must not be reported as uncertain.
    if (!context.checker.getSymbolAtLocation(node.expression)) {
      const caller = context.nodes.get(callerId);
      if (caller && !caller.tags.includes(TAGS.UNRESOLVED_DYNAMIC_CALL)) {
        caller.tags.push(TAGS.UNRESOLVED_DYNAMIC_CALL);
      }
      return false;
    }

    return true;
  }

  context.addEdge({
    sourceNodeId: callerId,
    targetNodeId: targetId,
    kind: isAwaited ? "awaits" : "calls",
    label: isAwaited ? `awaits ${calleeText}` : `calls ${calleeText}`,
    analysisConfidence: 1,
    provenance: context.provenance("semantic", language),
    sourceLocation: locationOf(context, node),
    metadata: {},
  });

  return true;
}

/**
 * A call whose declaration lives in a collapsed dependency (a database client,
 * an SDK). We do not graph the package's internals — only that our code reaches
 * the boundary, and whether it reads or writes.
 */
function externalCallBoundary(
  context: AnalysisContext,
  node: ts.CallExpression,
  callerId: string,
  calleeText: string,
  language: Language,
): boolean {
  let symbol = context.checker.getSymbolAtLocation(node.expression);
  if (!symbol && ts.isPropertyAccessExpression(node.expression)) {
    symbol = context.checker.getSymbolAtLocation(node.expression.name);
  }

  const declaringFile = symbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
  if (!declaringFile.includes("node_modules")) return false;

  const packageName = normalizePackageName(declaringFile);
  const boundary = resolveBoundary(packageName);
  if (!boundary) return false;

  const boundaryId = `${context.options.repositoryId}:boundary:${boundary.label}`;
  context.addNode({
    id: boundaryId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language,
    kind: boundary.kind,
    name: boundary.label,
    tags: [],
    analysisConfidence: 0.9,
    provenance: context.provenance("framework_inferred", language),
    zoomLevel: 1,
    applicationOwned: false,
    metadata: { package: packageName, collapsed: true, framework: boundary.framework === true },
  });

  // Framework plumbing (res.json, app.use) is noise on the canvas: the boundary
  // node records the dependency, but per-call edges into it are not drawn.
  if (boundary.framework) return true;

  const query = queryTextOf(node);
  const isWrite = boundary.kind === "database" && isDatabaseWrite(calleeText, query);

  context.addEdge({
    sourceNodeId: callerId,
    targetNodeId: boundaryId,
    kind: boundary.kind === "database" ? (isWrite ? "writes" : "reads") : "calls",
    label: isWrite ? `writes via ${calleeText}` : `${calleeText} → ${boundary.label}`,
    analysisConfidence: 0.85,
    provenance: context.provenance("framework_inferred", language),
    sourceLocation: locationOf(context, node),
    metadata: query ? { query } : {},
  });

  return true;
}

/** First string-literal argument of a call — the SQL text, for a query call. */
function queryTextOf(node: ts.CallExpression): string | undefined {
  for (const argument of node.arguments) {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return argument.text;
    }
  }
  return undefined;
}

/**
 * Resolves a URL expression to a literal string where possible, following
 * identifiers to their constant initializer and folding template literals.
 * `${SHOPIFY_BASE}/orders/${id}.json` becomes a URL we can actually match a
 * known service against, rather than an unidentified "External HTTP API".
 */
function foldUrlExpression(context: AnalysisContext, expression: ts.Expression, depth = 0): string {
  if (depth > 3) return expression.getText(expression.getSourceFile());

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }

  if (ts.isTemplateExpression(expression)) {
    let result = expression.head.text;
    for (const span of expression.templateSpans) {
      result += foldUrlExpression(context, span.expression, depth + 1);
      result += span.literal.text;
    }
    return result;
  }

  if (ts.isIdentifier(expression)) {
    const symbol = context.checker.getSymbolAtLocation(expression);
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return foldUrlExpression(context, declaration.initializer, depth + 1);
      }
    }
  }

  if (ts.isNewExpression(expression) && expression.arguments?.[0]) {
    return foldUrlExpression(context, expression.arguments[0], depth + 1);
  }

  return expression.getText(expression.getSourceFile());
}

function extractFetch(context: AnalysisContext, node: ts.CallExpression, callerId: string, language: Language): void {
  const argument = node.arguments[0];
  const urlText = argument ? foldUrlExpression(context, argument) : "";
  const boundary = resolveBoundaryForUrl(urlText);
  const label = boundary?.label ?? hostFromExpression(urlText) ?? "External HTTP API";
  const boundaryId = `${context.options.repositoryId}:boundary:${label}`;

  context.addNode({
    id: boundaryId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language,
    kind: "external_api",
    name: label,
    tags: [],
    analysisConfidence: boundary ? 0.85 : 0.5,
    provenance: context.provenance("framework_inferred", language),
    zoomLevel: 1,
    applicationOwned: false,
    metadata: { collapsed: true, urlExpression: urlText },
  });

  context.addEdge({
    sourceNodeId: callerId,
    targetNodeId: boundaryId,
    kind: "calls",
    label: `HTTP request to ${label}`,
    analysisConfidence: boundary ? 0.85 : 0.5,
    provenance: context.provenance("framework_inferred", language),
    sourceLocation: locationOf(context, node),
    metadata: {},
  });
}

function hostFromExpression(text: string): string | undefined {
  const match = text.match(/https?:\/\/([^/`'"$\s]+)/);
  return match?.[1];
}

function extractThrow(context: AnalysisContext, node: ts.ThrowStatement, language: Language): void {
  const throwerId = enclosingSymbolId(context, node);
  if (!throwerId) return;

  const expression = node.expression;
  const errorName =
    ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : "Error";

  // When the thrown type is a class the app declares, point at that class rather
  // than inventing a parallel error node — the reader can then open the real
  // definition instead of a synthetic stand-in.
  const declaredClassId = ts.isNewExpression(expression)
    ? resolveDeclarationId(context, expression.expression)
    : undefined;

  const errorId = declaredClassId ?? `${context.options.repositoryId}:error:${errorName}`;

  if (!declaredClassId) {
    context.addNode({
      id: errorId,
      repositoryId: context.options.repositoryId,
      commitSha: context.options.commitSha,
      language,
      kind: "error",
      name: errorName,
      tags: [],
      analysisConfidence: 0.9,
      provenance: context.provenance("syntactic", language),
      zoomLevel: 4,
      applicationOwned: true,
      metadata: { builtin: true },
    });
  }

  context.addEdge({
    sourceNodeId: throwerId,
    targetNodeId: errorId,
    kind: "throws",
    label: `throws ${errorName}`,
    analysisConfidence: 0.95,
    provenance: context.provenance("syntactic", language),
    sourceLocation: locationOf(context, node),
    metadata: {},
  });

  const thrower = context.nodes.get(throwerId);
  if (thrower && !thrower.tags.includes(TAGS.ERROR_HANDLING)) thrower.tags.push(TAGS.ERROR_HANDLING);
}

/**
 * Promotes a condition to a labelled edge only when its branch does something
 * architecturally meaningful — a call, return, or throw (BRIEF §8). Minor
 * conditionals stay out of the graph.
 */
function extractCondition(context: AnalysisContext, node: ts.IfStatement, language: Language): void {
  const enclosingId = enclosingSymbolId(context, node);
  if (!enclosingId) return;

  const sourceFile = node.getSourceFile();
  const conditionText = node.expression.getText(sourceFile);

  const branches: Array<{ statement: ts.Statement | undefined; taken: boolean }> = [
    { statement: node.thenStatement, taken: true },
    { statement: node.elseStatement, taken: false },
  ];

  for (const branch of branches) {
    if (!branch.statement) continue;

    for (const target of meaningfulTargets(context, branch.statement)) {
      context.addEdge({
        sourceNodeId: enclosingId,
        targetNodeId: target.id,
        kind: "calls",
        label: humanizeCondition(conditionText, branch.taken),
        condition: branch.taken ? conditionText : `!(${conditionText})`,
        analysisConfidence: 0.9,
        provenance: context.provenance("semantic", language),
        sourceLocation: locationOf(context, node),
        metadata: { conditional: true, branch: branch.taken ? "then" : "else" },
      });
    }
  }
}

function meaningfulTargets(context: AnalysisContext, statement: ts.Statement): Array<{ id: string }> {
  return branchCalls(statement)
    .map((call) => resolveDeclarationId(context, call.expression))
    .filter((id): id is string => id !== undefined)
    .map((id) => ({ id }));
}

/** Call expressions inside a branch body, excluding nested if-statements. */
function branchCalls(statement: ts.Statement): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];

  const visit = (node: ts.Node): void => {
    // A nested if gets its own conditional edges; do not attribute its calls here.
    if (ts.isIfStatement(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };

  visit(statement);
  return calls;
}

function collectConditionalCalls(sourceFile: ts.SourceFile): Set<ts.Node> {
  const conditional = new Set<ts.Node>();

  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      for (const branch of [node.thenStatement, node.elseStatement]) {
        if (branch) {
          for (const call of branchCalls(branch)) conditional.add(call);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return conditional;
}

/**
 * Renders a source condition as prose for the edge label. The verbatim
 * expression is always kept alongside it in `condition`, so a reader can check
 * this rendering against the real source.
 */
function humanizeCondition(conditionText: string, taken: boolean): string {
  const negated = conditionText.startsWith("!");
  const bare = negated ? conditionText.slice(1).replace(/^\((.*)\)$/, "$1") : conditionText;
  const readable = bare
    .replace(/^is([A-Z])/, (_m, c: string) => `is ${c.toLowerCase()}`)
    .replace(/\(.*\)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();

  const isTrue = taken !== negated;
  return isTrue ? `if ${readable}` : `if not ${readable}`;
}

function extractEnvVar(context: AnalysisContext, node: ts.PropertyAccessExpression, language: Language): void {
  const readerId = enclosingSymbolId(context, node);
  const name = node.name.text;
  const envId = `${context.options.repositoryId}:env:${name}`;

  context.addNode({
    id: envId,
    repositoryId: context.options.repositoryId,
    commitSha: context.options.commitSha,
    language,
    kind: "environment_variable",
    name,
    tags: [],
    analysisConfidence: 1,
    provenance: context.provenance("syntactic", language),
    zoomLevel: 4,
    applicationOwned: true,
    metadata: {},
  });

  if (!readerId) return;

  context.addEdge({
    sourceNodeId: readerId,
    targetNodeId: envId,
    kind: "reads",
    label: `reads ${name}`,
    analysisConfidence: 1,
    provenance: context.provenance("syntactic", language),
    sourceLocation: locationOf(context, node),
    metadata: {},
  });

  const reader = context.nodes.get(readerId);
  if (reader && !reader.tags.includes(TAGS.USES_ENV_VAR)) reader.tags.push(TAGS.USES_ENV_VAR);
}

/** Tags that can only be computed once the whole graph exists. */
function applyDerivedTags(context: AnalysisContext): void {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();

  for (const edge of context.edges) {
    if (edge.kind === "calls" || edge.kind === "awaits") {
      fanIn.set(edge.targetNodeId, (fanIn.get(edge.targetNodeId) ?? 0) + 1);
      fanOut.set(edge.sourceNodeId, (fanOut.get(edge.sourceNodeId) ?? 0) + 1);
      if (edge.sourceNodeId === edge.targetNodeId) {
        context.nodes.get(edge.sourceNodeId)?.tags.push(TAGS.RECURSIVE);
      }
    }

    const target = context.nodes.get(edge.targetNodeId);
    const source = context.nodes.get(edge.sourceNodeId);
    if (!target || !source) continue;

    if (target.kind === "database" && edge.kind === "writes") pushTag(source, TAGS.WRITES_DATABASE);
    if (target.kind === "database" && edge.kind === "reads") pushTag(source, TAGS.READS_DATABASE);
    if (target.kind === "external_api" && edge.kind === "calls" && source.applicationOwned) {
      pushTag(source, TAGS.CALLS_EXTERNAL_API);
    }
  }

  for (const [id, count] of fanIn) {
    if (count >= 4) pushTag(context.nodes.get(id), TAGS.HIGH_FAN_IN);
  }
  for (const [id, count] of fanOut) {
    if (count >= 6) pushTag(context.nodes.get(id), TAGS.HIGH_FAN_OUT);
  }
}

function pushTag(node: GraphNode | undefined, tag: string): void {
  if (node && !node.tags.includes(tag)) node.tags.push(tag);
}
