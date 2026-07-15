// Shared constants for Sprint Room

/** Maximum number of human participants per room */
export const MAX_HUMANS = 3;

/** The AI participant's fixed connection id */
export const AI_ID = 'ai_agent';

/** The AI participant's display name */
export const AI_NAME = 'Sprint AI';

/** Length of nanoid-generated room IDs */
export const NANOID_LENGTH = 10;

/** Room expiry duration in milliseconds (24 hours) */
export const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** AI action abort timeout in milliseconds (28 seconds) */
export const AI_ABORT_MS = 28_000;

/** AI participant presence color (teal) */
export const AI_COLOR = '#2A9D8F';

/** Distinct human presence colors that don't conflict with AI teal */
export const HUMAN_COLORS = [
  '#E4572E', // vermillion
  '#F4A261', // sandy orange
  '#7B2D8B', // purple
  '#3D5A80', // steel blue
  '#E76F51', // burnt sienna
  '#264653', // dark teal-blue
] as const;
