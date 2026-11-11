import { RAIN_RULE_VERSION, type MonitoredRainWindow, type RainMonitorSnapshot } from '@/shared/rain-monitor';

export type DemoScenarioId = 'low' | 'moderate' | 'high' | 'critical';

export interface DemoScenarioConfig {
  id: DemoScenarioId;
  code: string;
  name: string;
  badgeLabel: string;
  shortLabel: string;
  description: string;
  baseTemp: number; // °C
  baseHumidity: number; // %
  basePressure: number; // hPa
  pressureTrendCategory: 'STABLE' | 'FALLING' | 'RAPIDLY_FALLING';
  todayMm: number;
  totalTipsToday: number;
  currentRateMmH: number;
  maxObservedRateMmH: number;
  last24hMm: number;
}

export const DEMO_SCENARIOS: Record<DemoScenarioId, DemoScenarioConfig> = {
  low: {
    id: 'low',
    code: 'Demo 1',
    name: 'Nguy cơ Thấp (An toàn)',
    badgeLabel: 'Demo 1: Thấp',
    shortLabel: 'Thấp',
    description: 'Trời tạnh ráo, không khí thoáng mát, cống rãnh lưu thông tốt, nguy cơ ngập lụt ở mức tối thiểu.',
    baseTemp: 29.4,
    baseHumidity: 62.5,
    basePressure: 1013.8,
    pressureTrendCategory: 'STABLE',
    todayMm: 0.0,
    totalTipsToday: 0,
    currentRateMmH: 0.0,
    maxObservedRateMmH: 0.0,
    last24hMm: 0.0
  },
  moderate: {
    id: 'moderate',
    code: 'Demo 2',
    name: 'Nguy cơ Trung bình (Cần lưu ý)',
    badgeLabel: 'Demo 2: Trung bình',
    shortLabel: 'Trung bình',
    description: 'Độ ẩm không khí tăng cao, áp suất giảm nhẹ, đất bắt đầu ẩm, cần lưu ý tại các điểm thoát nước chậm.',
    baseTemp: 26.8,
    baseHumidity: 78.5,
    basePressure: 1008.2,
    pressureTrendCategory: 'FALLING',
    todayMm: 5.12,
    totalTipsToday: 8,
    currentRateMmH: 5.12,
    maxObservedRateMmH: 8.5,
    last24hMm: 10.24
  },
  high: {
    id: 'high',
    code: 'Demo 3',
    name: 'Nguy cơ Cao (Cảnh báo ngập)',
    badgeLabel: 'Demo 3: Cao',
    shortLabel: 'Cao',
    description: 'Thời tiết giông gió, áp suất khí quyển giảm nhanh, đất ngậm no nước, nguy cơ ngập tăng cao.',
    baseTemp: 24.6,
    baseHumidity: 88.6,
    basePressure: 1003.4,
    pressureTrendCategory: 'RAPIDLY_FALLING',
    todayMm: 16.0,
    totalTipsToday: 25,
    currentRateMmH: 12.8,
    maxObservedRateMmH: 24.0,
    last24hMm: 38.4
  },
  critical: {
    id: 'critical',
    code: 'Demo 4',
    name: 'Nguy cơ Rất cao (Nguy hiểm)',
    badgeLabel: 'Demo 4: Rất cao',
    shortLabel: 'Rất cao',
    description: 'Thời tiết bão / áp thấp nhiệt đới sâu, đất bão hòa nước đỉnh điểm, cảnh báo nguy cơ ngập sâu diện rộng.',
    baseTemp: 23.2,
    baseHumidity: 94.6,
    basePressure: 998.2,
    pressureTrendCategory: 'RAPIDLY_FALLING',
    todayMm: 48.0,
    totalTipsToday: 75,
    currentRateMmH: 38.4,
    maxObservedRateMmH: 65.0,
    last24hMm: 115.2
  }
};

export interface DemoEnvironmentData {
  temperature: number;
  humidity: number;
  pressure: number;
  pressureTrend: {
    category: 'STABLE' | 'FALLING' | 'RAPIDLY_FALLING';
    deltaHpa: number;
    labelVi: string;
  };
}

export function getDemoEnvironment(scenarioId: DemoScenarioId, tick: number): DemoEnvironmentData {
  const s = DEMO_SCENARIOS[scenarioId] || DEMO_SCENARIOS.low;

  // Gentle, realistic wave + subtle noise (cập nhật 10 giây/lần giống Live mode, không nhảy vọt)
  const tempNoise = Math.round((Math.sin(tick * 0.35) * 0.18 + Math.cos(tick * 0.75) * 0.06) * 10) / 10;
  const humNoise = Math.round((Math.cos(tick * 0.28) * 0.45 + Math.sin(tick * 0.65) * 0.15) * 10) / 10;
  const pressNoise = Math.round((Math.sin(tick * 0.3) * 0.2 + Math.cos(tick * 0.8) * 0.08) * 10) / 10;

  const temperature = Math.round((s.baseTemp + tempNoise) * 10) / 10;
  const humidity = Math.min(99.9, Math.max(20, Math.round((s.baseHumidity + humNoise) * 10) / 10));
  const pressure = Math.round((s.basePressure + pressNoise) * 10) / 10;

  let deltaHpa = 0.0;
  let labelVi = 'Ổn định';
  if (s.pressureTrendCategory === 'RAPIDLY_FALLING') {
    deltaHpa = -3.2 + Math.round((Math.sin(tick) * 0.2) * 10) / 10;
    labelVi = 'Giảm nhanh';
  } else if (s.pressureTrendCategory === 'FALLING') {
    deltaHpa = -1.6 + Math.round((Math.sin(tick) * 0.2) * 10) / 10;
    labelVi = 'Đang giảm';
  } else {
    deltaHpa = 0.1 + Math.round((Math.sin(tick) * 0.1) * 10) / 10;
    labelVi = 'Ổn định';
  }

  return {
    temperature,
    humidity,
    pressure,
    pressureTrend: {
      category: s.pressureTrendCategory,
      deltaHpa,
      labelVi
    }
  };
}

export function getDemoRainMonitorSnapshot(
  deviceId: string,
  scenarioId: DemoScenarioId = 'high',
  timezone = 'Asia/Ho_Chi_Minh',
  now = new Date()
): RainMonitorSnapshot {
  const at = now.getTime();
  const generatedAt = now.toISOString();
  const validTo = new Date(at + 60 * 60000).toISOString();
  const stamp = (minutes: number) => new Date(at - minutes * 60000).toISOString();

  switch (scenarioId) {
    case 'low': {
      // Demo 1: Thấp (An toàn) - Trời tạnh ráo, không có mưa
      const windows: MonitoredRainWindow[] = [
        { minutes: 5, from: stamp(5), to: generatedAt, rainfallMm: 0, averageMmH: 0, quality: 'complete' },
        { minutes: 15, from: stamp(15), to: generatedAt, rainfallMm: 0, averageMmH: 0, quality: 'complete' },
        { minutes: 60, from: stamp(60), to: generatedAt, rainfallMm: 0, averageMmH: 0, quality: 'complete' },
        { minutes: 180, from: stamp(180), to: generatedAt, rainfallMm: 0, averageMmH: 0, quality: 'complete' },
        { minutes: 1440, from: stamp(1440), to: generatedAt, rainfallMm: 0, averageMmH: 0, quality: 'complete' }
      ];
      return {
        deviceId,
        timezone,
        generatedAt,
        observedAt: generatedAt,
        demo: true,
        windows,
        pressure: {
          hpa: 1013.8,
          delta3hHpa: 0.1,
          reason: 'Khí quyển ổn định (+0,1 hPa trong 3 giờ)'
        },
        observation: {
          status: 'dry',
          alert: null,
          rulesConfigured: true,
          thresholds: [
            { ruleId: 'demo-60m', windowMinutes: 60, unit: 'mm', threshold: 15, value: 0, quality: 'complete' },
            { ruleId: 'demo-5m', windowMinutes: 5, unit: 'mm/h', threshold: 25, value: 0, quality: 'complete' }
          ]
        },
        forecast: {
          validFrom: generatedAt,
          validTo,
          estimatedRainMm: 0,
          method: 'persistence',
          status: 'dry_baseline',
          reason: 'Khí áp ổn định (1.013,8 hPa, +0,1 hPa/3h). Thuật toán AI phân tích không có tín hiệu đối lưu hình thành mưa trong 60 phút tới.'
        }
      };
    }

    case 'moderate': {
      // Demo 2: Trung bình (Cần lưu ý) - Mưa rào ngắt quãng 5.12 mm, dưới ngưỡng 15 mm
      const windows: MonitoredRainWindow[] = [
        { minutes: 5, from: stamp(5), to: generatedAt, rainfallMm: 0.64, averageMmH: 7.68, quality: 'complete' },
        { minutes: 15, from: stamp(15), to: generatedAt, rainfallMm: 1.28, averageMmH: 5.12, quality: 'complete' },
        { minutes: 60, from: stamp(60), to: generatedAt, rainfallMm: 5.12, averageMmH: 5.12, quality: 'complete' },
        { minutes: 180, from: stamp(180), to: generatedAt, rainfallMm: 7.68, averageMmH: 2.56, quality: 'complete' },
        { minutes: 1440, from: stamp(1440), to: generatedAt, rainfallMm: 10.24, averageMmH: 0.43, quality: 'complete' }
      ];
      return {
        deviceId,
        timezone,
        generatedAt,
        observedAt: generatedAt,
        demo: true,
        windows,
        pressure: {
          hpa: 1008.2,
          delta3hHpa: -1.6,
          reason: 'Áp suất đang giảm nhẹ (-1,6 hPa trong 3 giờ)'
        },
        observation: {
          status: 'rain',
          alert: null,
          rulesConfigured: true,
          thresholds: [
            { ruleId: 'demo-60m', windowMinutes: 60, unit: 'mm', threshold: 15, value: 5.12, quality: 'complete' },
            { ruleId: 'demo-5m', windowMinutes: 5, unit: 'mm/h', threshold: 25, value: 7.68, quality: 'complete' }
          ]
        },
        forecast: {
          validFrom: generatedAt,
          validTo,
          estimatedRainMm: 5.12,
          method: 'ridge',
          status: 'evaluated',
          modelVersion: 'rain-ridge-v1.2',
          reason: 'Áp suất giảm nhẹ (-1,6 hPa/3h) kết hợp độ ẩm cao. AI dự báo mưa rào ngắt quãng 5–6 mm trong 60 phút tới, chưa có nguy cơ ngập.'
        }
      };
    }

    case 'critical': {
      // Demo 4: Rất cao (Khẩn cấp / Nguy hiểm) - Mưa xối xả 48 mm, áp thấp sâu 998.2 hPa (CRITICAL)
      const windows: MonitoredRainWindow[] = [
        { minutes: 5, from: stamp(5), to: generatedAt, rainfallMm: 4.48, averageMmH: 53.76, quality: 'complete' },
        { minutes: 15, from: stamp(15), to: generatedAt, rainfallMm: 12.8, averageMmH: 51.2, quality: 'complete' },
        { minutes: 60, from: stamp(60), to: generatedAt, rainfallMm: 48.0, averageMmH: 48.0, quality: 'complete' },
        { minutes: 180, from: stamp(180), to: generatedAt, rainfallMm: 76.8, averageMmH: 25.6, quality: 'complete' },
        { minutes: 1440, from: stamp(1440), to: generatedAt, rainfallMm: 115.2, averageMmH: 4.8, quality: 'complete' }
      ];
      return {
        deviceId,
        timezone,
        generatedAt,
        observedAt: generatedAt,
        demo: true,
        windows,
        pressure: {
          hpa: 998.2,
          delta3hHpa: -5.8,
          reason: 'Áp thấp khí quyển sâu (-5,8 hPa trong 3 giờ)'
        },
        observation: {
          status: 'heavy',
          alert: {
            source: 'simulation',
            ruleVersion: RAIN_RULE_VERSION,
            ruleId: 'demo-60m',
            severity: 'CRITICAL',
            value: 48.0,
            threshold: 15.0,
            unit: 'mm',
            windowMinutes: 60,
            from: stamp(60),
            to: generatedAt
          },
          rulesConfigured: true,
          thresholds: [
            { ruleId: 'demo-60m', windowMinutes: 60, unit: 'mm', threshold: 15, value: 48.0, quality: 'complete' },
            { ruleId: 'demo-5m', windowMinutes: 5, unit: 'mm/h', threshold: 25, value: 53.76, quality: 'complete' }
          ]
        },
        forecast: {
          validFrom: generatedAt,
          validTo,
          estimatedRainMm: 45.0,
          method: 'ridge',
          status: 'evaluated',
          modelVersion: 'rain-ridge-v1.2',
          reason: 'Vùng áp thấp sâu (-5,8 hPa/3h), mưa cực lớn dồn dập. AI CẢNH BÁO KHẨN CẤP: Nguy cơ ngập sâu diện rộng 30–50cm và ngập tầng hầm!'
        }
      };
    }

    case 'high':
    default: {
      // Demo 3: Cao (Cảnh báo ngập) - Mưa to 16 mm vượt ngưỡng 15 mm, áp suất 1003.4 hPa (WARNING)
      const windows: MonitoredRainWindow[] = [
        { minutes: 5, from: stamp(5), to: generatedAt, rainfallMm: 1.92, averageMmH: 23.04, quality: 'complete' },
        { minutes: 15, from: stamp(15), to: generatedAt, rainfallMm: 3.2, averageMmH: 12.8, quality: 'complete' },
        { minutes: 60, from: stamp(60), to: generatedAt, rainfallMm: 16.0, averageMmH: 16.0, quality: 'complete' },
        { minutes: 180, from: stamp(180), to: generatedAt, rainfallMm: 25.6, averageMmH: 8.53, quality: 'complete' },
        { minutes: 1440, from: stamp(1440), to: generatedAt, rainfallMm: 38.4, averageMmH: 1.6, quality: 'complete' }
      ];
      return {
        deviceId,
        timezone,
        generatedAt,
        observedAt: generatedAt,
        demo: true,
        windows,
        pressure: {
          hpa: 1003.4,
          delta3hHpa: -3.2,
          reason: 'Khí áp giảm nhanh (-3,2 hPa trong 3 giờ)'
        },
        observation: {
          status: 'heavy',
          alert: {
            source: 'simulation',
            ruleVersion: RAIN_RULE_VERSION,
            ruleId: 'demo-60m',
            severity: 'WARNING',
            value: 16.0,
            threshold: 15.0,
            unit: 'mm',
            windowMinutes: 60,
            from: stamp(60),
            to: generatedAt
          },
          rulesConfigured: true,
          thresholds: [
            { ruleId: 'demo-60m', windowMinutes: 60, unit: 'mm', threshold: 15, value: 16.0, quality: 'complete' },
            { ruleId: 'demo-5m', windowMinutes: 5, unit: 'mm/h', threshold: 25, value: 23.04, quality: 'complete' }
          ]
        },
        forecast: {
          validFrom: generatedAt,
          validTo,
          estimatedRainMm: 16.0,
          method: 'ridge',
          status: 'evaluated',
          modelVersion: 'rain-ridge-v1.2',
          reason: 'Khí áp giảm nhanh (-3,2 hPa/3h), mưa to duy trì. AI CẢNH BÁO: Nguy cơ ngập cục bộ tại các điểm trũng thấp trong 60 phút tới.'
        }
      };
    }
  }
}
