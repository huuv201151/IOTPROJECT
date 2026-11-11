export interface MeasurementSummary {
  min: number;
  max: number;
  avg: number;
  sampleCount?: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  firstValue?: number;
  lastValue?: number;
  coverageComplete?: boolean;
}

export interface WeatherFeatures {
  from: string;
  to: string;
  sampleCount: number;
  invalidSampleCount: number;
  coverageComplete: boolean;
  temperature: MeasurementSummary | null;
  humidity: MeasurementSummary | null;
  pressure: MeasurementSummary | null;
  availableSampleCount?: number;
  pressureDelta3hHpa: number | null;
  temperatureDelta1hC: number | null;
}
