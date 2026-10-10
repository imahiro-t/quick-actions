// The colours of the result pane and the ⋯ dialog, by the `paneTheme` setting
// and where the pane is placed. Pure, so the tests check them directly.

/** The `paneTheme` setting: follow Claude Code's theme, or a fixed palette. */
export type PaneTheme = 'auto' | 'light' | 'dark'

/**
 * The setting as written: `light` or `dark` (any case, spaces around them
 * ignored); anything else, unset included, is `auto`.
 */
export function parsePaneTheme(setting: unknown): PaneTheme {
  if (typeof setting !== 'string') return 'auto'
  const v = setting.trim().toLowerCase()
  return v === 'light' || v === 'dark' ? v : 'auto'
}

/** A fixed palette: hex `#rrggbb` only, so its contrast can be checked. */
export type Palette = {
  readonly background: string
  readonly heading: string
  readonly body: string
  readonly failed: string
  readonly muted: string
}

// Every text colour reads at 4.5:1 or more on its background (WCAG AA), with
// room to spare, both as written and as a 256-colour terminal rounds them
// (Terminal.app among them): tests/theme.test.tsx holds them to both. Hence
// light's failure colour is #af0000, a colour of the 256-colour cube itself.
export const PALETTES: Readonly<Record<'light' | 'dark', Palette>> = {
  dark: { background: '#1e1e1e', heading: '#f0f0f0', body: '#d4d4d4', failed: '#ff7b72', muted: '#9e9e9e' },
  light: { background: '#fafafa', heading: '#1a1a1a', body: '#303030', failed: '#af0000', muted: '#5c5c5c' },
}

// The pane's text colours under `auto`, by placement. Docked on the right,
// the pane sits on a background core paints in the theme
// (composerSidebarBackground), while text with no colour is drawn in the
// terminal's own foreground: when the theme and the terminal disagree (a dark
// terminal on the light theme, or the other way round) that text vanishes.
// A theme key is drawn in the same theme as that background, so it reads
// either way. Inline, nothing paints the background, so the heading and body
// keep the terminal's foreground there, which suits the terminal's own
// background. A failure follows the same split: docked it is the theme's
// `error`; inline it stays the raw name `red`, as it was, which the terminal
// draws from its own palette, tuned to its own background where the theme's
// `error` is not (a colour prop admits a theme key, a name or hex, never an
// `ansi:` value). dimColor needs nothing: core draws it in the theme's
// `inactive`.
export const PANE_COLORS = {
  dock: { heading: 'text', body: 'text', failed: 'error' },
  inline: { heading: undefined, body: undefined, failed: 'red' },
} as const

/**
 * How the pane and the ⋯ dialog are drawn. `background` undefined: the plugin
 * paints none (core's, or the terminal's, shows). `muted` undefined: the
 * secondary texts are drawn dimColor, as before; a palette names a colour
 * instead, since dimColor is the theme's `inactive`, which need not read on a
 * fixed background.
 */
export type PaneStyle = {
  readonly background: string | undefined
  readonly heading: string | undefined
  readonly body: string | undefined
  readonly failed: string
  readonly muted: string | undefined
}

/**
 * The style for `theme` at `placement`. Inline is the same whatever the
 * setting (nothing paints its background, so it keeps the terminal's colours);
 * docked, `auto` is PANE_COLORS.dock as it always was, and `light` / `dark`
 * their palette, background and all.
 */
export function paneStyle(theme: PaneTheme, placement: 'dock' | 'inline'): PaneStyle {
  if (placement === 'inline') return { background: undefined, muted: undefined, ...PANE_COLORS.inline }
  if (theme === 'auto') return { background: undefined, muted: undefined, ...PANE_COLORS.dock }
  return PALETTES[theme]
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (m === null) throw new Error(`not a #rrggbb colour: ${hex}`)
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map(h => {
    const c = parseInt(h, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG 2.x contrast ratio of two `#rrggbb` colours, 1 to 21, in either order. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
