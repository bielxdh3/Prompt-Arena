# Privacy

Prompt Arena is local-first and single-user per installation.

- Foundation UI state and future app-owned records stay on the local machine by default.
- Prompt Arena sends no telemetry and operates without a Prompt Arena account or server.
- The foundation has no hosted inference path and does not make provider requests.
- A later external provider integration may send selected prompt content and configuration to the provider chosen by the
  user; that behavior must be visible, opt-in, and separately documented.
- A later model/catalog download may contact the selected runtime or catalog. The source, destination, and progress must
  be shown to the user.
- Local runtime endpoints may be configured in a later phase; they are not silently substituted for local storage.

The app is not coupled to BielOS or another hub. Local data cleanup will be explicit and scoped to known app-owned roots.
Runtime-owned model files will not be conflated with Prompt Arena artifacts.
