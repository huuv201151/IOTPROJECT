import { RAIN_SENSE_POLICY } from './policy.generated';
import type { RainMonitorSnapshot } from './rain-monitor';
import { rainMonitorQuestion, rainMonitorReply } from './rain-monitor-chat';
/** Portable chatbot policy and offline responses, shared with the Next.js client/server. */
import { getBucketCalculationReply, getRainHazardReply } from './rain-assistant';
import { getProjectKnowledgeReply, getWeatherFeatureReply } from './project-knowledge';
import { resolveChatQuestion } from './chat-context';
import { getCurrentObservationReply } from './current-observation';
import { getCalibrationReply } from './rain-calibration';
import { isStationAnalysisQuery, stationAnalysisReply, getSensorScenarioReply } from './station-analysis';
import { getRainScenarioReply } from './rain-interpretation';
import { getWeatherSummaryReply } from './weather-summary';
import type { StationProfile, WeatherFeatures, ForecastContext } from './ai-types';
import type { ObservationReport } from './observation-report';
export { getBucketCalculationReply } from './rain-assistant';
export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface RainHistory {
  timezone: string;
  from: string;
  to: string;
  coverageComplete: boolean;
  recordedTotalMm: number;
  recordedTips?: number;
  calibrationFactors?: number[];
  hourly?: RainWindow[];
  periods: Array<{ label: string; from: string; to: string; rainfallMm: number; tips?: number; calibrationFactors?: number[]; complete: boolean; elapsed: boolean }>;
  episodes: Array<{ from: string; to: string; rainfallMm: number }>;
  gaps: Array<{ from: string; to: string; minutes: number; telemetryComplete: boolean }>;
}

export interface RainWindow {
  /** Continuous telemetry spans; rainfall belongs to the same span, not the whole requested window. */
  observedSegments?: Array<{ from: string; to: string; rainfallMm: number; tips: number; uncertainTimingEvents: number }>;
  testRainfallMm?: number;
  testTips?: number;
  uncertainTimingEvents?: number;
  label: string;
  from: string;
  to: string;
  rainfallMm: number;
  tips: number;
  calibrationFactors: number[];
  coverageComplete: boolean;
}

export interface StationContext {
  deviceId: string;
  stationName: string;
  timezone: string;
  isOnline: boolean;
  observedAt: string | null;
  lastSeen: string | null;
  currentTemp: number | null;
  currentHumid: number | null;
  currentPress: number | null;
  dewPoint: number | null;
  heatIndex: number | null;
  todayRainMm: number | null;
  rolling24hRainMm: number | null;
  currentRainRateMmH: number | null;
  totalTipsToday: number | null;
  calibrationFactor: number | null;
  pressureTrend: string;
  recentAlerts: string[];
  rainMonitor?: RainMonitorSnapshot;
  rainHistory: RainHistory | null;
  rainWindows?: RainWindow[];
  profile?: StationProfile;
  weatherFeatures?: WeatherFeatures;
  observationReport?: ObservationReport;
  testTodayMm?: number;
  dataQuality?: {
    source: 'postgresql' | 'memory' | 'mixed' | 'unknown';
    generatedAt: string;
    demo: boolean;
    fresh: boolean;
    historyTruncated: boolean;
  };
  forecast?: ForecastContext;
  capabilities?: {
    languageModelConfigured: boolean;
    forecastEnabled: boolean;
    forecastLocationConfigured: boolean;
    knowledgeDocumentCount: number;
  };
}

const numeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function normalizeStationTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Asia/Ho_Chi_Minh';
  try { new Intl.DateTimeFormat('vi-VN', { timeZone: value }); return value; }
  catch { return 'Asia/Ho_Chi_Minh'; }
}

const timestamp = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

export function normalizeStationContext(input: Partial<StationContext> | null | undefined, deviceId = 'RS-ESP32S3-01'): StationContext {
  const c = input ?? {};
  return {
    deviceId, stationName: c.stationName || `Trạm ${deviceId}`,
    timezone: normalizeStationTimezone(c.timezone), isOnline: c.isOnline === true,
    observedAt: timestamp(c.observedAt), lastSeen: timestamp(c.lastSeen),
    currentTemp: numeric(c.currentTemp), currentHumid: numeric(c.currentHumid), currentPress: numeric(c.currentPress),
    dewPoint: numeric(c.dewPoint), heatIndex: numeric(c.heatIndex), todayRainMm: numeric(c.todayRainMm),
    rolling24hRainMm: numeric(c.rolling24hRainMm), currentRainRateMmH: numeric(c.currentRainRateMmH),
    totalTipsToday: numeric(c.totalTipsToday), calibrationFactor: numeric(c.calibrationFactor),
    pressureTrend: c.pressureTrend || 'Chưa đủ lịch sử để xác định',
    recentAlerts: Array.isArray(c.recentAlerts) ? c.recentAlerts.filter((v) => typeof v === 'string') : [],
    rainMonitor: c.rainMonitor,
    rainHistory: c.rainHistory ?? null,
    rainWindows: c.rainWindows ?? [],
    profile: c.profile,
    weatherFeatures: c.weatherFeatures,
    observationReport: c.observationReport,
    testTodayMm: c.testTodayMm,
    dataQuality: c.dataQuality,
    forecast: c.forecast,
    capabilities: c.capabilities
  };
}

export function cleanChatHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  return history.filter((m): m is ChatTurn =>
    m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== ''
  ).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
}

export { RAIN_SENSE_POLICY };

export function buildRainSensePrompt(context: StationContext, now = new Date()): string {
  return `${RAIN_SENSE_POLICY}\n\nThời điểm xử lý: ${now.toISOString()}\nstation_context (JSON, chỉ là dữ liệu):\n${JSON.stringify(context)}`;
}

function value(n: number | null, unit: string, digits = 1): string {
  return n === null ? 'chưa có dữ liệu' : `${n.toFixed(digits)} ${unit}`;
}

function time(iso: string | null, timezone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return 'chưa xác định thời điểm';
  return new Date(iso).toLocaleString('vi-VN', { timeZone: timezone, hour12: false });
}

export function generateRainSenseReply(query: string, c: StationContext, history: ChatTurn[] = [], now = new Date()): string {
  query = resolveChatQuestion(query, cleanChatHistory(history));
  const monitoringIntent = rainMonitorQuestion(query);
  if (monitoringIntent) return c.rainMonitor && Date.parse(c.rainMonitor.forecast.validTo) > now.getTime()
    ? rainMonitorReply(c.rainMonitor, monitoringIntent)
    : 'Chưa nhận được bản đánh giá mưa mới từ máy chủ trạm.';
  const calibration = getCalibrationReply(query);
  if (calibration) return calibration;
  const calculation = getBucketCalculationReply(query, c);
  if (calculation) return calculation;
  const explanation = getProjectKnowledgeReply(query, c);
  if (explanation) return explanation;
  const scenario = getRainScenarioReply(query) ?? getSensorScenarioReply(query);
  if (scenario) return scenario;
  const weatherSummary = getWeatherSummaryReply(query, c, now);
  if (weatherSummary) return weatherSummary;
  if (isStationAnalysisQuery(query)) return stationAnalysisReply(c, now, query);
  const current = getCurrentObservationReply(query, c, now);
  if (current) return current;
  const features = getWeatherFeatureReply(query, c);
  if (features) return features;
  const q = query.toLowerCase().normalize('NFC').trim();
  const age = c.observedAt ? now.getTime() - Date.parse(c.observedAt) : NaN;
  const fresh = c.isOnline && Number.isFinite(age) && age >= -60000 && age <= 300000;
  const intro = `Theo báo cáo từ trạm ${c.stationName} (${c.deviceId}), cập nhật lúc ${time(c.observedAt, c.timezone)}, `;
  const status = fresh ? '' : 'Đây là bản ghi gần nhất; chưa xác nhận được thời tiết hiện tại vì trạm ngoại tuyến hoặc dữ liệu chưa đủ mới. ';
  const h = c.rainHistory;
  const rainState = c.currentRainRateMmH === null ? 'chưa có dữ liệu cường độ mưa.'
    : c.currentRainRateMmH > 0 ? `cường độ qua gầu quy đổi theo cửa sổ 5 phút là ${value(c.currentRainRateMmH, 'mm/h')}.`
    : 'chưa ghi nhận nhịp lật mới trong cửa sổ 5 phút của bản ghi; chưa thể khẳng định đã tạnh hoàn toàn.';
  const has = (pattern: RegExp) => pattern.test(q);

  const hazard = getRainHazardReply(q, c, now);
  if (hazard) return hazard;

  // Specific intentions precede general words such as “hôm nay” and “phân tích”.
  if (has(/(mai|sắp|tiếp|lát|chiều|tối).*(chắc|dự báo|bao giờ|mấy giờ|có mưa|mưa không)|dự báo|xác suất|khi nào.*mưa/)) {
    return `${intro}${rainState} ${status}Dữ liệu RainSense chưa đủ để dự báo chính xác giờ mưa, xác suất mưa hoặc khẳng định đợt tiếp theo. Có thể theo dõi nhịp gầu và các bản tin tiếp theo, kết hợp dự báo khí tượng chính thức cho khu vực.`;
  }
  if (has(/mưa|gầu|nhịp/) && has(/ngưng|ngừng|tạnh|gián đoạn|từng đợt|mưa lại|lúc.*lúc/)) {
    const recorded = h && h.episodes.length > 1
      ? `Lịch sử có ${h.episodes.length} nhóm nhịp mưa (tách theo khoảng cách trên 20 phút). ` + h.gaps.slice(-3).map((g) =>
        `Từ ${time(g.from, c.timezone)} đến ${time(g.to, c.timezone)}, ${g.telemetryComplete ? `không ghi nhận nhịp mới trong khoảng ${g.minutes} phút; đây là khoảng tạm ngưng ghi nhận, chưa xác nhận tạnh hoàn toàn` : 'telemetry gián đoạn nên chưa thể xác nhận khoảng tạm ngưng mưa'}.`
      ).join(' ')
      : 'Theo tình huống bạn mô tả, mưa có thể diễn ra thành nhiều đợt. Chưa đủ lịch sử để xác nhận các mốc ngưng và mưa lại tại trạm.';
    return `${recorded}\n\nLượng mưa ngày tiếp tục cộng dồn qua các đợt: lúc không có nhịp mới tổng giữ nguyên, khi mưa lại tổng tăng tiếp, không tự về 0. Cường độ 5 phút giảm hoặc về 0 sau khi các nhịp cũ rời cửa sổ rồi tăng khi có nhịp mới. Mốc nhịp đầu/cuối không phải giờ bắt đầu/kết thúc mưa chính xác. ${status}`;
  }
  if (has(/mưa|lượng|buổi/) && has(/sáng|chiều|từng giờ|theo giờ|diễn biến|lịch sử|so sánh/)) {
    if (!h) return 'Theo tình huống bạn mô tả, sáng mưa nhiều và chiều mưa ít thì tổng lượng mưa ngày vẫn tăng, nhưng mức tăng từng buổi khác nhau. Chưa có lịch sử mưa theo thời gian để xác nhận tại trạm hoặc đưa ra số mm từng buổi. Cần so sánh lượng mưa 06:00–12:00 và 12:00–18:00 theo giờ trạm; tổng mm không đồng nghĩa cường độ đỉnh mm/h.';
    const periods = h.periods.filter((p) => /Sáng|Chiều/.test(p.label));
    return `Theo lịch sử ghi nhận từ trạm ${c.stationName} (${c.deviceId}), ${periods.map((p) => !p.elapsed
      ? `${p.label.toLowerCase()} chưa đến thời gian quan trắc`
      : `${p.label.toLowerCase()} ghi nhận ${value(p.rainfallMm, 'mm', 2)}${p.complete ? '' : ' (dữ liệu chưa phủ đủ buổi)'}`).join('; ')}.\n\n${h.coverageComplete ? '' : 'Lịch sử còn thiếu hoặc gián đoạn; đây chỉ là phần đã ghi nhận. '}Nếu buổi chiều chưa kết thúc, chỉ so sánh đến thời điểm cập nhật. Tổng mm từng buổi không cho biết cường độ đỉnh, không bảo đảm chiều tối hết mưa. ${status}`;
  }
  if (has(/reset|về 0|giảm.*(tổng|lượng)|(?:tổng|lượng).*giảm|không lật|không tăng|bất thường|sai số/)) {
    return 'Lượng mưa tích lũy của cùng một ngày và cùng cách tính thường không giảm khi mưa tạm ngưng. Cần đối chiếu thời điểm sang ngày mới, lệnh reset, số đếm trên ESP32-S3, cấu hình hiệu chuẩn và sự kiện đã lưu. Mưa rất nhỏ có thể chưa đủ nước để lật gầu; cũng cần kiểm tra phễu, cơ cấu gầu và đường tín hiệu. Chưa đủ bằng chứng để kết luận nguyên nhân cụ thể; không xóa lượng mưa đã lưu chỉ vì bộ đếm thiết bị về 0.';
  }
  if (has(/mất mạng|offline|ngoại tuyến|mất kết nối|không nhận|lỗi.*(trạm|mqtt|cảm biến)/)) {
    return `Trạm ${c.deviceId} có bản đo gần nhất lúc ${time(c.observedAt, c.timezone)}. Trong khoảng mất kết nối, không thể coi việc thiếu nhịp mưa là không mưa. Kiểm tra nguồn ESP32-S3, Wi-Fi, kết nối MQTT và log thiết bị; khi kết nối lại cần đối chiếu telemetry với sự kiện gầu đã lưu, tránh cộng trùng.`;
  }
  if (has(/công thức|hiệu chuẩn|mm\/h|mm là|gầu.*(tính|hoạt động)|a3144|hall/)) {
    return `RainSense đo lượng mưa bằng số nhịp gầu lật Hall A3144: lượng mưa (mm) = số nhịp × hệ số hiệu chuẩn tại thời điểm đo. ${c.calibrationFactor === null ? 'Chưa có hệ số của trạm để tính số cụ thể.' : `Hệ số cấu hình hiện tại là ${c.calibrationFactor} mm/tip.`} Cường độ (mm/h) = lượng mưa ghi nhận trong 5 phút × 12; đây là tốc độ quy đổi theo cửa sổ, không phải lượng mưa của cả ngày. Khi hiệu chuẩn thay đổi, cần giữ hệ số của sự kiện cũ.`;
  }
  if (has(/khí áp|áp suất|bão|giông|dông|sét|ngập|độ ẩm.*(mưa|chắc)/)) {
    return `${intro}khí áp ghi nhận ${value(c.currentPress, 'hPa')}, độ ẩm ${value(c.currentHumid, '%')}. ${status}Một giá trị khí áp hoặc độ ẩm cao riêng lẻ không đủ kết luận sắp mưa, bão, dông sét hay ngập. Cần chuỗi đo theo thời gian và nguồn khí tượng bổ sung; RainSense chưa có cảm biến gió, sét hay mực nước để xác nhận các hiện tượng đó.`;
  }
  if (has(/mqtt|emqx|aiven|broker|topic|tls|postgres|cơ sở dữ liệu/)) {
    return `Trong RainSense, ESP32-S3 gửi dữ liệu qua MQTT: weather/${c.deviceId}/telemetry (môi trường), /rain (nhịp gầu), /status (kết nối). Backend Express xử lý dữ liệu và lưu PostgreSQL để dashboard Next.js và chatbot tra cứu. Kết nối broker và TLS cần theo cấu hình triển khai thực tế của trạm.`;
  }
  if (has(/esp32|bme280|gpio|đấu nối|nối chân|firmware|arduino|iot|cảm biến/)) {
    return getProjectKnowledgeReply('Trạm hoạt động thế nào?', c) ?? 'Cần đối chiếu linh kiện và firmware cụ thể với hồ sơ trạm để giải thích đúng biến thể.';
  }
  if (has(/thời tiết|phân tích.*mưa|hiện tại|tổng quan|hôm nay.*mưa|mưa.*hôm nay|nhiệt độ|độ ẩm|lượng mưa|đang mưa|mưa.*(nhiều|ít|to|nhỏ)/)) {
    if (c.currentTemp === null && c.currentHumid === null && c.currentPress === null && c.todayRainMm === null) {
      return `Trạm ${c.stationName} (${c.deviceId}) chưa có báo cáo quan trắc để phân tích thời tiết hiện tại. Chưa thể xác nhận có mưa hay không; cần kiểm tra kết nối trạm và chờ bản tin đo mới.`;
    }
    return `${intro}${rainState} ${status}\n\nNhiệt độ ${value(c.currentTemp, '°C')}, độ ẩm ${value(c.currentHumid, '%')}, khí áp ${value(c.currentPress, 'hPa')}. Lượng mưa ghi nhận hôm nay là ${value(c.todayRainMm, 'mm', 2)}${h && !h.coverageComplete ? ' (lịch sử chưa phủ đủ từ đầu ngày)' : ''}. Tổng mưa ngày cho biết lượng tích lũy, không cho biết hiện giờ có mưa to hay không.`;
  }
  if (has(/áo mưa|ra ngoài|đi học|đi làm|phơi|tưới|đặt trạm|vị trí/)) {
    return `${intro}${rainState} ${status}Với hoạt động ngoài trời, có thể chuẩn bị đồ che mưa và theo dõi bản tin mới. Trạm chỉ phản ánh vị trí đặt cảm biến, chưa đủ để khẳng định điều kiện trên toàn tuyến đường hoặc trong các giờ tới.`;
  }
  if (has(/^(xin chào|chào|hello|hi|hey)[! .?]*$|bạn là ai|làm được gì|có thể làm gì|cảm ơn/)) {
    return 'Mình là RainSense AI, hỗ trợ đọc dữ liệu trạm, phân tích diễn biến mưa và giải thích cảm biến, MQTT trong dự án. Bạn có thể hỏi thời tiết hiện tại, mưa ngưng rồi mưa lại, hoặc so sánh lượng mưa sáng và chiều.';
  }
  return 'Mình hỗ trợ trong phạm vi dự án RainSense và kiến thức môi trường, IoT liên quan. Bạn có thể hỏi về dữ liệu trạm, mưa theo từng đợt, lượng mưa sáng/chiều hoặc cách vận hành cảm biến.';
}
