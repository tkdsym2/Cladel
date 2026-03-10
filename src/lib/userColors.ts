const USER_COLOR_PALETTE = [
  { bg: '#dbeafe', border: '#3b82f6', glow: '#93c5fd' }, // blue
  { bg: '#fce7f3', border: '#ec4899', glow: '#f9a8d4' }, // pink
  { bg: '#d1fae5', border: '#10b981', glow: '#6ee7b7' }, // green
  { bg: '#fef3c7', border: '#f59e0b', glow: '#fcd34d' }, // yellow
  { bg: '#ede9fe', border: '#8b5cf6', glow: '#c4b5fd' }, // violet
  { bg: '#ffedd5', border: '#f97316', glow: '#fdba74' }, // orange
  { bg: '#cffafe', border: '#06b6d4', glow: '#67e8f9' }, // cyan
  { bg: '#fdf2f8', border: '#d946ef', glow: '#f0abfc' }, // fuchsia
];

const UNKNOWN_USER_COLOR = { bg: '#f3f4f6', border: '#9ca3af', glow: '#d1d5db' };

export function getUserColor(userId: string | null | undefined): typeof UNKNOWN_USER_COLOR {
  if (!userId) return UNKNOWN_USER_COLOR;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return USER_COLOR_PALETTE[hash % USER_COLOR_PALETTE.length];
}
