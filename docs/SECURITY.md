# Security

## Foundation verdict

The desktop boundary remains narrow and has no enabled host-system plugin permissions. Registered Tauri commands are
typed status, benchmark/profile/draft persistence, fixed-loopback Ollama discovery, one-shot execution, Runs read
operations, and bounded blind-evaluation preparation/lock plus a read-only published benchmark-version command; they
operate only on typed data and the app-owned local storage root. Draft saves use bounded requests and
optimistic revisions; publishing revalidates the stored document before creating an immutable benchmark version. The
capability file contains no plugin permissions. The worker accepts a tagged protocol, validates its version, job ID,
and request bound, performs one generation at most, returns one typed terminal response, and exits.

The CSP allows the local Vite development origin and Tauri IPC only. It does not allow arbitrary scripts, inline styles,
or external font loading in the production document. Font choices use local system stacks.

The Phase 03 Ollama adapter remains a narrow backend module. Phase 06 exposes only the typed `list_local_ollama_models`
command, which constructs the fixed local default `http://127.0.0.1:11434`; it is not a general provider proxy and
does not accept an endpoint or credential. The adapter can request health, model metadata, generation, and streaming
from an already-running local Ollama service; it does not spawn or forcibly terminate that service.

## Trust boundaries

- UI input is presentation state; font selection is constrained to a fixed option list.
- Tauri commands are explicit Rust functions with typed responses; no command accepts a shell string or path.
- Worker input is untrusted JSON and is rejected on malformed JSON, unsupported protocol versions, or unsafe job IDs.
- The execution command resolves only the fixed worker binary beside the current app executable, supplies no shell or
  arbitrary command arguments, and bounds both request and response bytes.
- Benchmark documents are deserialized and manually validated at the domain boundary; unknown JSON fields are retained.
- Published version reads validate the deterministic bounded `benchmark-id@version` identity and return only the stored
  canonical document JSON plus summary. They do not import, rewrite, re-canonicalize, or publish benchmark history.
- Benchmark drafts are canonicalized before local storage and enforce portable IDs, a 256-byte title limit, a 256 KiB
  document limit, a 512 KiB request limit, and revision checks. Draft state is mutable; published benchmark versions
  remain immutable and conflicting content is rejected.
- Profile registration is typed and immutable. The derived `profile-id@revision` identity is checked at the storage
  boundary; identical replay is idempotent and changed content under that identity is rejected as an immutable conflict.
  The complete serialized profile request is capped at 256 KiB, including `parameters` and flattened `extra`, and the
  resulting metadata remains under the 1 MiB local metadata ceiling.
- The structured editor emits only bounded optional text expected answers. It rejects non-text expected values when
  loading a draft rather than silently converting them, and it rejects unsupported multi-item shapes before an edit can
  rewrite data.
- Artifact references and write requests are validated as portable relative paths and cannot use traversal, absolute
  roots, drive prefixes, empty segments, symlinks, or backslashes.
- Local metadata is capped at 1 MiB. Artifact bytes are hashed, written atomically, and never replace an existing name;
  immutable metadata conflicts are rejected.
- Ollama discovery is bounded to 512 records, validates bounded model text fields, caps every returned record's
  serialized metadata map at 256 KiB, and sorts records by name and digest. The standard-library HTTP client accepts
  only explicit plain-HTTP loopback endpoints; the Phase 06 command uses exactly `http://127.0.0.1:11434` and rejects
  credentials, query strings, fragments, and non-loopback hosts. Unavailable transport failures and malformed runtime
  responses remain typed unavailable/protocol errors. Status/header/NDJSON lines are capped at 64 KiB, non-stream
  bodies at 16 MiB, and cumulative streamed NDJSON payload bytes at 16 MiB. Every response also has a finite 10-minute
  overall read deadline by default, configurable from 1 ms through 60 minutes, in addition to the 500 ms per-read
  socket timeout.
- Cancellation is cooperative: the client checks the token between socket reads and streamed chunks and returns a typed
  cancellation error. It has no remote process-kill capability.
- The run-plan helper accepts no endpoint, credential, shell, provider, or lifecycle input. It validates the published
  version/document identity, selected task/case identity, non-empty prompt, immutable profile identity/runtime/model,
  supported bounded profile parameters, one-repetition limit, and serialized 256 KiB plan bound. It always emits the
  fixed/default `http://127.0.0.1:11434` Ollama configuration and delegates only to the existing one-shot worker.
- The Arena view accepts only selected identities returned by typed immutable version/profile reads and the selected
  stored document. It exposes no raw JSON, endpoint, credential, cancellation, or process-lifecycle input; progress and
  terminal text are rendered as text and no run record exists until explicit one-shot execution.
- Completed attempt summaries are bounded metadata only: they omit response text, are stored in the immutable attempt's
  flattened extra fields, and are rejected when they exceed the 8 KiB summary bound. The Runs view uses the existing
  typed `list_run_attempts` read and displays artifact/hash references without resolving or rendering artifact files.
  Failed/cancelled attempts have no completed-response summary. String expected values are separately capped at 64 KiB,
  validated at both plan boundaries, kept out of generation metadata/runtime requests, and reduced after generation to
  exact-text pass/fail, normalized byte counts, and SHA-256 hashes only; no response or expected text is copied into the
  result score or Runs UI.
- Objective verification is deterministic evidence, not human/AI evaluation: the immutable result score is null without
  a supported string expectation, and this slice writes only the bounded verifier kind, status, counts, and hashes. The
  persisted score field remains extensible generic JSON, while Runs displays objective details only for the recognized
  exact-text shape and preserves unknown/future score values without rendering them.
- Blind human evaluation is a separate local immutable record, not a mutation of Attempts, Results, or artifacts. Its
  preparation reader accepts only completed attempts pointing to registered `generation-response` artifacts, checks the
  app-owned relative path, kind/schema/path metadata, regular-file boundary, size, and SHA-256, and parses the bounded
  response as untrusted plain text. Stable anonymous tokens/order are derived from run and attempt IDs, while the
  prepared UI does not mount AttemptDetail or identifying model/profile/provider/endpoint/metric/objective/attempt-ID
  evidence. The parent gate also keeps that evidence hidden for loading, empty, and error states; only a successful lock
  re-enables post-lock audit IDs. The persisted record contains no response text, and scores/ranking are validated at
  the Rust boundary (overall/criterion scores 1–5, bounded token coverage, immutable replay/conflict behavior).
- Browser preview is a no-write surface: it renders unsaved editor/profile state and explanatory Arena contract copy
  only. It cannot invoke draft/version/profile/model/Arena commands, validate benchmarks, query Ollama, or invent
  records. Future model output is untrusted content and must be sanitized before Markdown/HTML rendering.

## Required future controls

External/cloud provider credentials, downloads, deletion, long-lived runtime process lifecycle, broader run authoring/
model execution UI beyond the bounded Arena flow, multi-rater human evaluation, AI judging, cross-run rankings, broader scoring/analysis, official benchmark packs, full model-library management,
broader benchmark authoring/import flows, and destructive cleanup are not implemented here. When added, they require
explicit capability review, allowlisted executable paths, bounded arguments, safe archive extraction, credential
isolation, cancellation, and confirmation for user data deletion.
Historical benchmark records must not be deleted as a migration side effect.

No secrets, tokens, private logs, or databases belong in source control or validation output.
