# Security

## Foundation verdict

The foundation has a narrow desktop boundary and no enabled host-system plugin permissions. The only registered Tauri
command is `app_status`, which returns static typed application metadata. The capability file contains no plugin
permissions. The worker accepts a tagged protocol, validates its version and job ID, performs only the foundation
contract check, and exits.

The CSP allows the local Vite development origin and Tauri IPC only. It does not allow arbitrary scripts, inline styles,
or external font loading in the production document. Font choices use local system stacks.

## Trust boundaries

- UI input is presentation state; font selection is constrained to a fixed option list.
- Tauri commands are explicit Rust functions with typed responses; no command accepts a shell string or path.
- Worker input is untrusted JSON and is rejected on malformed JSON, unsupported protocol versions, or unsafe job IDs.
- Artifact paths are validated as portable relative paths and cannot use traversal, absolute roots, or backslashes.
- Future model output is untrusted content and must be sanitized before Markdown/HTML rendering.

## Required future controls

Provider credentials, downloads, runtime process spawning, and destructive cleanup are not implemented here. When added,
they require explicit capability review, allowlisted executable paths, bounded arguments, safe archive extraction,
credential isolation, cancellation, and confirmation for user data deletion. Historical benchmark records must not be
deleted as a migration side effect.

No secrets, tokens, private logs, or databases belong in source control or validation output.
