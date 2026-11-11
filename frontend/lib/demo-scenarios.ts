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
    pressureTrendCategory: 'STABLE'
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
    pressureTrendCategory: 'FALLING'
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
    pressureTrendCategory: 'RAPIDLY_FALLING'
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
    pressureTrendCategory: 'RAPIDLY_FALLING'
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
