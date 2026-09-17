/**
 * The extension's entire theme system in one module:
 *
 *   - preset color schemes (MCU seeds, aligned with the desktop app)
 *   - M3 palette generation → CSS custom properties
 *   - pre-mount bootstrap (no first-frame flash)
 *   - `useAppTheme()` — the single Vue composable both UIs consume
 *
 * The static Rayburst purple values in globals.css act as fallback for the brief
 * window before the bootstrap runs.
 */
import { computed, onScopeDispose, ref, watchEffect } from 'vue';
import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  Contrast,
} from '@material/material-color-utilities';
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui';
import { parseUiPrefs, type ThemePreference, type UiPrefs } from '@/lib/schema';

import { createThemeVars, resolveScheme, semanticRoles, SURFACE_TONES } from './theme-colors';
export { COLOR_SCHEMES, createThemeVars } from './theme-colors';

/** Resolve a theme preference to the effective light/dark class. */
function resolveThemeClass(preference: ThemePreference, systemIsDark: boolean): 'light' | 'dark' {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

/** Apply the theme to the document: class on <html> + CSS variables. */
function applyThemeToDocument(prefs: UiPrefs, systemIsDark: boolean): void {
  const themeClass = resolveThemeClass(prefs.theme, systemIsDark);
  document.documentElement.className = themeClass;
  const vars = createThemeVars({
    seedHex: resolveScheme(prefs.colorScheme).seed,
    isDark: themeClass === 'dark',
  });
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value);
  }
}

// ─── Pre-mount Bootstrap ────────────────────────────────

let bootstrappedPrefs: UiPrefs | undefined;

/**
 * Apply the persisted theme before Vue mounts so the first rendered frame
 * doesn't flash the static purple fallback.
 */
export async function bootstrapStoredTheme(storage: {
  getItem: (key: 'local:uiPrefs') => Promise<unknown>;
}): Promise<UiPrefs> {
  const prefs = parseUiPrefs(await storage.getItem('local:uiPrefs').catch(() => null));
  applyThemeToDocument(prefs, window.matchMedia('(prefers-color-scheme: dark)').matches);
  bootstrappedPrefs = prefs;
  return prefs;
}

// ─── Naive UI Overrides ─────────────────────────────────

const FONT_FAMILY =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ' +
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ' +
  '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function buildThemeOverrides(seedHex: string, isDark: boolean): GlobalThemeOverrides {
  const m3Theme = themeFromSourceColor(argbFromHex(seedHex));
  const scheme = isDark ? m3Theme.schemes.dark : m3Theme.schemes.light;
  const neutral = m3Theme.palettes.neutral;
  const tones = SURFACE_TONES[isDark ? 'dark' : 'light'];
  const surface = (key: keyof typeof tones) => hexFromArgb(neutral.tone(tones[key]));

  const primary = hexFromArgb(scheme.primary);
  const onPrimary = hexFromArgb(scheme.onPrimary);
  const onSurface = hexFromArgb(scheme.onSurface);
  const onSurfaceVariant = hexFromArgb(scheme.onSurfaceVariant);
  const outline = hexFromArgb(scheme.outlineVariant);
  const outlineFull = hexFromArgb(scheme.outline);

  const primaryPalette = m3Theme.palettes.primary;
  const primaryHover = hexFromArgb(primaryPalette.tone(isDark ? 70 : Contrast.darker(100, 4.6)));
  const primaryPressed = hexFromArgb(primaryPalette.tone(isDark ? 90 : 30));

  const roles = semanticRoles(m3Theme, isDark);
  const semanticOverrides = Object.fromEntries(
    Object.entries(roles).flatMap(([name, role]) => [
      [`${name}Color`, role.color],
      [`${name}ColorHover`, role.hover],
      [`${name}ColorPressed`, role.pressed],
      [`${name}ColorSuppl`, role.color],
    ]),
  );
  const buttonForegrounds = Object.fromEntries(
    Object.entries(roles).flatMap(([name, role]) => {
      const suffix = name[0]!.toUpperCase() + name.slice(1);
      return ['', 'Hover', 'Pressed', 'Focus'].map((state) => [
        `textColor${state}${suffix}`,
        role.onColor,
      ]);
    }),
  );
  return {
    common: {
      ...semanticOverrides,
      primaryColor: primary,
      primaryColorHover: primaryHover,
      primaryColorPressed: primaryPressed,
      primaryColorSuppl: primary,
      bodyColor: 'transparent',
      cardColor: surface('--color-surface-container'),
      modalColor: surface('--color-surface-container-high'),
      popoverColor: surface('--color-surface-container-high'),
      borderColor: outline,
      dividerColor: outline,
      borderRadius: '6px',
      fontFamily: FONT_FAMILY,
    },
    Divider: { color: outline },
    Button: {
      ...buttonForegrounds,
      textColorPrimary: onPrimary,
      textColorHoverPrimary: onPrimary,
      textColorPressedPrimary: onPrimary,
      textColorFocusPrimary: onPrimary,
      border: `1px solid ${outline}`,
      borderHover: `1px solid ${outlineFull}`,
      borderFocus: `1px solid ${outlineFull}`,
    },
    Input: {
      color: surface('--color-surface-container'),
      colorFocus: surface('--color-surface-container'),
      textColor: onSurface,
      placeholderColor: onSurfaceVariant,
      border: `1px solid ${outline}`,
      borderHover: `1px solid ${outlineFull}`,
      borderFocus: `1px solid ${primary}`,
    },
    InputNumber: {
      peers: {
        Input: {
          color: surface('--color-surface-container'),
          colorFocus: surface('--color-surface-container'),
          textColor: onSurface,
          border: `1px solid ${outline}`,
          borderHover: `1px solid ${outlineFull}`,
          borderFocus: `1px solid ${primary}`,
        },
        Button: { textColor: onSurfaceVariant, textColorHover: onSurface },
      },
    },
    Card: {
      color: surface('--color-surface-container-low'),
      textColor: onSurface,
      titleTextColor: onSurface,
      borderColor: outline,
    },
    Message: {
      color: surface('--color-surface-container-high'),
      textColor: onSurface,
      closeIconColor: onSurfaceVariant,
      closeIconColorHover: onSurface,
      colorInfo: surface('--color-surface-container-high'),
      colorSuccess: surface('--color-surface-container-high'),
      colorWarning: surface('--color-surface-container-high'),
      colorError: surface('--color-surface-container-high'),
    },
    Switch: { railColorActive: primary },
    Tag: {
      textColorCheckable: onSurfaceVariant,
      textColorHoverCheckable: primary,
      textColorChecked: onPrimary,
      colorChecked: primary,
      colorCheckedHover: primary,
    },
    Select: {
      peers: {
        InternalSelection: {
          border: `1px solid ${outline}`,
          borderHover: `1px solid ${outlineFull}`,
          borderFocus: `1px solid ${primary}`,
          borderActive: `1px solid ${primary}`,
        },
      },
    },
    Form: { labelTextColor: onSurfaceVariant },
  };
}

// ─── Composable ─────────────────────────────────────────

/**
 * The single theme composable. Owns theme mode + color scheme state,
 * watches the system dark preference, keeps the DOM (class + CSS vars) in
 * sync, and produces Naive UI provider props.
 */
export function useAppTheme() {
  const bootstrapped = bootstrappedPrefs;
  const mode = ref<ThemePreference>(bootstrapped?.theme ?? 'system');
  const colorSchemeId = ref<UiPrefs['colorScheme']>(bootstrapped?.colorScheme ?? 'rayburst');

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const systemDark = ref(mql.matches);
  const onMediaChange = (e: MediaQueryListEvent) => {
    systemDark.value = e.matches;
  };
  mql.addEventListener('change', onMediaChange);
  onScopeDispose(() => mql.removeEventListener('change', onMediaChange));

  const isDark = computed(() => resolveThemeClass(mode.value, systemDark.value) === 'dark');
  const seedHex = computed(() => resolveScheme(colorSchemeId.value).seed);

  watchEffect(() => {
    applyThemeToDocument(
      { theme: mode.value, colorScheme: colorSchemeId.value, locale: 'auto' },
      systemDark.value,
    );
  });

  const naiveTheme = computed(() => (isDark.value ? darkTheme : null));
  const themeOverrides = computed(() => buildThemeOverrides(seedHex.value, isDark.value));

  return {
    naiveTheme,
    themeOverrides,
    setMode: (value: ThemePreference) => {
      mode.value = value;
    },
    setColorScheme: (id: string) => {
      colorSchemeId.value = parseUiPrefs({ colorScheme: id }).colorScheme;
    },
  };
}
