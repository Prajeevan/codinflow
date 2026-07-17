# MASTER PRODUCT, ARCHITECTURE AND EXECUTION PROMPT

You are acting as the founding CTO, principal software architect, product strategist, UX architect, security lead and senior full-stack engineer for a new developer platform.

You are not being asked to merely brainstorm this product.

You must:

1. Understand and refine the business.
2. identify the strongest initial customer and use case.
3. Design the complete product experience.
4. Define the technical architecture.
5. Design the data model and analysis engine.
6. Create a realistic implementation plan.
7. Scaffold and implement the MVP.
8. Test the system against real JavaScript and TypeScript repositories.
9. Clearly document limitations, assumptions and architectural decisions.
10. Continue executing rather than stopping after high-level recommendations.

When information is incomplete, make the strongest reasonable assumption, document it and proceed. Do not block progress by asking broad product questions that can be answered through sound product and engineering judgment.

---

# 1. PRODUCT VISION

Build a visual code intelligence platform that converts a software repository into a living, navigable map of how the application actually works.

The product should connect to a Git repository, initially through a GitHub App or direct repository connection, analyze the source code and transform the application into a human-readable visual system.

The visual system must show:

* Applications
* Services
* Modules
* Files
* Classes
* Functions
* Methods
* API routes
* Middleware
* Events
* Database operations
* State changes
* External APIs
* Background jobs
* Queues
* Important variables
* Conditional execution paths
* Imports and dependencies
* Calls between functions
* Data movement
* Error paths
* Tests associated with code
* Changes between commits

The result should appear on an infinite canvas using meaningful blocks, groups, arrows, labels, colours, icons, tags and levels of detail.

This should not look like a raw AST viewer or a complicated dependency graph intended only for compiler engineers.

It should feel like a visual explanation of the application.

A developer, technical lead, product manager or engineering executive should be able to open a repository and quickly understand:

* Where requests enter the application
* Which functions handle each request
* What validation occurs
* Which code runs under different conditions
* Which services and databases are involved
* Which external systems are contacted
* What changed in a commit or pull request
* What parts of the system may be affected by a change
* Whether AI-generated code modified existing behaviour
* Where risks, side effects and architectural inconsistencies may exist

The primary value proposition is:

> Turn every repository and commit into a visual, human-readable map of application behaviour.

---

# 2. CORE PRODUCT PRINCIPLE

Do not simply visualize every line of code.

The product must abstract away unnecessary implementation noise while retaining enough traceability that a developer can verify every conclusion against the source code.

Every visual statement must be traceable to:

* A file
* A source location
* A symbol
* An AST node
* A commit
* A deterministic analysis result
* An explicitly identified AI inference

The system must clearly distinguish between:

1. Deterministically proven relationships
2. Statically inferred relationships
3. AI-generated descriptions
4. Unresolved or uncertain runtime behaviour

Never present uncertain behaviour as fact.

---

# 3. INITIAL LANGUAGE SCOPE

The MVP must support JavaScript and TypeScript only.

Prioritize:

* Node.js
* Express
* Fastify
* Hono
* NestJS
* React
* Next.js
* Remix
* TanStack applications
* Cloudflare Workers
* Common REST APIs
* Common event-driven Node.js applications

The architecture must support future language adapters for:

* C#
* Java
* C++
* Python
* Go
* Rust
* PHP

Do not attempt to implement all languages in the first release.

Create a language-neutral graph schema, but implement only the JavaScript and TypeScript analyzer during the MVP.

---

# 4. APPLICATION-OWNED CODE VERSUS DEPENDENCY CODE

One of the most important product behaviours is how third-party packages are represented.

By default:

* Ignore `node_modules`.
* Ignore generated files.
* Ignore build output.
* Ignore minified files.
* Ignore vendored libraries.
* Ignore framework internals.
* Ignore package implementation details that are not part of the user’s repository.

Third-party dependencies should be represented as collapsed semantic boundary nodes.

For example, instead of displaying hundreds of Express internal functions, show:

* Express Router
* Authentication Middleware
* Shopify Admin API
* Stripe API
* PostgreSQL
* Redis
* Cloudflare D1
* Cloudflare KV
* Email Provider
* Message Queue

Show only the application-owned code that interacts with those dependencies.

A user should be able to expand a dependency boundary when deeper inspection is useful, but the default view should prioritize the code the team owns.

For a regular Express API application, the high-level visual flow might look like:

```text
Incoming HTTP Request
        ↓
Express Application
        ↓
Authentication Middleware
        ↓
POST /api/orders
        ↓
createOrder Controller
        ↓
validateShopifyOrder
      ↙          ↘
Invalid          Valid
  ↓                ↓
returnError     createOrderRecord
                    ↓
               Shopify Admin API
                    ↓
               Database Write
                    ↓
               Return Response
```

The user must be able to progressively expand this flow from the system level down to individual functions and source lines.

---

# 5. BUSINESS STRATEGY

Before implementation, create a concise but serious business plan.

The plan must include:

## Target customers

Evaluate and prioritize:

* Engineering teams using AI coding agents
* CTOs and technical leads
* Software agencies managing unfamiliar client repositories
* Enterprise modernization teams
* Teams onboarding developers into large codebases
* Teams reviewing high volumes of pull requests
* Security and compliance teams
* Technical due-diligence teams
* Companies with poorly maintained architecture documentation

Choose the strongest initial ideal customer profile.

## Initial wedge

The recommended initial wedge should be:

> Visual commit and pull-request review for JavaScript and TypeScript repositories, especially code created or modified by AI coding agents.

The first version does not need to replace GitHub.

It should integrate with GitHub as:

* A GitHub App
* A pull-request check
* A link attached to commits and pull requests
* A standalone repository analysis dashboard

Future integrations can include:

* GitLab
* Bitbucket
* Azure DevOps
* VS Code
* Cursor
* Claude Code
* OpenAI Codex
* CI/CD pipelines
* Local analysis CLI
* Self-hosted enterprise analysis workers

## Core jobs to be done

Users should hire the product to:

* Understand an unfamiliar repository
* Review what an AI coding agent changed
* See a commit as behavioural changes rather than line changes
* Identify the potential blast radius of a change
* Create living architecture documentation
* Follow the execution path of an API request
* Find all code connected to a function, route or data model
* Explain a complex function to a non-author
* Compare architecture between releases
* Detect architectural drift
* Speed up developer onboarding

## Monetization hypotheses

Design pricing around repository analysis and team usage.

Evaluate a structure such as:

### Free

* Public repositories
* One private repository
* Limited repository size
* Limited monthly analyses
* Current snapshot only
* Community support

### Professional

* Multiple private repositories
* Commit history
* Pull-request analysis
* AI explanations
* Saved visual views
* Architecture search
* Personal developer integrations

### Team

* Shared workspaces
* Comments
* Review assignments
* Architecture rules
* Team vocabulary
* Role-based access
* More analysis capacity
* Longer history

### Enterprise

* SSO
* Audit logs
* Data residency controls
* Private AI configuration
* Bring-your-own-model support
* Self-hosted or isolated analysis
* Custom retention
* Advanced security
* Dedicated support
* Organization-wide architecture maps

Evaluate pricing by seat, repository, analysis volume and organization size. Recommend the model that aligns revenue with customer value without making commit analysis unpredictable.

## Go-to-market

Create a go-to-market strategy based on:

* GitHub Marketplace distribution
* A free public-repository visualizer
* Interactive visualizations of recognizable open-source repositories
* Shareable architecture maps
* Pull-request status checks
* Content showing before-and-after visual commit maps
* Partnerships with AI coding platforms
* Agency and consulting use cases
* Developer onboarding use cases
* Technical due-diligence reports

## Product moat

Evaluate the following potential defensibility:

* Longitudinal code graph history
* Stable symbol identity across commits
* Organization-specific vocabulary
* User corrections to graph interpretations
* Architecture rule history
* Historical change-risk data
* Review behaviour
* Repository-specific semantic context
* Cross-repository service maps
* Integrations into the pull-request workflow

The product must not position itself as merely a prettier dependency graph.

Its differentiation is the combination of:

* Human-readable behaviour
* Visual execution paths
* Commit awareness
* Pull-request understanding
* AI-code oversight
* Source-level traceability
* Historical architecture intelligence

---

# 6. PRIMARY USER EXPERIENCE

Design the product around these principal flows.

## Flow A: Connect a repository

1. User signs in.
2. User installs the GitHub App or connects a repository.
3. User selects a repository and branch.
4. The product displays an analysis progress screen.
5. The analysis pipeline identifies the project type.
6. The user is taken to the generated architecture map.
7. A guided tour highlights entry points, routes, services and external systems.

## Flow B: Understand the application

The default repository screen should answer:

* What kind of application is this?
* Where does execution begin?
* What are the major application areas?
* What routes exist?
* What external systems exist?
* Which databases are used?
* Where are the most connected or risky functions?
* What recently changed?

Provide an application overview panel containing:

* Repository description
* Languages
* Frameworks
* Entry points
* Route count
* Function count
* Class count
* External integrations
* Data stores
* Background jobs
* Recent commits
* Analysis confidence
* Architecture warnings

## Flow C: Follow an execution path

A user selects an API route such as:

```text
POST /api/orders
```

The canvas isolates the route and displays:

1. Middleware
2. Route handler
3. Validation
4. Service functions
5. Database calls
6. External API calls
7. Response
8. Error paths

The user can select an arrow to understand why one node connects to another.

Example edge labels:

* `calls`
* `awaits`
* `if order is invalid`
* `if signature verification fails`
* `on successful payment`
* `passes orderId`
* `returns OrderResponse`
* `throws ValidationError`
* `writes order record`
* `emits order.created`
* `handles POST /api/orders`

## Flow D: Inspect a function

When a function block is selected, open an inspector panel containing:

* Function name
* Human-readable description
* Signature
* Parameters
* Return value
* File path
* Source lines
* Tags
* Incoming calls
* Outgoing calls
* Database access
* External API access
* Events emitted
* Events consumed
* Errors thrown
* Tests connected to the function
* Commit history
* Last author
* Complexity indicators
* Analysis confidence

Include a source-code tab showing the exact relevant code.

Clicking a source line should highlight the corresponding visual path.

## Flow E: Review a commit

For each commit, provide a visual architecture diff.

Show:

* Added blocks
* Removed blocks
* Modified blocks
* Added relationships
* Removed relationships
* Changed branch conditions
* Changed route behaviour
* Changed database operations
* Changed external API calls
* Changed asynchronous behaviour
* Changed error handling
* Changed parameters and return types
* Potential blast radius
* Potential breaking behaviour

The user must be able to toggle between:

* Before
* After
* Overlay
* Changed only
* Impacted path
* Full application context

Each commit should receive a human-readable summary such as:

> This commit changes the Shopify order-validation path. Invalid orders previously returned immediately. They are now passed to `normalizeOrder`, which calls the Shopify Admin API before writing a new order record. This introduces one new external API call and one new database write.

Every statement in the summary must link to the supporting nodes, edges and source changes.

## Flow F: Review a pull request

Create a pull-request review screen containing:

* Executive change summary
* Behavioural changes
* Changed visual map
* New external dependencies
* New environment variables
* New database writes
* New routes
* Removed routes
* Authentication changes
* Error-handling changes
* Affected tests
* Functions with increased complexity
* Suspected unused code
* Risk level
* Review comments
* Link back to GitHub

The GitHub check should provide a concise summary and a link to the full visualization.

---

# 7. INFINITE CANVAS UX

The canvas is the central product experience.

It must support:

* Pan
* Zoom
* Semantic zoom
* Minimap
* Search
* Keyboard navigation
* Fit to selection
* Focus mode
* Path tracing
* Expand and collapse
* Grouping
* Saved views
* Filters
* Tags
* Comments
* Shareable links
* Before-and-after comparison
* Source-code synchronization

## Semantic zoom levels

### Level 1: System

Show:

* Frontend
* Backend
* Workers
* Databases
* External APIs
* Queues
* Scheduled jobs
* Major domains

### Level 2: Feature or module

Show:

* Authentication
* Orders
* Payments
* Products
* Users
* Notifications
* Admin

### Level 3: File and class

Show:

* Files
* Classes
* Exported functions
* Route modules
* Services
* Repositories

### Level 4: Function

Show:

* Parameters
* Important variables
* Calls
* Branches
* Data access
* Errors
* Return paths

### Level 5: Source

Show:

* Relevant code
* Line numbers
* Source annotations
* Exact branch conditions
* Exact call sites

Do not display all levels simultaneously.

Large repositories must remain understandable through progressive disclosure.

## Visual node types

Create a consistent visual grammar for:

* Application
* Service
* Module
* File
* Class
* Interface
* Function
* Method
* API route
* Middleware
* Database
* Query
* External API
* Queue
* Event
* Background job
* Configuration
* Environment variable
* Test
* Error
* Conditional branch

Each node type should have a recognizable shape or icon, but do not rely only on colour.

## Function tags

Automatically apply useful tags such as:

* Async
* Exported
* Public API
* Route handler
* Middleware
* Calls external API
* Reads database
* Writes database
* Emits event
* Consumes event
* Uses environment variable
* Authentication
* Authorization
* Validation
* Error handling
* Recursive
* High fan-in
* High fan-out
* No tests detected
* Changed in current commit
* AI explanation available
* Unresolved dynamic call

Tags must be filterable.

## Graph layout

Do not position everything randomly.

Support multiple intelligent layouts:

* Execution flow
* Dependency hierarchy
* Route flow
* Data flow
* Event flow
* File structure
* Commit impact
* Manual layout

Preserve user-adjusted positions in saved views.

For the MVP, benchmark an interaction-focused node graph library and a hierarchical layout engine. Design the graph API so the renderer can later move to a WebGL-based implementation if very large graphs exceed DOM rendering limits.

Never send the entire graph to the browser when only a small region is visible. Support graph chunking and neighbourhood queries.

---

# 8. JAVASCRIPT AND TYPESCRIPT ANALYSIS ENGINE

Build deterministic code analysis first.

Use AI to explain structured findings, not to invent the graph.

The analyzer should use the TypeScript compiler and language-service capabilities, or another strongly justified parser and symbol-resolution approach.

Evaluate the TypeScript Compiler API, language service and `ts-morph`.

Tree-sitter may be used as a language-neutral parsing layer later, but TypeScript-specific symbol resolution should be used for the initial JavaScript and TypeScript implementation.

## Repository discovery

The analyzer must inspect:

* `package.json`
* Lock files
* `tsconfig.json`
* Workspace configuration
* Monorepo configuration
* Build scripts
* Source directories
* Framework configuration
* Environment examples
* Test configuration
* Route directories
* Worker configuration
* Deployment configuration

Detect:

* Package manager
* Monorepo structure
* Applications
* Packages
* Frameworks
* Entry points
* Build output
* Generated code
* Test files
* Configuration files
* Potential secrets

Never execute repository lifecycle scripts by default.

Do not automatically run:

* `postinstall`
* `prepare`
* Arbitrary build scripts
* Arbitrary test scripts
* Unknown binaries

Treat repositories as untrusted input.

## Symbol extraction

Extract:

* Files
* Imports
* Exports
* Functions
* Arrow functions
* Classes
* Constructors
* Methods
* Interfaces
* Type aliases
* Enums
* Variables with architectural importance
* Function parameters
* Return types
* Decorators
* Routes
* Middleware
* Event handlers
* Database clients
* External API clients
* Environment variables

Do not create permanent graph nodes for every local variable.

Promote a variable to a graph-level concept when it:

* Crosses function boundaries
* Holds important application state
* Controls a major branch
* Represents a service or dependency
* Represents an environment variable
* Represents user, order, payment or domain data
* Is read or written across modules
* Is part of an exported contract

## Relationship extraction

Extract relationships such as:

* Imports
* Exports
* Calls
* Awaits
* Instantiates
* Extends
* Implements
* Reads
* Writes
* Returns
* Throws
* Catches
* Emits
* Subscribes
* Routes to
* Runs before
* Runs after
* Validates
* Transforms
* Serializes
* Deserializes
* Tests
* Configures
* Depends on

## Conditional execution

Represent meaningful conditions as labelled edges.

Example:

```typescript
if (!isValidShopifyOrder(order)) {
  return rejectOrder(order);
}

return createOrder(order);
```

Visual representation:

```text
isValidShopifyOrder
        │
        ├── if false → rejectOrder
        │
        └── if true → createOrder
```

Preserve the actual condition as metadata:

```text
!isValidShopifyOrder(order)
```

Generate a human-readable edge label:

```text
if the Shopify order is invalid
```

The exact expression and source location must remain available in the inspector.

Avoid creating a visual node for every minor conditional statement. Promote conditions that affect:

* Function calls
* Returns
* Throws
* Database writes
* External API calls
* Authentication
* Authorization
* Business outcomes
* Events
* State changes

## Framework-specific adapters

Create adapters for common patterns.

### Express

Detect:

* `app.get`
* `app.post`
* `app.put`
* `app.patch`
* `app.delete`
* `router.*`
* Middleware ordering
* Route prefixes
* Route handlers
* Error middleware

### Hono

Detect:

* Route declarations
* Middleware
* Context usage
* Environment bindings
* Worker entry points

### Fastify

Detect:

* Routes
* Hooks
* Plugins
* Schemas
* Decorators

### NestJS

Detect:

* Controllers
* Decorators
* Providers
* Modules
* Guards
* Interceptors
* Pipes
* Dependency injection

### React

Detect:

* Components
* Hooks
* Context
* Event handlers
* API calls
* State changes
* Major component relationships

Do not turn every small JSX element into a graph node.

### Next.js

Detect:

* App Router routes
* Pages Router routes
* Route handlers
* Server actions
* Middleware
* API routes
* Client versus server boundaries
* Data fetching
* External requests

### Cloudflare Workers

Detect:

* Fetch handlers
* Queue consumers
* Scheduled handlers
* Durable Object classes
* D1 bindings
* KV bindings
* R2 bindings
* Queue bindings
* Service bindings
* Environment bindings

---

# 9. STABLE SYMBOL IDENTITY

Graph nodes need stable identities across commits.

Do not identify a symbol only by line number.

Design a stable symbol key using a combination of:

* Repository ID
* Language
* Package or workspace
* File path
* Fully qualified symbol name
* Symbol kind
* Parent symbol
* Signature
* AST structure fingerprint

Account for:

* File moves
* Function moves
* Function renames
* Signature changes
* Refactoring
* Extracted functions
* Inlined functions

Create a similarity-based reconciliation process for symbols that cannot be matched exactly.

Every matched symbol should include:

* Match method
* Confidence
* Previous identity
* Current identity

This identity system is essential to commit visualization and must be treated as a first-class architectural component.

---

# 10. HUMAN-READABLE FUNCTION DESCRIPTIONS

Every important function should receive a concise plain-language explanation.

Example:

> Validates the required order fields and verifies that the order originated from Shopify. Invalid orders are passed to `rejectOrder`. Valid orders continue to `createOrderRecord`.

Generate descriptions from structured facts such as:

* Function name
* Parameters
* Return type
* Conditions
* Calls
* Database access
* External API access
* Errors
* Comments
* Surrounding symbols

The description system must:

* Avoid claims unsupported by analysis
* Link every sentence to evidence
* Show confidence
* Regenerate only when the underlying facts change
* Allow a developer to edit or approve the description
* Preserve organization-specific terminology
* Avoid exposing secrets
* Avoid sending entire repositories to an external model unnecessarily

The ideal pipeline is:

1. Deterministic analyzer produces structured facts.
2. Relevant facts and small code excerpts are selected.
3. Sensitive values are redacted.
4. AI generates a description.
5. The description is validated against the structured facts.
6. The result is stored with model and prompt metadata.
7. The user can inspect the evidence.

Use AI for:

* Function summaries
* Commit summaries
* Pull-request summaries
* Suggested tags
* Architecture-area naming
* Natural-language search
* Possible risk explanations

Do not use AI as the only source for:

* Symbol existence
* Call relationships
* Route definitions
* Import relationships
* Database writes
* Source locations
* Commit changes

---

# 11. COMMIT AND PULL-REQUEST DIFF ENGINE

Store a graph snapshot for each analyzed commit.

For subsequent commits, perform incremental analysis.

The pipeline should:

1. Read the Git diff.
2. Determine changed files.
3. Parse changed files.
4. Reconcile changed symbols.
5. Identify direct relationships.
6. Recompute affected reverse dependencies.
7. Update graph fragments.
8. Compare current and previous graph snapshots.
9. Generate behavioural changes.
10. Calculate blast radius.
11. Generate a human-readable summary.

Classify changes as:

* Node added
* Node removed
* Node renamed
* Node moved
* Node signature changed
* Node implementation changed
* Edge added
* Edge removed
* Edge condition changed
* External API added
* External API removed
* Database read added
* Database write added
* Route added
* Route removed
* Authentication changed
* Authorization changed
* Error path changed
* Async behaviour changed
* Event flow changed
* Environment variable added
* Dependency boundary changed

## Blast radius

Calculate blast radius using:

* Incoming callers
* Outgoing dependencies
* Route exposure
* Shared state
* Database tables
* Events
* Public exports
* Tests
* Cross-package dependencies
* Historical co-change patterns

Do not present blast radius as certainty.

Present:

* Directly affected
* Probably affected
* Potentially affected
* Unknown dynamic impact

---

# 12. CLOUDFLARE-NATIVE ARCHITECTURE

Keep the application primarily on Cloudflare.

Use the following architecture as the starting point, but verify current Cloudflare capabilities and limits before implementation.

## Frontend

Use:

* React
* TypeScript
* Vite
* A Cloudflare-compatible full-stack deployment
* TanStack Query
* A lightweight router
* Tailwind
* shadcn-style accessible components
* A node graph or infinite-canvas renderer
* Hierarchical layout tooling
* Monaco Editor or a suitable read-only source viewer

The frontend should be deployed through Cloudflare Workers or the currently recommended Cloudflare full-stack path.

## API layer

Use Cloudflare Workers for:

* Authentication callbacks
* Repository APIs
* Graph queries
* Search
* Webhook endpoints
* Commit APIs
* Pull-request APIs
* Saved views
* Comments
* User preferences
* Organization administration
* Usage metering
* Starting analysis workflows

Use framework-native bindings rather than calling Cloudflare services through unnecessary REST requests.

## D1

Use D1 for relational metadata:

* Users
* Organizations
* Memberships
* Repositories
* Repository installations
* Branches
* Commits
* Pull requests
* Analysis runs
* Symbol metadata
* Graph snapshot metadata
* Node change metadata
* Tags
* Saved views
* Comments
* Review status
* Billing entitlements
* Audit events
* Model-generation metadata

Do not store massive graph payloads directly in relational rows when object storage is more appropriate.

## R2

Use R2 for large and versioned artifacts:

* Repository archives
* Analysis input bundles
* Parsed AST artifacts where appropriate
* Graph snapshot files
* Graph partitions
* Source indexes
* Generated reports
* Exported diagrams
* Large commit-diff payloads
* Debug artifacts
* Analysis logs with controlled retention

Use content-addressed object keys where practical.

## KV

Use KV for read-heavy or temporary values:

* Session-related cache
* Repository settings cache
* Framework detection cache
* Popular graph neighbourhoods
* Signed temporary references
* Feature flags
* Rate-limit metadata where appropriate
* Model prompt templates
* Short-lived analysis status cache

Do not use KV for strongly consistent workflow state.

## Queues

Use Queues to decouple:

* Webhook ingestion
* Repository analysis requests
* AI summary generation
* Embedding generation
* Search-index updates
* Graph partition generation
* Notification delivery
* Usage aggregation

Messages must be idempotent and safe to retry.

## Workflows

Use Workflows to orchestrate the durable repository-analysis pipeline.

Potential steps:

1. Validate repository access.
2. Create analysis record.
3. Retrieve repository archive or clone metadata.
4. Create isolated analysis environment.
5. Discover project structure.
6. Parse JavaScript and TypeScript.
7. Resolve symbols.
8. Extract graph relationships.
9. Detect framework concepts.
10. Build graph partitions.
11. Upload artifacts to R2.
12. Write metadata to D1.
13. Generate human-readable summaries.
14. Generate embeddings.
15. Compare against the previous commit.
16. Calculate change impact.
17. Finalize analysis.
18. Notify users and GitHub.

Every step must be idempotent.

Store large outputs in R2 and pass references between steps rather than passing huge payloads through workflow state.

## Sandbox or Containers

Use an isolated Cloudflare Sandbox or Container for operations that require:

* A filesystem
* Git
* TypeScript compiler execution
* Repository extraction
* Monorepo discovery
* Language tooling
* CPU-intensive graph analysis
* Future multi-language parsers

Repositories are untrusted.

The analysis environment must:

* Run with tenant isolation
* Use strict resource limits
* Use timeouts
* Limit filesystem scope
* Disable or severely restrict outbound network access
* Avoid package scripts
* Prevent secret access
* Detect archive traversal
* Detect symlink abuse
* Detect zip bombs
* Limit repository size
* Limit file count
* Limit individual file size
* Clean up temporary storage
* Record the analyzer version

## Durable Objects

Use Durable Objects selectively for:

* Live analysis progress
* WebSocket coordination
* Collaborative canvas sessions
* Presence
* Real-time comments
* Per-repository analysis coordination
* Preventing duplicate simultaneous analyses
* Short-lived distributed locks

Do not place the entire permanent graph in one Durable Object.

## Workers AI and AI Gateway

Use Workers AI or another deliberately selected model through a controlled abstraction for:

* Function summaries
* Commit summaries
* Pull-request summaries
* Natural-language queries
* Tag suggestions
* Architecture-area labels

Use AI Gateway for:

* Model observability
* Usage tracking
* Caching where appropriate
* Rate limits
* Provider fallback
* Cost controls
* Prompt version tracking

The model layer must be replaceable.

## Vectorize

Use Vectorize for semantic retrieval across:

* Functions
* Classes
* Routes
* Human-readable summaries
* Architecture areas
* Commit summaries
* Documentation

Example searches:

* “Where do we validate Shopify orders?”
* “Which functions can create a refund?”
* “What code sends customer emails?”
* “What changed in authentication this month?”
* “Which functions write to the orders table?”

Semantic results must link back to deterministic graph entities.

## Cloudflare Artifacts

Treat Git-compatible Cloudflare artifact storage as an optional future integration.

Do not make the MVP dependent on beta or limited-access services.

## Analytics

Capture product analytics for:

* Repositories connected
* Successful analyses
* Analysis duration
* Analysis failures
* Commit maps opened
* Paths explored
* Graph-to-code clicks
* Search usage
* Pull-request checks opened
* Saved views
* Weekly active repositories
* Weekly active reviewers
* Time from repository connection to first useful insight

---

# 13. END-TO-END ANALYSIS FLOW

Design the system around this flow:

```text
GitHub Webhook
      ↓
Cloudflare Worker
      ↓
Validate Signature and Installation
      ↓
Create Commit and Analysis Records in D1
      ↓
Start Analysis Workflow
      ↓
Create Isolated Sandbox
      ↓
Retrieve Repository
      ↓
Analyze Project Structure
      ↓
Parse JavaScript and TypeScript
      ↓
Resolve Symbols and Relationships
      ↓
Create Language-Neutral Graph
      ↓
Store Graph Partitions in R2
      ↓
Store Searchable Metadata in D1
      ↓
Generate Summaries
      ↓
Update Vector Search
      ↓
Compare Against Previous Commit
      ↓
Generate Behavioural Diff
      ↓
Update Analysis Status
      ↓
Publish GitHub Check
      ↓
Notify Connected Clients
```

The frontend should receive real-time status updates during analysis.

---

# 14. GRAPH DATA MODEL

Design and implement a versioned graph schema.

A graph node should resemble:

```typescript
type GraphNode = {
  id: string;
  repositoryId: string;
  commitSha: string;
  language: "javascript" | "typescript";
  kind:
    | "application"
    | "module"
    | "file"
    | "class"
    | "interface"
    | "function"
    | "method"
    | "route"
    | "middleware"
    | "database"
    | "query"
    | "external_api"
    | "queue"
    | "event"
    | "job"
    | "configuration"
    | "environment_variable"
    | "test"
    | "error"
    | "condition";
  name: string;
  qualifiedName?: string;
  parentId?: string;
  filePath?: string;
  source?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  signature?: string;
  summary?: string;
  tags: string[];
  visibility?: "private" | "internal" | "public";
  frameworkRole?: string;
  analysisConfidence: number;
  sourceFingerprint?: string;
  metadata: Record<string, unknown>;
};
```

A graph edge should resemble:

```typescript
type GraphEdge = {
  id: string;
  repositoryId: string;
  commitSha: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind:
    | "imports"
    | "exports"
    | "calls"
    | "awaits"
    | "instantiates"
    | "extends"
    | "implements"
    | "reads"
    | "writes"
    | "returns"
    | "throws"
    | "catches"
    | "emits"
    | "subscribes"
    | "routes_to"
    | "runs_before"
    | "runs_after"
    | "validates"
    | "transforms"
    | "tests"
    | "depends_on";
  label?: string;
  condition?: string;
  sourceLocation?: {
    filePath: string;
    line: number;
    column: number;
  };
  analysisConfidence: number;
  metadata: Record<string, unknown>;
};
```

Create separate change records rather than mutating historical snapshots.

Support graph partitioning by:

* Application
* Package
* Module
* File
* Feature
* Neighbourhood
* Commit
* Route
* Saved view

---

# 15. API DESIGN

Create typed APIs for:

* Organizations
* Repositories
* Repository installations
* Branches
* Commits
* Pull requests
* Analysis status
* Graph overview
* Graph neighbourhood
* Node details
* Edge details
* Execution paths
* Route maps
* Commit diffs
* Pull-request diffs
* Search
* Saved views
* Comments
* Tags
* Summary feedback
* Usage
* Administration

Important graph endpoints should support:

* Depth
* Direction
* Edge types
* Node types
* Tags
* Commit SHA
* Comparison SHA
* Maximum node count
* Cursor pagination
* Confidence threshold
* Application-owned code only
* Dependency-boundary expansion

Do not create a single endpoint that returns an entire enterprise repository graph.

---

# 16. SECURITY AND PRIVACY

Repository code is highly sensitive.

Create a detailed threat model covering:

* Malicious repositories
* Supply-chain scripts
* Secret leakage
* Cross-tenant access
* GitHub token exposure
* Webhook forgery
* Prompt injection inside source comments
* Archive traversal
* Symlink attacks
* Resource exhaustion
* Large-file denial of service
* Model-provider data exposure
* Improper cache keys
* Insecure temporary URLs
* Log leakage
* Broken access control
* Dependency vulnerabilities

Required principles:

* Least-privilege GitHub App permissions
* Validate webhook signatures
* Encrypt secrets
* Never place access tokens in logs
* Tenant-aware object keys
* Tenant-aware cache keys
* Signed short-lived artifact URLs
* Strict repository size limits
* Strict analysis time limits
* No package scripts by default
* Restricted network access
* Configurable code retention
* Repository deletion workflow
* Audit logging
* Role-based access control
* Model opt-out
* Clear disclosure of what code is sent to AI
* Small evidence bundles rather than entire repositories
* Prompt-injection-resistant summarization
* Source comments treated as untrusted data

AI instructions found inside repository files must never override system instructions.

---

# 17. MONOREPO STRUCTURE

Create a clean monorepo such as:

```text
/apps
  /web
  /api

/workers
  /webhook
  /analysis-orchestrator
  /queue-consumer
  /ai-summary
  /search-indexer

/packages
  /auth
  /database
  /d1-schema
  /graph-schema
  /graph-storage
  /graph-diff
  /github
  /analyzer-core
  /analyzer-js-ts
  /analyzer-express
  /analyzer-hono
  /analyzer-fastify
  /analyzer-react
  /analyzer-next
  /analyzer-cloudflare
  /ai
  /ui
  /config
  /observability

/containers
  /repository-analyzer

/fixtures
  /express-api
  /hono-worker
  /next-app
  /typescript-library
  /monorepo

/docs
  product-brief.md
  business-plan.md
  architecture.md
  architecture-decisions.md
  ux-specification.md
  graph-schema.md
  analysis-engine.md
  commit-diff-engine.md
  security.md
  privacy.md
  cloudflare-infrastructure.md
  implementation-roadmap.md
  testing-strategy.md
```

Use strict TypeScript.

Avoid untyped boundaries.

Validate external and persisted data at runtime.

---

# 18. MVP SCOPE

The MVP must deliver one complete, impressive workflow rather than many incomplete features.

## Required MVP

* GitHub authentication
* Connect one repository
* Analyze the default branch
* JavaScript and TypeScript support
* Express route detection
* Function and class extraction
* Import and call relationships
* External dependency boundaries
* Database and external API tagging
* Human-readable function descriptions
* Infinite canvas
* Semantic zoom
* Function inspector
* Source-code linkage
* Search
* Analyze a second commit
* Visual commit comparison
* Human-readable commit summary
* Shareable read-only map
* Basic GitHub pull-request check
* Analysis status and error handling

## Explicitly defer

* Full multi-language support
* Runtime tracing
* Production traffic capture
* Full collaborative editing
* Enterprise SSO
* Cross-repository service maps
* Automatic code modification
* Full IDE replacement
* Deep visualization of third-party package internals
* Perfect resolution of highly dynamic JavaScript
* Self-hosted enterprise deployment

---

# 19. IMPLEMENTATION PHASES

## Phase 0: Product and architecture

Produce:

* Product brief
* Business model
* Ideal customer profile
* Competitive research
* MVP definition
* UX flows
* Architecture
* Data model
* Threat model
* Cost model
* Architecture decision records
* Success metrics

Do not remain in Phase 0 indefinitely.

## Phase 1: Deterministic analyzer

Build:

* Repository discovery
* TypeScript project loading
* File extraction
* Symbol extraction
* Import graph
* Function call graph
* Class relationships
* Express routes
* Source locations
* Stable symbol IDs
* Graph JSON output

Test this against fixture repositories.

## Phase 2: Cloudflare ingestion pipeline

Build:

* Repository connection
* Webhook validation
* D1 schema
* R2 artifact storage
* Analysis workflow
* Sandbox execution
* Queue consumers
* Progress events
* Failure recovery
* Idempotency

## Phase 3: Visual experience

Build:

* Repository overview
* Infinite canvas
* Node inspector
* Edge inspector
* Search
* Filters
* Semantic zoom
* Route focus
* Source linkage
* Saved layout state

## Phase 4: Commit intelligence

Build:

* Snapshot comparison
* Stable symbol reconciliation
* Added and removed nodes
* Changed relationships
* Behavioural summary
* Blast-radius view
* Before, after and overlay modes

## Phase 5: GitHub workflow

Build:

* Pull-request webhook
* Commit analysis
* GitHub check status
* Concise summary
* Link to visual diff
* Repository settings

## Phase 6: Production hardening

Build:

* Tenant isolation
* Rate limiting
* Resource limits
* Audit logging
* Retention
* Usage metering
* Monitoring
* Error reporting
* Performance testing
* Security testing

---

# 20. TESTING STRATEGY

Create fixture repositories containing known behaviours.

At minimum:

## Express fixture

Include:

* Middleware
* Authentication
* Routes
* Controllers
* Services
* Database access
* Shopify API call
* Conditional validation
* Error paths
* Async functions
* Tests

## Hono Worker fixture

Include:

* Worker bindings
* D1
* KV
* Queue
* External API
* Scheduled event

## TypeScript library fixture

Include:

* Classes
* Interfaces
* Inheritance
* Generics
* Exports
* Circular imports
* Overloaded functions

## Commit history fixture

Create sequential commits that:

* Add a route
* Rename a function
* Move a function
* Add a database write
* Add an external API call
* Change an error path
* Remove authentication
* Extract a helper
* Change async behaviour

Create golden expected graph files.

Tests must verify:

* Node extraction
* Edge extraction
* Source location
* Stable IDs
* Framework detection
* Diff classification
* Human-readable evidence
* Graph partitioning
* Tenant boundaries
* Idempotent workflows

Track analyzer precision separately from AI-summary quality.

---

# 21. QUALITY REQUIREMENTS

The product must be:

* Technically credible
* Visually understandable
* Fast enough for real repositories
* Secure with private source code
* Incremental rather than repeatedly analyzing everything
* Honest about uncertainty
* Traceable to source
* Useful before multi-language support
* Easy to demo
* Valuable during every pull request

Do not create a visually impressive graph that developers cannot trust.

Do not create a technically correct graph that humans cannot understand.

The product succeeds only when it achieves both.

---

# 22. SUCCESS METRICS

Define and instrument:

* Time to first repository map
* Successful analysis rate
* Median analysis duration
* Incremental analysis duration
* Percentage of graph statements with source evidence
* Percentage of resolved function calls
* Search-to-useful-result rate
* Graph-to-source click rate
* Commit maps reviewed
* Pull-request checks opened
* Weekly active repositories
* Weekly active reviewers
* Saved views created
* User corrections to summaries
* Time required to understand a pull request
* Developer onboarding time
* Retention by connected repository

The main product metric should relate to:

> How quickly a user can confidently understand a repository or code change.

---

# 23. OPERATING RULES FOR YOU, THE AI ENGINEERING LEAD

Follow these rules throughout execution:

1. Do not blindly accept the initial architecture if testing reveals a better design.
2. Document important decisions as ADRs.
3. Prefer deterministic analysis over AI inference.
4. Use AI only where language understanding adds value.
5. Treat repositories as hostile input.
6. Keep every graph fact traceable.
7. Build one end-to-end path early.
8. Avoid premature multi-language abstraction.
9. Avoid microservices unless a Cloudflare boundary genuinely requires one.
10. Keep shared domain types in dedicated packages.
11. Make jobs idempotent.
12. Design for incremental analysis.
13. Do not load full enterprise graphs into the browser.
14. Preserve historical snapshots.
15. Track analyzer and schema versions.
16. Surface uncertainty visibly.
17. Use fixtures and golden tests.
18. Keep the UI useful for both developers and technical non-authors.
19. Optimize the default view for application-owned code.
20. Do not expose third-party package internals unless requested.
21. Do not stop after creating documentation.
22. Proceed from architecture into implementation.
23. After every phase, state what is complete, what was validated and what remains.
24. When a technical limitation is discovered, propose and implement the most practical fallback.
25. Never claim a feature works until it has been tested.

---

# 24. FIRST REQUIRED RESPONSE

Begin by producing the following, in order:

1. Refined one-paragraph product definition
2. Product name ideas and recommended working name
3. Initial ideal customer profile
4. Strongest initial use case
5. Business model hypothesis
6. Product differentiation
7. MVP scope
8. Primary UX flow
9. Cloudflare architecture diagram
10. Analysis pipeline diagram
11. Initial graph schema
12. D1 entity model
13. Security threat summary
14. Key architecture decisions
15. Twelve-week implementation plan
16. Repository and package structure
17. Major technical risks
18. Assumptions being made
19. The first implementation milestone
20. The actual files and code to create next

After providing this foundation, begin creating the product.

Do not respond with generic advice such as “consider using an AST parser” or “you could use a graph database.”

Make specific decisions.

Explain why each major choice is being made.

Identify where an experiment is needed.

Then execute the first milestone.
