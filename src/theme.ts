/** Light app palette with an amber accent (matches the sign-in screen). */
export const colors = {
  bg: '#F5F7FA',
  panel: '#FFFFFF',
  panelRaised: '#FFFFFF',
  border: '#DDE2E8',
  borderFocus: '#E9A23B',
  text: '#111827',
  muted: '#6B7280',
  label: '#4B5563',
  accent: '#E9A23B',
  accentPressed: '#D8922C',
  /** Partly-filled coverage segments. */
  accentDim: '#F5D6A3',
  /** Amber dark enough to read as text on the light background. */
  accentText: '#A15C07',
  /** Text and icons drawn on an accent fill. */
  onAccent: '#111827',
  track: '#E5E9EF',
  success: '#16A34A',
  warning: '#B45309',
  danger: '#DC2626',
  overlay: 'rgba(17, 24, 39, 0.6)',
  codeBg: '#EEF1F5',
  codeText: '#374151',
};

/** Dark palette for UI drawn over the live camera feed, where light colors would wash out. */
export const cameraColors: typeof colors = {
  ...colors,
  bg: '#000000',
  panel: '#121922',
  panelRaised: '#18212C',
  border: '#243243',
  text: '#F9FAFB',
  muted: '#C2C9D1',
  label: '#C2C9D1',
  accentDim: '#7A5620',
  accentText: '#E9A23B',
  track: 'rgba(255, 255, 255, 0.18)',
  success: '#22C55E',
  warning: '#F5A524',
  danger: '#F04438',
  overlay: 'rgba(6, 10, 15, 0.62)',
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
