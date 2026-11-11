import type { AlertSeverity } from './types/alert';

export const RAIN_RULE_VERSION = 'rain-observed-v1';
export const rainWindowMinutes = [5, 15, 60, 180, 1440] as const;
export type RainWindowMinutes = typeof rainWindowMinutes[number];
export type RainQuality = 'complete' | 'missing_telemetry' | 'test_water' | 'uncertain_tips' | 'mixed_station' | 'simulation' | 'unavailable';

export interface MonitoredRainWindow {
  minutes: RainWindowMinutes;
  from: string;
  to: string;
  rainfallMm: number | null;
  averageMmH: number | null;
  quality: RainQuality;
}

export interface RainAlertEvidence {
  source: 'observed' | 'simulation';
  ruleVersion: string;
  ruleId: string;
  severity: AlertSeverity;
  value: number;
  threshold: number;
  unit: 'mm' | 'mm/h';
  windowMinutes: number;
  from: string;
  to: string;
}

export interface RainThresholdCheck {
  ruleId: string;
  windowMinutes: 5 | 60;
  unit: 'mm' | 'mm/h';
  threshold: number;
  value: number | null;
  quality: RainQuality;
}

export interface RainMonitorSnapshot {
  deviceId: string;
  timezone: string;
  generatedAt: string;
  observedAt: string | null;
  demo: boolean;
  windows: MonitoredRainWindow[];
  pressure: { hpa: number | null; delta3hHpa: number | null; reason: string | null };
  observation: {
    status: 'dry' | 'rain' | 'heavy' | 'insufficient';
    alert: RainAlertEvidence | null;
    rulesConfigured: boolean;
    thresholds: RainThresholdCheck[];
  };
  forecast: {
    validFrom: string;
    validTo: string;
    estimatedRainMm: number | null;
    method: 'persistence' | 'ridge';
    status: 'experimental' | 'evaluated' | 'dry_baseline' | 'insufficient';
    reason: string | null;
    modelVersion?: string;
    modelFeatures?: 'rain' | 'rain_pressure';
    trainedFrom?: string;
    trainedTo?: string;
  };
}

export const rainQualityLabels: Record<RainQuality, string> = {
  complete: 'Đủ quan trắc',
  missing_telemetry: 'Thiếu bản tin quan trắc',
  test_water: 'Cửa sổ có thử gầu',
  uncertain_tips: 'Có nhịp gộp chưa xác định được ở biên cửa sổ',
  mixed_station: 'Cửa sổ chứa dữ liệu sao chép từ trạm khác',
  simulation: 'Cửa sổ chứa dữ liệu mô phỏng',
  unavailable: 'Nguồn dữ liệu chưa sẵn sàng'
};

export const rainObservationLabels: Record<RainMonitorSnapshot['observation']['status'], string> = {
  dry: 'Chưa ghi nhận mưa',
  rain: 'Có ghi nhận mưa',
  heavy: 'Mưa lớn theo ngưỡng trạm',
  insufficient: 'Thiếu dữ liệu'
};

export function rainObservationLabel(observation: RainMonitorSnapshot['observation']): string {
  if (observation.status === 'rain' && observation.rulesConfigured) return 'Có mưa dưới ngưỡng cảnh báo';
  return rainObservationLabels[observation.status];
}

export function formatRainEvidence(evidence: RainAlertEvidence): string {
  return `${evidence.source === 'simulation' ? 'Mô phỏng' : 'Mưa thực đo'} · ${evidence.value} ${evidence.unit} trong cửa sổ ${evidence.windowMinutes} phút, vượt ngưỡng ${evidence.threshold} ${evidence.unit}.`;
}
