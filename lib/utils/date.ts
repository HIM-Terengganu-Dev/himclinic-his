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
  if (typeof date === 'string') {
    // Handle GMT+8 timestamps from database (e.g., "2025-12-11T17:26:46+08:00")
    if (/\+08:00/.test(date)) {
      const match = date.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hour, minute, second] = match;
        
        // Month names for formatting
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = monthNames[parseInt(month) - 1];
        const dayNum = parseInt(day);
        const yearNum = parseInt(year);
        const hourNum = hour.padStart(2, '0');
        const minuteNum = minute.padStart(2, '0');
        const secondNum = second ? second.padStart(2, '0') : '00';
        
        // Format according to the formatString pattern
        if (formatString.includes('HH:mm:ss')) {
          return `${monthName} ${dayNum}, ${yearNum} ${hourNum}:${minuteNum}:${secondNum}`;
        } else if (formatString.includes('HH:mm')) {
          return `${monthName} ${dayNum}, ${yearNum} ${hourNum}:${minuteNum}`;
        } else {
          // Default format
          return `${monthName} ${dayNum}, ${yearNum} ${hourNum}:${minuteNum}`;
        }
      }
    }
    
    // Handle UTC timestamps (e.g., "2025-12-11T09:26:46Z")
    // Convert to GMT+8 by adding 8 hours
    if (date.endsWith('Z')) {
      const dateObj = new Date(date);
      const gmt8Date = new Date(dateObj.getTime() + GMT8_OFFSET_MS);
      return format(gmt8Date, formatString);
    }
  }
  
  // For Date objects or other formats, convert to GMT+8
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
 * For relative time calculations, we just need the correct moment in time
 * JavaScript Date objects handle this correctly regardless of timezone
 */
export function formatDistanceToNowGMT8(date: Date | string, options?: { addSuffix?: boolean }): string {
  // Parse the date string to a Date object
  // If it's a UTC timestamp (ends with Z or no timezone), parse it directly
  // If it's a GMT+8 timestamp (has +08:00), JavaScript will parse it correctly
  let dateObj: Date;
  
  if (typeof date === 'string') {
    // If it has +08:00, parse it (JavaScript handles this correctly)
    if (/\+08:00/.test(date)) {
      dateObj = new Date(date);
    }
    // If it's UTC (ends with Z), parse it directly
    else if (date.endsWith('Z')) {
      dateObj = new Date(date);
    }
    // If no timezone indicator, assume it's UTC (from WooCommerce date_created_gmt)
    else {
      // WooCommerce date_created_gmt is UTC without Z, so add it
      dateObj = new Date(date.endsWith('Z') ? date : date + 'Z');
    }
  } else {
    dateObj = date;
  }
  
  // formatDistanceToNow calculates the difference from "now" correctly
  // regardless of timezone, as long as both dates are in the same reference
  return formatDistanceToNow(dateObj, options);
}

