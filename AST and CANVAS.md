1. Does Python AST make sense?
For JavaScript and TypeScript: no

Do not parse JavaScript or TypeScript using Python.

For the JS/TS MVP, use the TypeScript Compiler API because it gives us more than syntax:

AST nodes
Symbols
Type information
Cross-file imports
Module resolution
Function definitions
References
Inferred types
JavaScript support through allowJs
TypeScript project configuration

The TypeScript type checker can resolve the symbol and type attached to an AST node, which is essential for determining which actual function a call refers to.

An AST by itself tells us:

There is a call expression named createOrder

The TypeScript semantic layer helps tell us:

This createOrder call resolves to:
src/services/orders/create-order.ts
lines 42–78

That difference is crucial.

For adding Python support later: yes

Python’s built-in ast module is a sensible starting point for parsing Python syntax. It exposes Python’s abstract syntax grammar and lets us traverse functions, classes, calls, conditions and imports.

But Python ast alone would not be enough for the complete product. We would eventually combine it with a Python semantic-analysis tool for:

Cross-file symbol resolution
Import resolution
Type inference
Method resolution
Virtual environments
Package understanding
Framework-specific behaviour

The overall approach should be:

JavaScript/TypeScript
TypeScript Compiler API + TypeChecker
                ↓
Language-neutral internal graph

Python
Python ast + Python semantic resolver
                ↓
Language-neutral internal graph

Java
Java parser + language server
                ↓
Language-neutral internal graph

Each language gets its own adapter. Every adapter outputs the same graph schema.

Tree-sitter could later provide broad syntax support, but it should not replace the TypeScript Compiler API for JS/TS because syntax parsing alone cannot reliably resolve application-level symbols and calls.

2. Are we building the infinite canvas from scratch?

Definitely not.

We should build our product-specific nodes, interactions and semantic zoom system on top of an established graph UI library.

Recommended MVP stack
React Flow / xyflow
    Rendering and interaction
    Custom function blocks
    Custom edges
    Pan and zoom
    Selection
    Handles
    Minimap
    Grouped nodes
    Keyboard navigation

ELK.js
    Automatic graph layout
    Layered execution flows
    Orthogonal edge routing
    Ports
    Hierarchical arrangements

Our application layer
    Semantic zoom
    Graph chunk loading
    Commit overlays
    Function inspectors
    Source-code synchronization
    Repository navigation

React Flow is specifically intended for interactive node-based editors and supports custom nodes, edges, connection handles and the expected graph interactions.

ELK’s layered layout is designed for directional node-link diagrams and supports ports and orthogonal routing, which fits code execution and dependency diagrams well. React Flow also provides an official ELK integration example.

Why not tldraw as the primary engine?

tldraw is an excellent general-purpose infinite-canvas SDK with custom shapes, tools, arrows and polished canvas navigation.

But this product is fundamentally a structured graph explorer, not primarily a whiteboard.

React Flow gives us better native concepts for:

Nodes
Edges
Connection handles
Directed relationships
Edge selection
Graph state
Expandable groups
Automatic graph layouts
Path highlighting

tldraw would make more sense if we wanted users to freely sketch architecture, draw annotations and mix diagrams with unstructured content. We could eventually add that capability, but it should not drive the MVP architecture.

Large-repository fallback

React Flow should render the currently focused subgraph, not every symbol in the repository.

For example:

Entire repository:
35,000 functions stored server-side

Current system view:
20 domain/service nodes

Expanded Orders module:
65 nodes

Selected POST /orders path:
18 nodes

Function neighbourhood:
12 nodes

React Flow publishes performance guidance for larger graphs, but we should still benchmark our custom nodes and edges rather than assume unlimited scale.

For very large read-only graph overviews, we should keep the renderer replaceable. Cytoscape.js offers graph visualization and graph-analysis capabilities and uses browser canvas rendering.

Therefore:

React Flow + ELK.js for the MVP
Cytoscape.js or a WebGL renderer as a future large-graph overview
Never load or render the full repository graph by default
Keep the graph data model independent from the renderer
Add this clarification to the master prompt
PARSER AND VISUALIZATION TECHNOLOGY DECISIONS

These are explicit architecture decisions. Do not replace them without documenting and validating a materially better approach.

AST and language-analysis strategy

Use abstract syntax trees as one input to the code-analysis system, but do not treat a raw AST as sufficient for understanding application behaviour.

The system needs both:

Syntactic analysis
Semantic symbol resolution

A syntax tree can identify that a function call exists. A semantic resolver is required to determine which function, method, import or declaration that call refers to.

JavaScript and TypeScript MVP

For JavaScript and TypeScript, use the TypeScript Compiler API as the primary analysis engine.

Create a TypeScript Program and use its TypeChecker to resolve:

Symbols
Types
Imports
Exports
Function calls
Method calls
Class inheritance
Interfaces
Declarations
References
Module paths
Function signatures
Source locations

Support JavaScript repositories through TypeScript compiler options such as allowJs, while safely handling projects that have incomplete or invalid TypeScript configurations.

Do not use Python to parse JavaScript or TypeScript.

Do not rely exclusively on regex, AI interpretation or a syntax-only parser.

ts-morph may be evaluated as a convenience wrapper, but the architecture must retain access to the underlying TypeScript compiler nodes, symbols and type checker. Avoid creating a critical dependency on wrapper-specific abstractions when compiler-level access is required.

Python language support

Python is not part of the initial MVP, but design a future Python language adapter.

Python’s built-in ast module can be used for syntax extraction, including:

Modules
Functions
Async functions
Classes
Methods
Calls
Imports
Assignments
Conditions
Exceptions
Decorators

The built-in Python AST is not sufficient by itself for reliable cross-file call graphs, type inference or import resolution.

When implementing Python support, combine syntax analysis with an appropriate Python semantic-analysis or language-server layer.

The Python adapter must output the same language-neutral graph schema as the JavaScript and TypeScript adapter.

Future languages

Each language must have an isolated adapter:

Source Repository
       ↓
Language Detector
       ↓
Language-Specific Parser
       ↓
Language-Specific Semantic Resolver
       ↓
Framework Adapters
       ↓
Language-Neutral Code Graph

Tree-sitter may be evaluated as a shared syntax layer for future languages, especially when bootstrapping broad language support.

Do not use Tree-sitter as a substitute for language-specific semantic resolution when a compiler or language-service API is available.

Every graph fact must record:

Analyzer
Analyzer version
Language
Evidence type
Source location
Confidence
Whether the result is syntactic, semantic, framework-inferred or AI-generated
INFINITE CANVAS AND GRAPH RENDERING DECISION

Do not build an infinite-canvas rendering engine from scratch.

Use established libraries for rendering, navigation, graph interaction and automatic layout.

MVP renderer

Use React Flow, distributed through the @xyflow/react package, as the primary interactive graph renderer.

Use React Flow for:

Infinite canvas navigation
Pan and zoom
Node rendering
Custom node types
Custom edge types
Connection handles
Node selection
Edge selection
Multi-selection
Keyboard navigation
Grouped nodes
Parent-child nodes
Minimap
Viewport controls
Fit-to-view
Dragging
Focus mode
Viewport state

Build product-specific code blocks as custom React Flow nodes.

Examples include:

Application node
Module node
Function node
Class node
API-route node
Middleware node
Database node
External-service node
Conditional node
Commit-change node
Error node

Do not rebuild basic viewport mathematics, mouse interactions, node dragging, edge selection or zoom handling.

Graph layout

Use ELK.js as the primary automatic layout engine.

Use ELK’s layered layout for:

Execution paths
API request flows
Function call paths
Dependency direction
Conditional branches
Orthogonal edge routing
Explicit node ports
Nested modules
Compound graphs

Layout calculations should run in a Web Worker or analysis worker when they are expensive, preventing the main browser thread from freezing.

Store calculated layout coordinates with saved views so layouts do not unnecessarily recalculate every time the user opens a graph.

Allow a user to manually adjust node positions after automatic layout.

Why React Flow instead of a generic whiteboard engine

The core product is a structured, directed code graph rather than a general-purpose drawing application.

React Flow should be preferred because the product depends heavily on:

Nodes
Edges
Directed relationships
Ports
Graph selection
Path highlighting
Neighbourhood expansion
Automatic layouts
Edge metadata
Execution direction

A general infinite-canvas SDK such as tldraw may be evaluated later for freehand annotation, architecture sketching or mixed whiteboard experiences.

It should not be the primary graph renderer for the MVP unless a prototype proves that it handles structured code graphs better than React Flow.

Renderer abstraction

Do not couple the canonical graph schema directly to React Flow’s internal node and edge types.

Create a renderer adapter:

interface GraphRendererAdapter {
  createView(input: GraphViewInput): RenderableGraph;
  updateView(diff: GraphViewDiff): RenderableGraphUpdate;
  focusNode(nodeId: string): void;
  focusPath(pathId: string): void;
  setZoomLevel(level: SemanticZoomLevel): void;
}

The canonical code graph must remain renderer-independent.

This allows the product to introduce a Canvas or WebGL-based renderer later without changing repository analysis or persisted graph data.

Large-graph strategy

Do not send the full repository graph to the browser.

Use progressive graph loading.

The frontend should request only:

Repository overview nodes
Visible module nodes
Selected route paths
Selected function neighbourhoods
Changed commit regions
Explicitly expanded dependencies

Graph APIs must support:

Node limit
Edge limit
Neighbourhood depth
Incoming or outgoing direction
Node-type filters
Edge-type filters
Semantic zoom level
Bounding region
Continuation cursors

Collapse graph areas into aggregate nodes such as:

48 functions
12 routes
6 database operations
3 external integrations
142 unchanged functions

Expand these aggregates only when requested.

Performance validation

Create realistic performance fixtures and benchmark:

100 nodes
500 nodes
1,000 nodes
5,000 nodes
Dense call graphs
Deeply nested graphs
Graphs with large custom nodes
Commit overlay graphs
Graphs with animated path highlighting

Measure:

Initial render
Layout duration
Pan and zoom frame rate
Node expansion latency
Search-to-focus latency
Memory use
Edge-rendering cost

Do not claim React Flow supports the required repository size until the product’s custom nodes and edges have been benchmarked.

For very large overview graphs, evaluate Cytoscape.js or an appropriate WebGL renderer.

The default UX should avoid the need to display thousands of detailed function blocks simultaneously through semantic zoom, aggregation and progressive disclosure.