/**
 * Environmental and Rainfall Calculation Utilities
 */

/**
 * Calculate Dew Point in °C using the Magnus-Tetens formula
 * @param temperature Temperature in °C
 * @param humidity Relative humidity in % (0 - 100)
 * @returns Dew point in °C rounded to 1 decimal place
 */
export function calculateDewPoint(temperature: number, humidity: number): number {
  if (humidity <= 0) return temperature;
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * temperature) / (b + temperature) + Math.log(humidity / 100);
  const dewPoint = (b * alpha) / (a - alpha);
  return Math.round(dewPoint * 10) / 10;
}

/**
 * Calculate Heat Index in °C (Rothfusz equation)
 * @param temperature Temperature in °C
 * @param humidity Relative humidity in %
 */
export function calculateHeatIndex(temperature: number, humidity: number): number {
  if (temperature < 26.7 || humidity < 40) {
    return Math.round(temperature * 10) / 10;
  }
  // Convert °C to °F
  const T = (temperature * 9) / 5 + 32;
  const R = humidity;

  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R;

  // Convert back to °C
  const heatIndexC = ((hi - 32) * 5) / 9;
  return Math.round(heatIndexC * 10) / 10;
}

/**
 * Calculate Rainfall Accumulation in mm
 * Formula: Rainfall (mm) = Valid Tips * Calibration Factor (mm/tip)
 */
export function calculateRainfall(tips: number, mmPerTip: number): number {
  if (tips <= 0 || mmPerTip <= 0) return 0;
  return Math.round(tips * mmPerTip * 100) / 100;
}

/**
 * Calculate Rain Rate (Intensity) in mm/h over a specific time window
 * Formula: Rain Rate (mm/h) = Rainfall in window (mm) / Window duration (hours)
 * @param rainfallMm Accumulated rain in window
 * @param windowMinutes Window duration in minutes (e.g. 5, 15, 60)
 */
export function calculateRainRate(rainfallMm: number, windowMinutes: number): number {
  if (windowMinutes <= 0 || rainfallMm <= 0) return 0;
  const hours = windowMinutes / 60;
  const rate = rainfallMm / hours;
  return Math.round(rate * 10) / 10;
}

/**
 * Calculate Sea Level Pressure (hPa) given station elevation
 * Formula: P0 = P * (1 - (0.0065 * h) / (T + 0.0065 * h + 273.15)) ^ -5.257
 * @param stationPressure Measured atmospheric pressure in hPa
 * @param elevationMeters Altitude above sea level in meters
 * @param temperature Temperature in °C
 */
export function calculateSeaLevelPressure(
  stationPressure: number,
  elevationMeters: number,
  temperature: number
): number {
  if (elevationMeters <= 0) return stationPressure;
  const factor = 1 - (0.0065 * elevationMeters) / (temperature + 0.0065 * elevationMeters + 273.15);
  const p0 = stationPressure * Math.pow(factor, -5.257);
  return Math.round(p0 * 10) / 10;
}

export type PressureTrendCategory = 'UNKNOWN' | 'RAPIDLY_RISING' | 'RISING' | 'STABLE' | 'FALLING' | 'RAPIDLY_FALLING';

export interface PressureTrendResult {
  category: PressureTrendCategory;
  deltaHpa: number | null;
  labelVi: string;
}

/**
 * Analyze Atmospheric Pressure Trend over a 3-hour window
 * @param currentPressure Current pressure in hPa
 * @param pastPressure Pressure 3 hours ago in hPa
 */
export function classifyPressureTrend(currentPressure: number, pastPressure?: number): PressureTrendResult {
  if (!Number.isFinite(currentPressure) || pastPressure === undefined || pastPressure === null || !Number.isFinite(pastPressure)) {
    return { category: 'UNKNOWN', deltaHpa: null, labelVi: 'Chưa đủ dữ liệu' };
  }
  const delta = Math.round((currentPressure - pastPressure) * 10) / 10;

  if (delta >= 3.0) {
    return { category: 'RAPIDLY_RISING', deltaHpa: delta, labelVi: 'Tăng nhanh' };
  } else if (delta >= 1.2) {
    return { category: 'RISING', deltaHpa: delta, labelVi: 'Đang tăng' };
  } else if (delta <= -3.0) {
    return { category: 'RAPIDLY_FALLING', deltaHpa: delta, labelVi: 'Giảm nhanh' };
  } else if (delta <= -1.2) {
    return { category: 'FALLING', deltaHpa: delta, labelVi: 'Đang giảm' };
  } else {
    return { category: 'STABLE', deltaHpa: delta, labelVi: 'Ổn định' };
  }
}

/**
 * Get human-readable description for humidity level in Vietnamese
 */
export function getHumidityStatusVi(humidity: number): { label: string; color: string } {
  if (humidity < 30) return { label: 'Khô hanh', color: 'text-amber-500' };
  if (humidity <= 65) return { label: 'Lý tưởng', color: 'text-emerald-500' };
  if (humidity <= 80) return { label: 'Độ ẩm cao', color: 'text-blue-400' };
  return { label: 'Rất ẩm ướt', color: 'text-blue-600' };
}

/**
 * Categorize rainfall intensity according to meteorological standards (Vietnam / WMO)
 * - Nhẹ (Light): < 2.5 mm/h
 * - Vừa (Moderate): 2.5 - 10 mm/h
 * - To (Heavy): 10 - 50 mm/h
 * - Rất to (Violent / Torrential): > 50 mm/h
 */
export function getRainRateCategoryVi(rateMmH: number): {
  level: 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'VIOLENT';
  labelVi: string;
  badgeVariant: 'secondary' | 'default' | 'warning' | 'destructive';
} {
  if (rateMmH <= 0.05) {
    return { level: 'NONE', labelVi: 'Không mưa', badgeVariant: 'secondary' };
  } else if (rateMmH < 2.5) {
    return { level: 'LIGHT', labelVi: 'Mưa nhỏ', badgeVariant: 'secondary' };
  } else if (rateMmH < 10) {
    return { level: 'MODERATE', labelVi: 'Mưa vừa', badgeVariant: 'default' };
  } else if (rateMmH < 50) {
    return { level: 'HEAVY', labelVi: 'Mưa to', badgeVariant: 'warning' };
  } else {
    return { level: 'VIOLENT', labelVi: 'Mưa rất to', badgeVariant: 'destructive' };
  }
}
