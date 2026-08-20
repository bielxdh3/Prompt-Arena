# Security

## Foundation verdict

The desktop boundary remains narrow and has no enabled host-system plugin permissions. Registered Tauri commands are
`app_status`, `validate_benchmark_document`, `list_benchmark_versions`, and `save_benchmark_version`; they operate only
on typed benchmark data and the app-owned local storage root. The capability file contains no plugin permissions. The
worker accepts a tagged protocol, validates its version and job ID, performs only the foundation contract check, and
exits.

The CSP allows the local Vite development origin and Tauri IPC only. It does not allow arbitrary scripts, inline styles,
or external font loading in the production document. Font choices use local system stacks.

## Trust boundaries

- UI input is presentation state; font selection is constrained to a fixed option list.
- Tauri commands are explicit Rust functions with typed responses; no command accepts a shell string or path.
- Worker input is untrusted JSON and is rejected on malformed JSON, unsupported protocol versions, or unsafe job IDs.
- Benchmark documents are deserialized and manually validated at the domain boundary; unknown JSON fields are retained.
- Artifact references and write requests are validated as portable relative paths and cannot use traversal, absolute
  roots, drive prefixes, empty segments, symlinks, or backslashes.
- Local metadata is capped at 1 MiB. Artifact bytes are hashed, written atomically, and never replace an existing name;
  immutable metadata conflicts are rejected.
- Future model output is untrusted content and must be sanitized before Markdown/HTML rendering.

## Required future controls

Provider credentials, downloads, runtime process spawning, model execution, and destructive cleanup are not implemented
here. When added, they require explicit capability review, allowlisted executable paths, bounded arguments, safe archive
extraction, credential isolation, cancellation, and confirmation for user data deletion. Historical benchmark records
must not be deleted as a migration side effect.

No secrets, tokens, private logs, or databases belong in source control or validation output.
