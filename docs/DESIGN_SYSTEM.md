# Design system

Prompt Arena uses a dark neutral gray canvas with warm restrained accent color. The visual language is calm, strongly
rounded, and information-first rather than dashboard-dense.

## Tokens

Semantic CSS variables live in `src/styles.css`: canvas, surface, raised surface, soft surface, border, text, muted
text, subtle text, accent, success, and danger. Components consume semantic names instead of raw color literals where
possible. The radius scale is 10px / 18px / 28px, with 999px reserved for status chips.

## Typography

The default intent is Times New Roman. The explicit Linux fallback chain is Liberation Serif, Nimbus Roman, DejaVu Serif,
then the system serif. The app does not bundle proprietary fonts or fetch web fonts. Seven local font stacks are selectable
in Settings, including serif, sans-serif, and mono options.

## Components and behavior

Panels use a subtle gray gradient, thin border, and large radius. Primary actions use the warm accent; status uses success
and danger tokens. Every interactive control has a visible keyboard focus ring. Navigation uses semantic buttons with
`aria-current`, the app has a skip link, empty/error messages use live or alert semantics, and reduced-motion preferences
are honored.

Theme customization starts with the semantic token and font hooks. Future appearance editing may expose colors, radii,
spacing, and chart palettes while preserving contrast and focus requirements.
