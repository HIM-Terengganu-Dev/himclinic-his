import { format, formatDistanceToNow } from 'date-fns';

const GMT8_OFFSET_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

/**
 * Convert date to GMT+8 timezone for display
 * PostgreSQL queries return timestamps with +08:00 timezone indicator.
 * When JavaScript parses "2025-12-11T16:18:00+08:00", it creates a Date object
 * representing that exact moment in time (which is correct).
 * However, when formatting, we need to display it as if it's in GMT+8.
 * Since the string already represents GMT+8 time, we parse it and format the
 * components directly, or adjust for display.
 */
export function toGMT8(date: Date | string): Date {
  if (typeof date === 'string') {
    // Check if string has +08:00 timezone (GMT+8 from database)
    if (/\+08:00/.test(date)) {
      // Parse the string - JavaScript will create correct Date object
      const dateObj = new Date(date);
      // The Date object is in UTC internally, but represents the GMT+8 time
      // We need to format it as GMT+8, so we extract the components from the string
      // or adjust the Date object to show GMT+8 time
      // Since the string is already in GMT+8, we can parse and use directly
      return dateObj;
    }
    
    // If it has UTC timezone (Z), convert to GMT+8
    if (date.endsWith('Z')) {
      const dateObj = new Date(date);
      return new Date(dateObj.getTime() + GMT8_OFFSET_MS);
    }
    
    // If no timezone, assume UTC and add 8 hours
    const dateObj = new Date(date);
    return new Date(dateObj.getTime() + GMT8_OFFSET_MS);
  }
  
  // For Date objects, assume UTC and add 8 hours
  return new Date(date.getTime() + GMT8_OFFSET_MS);
}

/**
 * Format date to GMT+8 (Asia/Kuala_Lumpur timezone)
 * Database already returns timestamps in GMT+8, so we just format them directly
 */
export function formatDateGMT8(date: Date | string, formatString: string = 'MMM d, yyyy HH:mm'): string {
  if (typeof date === 'string' && /\+08:00/.test(date)) {
    // Database already returns GMT+8 timestamp (e.g., "2025-12-12T17:26:46+08:00")
    // Extract the date/time components directly and use them as-is
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      // Create a Date object using UTC constructor with the GMT+8 values
      // This ensures the displayed time matches what's in the database
      const dateObj = new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        second ? parseInt(second) : 0
      ));
      // Format will use UTC methods, showing the exact time from database
      return format(dateObj, formatString);
    }
  }
  
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

