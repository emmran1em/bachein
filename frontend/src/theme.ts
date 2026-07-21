// Bachein — Claude/Anthropic-inspired minimal palette
export const theme = {
  colors: {
    // Warm off-white base (like Claude's parchment)
    surface: '#F7F5F0',
    onSurface: '#22201C',
    surfaceSecondary: '#EFECE5',
    onSurfaceSecondary: '#4B4842',
    surfaceTertiary: '#E4DFD4',
    onSurfaceTertiary: '#6B6760',
    surfaceInverse: '#22201C',
    onSurfaceInverse: '#F7F5F0',
    // Warm accent — Anthropic's rust/coral
    brand: '#22201C',
    brandPrimary: '#22201C',
    onBrandPrimary: '#F7F5F0',
    brandSecondary: '#C5613E',
    onBrandSecondary: '#FFFFFF',
    accent: '#C5613E',
    // Status
    success: '#4C8161',
    warning: '#D9882B',
    error: '#B84C3A',
    info: '#4B4842',
    // Structure
    border: '#E4DFD4',
    borderStrong: '#C7C1B4',
    divider: '#E4DFD4',
    muted: '#8A8578',
    // Card
    card: '#FFFFFF',
    cardElevated: '#FFFEFB',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
  font: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
};

export type Theme = typeof theme;
