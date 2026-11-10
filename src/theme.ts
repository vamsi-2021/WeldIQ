/** BetaFlix brand colors, taken from the logo. */
export const brand = {
  blue: '#006193',
  blueDark: '#004B73',
  sky: '#AEE0F3',
  green: '#72BD48',
};

/** Light app palette in BetaFlix blue (matches the sign-in screen). */
export const colors = {
  bg: '#F4F9FC',
  panel: '#FFFFFF',
  panelRaised: '#FFFFFF',
  border: '#D6E4EC',
  borderFocus: brand.blue,
  text: '#0F2A3D',
  muted: '#5E7383',
  label: '#3E5566',
  accent: brand.blue,
  accentPressed: brand.blueDark,
  /** Partly-filled coverage segments. */
  accentDim: brand.sky,
  /** Brand blue as text on the light background. */
  accentText: brand.blue,
  /** Text and icons drawn on an accent fill. */
  onAccent: '#FFFFFF',
  track: '#E3EEF4',
  success: '#3F8F1F',
  warning: '#B45309',
  danger: '#DC2626',
  overlay: 'rgba(15, 42, 61, 0.6)',
  codeBg: '#EAF3F8',
  codeText: '#2D4556',
};

/** Dark palette for UI drawn over the live camera feed, where dark blue would disappear. */
export const cameraColors: typeof colors = {
  ...colors,
  bg: '#000000',
  panel: '#0D1B26',
  panelRaised: '#132433',
  border: '#1F3A4E',
  text: '#F9FAFB',
  muted: '#C2CDD6',
  label: '#C2CDD6',
  borderFocus: brand.sky,
  accent: brand.sky,
  accentPressed: '#8FD2EC',
  accentDim: '#2B6584',
  accentText: brand.sky,
  onAccent: '#00405F',
  track: 'rgba(255, 255, 255, 0.18)',
  success: brand.green,
  warning: '#F5A524',
  danger: '#F04438',
  overlay: 'rgba(4, 14, 22, 0.62)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16 };

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatPercent(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
