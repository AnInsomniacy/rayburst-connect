import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  CorePalette,
  Contrast,
  customColor,
  type Theme,
} from '@material/material-color-utilities';
import type { UiPrefs } from '@/lib/schema';
// ─── Color Schemes ──────────────────────────────────────

interface ColorSchemeDefinition {
  /** Unique identifier stored in config (kebab-case). */
  id: UiPrefs['colorScheme'];
  /** i18n key for the scheme name. */
  labelKey: string;
  /** Seed hex fed to MCU `themeFromSourceColor`. */
  seed: string;
}

/** Rayburst purple is the default; other seeds are explicit user choices. */
export const COLOR_SCHEMES: ColorSchemeDefinition[] = [
  { id: 'rayburst', labelKey: 'options_color_scheme_rayburst', seed: '#7B3ED1' },
  { id: 'amber', labelKey: 'options_color_scheme_amber', seed: '#E0A422' },
  { id: 'space', labelKey: 'options_color_scheme_space', seed: '#4A6CF7' },
  { id: 'mint', labelKey: 'options_color_scheme_mint', seed: '#10B981' },
  { id: 'rose', labelKey: 'options_color_scheme_rose', seed: '#F43F5E' },
  { id: 'coral', labelKey: 'options_color_scheme_coral', seed: '#F97316' },
  { id: 'glacier', labelKey: 'options_color_scheme_glacier', seed: '#06B6D4' },
  { id: 'evergreen', labelKey: 'options_color_scheme_evergreen', seed: '#15803D' },
  { id: 'graphite', labelKey: 'options_color_scheme_graphite', seed: '#6B7280' },
  { id: 'sakura', labelKey: 'options_color_scheme_sakura', seed: '#EC4899' },
];

export function resolveScheme(id: string | undefined): ColorSchemeDefinition {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? COLOR_SCHEMES[0]!;
}

// ─── M3 Palette → CSS Variables ─────────────────────────

const MCU_TO_CSS: Record<string, string> = {
  primary: '--color-primary',
  onPrimary: '--color-on-primary',
  primaryContainer: '--color-primary-container',
  onPrimaryContainer: '--color-on-primary-container',
  surface: '--color-surface',
  onSurface: '--color-on-surface',
  onSurfaceVariant: '--color-on-surface-variant',
  outline: '--color-outline',
  outlineVariant: '--color-outline-variant',
  error: '--color-error',
  onError: '--color-on-error',
  errorContainer: '--color-error-container',
  tertiary: '--color-tertiary',
  onTertiary: '--color-on-tertiary',
  inverseSurface: '--color-inverse-surface',
  inverseOnSurface: '--color-on-inverse-surface',
};

export const SURFACE_TONES = {
  light: {
    '--color-surface-dim': 84,
    '--color-surface-container-lowest': 98,
    '--color-surface-container-low': 94,
    '--color-surface-container': 91,
    '--color-surface-container-high': 88,
    '--color-surface-container-highest': 85,
  },
  dark: {
    '--color-surface-dim': 6,
    '--color-surface-container-lowest': 4,
    '--color-surface-container-low': 10,
    '--color-surface-container': 12,
    '--color-surface-container-high': 17,
    '--color-surface-container-highest': 22,
  },
} as const;

const SEMANTIC_SEEDS = {
  info: '#0061A4',
  success: '#386A20',
  warning: '#7C5800',
  error: '#BA1A1A',
} as const;

export function semanticRoles(theme: Theme, dark: boolean) {
  return Object.fromEntries(
    Object.entries(SEMANTIC_SEEDS).map(([name, seed]) => {
      const group = customColor(theme.source, { name, value: argbFromHex(seed), blend: true });
      const role = dark ? group.dark : group.light;
      const palette = CorePalette.of(group.value).a1;
      return [
        name,
        {
          color: hexFromArgb(role.color),
          onColor: hexFromArgb(role.onColor),
          container: hexFromArgb(role.colorContainer),
          onContainer: hexFromArgb(role.onColorContainer),
          hover: hexFromArgb(palette.tone(dark ? 70 : Contrast.darker(100, 4.6))),
          pressed: hexFromArgb(palette.tone(dark ? 90 : 30)),
        },
      ];
    }),
  );
}

interface ThemeVarsInput {
  readonly seedHex: string;
  readonly isDark: boolean;
}

/** Generate every themed CSS custom property for a seed + mode. */
export function createThemeVars({ seedHex, isDark }: ThemeVarsInput): Record<string, string> {
  const m3Theme = themeFromSourceColor(argbFromHex(seedHex));
  const scheme = isDark ? m3Theme.schemes.dark : m3Theme.schemes.light;
  const json = scheme.toJSON() as Record<string, number>;
  const vars: Record<string, string> = {};

  for (const [mcuKey, cssVar] of Object.entries(MCU_TO_CSS)) {
    const argb = json[mcuKey];
    if (argb !== undefined) vars[cssVar] = hexFromArgb(argb);
  }

  const neutral = m3Theme.palettes.neutral;
  for (const [cssVar, tone] of Object.entries(SURFACE_TONES[isDark ? 'dark' : 'light'])) {
    vars[cssVar] = hexFromArgb(neutral.tone(tone));
  }

  const primary = hexFromArgb(scheme.primary);
  vars['--color-brand'] = primary;
  for (const [name, role] of Object.entries(semanticRoles(m3Theme, isDark))) {
    vars[`--color-${name}`] = role.color;
    vars[`--color-on-${name}`] = role.onColor;
    vars[`--color-${name}-container`] = role.container;
    vars[`--color-on-${name}-container`] = role.onContainer;
  }

  const palette = m3Theme.palettes.primary;
  vars['--color-primary-light-5'] = hexFromArgb(palette.tone(isDark ? 30 : 80));
  vars['--color-primary-light-9'] = hexFromArgb(palette.tone(isDark ? 10 : 95));

  const sr = (scheme.onSurface >> 16) & 0xff;
  const sg = (scheme.onSurface >> 8) & 0xff;
  const sb = scheme.onSurface & 0xff;
  vars['--color-scrollbar-thumb'] = `rgba(${sr}, ${sg}, ${sb}, ${isDark ? 0.22 : 0.3})`;

  return vars;
}
