# PROMPT ARENA — MASTER AUTONOMOUS BUILD MISSION
## PONYTAIL + Dual Codex + BL3 Architect/Orchestrator + BL4 Reviewer/Executor

> **Primary receiver:** BL3, acting as Orchestrator and Architect.
>
> **Canonical implementation worker:** BL4, acting as Executor and also holding the configured Reviewer role where the control plane supports that mapping.
>
> **Final authority:** ChatGPT/user mission contract.
>
> **Target repository:** `bielxdh3/Prompt-Arena`
>
> **Official target platforms:** Windows and Linux only.
>
> **macOS:** explicitly out of scope. Do not create macOS CI, packaging, compatibility work, roadmap commitments, or release targets unless a future explicit user instruction overrides this.
>
> **Mission mode:** maximum safe autonomy. Complete as much of the full application and current roadmap as technically possible without routine human intervention. Defer unavoidable human-only actions to one final action queue. Do not stop merely because one non-critical item is blocked.
>
> **Remote authorization for this mission:** creating non-destructive local commits, pushing non-destructive feature/stack branches to `origin`, and opening multiple pull requests is explicitly authorized. Do not merge PRs, force-push, rewrite public history, delete remote branches, publish packages, create releases/tags, deploy anything, mutate external production systems, or perform destructive remote operations without a new explicit authorization.
>
> **Important:** do not collapse this mission into one giant commit or one giant PR. Use multiple coherent commits and multiple coherent PRs. Do not manufacture meaningless micro-commits merely to satisfy a count.

---

# 0. EXECUTIVE MISSION

Build **Prompt Arena** as a polished, open-source, local-first desktop application for comparing AI models through reproducible benchmarks, blind human evaluation, objective verification, performance/cost measurements, immutable benchmark versioning, rich historical analysis, local model management, configurable runtime execution, and extensive visual personalization.

The mission should progress from an empty or near-empty repository to the most complete, coherent, tested application that can be achieved under the constraints in this document.

This is not a prototype-only mission.

This is not a "scaffold and stop" mission.

This is not a planning-only mission.

This is not permission to create a cloud service.

The desired outcome is a working, reviewable application with a serious architecture, real local-model execution, a usable benchmark workflow, polished UI, durable data, tests, documentation, packaging/build validation, and a truthful list of anything that still requires human action or is genuinely blocked.

If a later-phase capability cannot be completed safely because of an unavailable dependency, operating-system limitation, missing external credential, unavailable runtime, missing GPU, missing Docker, unavailable provider, CI limitation, or similar isolated condition:

1. isolate the blocker;
2. preserve evidence;
3. implement everything around it that can be implemented safely;
4. use mocks/contract tests only where they accurately validate the integration boundary;
5. continue independent phases;
6. record the exact blocker in the final report;
7. leave the smallest possible human action queue.

Do not ask the user routine engineering questions.

Make safe, reversible, architecture-consistent choices when the repository and this specification provide enough information.

---

# 1. AUTHORITY, PRECEDENCE, AND NON-NEGOTIABLE WORKFLOW

Use this precedence order:

1. Current explicit user instructions and this mission document.
2. The actual installed PONYTAIL skill and this document's PONYTAIL contract.
3. Applicable `AGENTS.md` / `AGENTS.override.md`.
4. Mandatory installed project/review/security/publication skills.
5. Applicable repository-local skills.
6. Current source, tests, schemas, migrations, CI, and documentation in `bielxdh3/Prompt-Arena`.
7. Read-only reference material from `bielxdh3/demanage`, only for visual/layout inspiration.
8. Historical context only as evidence, never as a reason to overwrite current repository truth.

If a conflict appears, preserve higher-precedence instructions and explicitly report the conflict.

ChatGPT/user remains the final authority on:

- product scope;
- architecture-level acceptance;
- security posture;
- final acceptance;
- PR merging;
- releases/tags;
- deployments;
- destructive remote operations;
- unresolved product-direction choices not already decided here.

Routine implementation choices belong to the BL3 → Dual Codex → BL4 → BL3 review loop.

---

# 2. MANDATORY PONYTAIL MASTER PROCESS

PONYTAIL is mandatory.

Before material repository work, BL3 and BL4 must resolve, read, and apply the actual installed `ponytail` skill available in their environments.

Do not merely mention PONYTAIL.
Do not imitate a remembered version.
Do not substitute this prompt for the real installed skill.
Do not claim skill use from self-report alone.

Recommended skill/instruction load order:

```text
1. ponytail
2. project-phase-review
3. project-security-review
4. project-publication-check, because this mission explicitly authorizes non-destructive push/PR publication
5. other mandatory installed global skills genuinely applicable to the task
6. repository-local skills genuinely applicable to the current phase
7. AGENTS.md / AGENTS.override.md
8. repository inspection
9. phase planning / implementation / review
```

If a mandatory skill is not installed or cannot be resolved, distinguish:

```text
mandatory_skill_missing
mandatory_skill_unreadable
mandatory_skill_identity_unproven
```

If the missing skill is mission-wide mandatory, fail closed for mutations that depend on it. Continue only read-only diagnosis and independent safe work that does not pretend compliance.

### Skill attestation

For file-backed skills record:

```text
Skill:
Role:
Resolved canonical path:
SHA-256:
Read/load status:
First non-secret heading/name:
How applied:
```

For runtime/resource-backed skills record:

```text
Skill:
Role:
Resolved resource identifier:
Resource/version identity if exposed:
Read/load status:
First heading/metadata:
How applied:
```

Expected markers:

```text
DUAL_CODEX_ARCHITECT_SKILL_ATTESTATION_OK
DUAL_CODEX_SKILL_ATTESTATION_OK
```

Markers without underlying evidence are insufficient.

---

# 3. DUAL CODEX ROLE MAPPING

The intended role mapping for this mission is:

```text
BL3 / biel3:
  orchestrator
  architect

BL4 / biel4:
  executor
  reviewer
```

The control plane must prove the actual configured mapping. Treat the labels above as intended targets, not self-authenticating facts.

BL4 may hold both `executor` and `reviewer` roles as requested, but BL4's reviewer output does **not** replace the independent review required from BL3 as Architect.

The mandatory independence boundary is:

```text
BL4 implements
BL4 may perform configured reviewer checks
BL3 independently inspects, validates, and accepts/rejects the phase
```

BL3 must not become the hidden implementation worker.

BL4 must remain the canonical implementation worker through corrections.

No native Codex subagent fan-out.
No substitute Executor.
No improvised second implementation channel.
No silent backend switch.
No "temporary direct implementation by Architect" for convenience.

The only exception is repair of Dual Codex itself. If Dual Codex must be modified/repaired, use direct Codex under ChatGPT authority for the Dual Codex repair only, validate it, then resume this mission through the canonical Dual Codex path.

---

# 4. DUAL CODEX BACKEND AND PROVENANCE

Use the backend actually configured for BL4.

Prefer App Server/headless when that is the configured backend.

Never silently switch backend to escape a problem.

For App Server/headless, reconcile as available:

```text
target_account
target_role
profile / CODEX_HOME identity
target repository
backend / transport
executor process id
app-server process id
session id
thread/conversation id
turn id
request/result correlation id
```

For native TUI only when explicitly selected, additionally reconcile as available:

```text
terminal_session_id
PID
epoch / generation
lease owner
lease generation
reuse_provenance
attach/reuse identity
```

Do not require TUI-only evidence from App Server.

Do not treat model statements such as "I am BL4" or "I am in the correct repository" as provenance.

Use trustworthy control-plane/result metadata.

If the intended Executor/account/profile/repository/backend/provenance cannot be proven, fail closed for implementation.

Suggested failure labels:

```text
target_identity_unproven
target_account_mismatch
target_profile_mismatch
target_repository_mismatch
backend_identity_unproven
executor_skill_attestation_missing
architect_skill_attestation_missing
unauthorized_backend_switch
replacement_executor_detected
native_subagent_fallback_detected
target_session_provenance_missing
```

---

# 5. MANDATORY PREFLIGHT

Before the first implementation mutation:

1. Load and attest BL3 mandatory skills.
2. Inspect repository instructions.
3. Inspect repository state.
4. Inspect Dual Codex status.
5. Resolve current BL3 and BL4 account/role mapping.
6. Verify configured BL4 backend.
7. Verify BL4 profile/CODEX_HOME identity when exposed.
8. Verify target repository is exactly the Prompt Arena repository.
9. Verify current branch and remotes.
10. Verify no unrelated user work will be overwritten.
11. Perform a harmless read-only semantic probe through the configured BL4 backend.
12. Require BL4 mandatory skill attestation.
13. Reconcile the first probe's provenance.
14. Perform a second harmless probe using the same logical BL4/backend.
15. Reconcile the second probe.
16. Confirm no replacement Executor or backend switch occurred.
17. Record transport status separately from semantic status.
18. Inspect the remote repository before assuming local state is authoritative.
19. If a local clone exists, prefer `git fetch` plus safe fast-forward logic. Do not reset/discard work.
20. If no clone exists and cloning is permitted in the environment, clone the public repository into an appropriate local path.
21. If the repository is empty, bootstrap it safely rather than treating emptiness as failure.

No implementation phase begins until preflight is accepted.

---

# 6. AUTONOMOUS BLOCKER POLICY

The mission must not terminate just because one item is blocked.

Classify blockers:

### Mission-wide hard blockers

These stop repository mutation:

- Dual Codex canonical Executor identity/provenance cannot be proven.
- Mandatory PONYTAIL/skill loading cannot be proven.
- Target repository identity cannot be proven.
- Repository safety cannot be established.
- A Critical/High security condition makes further mutation unsafe.
- Continuing would overwrite/discard unknown user work.
- Required authorization for a destructive or non-authorized remote action is missing.

### Local blockers

These block only the affected item:

- Docker unavailable.
- Ollama not installed.
- LM Studio not installed.
- llama.cpp not installed.
- no local GPU.
- no API key.
- provider network unavailable.
- a specific optional system API unavailable.
- a single OS-specific packaging dependency missing.
- one CI image failing for an environmental reason.
- a model catalog unavailable.
- hardware telemetry unsupported on a specific machine.

For a local blocker:

```text
isolate
→ implement surrounding contracts
→ add mocks/fixtures/contract tests where honest
→ continue independent phases
→ record blocker
```

Do not silently pretend the integration worked.

Do not weaken tests merely to make a gate green.

---

# 7. REMOTE/GIT AUTHORIZATION FOR THIS MISSION

The user explicitly authorizes:

```text
git fetch
safe git pull / pull --ff-only when appropriate
local branch creation
local commits
multiple coherent commits
non-destructive push of feature/stack branches to origin
remote feature/stack branch creation
multiple pull requests
updating already-created mission PR branches non-destructively
read-only GitHub inspection
CI observation
```

The user does **not** authorize:

```text
force push
history rewrite
deleting remote branches
merging PRs
auto-merge
release
tag
package publication
deployment
production mutation
repository deletion
repository visibility changes
repository settings mutation
secret creation/rotation
destructive Git
```

If push/PR creation is blocked, continue local implementation and record:

```text
publication_blocked_but_local_work_complete
```

### Commit policy

Do not make one giant commit.
Do not create meaningless one-line micro-commits.

Prefer cohesive commits such as:

```text
chore: bootstrap cross-platform desktop workspace
feat(domain): add immutable benchmark version model
feat(storage): add sqlite migrations and artifact store
feat(runtime): add provider/runtime adapter contracts
feat(ollama): discover and execute local models
feat(arena): add run orchestration and event persistence
feat(eval): add objective and blind human evaluation
feat(ui): add arena builder and results surfaces
feat(models): add unified local model library
feat(theme): add configurable typography and color tokens
test: add integration and regression coverage
docs: document architecture and contributor workflows
```

Every commit must be buildable or at least internally coherent unless explicitly a preparatory commit in a stacked PR.

### PR policy

Do not collapse the entire application into one PR.

Because PR merge is not authorized, prefer **stacked PRs**:

```text
main
  ↑
phase-01-foundation
  ↑
phase-02-domain-storage
  ↑
phase-03-runtime-ollama
  ↑
phase-04-arena-evaluation
  ↑
phase-05-model-library
  ↑
phase-06-advanced-benchmarking
  ↑
phase-07-polish-security-packaging
```

Each PR targets the immediately previous accepted branch so its diff stays focused.

At the end, create an **umbrella final PR** from the final stack head to `main`, clearly noting that earlier PRs are incremental review slices and no merge was performed.

If GitHub does not allow the exact stack shape due an empty repository or platform limitation, choose the closest non-destructive equivalent and document it.

---

# 8. PRODUCT IDENTITY

Project name:

```text
Prompt Arena
```

Remote:

```text
https://github.com/bielxdh3/Prompt-Arena
```

The application is:

- open source;
- single-user per installation;
- 100% standalone;
- local-first;
- useful offline after required local models/packs are present;
- focused on benchmarking/comparison, not casual chatbotting;
- not coupled to BielOS or any hub;
- not part of BielOS;
- not a BielOS module;
- not a BielOS service;
- not dependent on another user project;
- not a cloud SaaS;
- not multi-user;
- not account-based;
- not telemetry-based.

Do not introduce login, registration, team workspaces, organizations, sync accounts, hosted inference, or mandatory cloud infrastructure.

---

# 9. TARGET PLATFORMS

Official platforms:

```text
Windows
Linux
```

Explicitly excluded:

```text
macOS
```

Requirements:

- no macOS GitHub Actions jobs;
- no macOS packaging targets;
- no Cocoa/Swift/macOS compatibility layer;
- no "future macOS support" language in official roadmap;
- architecture may remain portable where natural, but no development effort should be spent on macOS.

If open-source contributors later port it, that is outside this mission.

---

# 10. TECHNICAL STACK BASELINE

Use the following baseline unless repository evidence proves a material blocker:

### Desktop shell

```text
Tauri 2
```

### Frontend

```text
React
TypeScript
Vite
Tailwind CSS
shadcn/Radix-style accessible component primitives where appropriate
Lucide-style iconography where appropriate
```

Use stable, supported versions resolved at implementation time rather than blindly pinning stale versions from this prompt.

### Native core

```text
Rust
```

### Worker architecture

Use a dedicated local worker process/binary owned by the desktop app.

Recommended structure:

```text
Prompt Arena desktop process
  ├─ frontend UI
  ├─ Tauri/native command layer
  ├─ local SQLite access/domain services
  └─ app-owned worker process
       ├─ provider/runtime execution
       ├─ cancellation
       ├─ streaming events
       ├─ sandbox orchestration
       ├─ model/runtime lifecycle
       └─ telemetry collection
```

The worker is not a cloud service.
The worker is not a permanently installed daemon.
The worker should live only as needed by the app.

If the user closes the main window during an active Arena:

```text
Ask:
- Cancel run and quit
- Continue run in system tray
```

If "continue" is chosen, keep the app/worker alive through tray ownership until the run finishes. Do not create an invisible always-on service.

### Storage

Use:

```text
SQLite for structured metadata/state
+
filesystem artifact store for large immutable artifacts/logs/materialized cases
```

Prefer content hashes for artifacts where useful.

Do not put every large log/blob into SQLite.

Use migrations.

Maintain clear transactional boundaries.

### Benchmark definition format

Canonical external/internal serialization:

```text
JSON validated by JSON Schema
```

The visual editor is primary.
Advanced raw JSON view is initially read-only.
Do not make YAML the canonical format.

---

# 11. REPOSITORY STRUCTURE

Choose a maintainable monorepo layout. A reasonable target is conceptually:

```text
/
  apps/
    desktop/
  crates/
    core/
    domain/
    storage/
    worker/
    runtime/
  packages/
    ui/
    schemas/
  benchmarks/
    official/
  docs/
  scripts/
  .github/
  AGENTS.md
  ROADMAP.md
  README.md
```

This is conceptual, not a requirement to create pointless package boundaries.

Prefer fewer meaningful packages over architecture theater.

Do not create dozens of crates/packages merely because the roadmap is large.

Each boundary must have a real reason.

---

# 12. CORE DOMAIN MODEL

The architecture must explicitly separate:

```text
Pack
Benchmark Definition / Draft
Immutable Benchmark Version
Arena / execution request
Run
Attempt / repetition
Materialized procedural case
Competitor identity
Model artifact/quantization
Profile
Immutable profile revision
Runtime installation/binding
Response/output artifact
Metrics
Evaluation
Ranking/aggregate
Annotation
Regression run
```

## 12.1 Pack

A Pack groups benchmarks/tasks and metadata.

Official launch categories:

```text
Programming / Software Engineering
Reasoning / Math / Knowledge
Writing / Analysis / Instruction Following
```

Support arbitrary nested category hierarchy.
Do not hardcode exactly one category + one subcategory.

Difficulty:

```text
1..5
```

Official packs ship with the application/repository.

Pack updates must not silently rewrite historical benchmark definitions or versions.

If an updated official pack is available through a future update mechanism, notify the user and let the user choose whether to use/update it.

## 12.2 Benchmark Draft and Immutable Benchmark Version

A benchmark may be edited while in draft.

Once a semantic version has historical results, it is immutable.

Any outcome-affecting change creates a new Benchmark Version.

Semantic fields include, at minimum:

```text
tasks and task versions
generators
fixed seeds/cases where applicable
prompts/system prompts
context compilation method
criteria
criterion weights
objective verifier policy
judge panel configuration
judge identities/versions where applicable
judge weights
aggregation
runtime policy
tool permissions
resource limits
generation parameters
evaluation policy
scoring
failure policy
interruption policy
repetition policy
comparability policy
authorized automatic adjustments
tournament policy
regression inclusion policy
```

Cosmetic metadata that cannot reach the model and cannot alter outcome semantics may be updated without creating a new semantic Benchmark Version.

Results are immutable.

Never rewrite old results when benchmark logic changes.

## 12.3 Run

A Run must snapshot the effective conditions used.

Save:

```text
benchmark_version_id
arena_id
competitor/profile revision
runtime/backend
runtime version
effective parameters
task/case identity
materialized procedural case
seed where available
context compilation output where required
tool policy
limits
actual execution order
timestamps
status
errors
response artifacts
metrics
evaluation results
environment fingerprint
comparability state
```

Raw execution data is append-only/immutable.

Later notes, incident flags, invalidations, or annotations live separately and never mutate the original raw record.

---

# 13. COMPETITOR, MODEL, PROFILE, AND RUNTIME IDENTITY

Do not conflate "model" with "runtime".

Use a hierarchy conceptually like:

```text
Base model / competitor
→ artifact / quantization variant
→ profile
→ immutable profile revision
→ runtime binding used for a specific run
```

Rules:

- Same base model with different quantizations can be distinct competitor variants.
- Q4 and Q8 are different competitor variants.
- Same model/quantization running in Ollama vs llama.cpp remains the same logical competitor identity unless a benchmark explicitly models runtime as a competitive dimension.
- Runtime is recorded per execution.
- Benchmark decides how runtime variants appear in results.
- A profile is an editable shell with automatically created immutable revisions.
- Every Run points to an exact profile revision.
- Profile defaults may include model, default runtime preference, generation params, system prompt, tools/permissions, and other settings.
- Benchmark may override profile defaults.
- Run stores the effective snapshot after overrides.
- Model artifact digest/hash should be stored when the backend exposes it.
- Lack of a digest must not make local use impossible.
- If the same name + quantization + size later maps to a different digest, flag possible artifact change.

When duplicate installations are found across runtimes:

- attempt grouping;
- use evidence such as source metadata, model name, family, quantization, size, digest when available;
- if uncertain, ask the user to confirm the link;
- remember confirmed associations;
- permit manual unlinking.

---

# 14. LOCAL RUNTIME / PROVIDER ARCHITECTURE

Create a generic adapter contract before hardcoding any backend.

Local-first priority:

1. Ollama
2. LM Studio
3. llama.cpp
4. OpenAI-compatible local endpoints
5. optional external APIs later/after local core is solid

The core Arena engine must not know backend-specific request formats.

Conceptually:

```text
ProviderAdapter
RuntimeAdapter
ModelCatalogAdapter
ModelDownloadAdapter
TelemetryAdapter
```

These may be combined where appropriate, but keep capabilities explicit.

Normalized request model should support, when applicable:

```text
messages
system prompt
prompt
attachments
temperature
top_p
top_k
max_output_tokens
stop sequences
seed
tools
tool policy
response format/schema
metadata
context
```

Capability negotiation is required.

Never pretend unsupported parameters are equivalent.

If a benchmark requests `temperature=0.2` and one backend cannot honor it, record partial parameter parity.

No silent backend adjustment.

---

# 15. OLLAMA

Ollama is the first real local adapter.

Implement:

- endpoint discovery/configuration;
- health check;
- installed model discovery;
- model metadata retrieval where exposed;
- generation/chat execution;
- streaming;
- cancellation if supported;
- token/usage metrics where exposed;
- runtime/model error normalization;
- model load/unload behavior where exposed;
- native download/pull integration;
- delete/remove integration through official runtime mechanism;
- contract tests with mock server/fixtures;
- optional live integration test that self-skips when Ollama is unavailable.

Do not require Ollama to open the application.

---

# 16. LM STUDIO AND LLAMA.CPP

Add adapters after the generic contracts and Ollama are stable.

Implement:

- runtime discovery where feasible;
- endpoint configuration;
- installed model discovery where feasible;
- OpenAI-compatible execution path when appropriate;
- runtime-specific model metadata;
- runtime-specific load/unload controls when exposed;
- model file/directory awareness for llama.cpp-style GGUF workflows;
- model identity grouping with other runtimes;
- honest capability reporting.

Do not assume llama.cpp has the same catalog semantics as Ollama.

Do not force every runtime into an identical storage model.

---

# 17. EXTERNAL APIS

External APIs are supported but clearly secondary.

Prompt Arena provides:

- no paid credits;
- no proxy;
- no hosted inference;
- no shared account;
- no bundled paid API key.

Users bring their own credentials.

Architecture should support:

```text
generic OpenAI-compatible provider
OpenAI
Anthropic
Gemini
other adapters later when justified
```

Do not let external API requirements distort the local-first UX.

### Cost safety

Before a paid API Arena:

- estimate cost when possible;
- show estimate;
- support user-configurable confirmation thresholds;
- support budget ceiling;
- stop starting new paid work when limit is reached;
- record actual cost when provider data allows;
- record the dated price table used;
- preserve historical cost;
- support separate simulation using current prices later.

Never expose secrets in logs/exports.

---

# 18. CREDENTIAL SECURITY

Credential requirements:

- never log API keys;
- never export API keys;
- never commit API keys;
- mask keys in UI;
- prefer OS secure storage;
- if an encrypted local credential file is needed, protect the encryption key through OS secure mechanisms;
- allow environment-variable credentials where appropriate;
- prompts/results/history remain local by default;
- clearly indicate when content will leave the machine for an external API.

Zero Prompt Arena server should receive credentials because there is no Prompt Arena server.

---

# 19. ZERO TELEMETRY AND NETWORK POLICY

There is no product analytics telemetry.

No:

- analytics SDK;
- usage reporting;
- crash upload;
- hardware reporting;
- benchmark upload;
- model inventory upload;
- hidden remote config;
- user tracking;
- account service;
- mandatory update service.

Network access is allowed only for explicit product functionality such as:

- user-selected external API call;
- user-selected model search/download;
- user-configured local HTTP runtime;
- GitHub/official source interaction when explicitly initiated by development or a future user-facing feature;
- update checks only if later explicitly implemented as a transparent user-controlled feature.

The application must remain useful without a central server.

---

# 20. BENCHMARK TASK MODEL

A task may include:

```text
prompt
system prompt
context
attachments
expected answer / gold
criteria
criterion weights
objective verifiers
tests
sandbox configuration
tool permissions
runtime requirements
resource limits
repetition rules
procedural generator
difficulty
category hierarchy
evaluated artifacts
failure policy
```

A task can evaluate:

- final text;
- structured output;
- files/code;
- test results;
- final sandbox state;
- selected artifacts.

Task defines the evaluated artifact set.

---

# 21. PROCEDURAL BENCHMARKS

Procedural benchmarks are first-class.

Rules:

- Each repetition may generate a new case.
- Within that repetition, every competitor receives the exact same materialized case.
- Save generator version/configuration.
- Save seed.
- Save exact materialized case.
- Across a new Arena of the same Benchmark Version, new seeds/cases may be generated from the same frozen generator/distribution unless the benchmark is a fixed suite.
- Benchmark Version freezes generator/distribution/rules, not necessarily every future seed.
- Old Arena exact cases must be replayable when environment permits.

A replay is a replication, not a guarantee of bit-identical model output.

Benchmark defines whether replay results join normal aggregates.

---

# 22. REPETITIONS AND STATISTICS

Benchmark supplies default repetitions.
Task may override where allowed.

Support:

```text
1
3
5
10
N
```

Show every attempt.

Default summary for repeated performance should include mean and useful distribution context.

Support as applicable:

```text
mean
median
min
max
standard deviation
success rate
sample size n
```

`n` must always be visible for rankings based on samples.

Benchmark defines official minimum sample size.

Competitors with different `n` may appear in a ranking, but the difference must be obvious.

Statistical uncertainty display is benchmark-defined/configurable.

Benchmark defines tie margin.

---

# 23. EXECUTION ORDER AND LOCAL PERFORMANCE FAIRNESS

Default local performance execution:

```text
competitor A: all repetitions
unload A
competitor B: all repetitions
unload B
...
```

Always record actual order.

Benchmark may define another order.

Between sequential competitors, unload the previous model to leave clean conditions where the runtime exposes a safe unload.

No mandatory stabilization pause by default.
Benchmark may require a pause or temperature condition.

Separate:

```text
model load time
time to first token
generation time
total time
```

Benchmark decides which metric enters scoring.

Separate cold/warm measurements by default when meaningful.

Offload to CPU/RAM is allowed by default.
Benchmark may require GPU-only.

Performance comparability requires the same relevant physical hardware.

Runtime/backend version changes are recorded but do not automatically erase all historical usefulness.

GPU/CPU offload differences may affect comparability according to benchmark policy.

---

# 24. GENERATION RANDOMNESS

Do not force a fake "same random seed" across unrelated model backends.

Each model uses its own randomness.

If backend exposes seed, save it.

If unavailable, record unavailable.

Reproducibility means methodology/config/case provenance, not promised bit-for-bit identical model text.

---

# 25. PARAMETER ADJUSTMENTS

Never silently alter:

- context window;
- offload;
- quantization;
- max output;
- tool access;
- runtime;
- timeout;
- model identity;
- generation params.

Benchmark Version may explicitly authorize automatic adjustments within exact declared limits.

For every adjustment, record:

```text
requested configuration
proposed adjustment
authorization basis
decision
effective configuration
```

Outside pre-authorized limits, apply benchmark/user policy.

If no policy exists and adjustment is necessary, ask/stop only that affected execution rather than silently changing it.

---

# 26. CONTEXT WINDOW AND CONTEXT COMPILATION

Do not silently truncate context.

Context compilation is a benchmark-defined operation.

Possible methods:

- select relevant sections;
- summarize;
- algorithmic compression;
- auxiliary-model compilation;
- hybrid.

Benchmark defines:

- common-context mode or each-competitor-capacity mode;
- compilation method;
- compiler identity/model if AI-based;
- whether result is materialized;
- what content/hash metadata is retained;
- whether differing capacity modes are considered comparable.

When a common compiled context is used, all competitors receive the same materialized compiled content.

Compilation method/config/materialized result is part of the frozen Benchmark Version/run evidence as appropriate.

If an auxiliary compiler model fails or is unavailable, do not silently substitute another.

If compilation still does not fit and policy has no answer, mark/ask at the narrowest possible scope and continue other work.

---

# 27. SANDBOX AND AUTONOMOUS CODING TASKS

Coding benchmarks may grant models autonomy inside a sandbox.

The benchmark fully defines:

- terminal access;
- filesystem access;
- allowed roots;
- network access;
- tools;
- APIs;
- time;
- token limit;
- cost;
- CPU;
- RAM;
- GPU;
- storage;
- whether Docker is required;
- initial filesystem state;
- evaluated artifacts.

Docker should be designed into the architecture from the beginning.

Real Docker-backed sandbox support must exist before official coding benchmarks that claim strong isolation are considered complete.

Docker must not be required to simply launch Prompt Arena.

If Docker is missing:

- never silently execute on host;
- obey benchmark fallback policy;
- if no fallback is declared, mark affected benchmark unavailable/blocked.

Sandbox security must prevent path traversal, accidental host writes, command injection, and secret leakage as far as reasonably possible.

---

# 28. FAILURE, TIMEOUT, OOM, CRASH, AND INTERRUPTION

Benchmark defines per-task failure policy.

If no benchmark rule exists, default:

```text
fail/interrupt affected competitor attempt
preserve evidence
continue other competitors
```

Failed/skipped competitors remain visible with explicit status.

Never remove them from raw history.

If the application crashes or execution is interrupted:

- preserve completed work;
- persist checkpoints;
- mark run interrupted;
- benchmark defines restart policy;
- default resume from last safe checkpoint when safe.

Manual stop should preserve everything completed.

---

# 29. EVALUATION ARCHITECTURE

Evaluation is criterion-level and evaluator-type aware.

Evaluator types include:

```text
objective deterministic verifier
blind human evaluation
AI judge
```

### Objective authority

When an objective verifier can authoritatively determine a criterion, the objective result is authoritative for that criterion.

AI/human do not override an objective truth criterion.

Examples:

- unit test pass/fail;
- exact numeric answer;
- schema validity;
- compilation success;
- required file presence;
- deterministic security rule.

### Human evaluation

Support:

- best response;
- worst response;
- full ranking;
- tie;
- criterion scores.

Blind mode should randomize display labels/order.

Fully blind preset hides until human evaluation is finalized:

- model identity;
- provider identity;
- AI judge scores;
- ranking;
- speed;
- cost;
- token counts.

After human evaluation is locked, reveal configured information.

### Divergence

If human vs AI evaluation diverges beyond a configurable threshold:

- show divergence;
- mark controversial;
- do not silently rewrite either score.

---

# 30. AI JUDGES

AI judges are an advanced feature and must not block the earliest core MVP, but this mission should implement the architecture and, if feasible within the same mission, the working feature after objective + blind human evaluation is stable.

Official pack judge policy:

- pack chooses 3 or 5 judges according to importance/cost;
- exact judge identities/versions, weights, rubric, aggregation, and deliberation policy freeze into Benchmark Version;
- no silent judge substitution;
- if required judge unavailable, user/policy chooses cancel or degraded run;
- degraded panel is visibly non-comparable to official series unless a new Benchmark Version declares it;
- pre-deliberation independent score is the default official score for official packs;
- deliberated score is experimental/parallel by default;
- if benchmark wants deliberated score official, it must declare that before the run and freeze it.

Preserve pre- and post-deliberation results separately.

Do not overwrite independent scores with deliberated scores.

Store who saw what, ordering/messages needed for audit, score changes, and dispersion where feasible.

---

# 31. JUDGE CALIBRATION

Judge weights must not be arbitrary vibes.

Support a separate immutable/versioned Calibration Benchmark.

Calibration data sources may include:

```text
objective alignment
blind human alignment
dedicated judge calibration tasks
```

Keep sources separate.

Do not calibrate judges using the same official benchmark whose score they will determine in a circular manner.

Freeze calibration snapshot/formula/resulting weights into the relevant Benchmark Version when weights are used.

---

# 32. AGGREGATION AND SCORING

Task criteria have weights.

Task final quality score may normalize to 0–100 internally.

Keep dimensions separate by default:

```text
quality/capability
speed/performance
cost
consistency/success
```

A benchmark/user may define a composite weighted score.

Do not present a single universal score as objective truth.

General cross-category ranking uses user-selected category weights at generation time.

Pack task weights are configurable; equal by default.

Aggregation method is benchmark-defined.

Do not hardcode weighted median as the only method.

---

# 33. COMPARABILITY

Comparability is multi-dimensional, not one boolean.

At minimum track:

```text
quality comparability
performance comparability
cost comparability
```

Global minimum comparability-critical information includes:

```text
tasks/cases
scoring/evaluation
judge panel where used
runtime/tools/limits
competitor generation parameters
effective context
```

Benchmark may add stricter fields but cannot remove the global minimum evidence required for meaningful analysis.

Across different immutable Benchmark Versions:

- show separate benchmark epochs;
- do not draw a fake continuous improvement line as if the ruler never changed.

Claims such as "34 → 42" are only directly meaningful under the same frozen Benchmark Version unless explicitly normalized by a declared methodology.

---

# 34. REGRESSION MODE

Controlled regression is first-class.

User manually chooses historical Arenas/cases to replay.

Regression uses the exact original Benchmark Version, including:

- tasks;
- scoring;
- judges;
- policies;
- methodology.

Regression results are separate from normal procedural ranking by default.

Benchmark may explicitly include them.

Do not automatically nag the user to run regression merely because a new model/profile revision is detected.

---

# 35. RANKINGS AND TOURNAMENTS

Support evaluation modes:

```text
1v1 blind confrontation
blind ranking of all
criterion scoring
tournament/bracket knockout
```

Tournament rules are configurable.

Default advancement may use higher score.

Default tie resolution may use benchmark-defined secondary criteria such as consistency and speed.

No universal tie rule must override benchmark policy.

Initial usable history should include:

- results per Arena;
- history by Benchmark Version;
- ranking by benchmark/category.

More global composite rankings can follow after core correctness.

---

# 36. MODEL LIBRARY

Model Library is a core local-first surface.

Implement progressively but within the planned product.

### Discovery

Auto-detect when feasible:

- Ollama;
- LM Studio;
- llama.cpp;
- installed/known models.

### Unified search

One unified search interface across supported sources.

Do not require the user to browse separate backend tabs unless necessary for backend-specific detail.

### Results

Default result cards/list rows should surface essential information and keep advanced detail collapsed.

Show as available:

```text
model/family
author/source
license
parameter size
quantization
format
download size
context support
runtime compatibility
estimated VRAM
estimated RAM
recommended backend/runtime
source/catalog
```

### Download

Prompt Arena initiates download in a unified UI, but the selected backend/runtime manages the actual files through its native mechanism whenever possible.

Do not unnecessarily become a fourth incompatible model store.

### Quantization recommendations

Show all quantizations.

Highlight recommendations based on:

```text
hardware fit
quality profile
balanced profile
speed profile
```

Classify hardware pressure:

```text
Ideal
Acceptable
Heavy
```

These thresholds are user-customizable.

Recommendations do not forbid download.

### Hardware detection

Detect:

```text
CPU
GPU
VRAM
RAM
```

Allow user corrections.

When correcting detected hardware, ask whether the override is temporary or permanent.

### Empirical learning

Use local historical measurements to improve recommendations.

Relevant metrics:

```text
tokens/s
VRAM used
RAM used
GPU offload
OOM events
load time
crashes/stability
```

Use similar data first.
When insufficient, broaden to less-similar local evidence.

Prefer empirical measurements over theoretical estimates when sample size + variability support the confidence.

Show:

```text
confidence: low | medium | high
sample size n
```

If hardware changes, older measurements may still contribute but current-hardware data gets greater weight.

Runtime-version history may be used normally; current-version evidence should naturally dominate only if the similarity/confidence model supports it, but do not hard-separate every runtime version by default.

### Duplicate management

Detect possible duplicate model storage across runtimes.

Offer safe removal options.

Prefer official runtime removal mechanisms.

Advanced mode may permit manual file deletion even when safety cannot be proven, but it must:

- show exact affected path(s);
- show size;
- show known/possible runtime references;
- show risk warning;
- require explicit confirmation;
- never pretend uncertain deletion is safe.

Never delete an actively loaded/in-use model.

---

# 37. PROFILE MANAGEMENT

A profile is editable.

Every relevant profile change creates an immutable revision automatically.

User sees a stable profile identity/name.

Runs reference exact revision.

Support:

- model selection;
- runtime preference/default;
- generation parameters;
- max output tokens;
- system prompt;
- tool permissions/defaults where appropriate;
- context preferences;
- metadata/tags.

Max output tokens defaults to competitor/profile configuration unless benchmark defines an explicit constraint.

Native chat template is used by default.
Benchmark may require another template.

---

# 38. API MODEL IDENTITY

For external APIs:

- record provider;
- requested model name;
- returned model id/version metadata where exposed;
- date/time;
- relevant headers/metadata where safe;
- identity confidence.

If exact provider-side model revision is unprovable, mark:

```text
identity_unverified
```

Do not invent a precise revision.

Historical series may still include it with visible identity uncertainty.

---

# 39. HARDWARE TELEMETRY

First usable implementation may prioritize:

```text
tokens/s
timings
basic memory data when safely available
```

Advanced hardware metrics can include:

```text
RAM
VRAM
CPU utilization
GPU utilization
energy/power where support is robust
```

Do not fake cross-platform telemetry parity.

Feature-detect and mark unavailable fields honestly.

Record enough environment context for performance comparison.

---

# 40. UI/UX DESIGN SOURCE AND REFERENCE

Use `bielxdh3/demanage` as a **read-only structural visual reference**.

Inspect its actual frontend code rather than guessing from screenshots.

Useful inspiration:

- compact desktop navigation;
- clear page hierarchy;
- topbar/sidebar composition;
- cards/panels;
- dashboard density;
- responsive grid discipline;
- reusable layout components;
- polished component primitives.

Do **not** copy deManage's finance domain, login/auth flow, backend, data model, user account logic, or product-specific screens.

Do **not** copy its exact black/neon identity.

Prompt Arena must have its own theme.

---

# 41. DEFAULT VISUAL LANGUAGE

Default appearance:

- dark neutral gray, not pure black;
- visual feel inspired by the softer gray surfaces used in modern conversational AI interfaces;
- background and surfaces differentiated by gray levels;
- high legibility without harsh white-on-black contrast;
- subtle borders;
- restrained shadows;
- strongly rounded geometry;
- rounded cards;
- rounded inputs;
- rounded dialogs;
- rounded menus;
- rounded buttons;
- rounded result panels;
- no square enterprise-dashboard aesthetic;
- no dominant neon amber/green identity;
- no generic "AI blue gradient" aesthetic;
- no visual dependency on Gemini's design;
- overall polish should be near-final early, not an ugly placeholder UI.

The user specifically wants ChatGPT-like roundedness.

Use animation sparingly and functionally.

Respect reduced-motion preferences.

---

# 42. TYPOGRAPHY AND THEME CUSTOMIZATION

Default UI/content font preference:

```text
Times New Roman
```

Because Times New Roman may not exist on all Linux systems and redistribution can be license-sensitive:

- use the system font when installed;
- use a safe fallback stack such as `Times`, `Liberation Serif`, and generic serif where necessary;
- do not ship proprietary Times New Roman font files without an appropriate license;
- keep the user-visible default intent as Times New Roman while handling availability honestly.

The user must be able to change font.

Provide **at least six font options**.

Reasonable built-in/selectable choices include:

1. Times New Roman (system)
2. Georgia (system where available)
3. Source Serif 4
4. Libre Baskerville
5. Lora
6. IBM Plex Serif
7. Newsreader
8. at least one modern sans option

Open-source bundled fonts must retain their licenses.

### Theme system

From the first commit, use semantic design tokens rather than hardcoded colors scattered throughout components.

At minimum:

```text
background
surface
surfaceElevated
surfaceMuted
textPrimary
textSecondary
textMuted
border
accent
accentForeground
success
warning
danger
chart palette
focus ring
fontUI
fontContent
fontMono
radiusSmall
radiusMedium
radiusLarge
radiusXL
density/spacing where practical
```

Roadmap must include an Appearance editor allowing users to customize broadly.

At minimum:

- app background;
- surfaces/cards;
- text colors;
- secondary text;
- accent;
- border;
- success/warning/error;
- chart colors;
- font;
- font size;
- font choice;
- corner radius within safe limits;
- presets;
- restore defaults.

The user wants broad visual customization.

Prevent custom theme values from making essential controls inaccessible where feasible; warn rather than silently overriding user intent.

Later/import-export theme support may be implemented if time permits in the same mission.

---

# 43. MAIN UI SURFACES

Implement polished versions of these surfaces:

### Dashboard

Show useful local state such as:

- recent Arenas;
- recent benchmark runs;
- models/runtimes detected;
- latest results;
- active/incomplete runs;
- quick actions;
- category ranking highlights where data exists.

Do not show fake data in production state.

### Arena Builder

Simple mode default.

Allow:

- benchmark/pack selection;
- tasks;
- competitor selection;
- profiles/groups;
- repetitions;
- runtime selection where benchmark permits;
- evaluation mode;
- limits;
- advanced config collapsed;
- benchmark requirements;
- explicit warnings about incompatible capabilities.

### Live Execution

Show:

- competitors;
- current task/repetition;
- queued/running/completed/failed;
- streaming output when appropriate;
- timing;
- cancellation;
- technical panel expandable;
- event log/audit view without exposing secrets;
- clear blocked/degraded status.

### Blind Human Evaluation

Hide identities according to blind preset.

Randomize response labels/order.

Allow criterion scoring, ranking, best/worst/tie based on benchmark.

Lock human evaluation before reveal when using fully blind mode.

### Results

Dashboard summary + drill-down.

Show separate dimensions:

- quality;
- performance;
- cost;
- consistency;
- failure rate;
- human evaluation;
- objective verification;
- AI judge results if enabled;
- comparability flags;
- runtime variants;
- sample size.

### Benchmarks/Packs

Browse official/custom packs.
Show immutable versions and drafts distinctly.
Create/edit custom benchmark through visual editor.
Advanced raw JSON view read-only initially.

### Model Library

Unified local/download experience described above.

### Profiles

Manage editable profiles and immutable revisions.

### History/Rankings

Filter by:

- benchmark;
- Benchmark Version;
- category;
- model;
- profile revision;
- runtime;
- date;
- hardware;
- status.

### Settings / Appearance

Theme editor, font selector, hardware overrides, runtime endpoints, API credentials, storage/retention, privacy/network explanation.

### Diagnostics

Local diagnostic surface is useful, but do not turn it into a remote support/telemetry system.

---

# 44. OFFICIAL PACKS

Ship at least one small but serious official pack in each core area:

```text
Programming / Software Engineering
Reasoning / Math / Knowledge
Writing / Analysis / Instruction Following
```

Packs should exercise the real infrastructure.

Avoid hundreds of low-quality tasks merely to inflate scope.

Each pack should demonstrate:

- categories;
- difficulty;
- objective criteria where possible;
- human criteria where appropriate;
- repetitions;
- versioning;
- failure handling.

Coding pack should use sandboxed objective tests for at least some tasks.

Reasoning/math pack should include deterministic answers where appropriate.

Writing/instruction pack should use blind human criteria and optionally AI judge support once available.

---

# 45. CUSTOM BENCHMARK EDITOR

Provide:

- visual editor;
- simple mode;
- advanced configuration panels;
- validation;
- live schema errors;
- preview;
- save draft;
- freeze/publish immutable local Benchmark Version;
- clone version into a new draft;
- raw JSON view read-only initially.

Support hierarchical categories and difficulty 1–5.

Do not require users to edit JSON manually.

---

# 46. PACK UPDATE AND VERSION HISTORY

Official packs are bundled with application/repository releases.

Do not silently mutate installed historical versions.

When pack source changes:

- preserve old versions referenced by history;
- allow new version use;
- explain version differences where practical.

No central Prompt Arena service is required.

---

# 47. ARTIFACT STORE

Store large immutable artifacts on filesystem.

Examples:

- full outputs;
- execution event logs;
- materialized procedural cases;
- generated files/code;
- sandbox result artifacts;
- compiled context;
- exported run reports.

Prefer content-addressed paths/hashes where practical.

SQLite stores references/metadata.

Implement garbage-collection/cleanup tooling carefully.

Raw historical evidence should not be silently deleted.

Retention is a combination of:

- manual cleanup/compaction;
- configurable policy by user/benchmark where sensible.

Always distinguish:

```text
critical immutable evidence
derived/rebuildable cache
temporary files
```

Do not delete critical evidence under a generic "clear cache" action.

---

# 48. EXPORT

Prioritize complete Arena result export.

Support at minimum:

```text
JSON
Markdown
```

CSV may be included for tabular metrics.

Exports must not contain secrets.

Full cross-installation re-import/reconstruction can remain a later capability if it would delay core correctness.

Do not design IDs/pathing so poorly that future import becomes impossible.

---

# 49. BACKUPS

Use simple manual backup support initially.

Document where database and artifact store live.

Provide a safe "open data folder" or backup/export mechanism where appropriate.

Do not create a hidden cloud backup.

---

# 50. SECURITY MODEL

Treat these as untrusted inputs:

- benchmark files;
- imported JSON;
- model output;
- filenames from model output;
- provider responses;
- runtime metadata;
- downloaded catalog metadata;
- URLs;
- sandbox-generated paths.

Defend against:

- path traversal;
- command injection;
- shell quoting errors;
- arbitrary host filesystem writes;
- unsafe archive extraction;
- XSS/HTML injection in model output;
- unsafe Markdown rendering;
- malicious links;
- secret leakage;
- log injection;
- SQLite injection through unsafe query construction;
- race conditions in job cancellation;
- symlink escape;
- dangerous model-file deletion;
- insecure temp files;
- overbroad Tauri permissions;
- unbounded event/log growth;
- network requests to unintended destinations where policy can constrain them.

Use least privilege.

Do not expose an unrestricted shell to the UI.

Tauri command surface should be narrow and typed.

---

# 51. RETENTION AND LOGGING

Execution audit should preserve:

- tool calls/events where benchmark uses tools;
- test outcomes;
- attempts;
- timestamps;
- relevant state transitions;
- effective config;
- failure evidence.

Do not store hidden chain-of-thought.

Do not request/store model private reasoning.

Store only visible protocol data and execution evidence.

Allow manual compaction/cleanup.

Support configurable retention policy.

Never silently erase history critical to benchmark interpretation.

---

# 52. APP LIFECYCLE

No always-on daemon.

When no active run exists, quitting the app should stop owned worker processes.

When active run exists, prompt:

```text
Cancel run and quit
Continue in tray
```

Tray continuation ends when the run finishes unless user keeps app open.

Handle worker crash and orphan cleanup safely.

---

# 53. ACCESSIBILITY

Polished UI must also be usable.

Include:

- keyboard navigation;
- visible focus states;
- accessible labels;
- semantic controls;
- contrast-aware defaults;
- reduced motion;
- screen-reader-friendly status text;
- no color-only status communication;
- scalable typography within reasonable bounds.

Theme customization must not completely bypass accessibility warnings.

---

# 54. PERFORMANCE AND RESOURCE DISCIPLINE

Prompt Arena itself should be reasonably light.

Avoid:

- busy polling;
- runaway intervals;
- unbounded in-memory event lists;
- loading full historical logs into memory by default;
- unnecessary model duplication;
- heavyweight background services.

Use pagination/virtualization where history/log size can grow.

Persist streaming events incrementally.

Keep UI responsive during model execution.

---

# 55. TESTING STRATEGY

Build a real layered test strategy.

### Rust

As applicable:

```text
cargo fmt --check
cargo clippy
cargo test
```

### Frontend

As applicable:

```text
typecheck
lint
unit/component tests
production build
```

### Schema/domain tests

Test:

- Benchmark Version immutability;
- semantic version fork behavior;
- profile revision behavior;
- run snapshot correctness;
- procedural case materialization;
- scoring;
- comparability;
- failure statuses;
- regression selection;
- cost price snapshotting.

### Provider contract tests

Mock HTTP providers for:

- stream success;
- non-stream success;
- timeout;
- disconnect;
- malformed response;
- capability mismatch;
- cancellation;
- auth error;
- OOM-like runtime error normalization where relevant.

### SQLite

Test migrations from clean DB and representative older schema versions once migrations exist.

### Worker

Test:

- job lifecycle;
- cancellation;
- crash recovery;
- event ordering;
- retry policy;
- bounded log persistence;
- cleanup.

### UI

Test high-value workflows:

- create Arena;
- choose benchmark;
- choose competitors;
- run with mocked backend;
- blind evaluate;
- reveal;
- inspect results/history;
- edit theme/font;
- detect failure/degraded status.

### Integration

Use live Ollama only when available, with self-skipping tests that clearly distinguish unavailable environment from failure.

### Windows/Linux

CI should validate both Windows and Linux where possible.

No macOS CI.

---

# 56. CI

Create GitHub Actions for:

- formatting;
- lint;
- typecheck;
- unit tests;
- Rust tests;
- security/dependency checks where appropriate;
- Windows build;
- Linux build;
- schema validation;
- official pack validation;
- packaging smoke checks where possible.

Keep secrets unnecessary for normal CI.

Do not add paid services.

Do not add telemetry services.

If runner limitations block full Tauri packaging, validate the strongest available subset and report the limitation.

---

# 57. SECURITY REVIEW

At appropriate milestones and final closeout, use project-security-review and any applicable repository security skill.

At minimum inspect:

- Tauri permissions/capabilities;
- IPC;
- path handling;
- process spawning;
- shell use;
- local HTTP requests;
- external URL handling;
- credential storage;
- artifact store;
- deletion;
- Docker invocation;
- imported benchmark files;
- HTML/Markdown rendering;
- update/download code;
- dependency risk;
- logs.

Critical/High findings in scope must be fixed before final acceptance if safely possible.

If they cannot be fixed, final status must be blocked/conditional rather than hidden.

---

# 58. DOCUMENTATION

Create and keep synchronized:

```text
README.md
ROADMAP.md
docs/ARCHITECTURE.md
docs/BENCHMARK_MODEL.md
docs/SECURITY.md
docs/PRIVACY.md
docs/DEVELOPMENT.md
docs/PROVIDERS.md
docs/MODEL_LIBRARY.md
docs/THEMING.md
docs/DATA_MODEL.md
docs/TESTING.md
```

Only create documents that add real value; combine where better.

README should explain:

- what Prompt Arena is;
- local-first;
- Windows/Linux;
- no macOS official support;
- zero telemetry;
- local models;
- optional BYOK APIs;
- basic setup;
- project status;
- screenshots later when real;
- security/privacy summary.

Do not claim features that do not exist.

ROADMAP must distinguish:

```text
done
in progress
planned
blocked
human-gated
```

---

# 59. ROADMAP TO IMPLEMENT

Treat this as the current roadmap baseline.

## Phase A — Foundation

- repo bootstrap;
- Tauri/React/TypeScript/Rust workspace;
- Windows/Linux CI;
- design token system;
- rounded gray UI foundation;
- Times New Roman default stack + 6+ font options;
- theme configuration model;
- SQLite migrations;
- artifact store;
- domain IDs/versioning primitives;
- worker IPC/lifecycle;
- repository docs;
- security baseline.

## Phase B — Core Arena

- generic provider/runtime contracts;
- Ollama;
- model/profile registration;
- Arena builder;
- benchmark draft/version loading;
- run orchestration;
- streaming;
- cancellation;
- attempt persistence;
- metrics;
- results;
- blind human evaluation;
- objective verification;
- history.

## Phase C — Official Packs

- coding;
- reasoning/math/knowledge;
- writing/analysis/instruction-following;
- pack validation;
- category/difficulty support;
- procedural task support;
- sandbox foundation;
- Docker coding tasks.

## Phase D — Model Library

- runtime detection;
- installed model discovery;
- unified search;
- backend-native downloads;
- quantization details;
- hardware detection;
- Ideal/Acceptable/Heavy recommendation;
- empirical recommendation history;
- confidence + sample size;
- duplicate grouping;
- duplicate removal;
- advanced manual file deletion warnings.

## Phase E — Advanced Benchmarking

- rankings;
- tournaments;
- regression mode;
- comparability dimensions;
- context compilation;
- richer statistics;
- AI judge architecture;
- calibration benchmark;
- independent pre-deliberation official scoring;
- optional deliberation;
- API cost model/history.

## Phase F — External Providers

- OpenAI-compatible generic;
- native OpenAI;
- Anthropic;
- Gemini;
- BYOK credential storage;
- cost safeguards;
- identity uncertainty metadata.

External providers remain secondary and must not block local-first completion.

## Phase G — Personalization and Polish

- full appearance editor;
- font selection;
- color editing;
- radius controls;
- presets;
- accessible warnings;
- theme persistence;
- export/import theme if feasible;
- refined dashboard;
- polished empty/error/loading states;
- responsive desktop sizing;
- diagnostics;
- storage cleanup UX.

## Phase H — Hardening and Release Readiness

- security closeout;
- test matrix;
- CI stabilization;
- Windows/Linux build validation;
- packaging;
- performance profiling;
- docs sync;
- clean install smoke;
- final issue/blocker list;
- PR stack;
- umbrella PR;
- Master PONYTAIL report.

---

# 60. EXPECTED PR STACK

Use coherent PRs. A suggested stack:

### PR 1 — Foundation and design system

Contains:

- workspace bootstrap;
- Tauri/React/Rust;
- worker skeleton;
- SQLite/artifact skeleton;
- design tokens;
- default gray/rounded shell;
- typography selector foundation;
- CI baseline;
- README/ROADMAP/architecture docs.

### PR 2 — Domain, storage, immutable versioning

Contains:

- benchmark domain;
- Pack/BenchmarkVersion/Run/ProfileRevision;
- JSON Schema;
- migrations;
- artifact refs;
- annotations;
- immutable result rules;
- tests.

### PR 3 — Runtime adapters and Ollama

Contains:

- provider/runtime contracts;
- capabilities;
- Ollama discovery/execution/streaming;
- local model identity;
- hardware detection baseline;
- worker jobs/events;
- tests.

### PR 4 — Arena workflow and evaluation

Contains:

- Arena builder;
- run execution;
- persistence;
- live UI;
- objective verification;
- blind human evaluation;
- results/history;
- failure/interruption;
- tests.

### PR 5 — Official packs and sandbox

Contains:

- three official pack families;
- procedural cases;
- pack validation;
- Docker sandbox;
- coding objective tests;
- hierarchy/difficulty;
- tests/docs.

### PR 6 — Model Library and profiles

Contains:

- unified library;
- LM Studio/llama.cpp;
- downloads;
- grouping;
- quantization recommendations;
- empirical hardware recommendations;
- duplicate management;
- profile revisions;
- tests.

### PR 7 — Advanced benchmarking and APIs

Contains:

- rankings;
- regression;
- tournaments;
- comparability;
- context compilation;
- AI judge/calibration if feasible;
- OpenAI-compatible/OpenAI/Anthropic/Gemini adapters;
- cost controls;
- tests.

### PR 8 — Personalization, hardening, packaging

Contains:

- full theme editor;
- 6+ fonts;
- accessibility;
- diagnostics;
- retention/cleanup;
- security fixes;
- Windows/Linux build/package validation;
- docs;
- final polish.

### Final umbrella PR

From final stack head to `main`.

Do not merge any PR.

If a suggested PR becomes too large, split it further.
If two adjacent PRs are naturally inseparable, adjust the stack, but still preserve multiple coherent PRs overall.

---

# 61. PHASE EXECUTION LOOP

For every substantial phase:

1. BL3 inspects only the necessary repository context.
2. BL3 defines phase objective and acceptance criteria.
3. BL3 confirms applicable skills.
4. BL3 delegates through Dual Codex to canonical BL4.
5. BL4 implements.
6. BL4 runs focused validation.
7. BL4 returns structured evidence.
8. BL3 validates provenance.
9. BL3 independently inspects diff/files/tests/security/scope.
10. BL3 chooses exactly:

```text
accepted
correction_required
blocked
```

11. If `correction_required`, send a bounded correction to the same BL4.
12. BL4 corrects and revalidates.
13. BL3 re-reviews.
14. Only then advance.
15. Commit accepted coherent work.
16. At appropriate boundaries, push branch and create/update the relevant PR.
17. Observe CI.
18. If CI finds genuine defects, correct through the same BL4 loop.
19. Continue until mission scope exhausted.

A blocked subphase does not automatically block other independent phases.

---

# 62. EXECUTOR REPORT CONTRACT

Every BL4 phase report must include at least:

```text
phase_id
task_status
transport_status
report_schema_status
mutation_status
skills_loaded
skill_attestation
target_repository
target_backend
files_inspected
files_changed
behavior_changed
commands_run
tests_and_results
security_notes
known_limitations
requested_followup
```

Include non-secret provenance fields exposed by Dual Codex.

For commandless work:

```json
"commands_run": []
```

Never include secrets.

---

# 63. BL3 REVIEW CONTRACT

Review in this order:

1. Was Dual Codex actually used?
2. Was canonical BL4 targeted?
3. Was BL4 account/role proven?
4. Was BL4 profile/CODEX_HOME proven where applicable?
5. Was Prompt Arena repository proven?
6. Was configured backend proven?
7. Was backend-appropriate provenance proven?
8. Were mandatory skills actually loaded?
9. Was there any substitute Executor/native subagent?
10. Was there any silent backend switch?
11. Did implementation stay in phase scope?
12. Did it preserve product invariants?
13. Did it preserve security?
14. Does validation prove claims?
15. Is the diff maintainable?
16. Are docs/tests/config aligned?
17. Was user work preserved?
18. Are remote actions within authorization?
19. Are blockers truthfully classified?
20. Is the phase ready to commit/PR?

Never advance on `correction_required`.

---

# 64. PRODUCT ACCEPTANCE CRITERIA

The mission should attempt to satisfy all of the following.

## Application

- Windows build works or is strongly validated in CI/environment.
- Linux build works or is strongly validated in CI/environment.
- no macOS target.
- application starts without server account/login.
- no telemetry.
- no BielOS coupling.
- worker lifecycle is local/app-owned.

## Arena

- user can select benchmark/tasks;
- user can select multiple competitors;
- local models can execute through at least Ollama;
- responses/results persist;
- streaming/progress visible;
- failures visible;
- cancellation works;
- interruption preserves state;
- blind evaluation works;
- objective evaluation works;
- results/history works.

## Benchmarking

- drafts + immutable Benchmark Versions;
- JSON Schema;
- official packs in three categories;
- repetitions;
- procedural cases;
- sample size;
- scoring;
- comparability metadata;
- regression architecture;
- rankings.

## Local model ecosystem

- adapter-first;
- Ollama real support;
- LM Studio/llama.cpp if feasible;
- same model across runtimes not automatically treated as different competitor;
- quantization identity;
- model library;
- native backend download;
- grouping confirmation;
- hardware recommendation;
- confidence/n;
- duplicate management.

## UI

- polished;
- gray, not pure black;
- strongly rounded;
- deManage-informed structural quality but distinct identity;
- Times New Roman default intent;
- at least 6 font choices;
- theme customization;
- accessible;
- no raw placeholder dashboard look.

## Security/privacy

- keys never logged/exported;
- secure credential storage;
- explicit outbound API behavior;
- sandbox does not silently fall back to host;
- imported content treated untrusted;
- no unsafe Tauri permissions;
- zero telemetry.

## Git/PR

- multiple cohesive commits;
- multiple cohesive PRs;
- no merges;
- no force push;
- final umbrella PR;
- clean evidence of remote actions.

---

# 65. DO NOT DO

Do not:

- build a social network;
- add user accounts;
- add multi-user/team workspace;
- add mandatory cloud sync;
- add hosted inference;
- add Prompt Arena server;
- add telemetry;
- couple to BielOS;
- add macOS support;
- build a custom inference engine;
- invent a marketplace;
- make AI judge the sole truth source;
- silently modify benchmark history;
- silently truncate context;
- silently substitute providers/judges;
- silently adjust runtime configs;
- silently run coding tasks on host when Docker-required;
- silently delete model files;
- hide failed competitors;
- hide parameter incompatibility;
- hide model identity uncertainty;
- create fake benchmark data in production;
- use native Codex subagents as implementation workers;
- bypass BL4 because of inconvenience;
- merge PRs;
- deploy/release.

---

# 66. EMPTY-REPOSITORY BOOTSTRAP RULE

If `bielxdh3/Prompt-Arena` is empty or nearly empty:

1. create the minimum repository foundation needed for the stack;
2. add README/ROADMAP/AGENTS/docs;
3. add `.gitignore`;
4. add licenses only if repository/user choice is already known; do not invent a license if not known;
5. add CI;
6. establish branch/PR stack;
7. continue directly into product implementation.

Do not interpret an empty repository as a reason to return only a plan.

Do not stop after scaffolding.

---

# 67. HUMAN-INTERVENTION MINIMIZATION

Do not ask for:

- folder names;
- component names;
- table names;
- routine package choices;
- test file organization;
- reversible refactor decisions;
- normal UI spacing decisions;
- normal local port selection;
- common retry values;
- ordinary error copy;
- non-critical naming choices.

Make reasonable choices and document them.

Only defer to human when genuinely necessary, such as:

- PR merges;
- unavailable credentials for a real external provider;
- OS signing certificate;
- manual visual acceptance that cannot be automated;
- a product decision not resolved anywhere in this prompt and with material irreversible consequences;
- destructive action;
- legal/licensing ambiguity requiring owner choice;
- external service approval.

Accumulate these in one final queue.

---

# 68. VISUAL QA

Because UI quality is a first-class requirement:

- inspect actual rendered screens where tooling allows;
- fix overflow;
- fix spacing;
- fix clipping;
- fix unreadable contrast;
- fix inconsistent radii;
- fix awkward typography;
- test empty/loading/error states;
- test long model names;
- test long benchmark names;
- test large metric values;
- test narrow desktop window widths;
- test font switching;
- test custom theme values;
- test Times New Roman missing fallback behavior on Linux;
- test keyboard navigation.

Do not accept "the components compile" as sufficient UI validation.

---

# 69. DATA MIGRATION AND FORWARD COMPATIBILITY

From the beginning:

- use explicit schema migrations;
- never mutate historical semantic records in place when immutability forbids it;
- add migration tests;
- keep schema version;
- add artifact schema/version metadata;
- preserve unknown/future fields where practical for imported benchmark JSON;
- reject malformed/unsafe data with useful errors.

---

# 70. ERROR TAXONOMY

Use typed errors and user-facing normalization.

Distinguish:

```text
provider unavailable
provider auth failed
model not installed
model load failed
OOM
timeout
cancelled
stream disconnected
malformed provider response
capability mismatch
parameter adjustment required
sandbox unavailable
Docker unavailable
objective verifier failed
judge unavailable
storage failure
artifact write failure
database migration failure
worker crashed
run interrupted
benchmark invalid
benchmark version mismatch
credential unavailable
network blocked
```

Avoid dumping raw backend errors without context.

Preserve raw non-secret diagnostic detail in expandable technical views/logs where useful.

---

# 71. DIAGNOSTIC EVIDENCE

A run should expose enough evidence for technical audit without drowning normal users.

Simple mode:

- status;
- score;
- speed;
- failures;
- key warnings.

Expandable technical panel:

- effective config;
- provider/runtime;
- runtime version;
- model identity;
- parameter parity;
- environment;
- attempt order;
- timestamps;
- case seed;
- artifact links;
- evaluator details;
- comparability flags;
- error detail.

Full audit/replay:

- persisted events;
- materialized inputs;
- output artifacts;
- test results;
- evaluation evidence.

---

# 72. SECURITY OF MODEL OUTPUT RENDERING

Model output is untrusted.

When rendering Markdown/code:

- sanitize HTML;
- avoid arbitrary script execution;
- safe-link external URLs;
- escape raw HTML where appropriate;
- protect `file://` and custom protocol handlers;
- never turn model-generated text into Tauri command arguments without strict parsing/validation.

---

# 73. DOWNLOAD SECURITY

Model/catalog downloads:

- display source;
- display size where known;
- preserve checksums/digests where provided;
- avoid unsafe archive extraction;
- avoid path traversal;
- call backend-native download mechanism when designed;
- distinguish catalog metadata from locally verified artifact identity;
- never execute downloaded model-adjacent files as code.

---

# 74. DELETION SAFETY

For model/artifact deletion:

- show what will be removed;
- show estimated released space;
- show references;
- prefer soft/manual cleanup for user-created data;
- require explicit confirmation for risky manual model-file deletion;
- prevent deletion while active;
- handle symlinks carefully;
- never recursively delete outside known roots;
- log non-secret deletion outcome.

---

# 75. STORAGE CLEANUP

Provide storage insights:

- database size;
- artifact store size;
- model storage known through runtimes;
- caches;
- old exports.

Allow:

- manual compaction;
- safe derived-cache cleanup;
- benchmark/user retention policy.

Do not conflate runtime-owned model storage with Prompt Arena-owned artifacts.

---

# 76. SOURCE OF TRUTH FOR ROADMAP

Create/update `ROADMAP.md` very early.

It must reflect this mission and evolve with implementation.

Use status markers, not vague prose.

At closeout, ROADMAP must accurately distinguish implemented vs blocked vs future.

Do not leave completed features marked planned.
Do not mark mocks as production-complete integrations.

---

# 77. SOURCE OF TRUTH FOR DESIGN

Create a lightweight `docs/DESIGN_SYSTEM.md` or equivalent describing:

- gray palette principle;
- semantic tokens;
- rounded radius scale;
- typography;
- Times New Roman default/fallback;
- selectable fonts;
- spacing;
- panels/cards;
- table/chart style;
- focus states;
- theme customization contract;
- deManage as structural inspiration only.

No need to reproduce proprietary ChatGPT/Claude CSS.

The goal is design language inspiration, not pixel copying.

---

# 78. SOURCE OF TRUTH FOR BENCHMARK SEMANTICS

Create documentation/schema that clearly defines:

```text
Draft
Benchmark Version
Run
Attempt
Materialized Case
Replication
Regression
Comparability
Evaluation
Scoring
Aggregation
Profile Revision
Runtime Binding
```

This vocabulary must be consistent in code and UI.

Avoid ambiguous uses of "Arena", "Benchmark", and "Run".

---

# 79. BENCHMARK FAIRNESS PHILOSOPHY

Do not impose one global definition of fairness.

Benchmark defines conditions.

Prompt Arena must make differences explicit.

Fairness is transparency + reproducible declared policy, not pretending all providers have identical features.

Examples:

- one provider lacks temperature;
- one model uses CPU offload;
- one runtime cannot expose token counts;
- one model has smaller context;
- one tool unavailable.

Record and surface it.

---

# 80. LOCAL PERFORMANCE HISTORY AND HARDWARE CHANGES

Performance recommendation/history:

- do not discard all old measurements after hardware changes;
- use current-hardware evidence with higher relevance;
- older hardware can inform broad estimates;
- never present mixed-hardware benchmark speed as directly comparable without flags;
- hardware fingerprint should be stored sufficiently to recognize meaningful changes.

No need to treat every driver patch as a new machine unless the benchmark/user policy says so.

---

# 81. CONFIDENCE MODEL FOR HARDWARE RECOMMENDATIONS

Recommendation confidence should combine:

```text
sample size
variability
similarity of hardware
similarity of model family/size
similarity of quantization
similarity of context/output conditions
similarity of offload
runtime context
stability/OOM history
```

Simple statistical heuristics are acceptable initially.

Do not claim ML-level prediction accuracy without evidence.

Keep the system explainable.

Show "why recommended" in advanced details.

---

# 82. CLOSE-APP ACTIVE RUN BEHAVIOR

Implement explicit close interception when a run is active.

Options:

```text
Cancel run and quit
Continue in tray
Go back
```

Tray continuation must be visible and controllable.

After completion:

- notify locally if appropriate;
- worker can terminate;
- app remains in tray or exits according to explicit user preference.

No secret background persistence.

---

# 83. OFFICIAL PACK QUALITY GATE

An official pack is not complete merely because JSON parses.

Validate:

- schema;
- semantic rules;
- evaluator availability;
- task IDs;
- version references;
- score range;
- weights;
- procedural generator determinism from seed where required;
- sandbox declarations;
- expected artifacts;
- no unsafe paths;
- no secrets;
- documentation;
- representative smoke run with mocks or live runtime where available.

---

# 84. AI-JUDGE PROMPT INJECTION DEFENSE

When AI judges evaluate model output:

- treat candidate output as quoted/untrusted content;
- delimit clearly;
- instruct judge not to follow candidate instructions;
- hide competitor identity unless benchmark intentionally exposes it;
- preserve judge prompt/version;
- sanitize/limit attachments;
- record degraded/incomplete judge panel.

Never let a candidate response alter judge system policy or tool permissions.

---

# 85. HUMAN BLINDNESS INTEGRITY

For fully blind human mode:

Before evaluation lock:

- no model names;
- no provider logos;
- no runtime names;
- no speed;
- no token count;
- no cost;
- no AI scores;
- no rank order based on hidden metrics.

Randomize display order.

Store mapping securely in local run state.

Reveal only after evaluation is finalized.

Avoid visual clues such as model-specific avatar/color.

---

# 86. COST COMPARISON

Store:

```text
actual historical cost
price snapshot/date
provider price basis
input/output unit prices
unknown/estimated flags
```

Current-price simulation is separate derived analysis.

Never overwrite historical cost when prices change.

---

# 87. USER-CREATED BENCHMARKS

Allow user-created tasks/packs.

Editor should:

- validate;
- save draft;
- clone/fork;
- freeze version;
- show which changes are semantic;
- prevent editing frozen semantic content in place;
- provide clear "create new version" path.

Do not require Git knowledge.

---

# 88. SAVED COMPETITOR GROUPS

Support manually selected models/profiles and saved groups.

Packs can recommend requirements/profiles.

Recommendations are not mandatory unless benchmark defines a hard requirement.

Show incompatibility before run where detectable.

---

# 89. EFFECTIVE CONFIG SNAPSHOT

Every attempt should be explainable from stored data.

Store the resolved effective configuration after applying:

```text
profile defaults
benchmark constraints/overrides
runtime capabilities
authorized adjustments
user run-level choices
```

Do not rely on mutable current settings to interpret historical results.

---

# 90. REVIEW OF REFERENCE REPOSITORY

Before implementing the main shell/design system, BL3/BL4 may inspect `bielxdh3/demanage` read-only.

Focus on frontend structure and component composition.

Do not import repository code wholesale.

If copying a reusable snippet is considered, verify licensing/ownership and adapt it meaningfully to Prompt Arena rather than transplanting product-specific code.

---

# 91. DEPENDENCY DISCIPLINE

Prefer mature dependencies with clear value.

Avoid dependency explosion.

For every major dependency:

- justify purpose;
- prefer actively maintained;
- avoid abandoned packages;
- check license;
- avoid network/telemetry SDKs;
- avoid packages that require cloud accounts for core functions.

Lock dependencies reproducibly.

---

# 92. LICENSE DISCIPLINE

Do not invent a project license if repository/user has not chosen one.

If a license already exists, obey it.

Track licenses for bundled open-source fonts/assets/dependencies where required.

Do not redistribute proprietary fonts such as Times New Roman without license.

---

# 93. LOCALIZATION

Primary UI language can follow the current implementation decision.

Do not block core work on a full i18n system unless repository direction already requires it.

Avoid hardcoding architecture that makes future localization impossible.

If UI is initially Portuguese or English, keep copy centralized enough for future work.

---

# 94. DATA PRIVACY COPY

Settings/About/Privacy documentation should clearly say:

- local data stays local by default;
- zero Prompt Arena telemetry;
- external provider calls send content to the selected provider;
- model downloads contact the selected catalog/runtime;
- local runtime endpoints may be configured;
- no Prompt Arena account/server.

---

# 95. VERSIONING APPLICATION ITSELF

Use normal semantic application versioning when the project reaches release readiness.

Do not conflate app version with Benchmark Version.

Do not tag/release under this mission.

Build artifacts may be created locally/CI for validation without publishing a release.

---

# 96. REVIEW CI AFTER EACH PR

For each pushed PR:

- observe available CI;
- classify failures as semantic vs environment;
- fix semantic failures through BL4;
- do not ignore red CI;
- do not endlessly chase clearly unrelated platform outages;
- record remaining environment failures precisely.

Do not weaken checks to make CI green without justification.

---

# 97. FINAL MASTER PONYTAIL REPORT

At mission end, BL3 must produce a detailed Master PONYTAIL report.

Include:

## Status

```text
mission status
repository
default branch
starting SHA/state
final stack head SHA
worktree state
ahead/behind
PONYTAIL status
BL3 skill attestation
BL4 skill attestation
configured backend
provenance summary
number of delegations
number of correction rounds
number of commits
number of PRs
blockers
human action queue
```

## Role/provenance

```text
BL3 orchestrator/architect proof
BL4 executor/reviewer proof
account mapping
role mapping
CODEX_HOME/profile evidence where available
repository evidence
backend evidence
App Server/session/thread/turn/request ids where available
TUI metadata only if TUI was used
confirmation of no substitute Executor
confirmation of no native subagent
confirmation of no silent backend switch
```

## Skills

For each mandatory skill and role:

```text
identity
path/resource
hash/version
load status
application
```

## Phase ledger

For each phase:

```text
phase id
objective
delegation ids
files
tests
architect verdict
correction rounds
commit(s)
PR
blockers
```

## Files changed

For each important file/group:

```text
path
reason
phase
ownership
type of change
```

## Behavior changed

```text
previous behavior
new behavior
security implication
validation evidence
```

## Validation

```text
command
environment
result
test count if exposed
claim proved
```

Do not paste huge logs.

## Product acceptance matrix

For every acceptance criterion:

```text
accepted
blocked
conditional
not attempted (must justify)
```

with evidence.

## Security review

```text
final verdict
Critical findings
High findings
Medium findings
Low findings
fixes
remaining risks
```

## UI review

```text
screens/surfaces validated
theme/font validation
accessibility checks
remaining visual issues
```

## Benchmark integrity review

```text
immutability
procedural materialization
comparability
evaluation authority
blindness
regression
history
```

## Git/remote truth

List every:

```text
commit
branch pushed
PR URL/number
base/head
CI state
```

Explicitly say:

```text
merge performed? NO
force push performed? NO
release/tag? NO
deploy? NO
destructive remote mutation? NO
```

unless a future explicit authorization changed that.

## Remaining blockers

For each:

```text
item
scope
reason
what was completed around it
exact prerequisite
whether human action is required
recommended next action
```

## Human action queue

Keep this minimal and final.

Examples:

- review/merge PR stack;
- provide external API key to live-test provider;
- install Docker and rerun one gated smoke;
- perform manual visual smoke on hardware not available to CI;
- code-sign installer if desired.

## Final verdict

Use a clear final state such as:

```text
PROMPT_ARENA_FULL_MISSION_COMPLETE_PENDING_HUMAN_PR_REVIEW
PROMPT_ARENA_CORE_COMPLETE_WITH_NONCRITICAL_BLOCKERS
PROMPT_ARENA_BLOCKED_BY_PROVENANCE
PROMPT_ARENA_BLOCKED_BY_SECURITY
```

Do not say "complete" if important in-scope functionality is knowingly missing without qualification.

---

# 98. DEFINITION OF "DONE ENOUGH TO RETURN"

Do not return to the user merely because:

- the repo scaffolds;
- the app window opens;
- one model responds;
- one benchmark exists;
- tests compile;
- one PR exists.

Continue until all current roadmap phases are either:

```text
implemented and accepted
truthfully blocked
truthfully conditional
explicitly deferred because it requires human-only action
```

And until:

- multiple commits exist;
- multiple PRs exist or remote publication is truthfully blocked;
- full documentation reflects truth;
- CI has been inspected;
- final security review is complete;
- final Master PONYTAIL report exists.

---

# 99. BEGIN

Start now with mandatory preflight.

Then construct the smallest sensible number of **substantial, coherent phases** that can complete this entire mission.

Do not ask the user to repeat known product decisions.

Do not ask for routine engineering choices.

Use BL3 as Orchestrator + Architect.

Use BL4 as canonical Executor + configured Reviewer role, while preserving BL3's independent Architect review.

Use PONYTAIL and mandatory applicable skills.

Use Dual Codex for all implementation.

Use the actual configured BL4 backend.

Fail closed on mission-wide provenance/security violations.

Skip/isolate safe local blockers and continue independent work.

Create multiple coherent commits.

Push multiple non-destructive branches.

Create multiple stacked PRs.

Do not merge.

Keep Prompt Arena standalone and local-first.

Target only Windows and Linux.

Do not add telemetry.

Do not couple to BielOS.

Use deManage only as a structural UI reference.

Default to a polished dark-gray, strongly rounded interface.

Default typography intent is Times New Roman with safe Linux fallbacks and at least six selectable fonts.

Implement broad theme customization through semantic tokens.

Complete as much of the entire current roadmap as safely possible before returning.

Defer human-only actions to the final queue.

End only with the Master PONYTAIL report.
