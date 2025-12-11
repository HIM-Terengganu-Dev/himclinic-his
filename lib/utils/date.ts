import { format, formatDistanceToNow } from 'date-fns';

const GMT8_OFFSET_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

/**
 * Convert UTC date to GMT+8 timezone by adding 8 hours
 */
export function toGMT8(date: Date | string): Date {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  // Add 8 hours to convert from UTC to GMT+8
  return new Date(dateObj.getTime() + GMT8_OFFSET_MS);
}

/**
 * Format date to GMT+8 (Asia/Kuala_Lumpur timezone)
 */
export function formatDateGMT8(date: Date | string, formatString: string = 'MMM d, yyyy HH:mm'): string {
  const gmt8Date = toGMT8(date);
  return format(gmt8Date, formatString);
}

/**
 * Format date to GMT+8 with time
 */
export function formatDateTimeGMT8(date: Date | string): string {
  return formatDateGMT8(date, 'MMM d, yyyy HH:mm');
}

/**
 * Format date to GMT+8 with seconds
 */
export function formatDateTimeWithSecondsGMT8(date: Date | string): string {
  return formatDateGMT8(date, 'MMM d, yyyy HH:mm:ss');
}

/**
 * Format distance to now in GMT+8
 */
export function formatDistanceToNowGMT8(date: Date | string, options?: { addSuffix?: boolean }): string {
  const gmt8Date = toGMT8(date);
  return formatDistanceToNow(gmt8Date, options);
}

