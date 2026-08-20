# Security

## Foundation verdict

The desktop boundary remains narrow and has no enabled host-system plugin permissions. Registered Tauri commands are
typed status, benchmark/profile/draft persistence, one-shot execution, and Runs read operations; they operate only on
typed data and the app-owned local storage root. Draft saves use bounded requests and optimistic revisions; publishing
revalidates the stored document before creating an immutable benchmark version. The capability file contains no plugin
permissions. The worker accepts a tagged protocol, validates its version, job ID, and request bound, performs one
generation at most, returns one typed terminal response, and exits.

The CSP allows the local Vite development origin and Tauri IPC only. It does not allow arbitrary scripts, inline styles,
or external font loading in the production document. Font choices use local system stacks.

The Phase 03 Ollama adapter is a backend-only module and is not exposed as a general provider proxy or UI command. It
can request health, model metadata, generation, and streaming from an already-running local Ollama service; it does not
spawn or forcibly terminate that service.

## Trust boundaries

- UI input is presentation state; font selection is constrained to a fixed option list.
- Tauri commands are explicit Rust functions with typed responses; no command accepts a shell string or path.
- Worker input is untrusted JSON and is rejected on malformed JSON, unsupported protocol versions, or unsafe job IDs.
- The execution command resolves only the fixed worker binary beside the current app executable, supplies no shell or
  arbitrary command arguments, and bounds both request and response bytes.
- Benchmark documents are deserialized and manually validated at the domain boundary; unknown JSON fields are retained.
- Benchmark drafts are canonicalized before local storage and enforce portable IDs, a 256-byte title limit, a 256 KiB
  document limit, a 512 KiB request limit, and revision checks. Draft state is mutable; published benchmark versions
  remain immutable and conflicting content is rejected.
- The structured editor emits only bounded optional text expected answers. It rejects non-text expected values when
  loading a draft rather than silently converting them, and it rejects unsupported multi-item shapes before an edit can
  rewrite data.
- Artifact references and write requests are validated as portable relative paths and cannot use traversal, absolute
  roots, drive prefixes, empty segments, symlinks, or backslashes.
- Local metadata is capped at 1 MiB. Artifact bytes are hashed, written atomically, and never replace an existing name;
  immutable metadata conflicts are rejected.
- The standard-library Ollama HTTP client accepts only explicit plain-HTTP loopback endpoints. It rejects credentials,
  query strings, fragments, and non-loopback hosts; status/header/NDJSON lines are capped at 64 KiB, non-stream bodies
  at 16 MiB, and cumulative streamed NDJSON payload bytes at 16 MiB. Every response also has a finite 10-minute overall
  read deadline by default, configurable from 1 ms through 60 minutes, in addition to the 500 ms per-read socket
  timeout.
- Cancellation is cooperative: the client checks the token between socket reads and streamed chunks and returns a typed
  cancellation error. It has no remote process-kill capability.
- Browser preview is a no-write surface: it renders unsaved editor state only and cannot invoke draft/version commands or
  benchmark validation. Future model output is untrusted content and must be sanitized before Markdown/HTML rendering.

## Required future controls

External/cloud provider credentials, downloads, long-lived runtime process lifecycle, run authoring/model execution UI,
evaluation, official benchmark packs, model-library management, broader benchmark authoring/import flows, and destructive
cleanup are not implemented here. When added, they require explicit capability review, allowlisted executable paths,
bounded arguments, safe archive extraction, credential isolation, cancellation, and confirmation for user data deletion.
Historical benchmark records must not be deleted as a migration side effect.

No secrets, tokens, private logs, or databases belong in source control or validation output.
