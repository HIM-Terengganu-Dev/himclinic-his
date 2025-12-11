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
 * Handles dates with +08:00 timezone from database correctly
 */
export function formatDateGMT8(date: Date | string, formatString: string = 'MMM d, yyyy HH:mm'): string {
  if (typeof date === 'string' && /\+08:00/.test(date)) {
    // String has GMT+8 timezone (e.g., "2025-12-12T17:26:46+08:00")
    // The time in the string (17:26:46) is already in GMT+8
    // JavaScript's Date() parses this and converts to UTC (09:26:46 UTC)
    // We need to extract the GMT+8 time components and create a Date that represents GMT+8
    const match = date.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00/);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      // The components are already in GMT+8, so we create a UTC date with these values
      // Then when formatted, it will show the GMT+8 time correctly
      // Create date in UTC using GMT+8 time values (this represents the GMT+8 moment)
      const utcDate = new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second || '0')
      ));
      // Format using the UTC date - this will show the correct GMT+8 time
      // because we used the GMT+8 time components to create the UTC date
      return format(utcDate, formatString);
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

