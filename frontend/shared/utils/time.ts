/**
 * Time and Timezone utilities supporting Asia/Ho_Chi_Minh
 */

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function normalizeStationTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('vi-VN', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Get start of day timestamp for a given date in a specific timezone
 * For Asia/Ho_Chi_Minh (UTC+7), midnight is UTC 17:00 of the preceding day.
 */
export function getStartOfDayInTimezone(date: Date = new Date(), timezone: string = DEFAULT_TIMEZONE): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const year = parseInt(parts.find((p) => p.type === 'year')?.value || '1970', 10);
  const month = parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10);
  const day = parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10);

  // Return the UTC date corresponding to 00:00:00 in that timezone
  // For UTC+7 (Asia/Ho_Chi_Minh):
  const offsetHours = timezone === 'Asia/Ho_Chi_Minh' || timezone === 'Asia/Saigon' ? 7 : 0;
  const utcDate = new Date(Date.UTC(year, month - 1, day, -offsetHours, 0, 0, 0));
  return utcDate;
}

/**
 * Get start of month timestamp in a specific timezone
 */
export function getStartOfMonthInTimezone(date: Date = new Date(), timezone: string = DEFAULT_TIMEZONE): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const year = parseInt(parts.find((p) => p.type === 'year')?.value || '1970', 10);
  const month = parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10);

  const offsetHours = timezone === 'Asia/Ho_Chi_Minh' || timezone === 'Asia/Saigon' ? 7 : 0;
  return new Date(Date.UTC(year, month - 1, 1, -offsetHours, 0, 0, 0));
}

/**
 * Format date in Vietnamese locale and station timezone
 */
export function formatStationTime(
  date: Date | string | number,
  timezone: string = DEFAULT_TIMEZONE,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: timezone,
    dateStyle: options?.dateStyle ?? 'medium',
    timeStyle: options?.timeStyle ?? 'medium',
    ...options
  }).format(d);
}

/**
 * Relative time in Vietnamese (e.g. "vừa xong", "2 phút trước", "1 giờ trước")
 */
export function formatRelativeTimeVi(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return 'Vừa xong';
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày trước`;
}
