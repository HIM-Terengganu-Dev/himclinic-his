import { format, formatDistanceToNow } from 'date-fns';

const GMT8_OFFSET_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

/**
 * Convert date to GMT+8 timezone for display
 * PostgreSQL queries now return timestamps with +08:00 timezone indicator.
 * JavaScript's Date() will parse these correctly, but we need to format them
 * in GMT+8 for display. Since the date already has timezone info, we just
 * need to format it correctly.
 */
export function toGMT8(date: Date | string): Date {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  // If the date string has +08:00 or similar GMT+8 timezone, JavaScript will parse it correctly
  // and the Date object will represent the correct time. We just return it.
  if (typeof date === 'string' && /\+08:00/.test(date)) {
    // Already has GMT+8 timezone, parse as-is
    return dateObj;
  }
  
  // If it has UTC timezone (Z), convert to GMT+8
  if (typeof date === 'string' && date.endsWith('Z')) {
    return new Date(dateObj.getTime() + GMT8_OFFSET_MS);
  }
  
  // If no timezone info, assume it's UTC and add 8 hours
  // (This handles legacy data or data without timezone conversion)
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

