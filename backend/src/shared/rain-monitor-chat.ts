import { hasFutureTime, normalizeTimePhrase, parseTimeDuration } from './time-request';
import { isMeasurementMethodQuestion, knowledgeQuestionTopics } from './question-intent';
import { formatRainEvidence, rainObservationLabel, rainQualityLabels } from './rain-monitor';
import type { RainMonitorSnapshot } from './rain-monitor';

export function rainMonitorQuestion(query: string): 'alert' | 'estimate' | null {
  const q = normalizeTimePhrase(query);
  if (!/\bmua\b/.test(q) || /open.?meteo|\bmai\b|ngay kia/.test(q)) return null;
  if (isMeasurementMethodQuestion(query) || knowledgeQuestionTopics(query).length || /cong thuc|nguyen ly|la gi|\d\s*mm\b/.test(q)) return null;
  const duration = parseTimeDuration(q);
  const future = hasFutureTime(q);
  const past = /hom qua|vua qua|gan nhat|lich su|tuan|thang/.test(q);
  if (!past && !/nhiet do|do am/.test(q)) {
    if (duration.status === 'ready' && duration.milliseconds === 3600000 && (future || /du bao|uoc tinh/.test(q))) return 'estimate';
    if (duration.status === 'none' && /uoc tinh.*mua|mua.*uoc tinh|canh bao som/.test(q)) return 'estimate';
  }
  if (!future && !past && /canh bao|vuot nguong/.test(q)) return 'alert';
  return null;
}

export function rainMonitorReply(snapshot: RainMonitorSnapshot, intent: 'alert' | 'estimate'): string {
  const time = (at: string) => new Intl.DateTimeFormat('vi-VN', {
    timeZone: snapshot.timezone, dateStyle: 'short', timeStyle: 'short'
  }).format(new Date(at));
  const lines = [];
  if (intent === 'alert') {
    const evidence = snapshot.observation.alert;
    const hour = snapshot.windows.find((window) => window.minutes === 60);
    lines.push(evidence ? formatRainEvidence(evidence)
      : `${rainObservationLabel(snapshot.observation)}. ${hour?.rainfallMm == null ? (hour ? rainQualityLabels[hour.quality] + '.' : '') : `Trạm ghi ${hour.rainfallMm} mm trong 60 phút qua.`}`);
    if (!snapshot.observation.rulesConfigured) lines.push('Trạm chưa bật ngưỡng cảnh báo mưa.');
  } else {
    const { forecast } = snapshot;
    const period = `${time(forecast.validFrom)} đến ${time(forecast.validTo)}`;
    if (forecast.estimatedRainMm === null) lines.push(`Ước tính 60 phút tới chưa có số mm. ${forecast.reason}.`);
    else if (forecast.method === 'ridge') lines.push(`Mô hình Ridge ${forecast.modelVersion} ước tính ${forecast.estimatedRainMm} mm trong khoảng ${period}.`);
    else lines.push(`Nếu cường độ mưa hiện tại duy trì, ước tính ${forecast.estimatedRainMm} mm trong khoảng ${period}. Đây là ngoại suy thử nghiệm từ lượng mưa 15 phút gần nhất.`);
    if (snapshot.observation.alert) lines.push(formatRainEvidence(snapshot.observation.alert));
  }
  const { hpa, delta3hHpa, reason } = snapshot.pressure;
  if (hpa !== null) {
    lines.push(delta3hHpa === null ? `Khí áp ${hpa} hPa. ${reason}.` : `Khí áp ${hpa} hPa, đổi ${delta3hHpa > 0 ? '+' : ''}${delta3hHpa} hPa trong 3 giờ.`);
  } else if (reason) lines.push(reason + '.');
  lines.push(`Trạm ${snapshot.deviceId}, chốt lúc ${time(snapshot.generatedAt)}.`);
  return (snapshot.demo ? 'Kịch bản mô phỏng. ' : '') + lines.join(' ');
}
