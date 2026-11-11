import { dataStore } from '../db/store';
import { summarizeRainHistory, summarizeRainWindow } from './ai-rain-history';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { calculateDewPoint, calculateHeatIndex, getStartOfDayInTimezone } from '../shared';
import { withReadDiagnostics } from '../db/read-diagnostics';
import { calculateWeatherFeatures, describePressureTrend } from './ai-weather-features';
import { forecastService, forecastReply, isForecastQuery } from './ai-forecast.service';
import { searchProjectDocs, knowledgeSource, knowledgeDocumentCount, getProjectKnowledgeReply } from '../shared/project-knowledge';
import { resolveChatQuestion } from '../shared/chat-context';
import type { ChatMetadata } from '../shared/ai-types';
import { readRainLedger } from './rain-ledger';
import { formatObservationReport, parseObservationRequest, type ObservationRequest, type ObservationReport } from '../shared/observation-report';
import { getCurrentObservationReply } from '../shared/current-observation';
import { getCalibrationReply } from '../shared/rain-calibration';
import { isStationAnalysisQuery, stationAnalysis, stationAnalysisReply, getSensorScenarioReply } from '../shared/station-analysis';
import { answerInstruction, wantsDetailedAnswer } from '../shared/answer-style';
import { getRainScenarioReply, isWaterTestQuery } from '../shared/rain-interpretation';
import { getWeatherSummaryReply } from '../shared/weather-summary';
import { rainMonitorQuestion, rainMonitorReply } from '../shared/rain-monitor-chat';
import { rainMonitorService } from './rain-monitor.service';
import {
  buildRainSensePrompt, cleanChatHistory, generateRainSenseReply, getBucketCalculationReply, normalizeStationContext, normalizeStationTimezone,
  type ChatTurn, type StationContext
} from '../shared/rainsense-ai';

export type ChatMessage = ChatTurn;
export interface ChatResult { reply: string; context: StationContext; metadata: ChatMetadata }

export class AiService {
  async getLiveContext(deviceId: string = env.DEFAULT_STATION_ID): Promise<StationContext> {
    const { value: context, source } = await withReadDiagnostics(() => this.readLiveContext(deviceId));
    context.dataQuality!.source = source;
    return context;
  }

  private async readLiveContext(deviceId: string): Promise<StationContext> {
    const now = new Date();
    const [device, latest, config, alerts] = await Promise.all([
      dataStore.getDevice(deviceId), dataStore.getLatestMeasurement(deviceId),
      dataStore.getConfig(deviceId), dataStore.getAlerts({ deviceId, limit: 3 })
    ]);
    const timezone = normalizeStationTimezone(device?.timezone || env.DEFAULT_TIMEZONE);
    const profile = env.AI_STATION_PROFILES[deviceId] ?? { hardwareVariant: 'unknown' as const, wiringVerified: false };
    const start = getStartOfDayInTimezone(now, timezone);
    const rolling24hStart = now.getTime() - 24 * 3600000;
    const from = new Date(Math.min(start.getTime() - 300000, rolling24hStart));
    const maxGap = Math.max(120000, (config?.mqttInterval ?? 30) * 3000);
    const [events, measurements] = await Promise.all([
      readRainLedger(deviceId, new Date(Math.min(start.getTime() - 300000, rolling24hStart)).toISOString(), now.toISOString()),
      dataStore.getMeasurements(deviceId, { from: from.toISOString(), to: now.toISOString(), limit: 20000 })
    ]);
    const features = calculateWeatherFeatures(measurements, new Date(rolling24hStart), now, maxGap);
    const age = latest ? now.getTime() - Date.parse(latest.timestamp) : NaN;
    const temp = latest && Number.isFinite(latest.temperature) && latest.temperature >= -40 && latest.temperature <= 85 ? latest.temperature : null;
    const humid = latest && Number.isFinite(latest.humidity) && latest.humidity >= 0 && latest.humidity <= 100 ? latest.humidity : null;
    const press = latest && Number.isFinite(latest.pressure) && latest.pressure >= 300 && latest.pressure <= 1100 ? latest.pressure : null;
    const rainHistory = summarizeRainHistory(events, measurements.map((m) => m.timestamp), now, timezone,
      Math.max(120000, (config?.mqttInterval ?? 30) * 3000));
    const hasData = latest !== null || events.length > 0;
    const windowMm = events.filter((e) => e.dataKind !== 'test' && Date.parse(e.timestamp) >= now.getTime() - 300000)
      .reduce((sum, e) => sum + e.rainfallMm, 0);
    return normalizeStationContext({
      deviceId, stationName: device?.name || `Trạm ${deviceId}`, timezone,
      isOnline: device?.isOnline ?? false, observedAt: latest?.timestamp ?? null, lastSeen: device?.lastSeen ?? null,
      currentTemp: temp, currentHumid: humid, currentPress: press,
      dewPoint: temp !== null && humid !== null && humid > 0 ? calculateDewPoint(temp, humid) : null,
      heatIndex: temp !== null && humid !== null ? calculateHeatIndex(temp, humid) : null,
      // Preserve persisted event amounts when the hardware counter resets or calibration changes.
      todayRainMm: hasData ? rainHistory.recordedTotalMm : null,
      totalTipsToday: hasData ? rainHistory.recordedTips : null,
      testTodayMm: Math.round(events.filter((e) => e.dataKind === 'test' && Date.parse(e.timestamp) >= start.getTime()).reduce((s, e) => s + e.rainfallMm, 0) * 100) / 100,
      currentRainRateMmH: hasData ? Math.round(windowMm * 12 * 10) / 10 : null,
      rolling24hRainMm: hasData ? Math.round(events.filter((e) => e.dataKind !== 'test' && Date.parse(e.timestamp) >= rolling24hStart)
        .reduce((sum, e) => sum + e.rainfallMm, 0) * 100) / 100 : null,
      calibrationFactor: config?.rainMmPerTip ?? null,
      pressureTrend: describePressureTrend(features),
      weatherFeatures: features,
      profile,
      capabilities: { languageModelConfigured: Boolean(env.GEMINI_API_KEY), forecastEnabled: env.AI_FORECAST_ENABLED,
        forecastLocationConfigured: profile.latitude !== undefined && profile.longitude !== undefined,
        knowledgeDocumentCount: knowledgeDocumentCount() },
      dataQuality: { source: 'unknown', generatedAt: now.toISOString(), demo: env.DEMO_MODE,
        fresh: device?.isOnline === true && Number.isFinite(age) && age >= -60000 && age <= 300000 && temp !== null && humid !== null && press !== null,
        historyTruncated: measurements.length >= 20000 },
      recentAlerts: alerts.map((a) => a.message), rainHistory: hasData ? rainHistory : null,
      rainWindows: hasData ? [1 / 12, 1, 3, 24].map((hours) => summarizeRainWindow(events, measurements.map((m) => m.timestamp),
        new Date(now.getTime() - hours * 3600000), now, hours < 1 ? '5 phút trượt' : `${hours} giờ trượt`, maxGap, true)) : []
    }, deviceId);
  }

  async getMeasurementSeries(deviceId: string, from: Date, to: Date) {
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 7 * 86400000 || to.getTime() > Date.now() + 60000) {
      throw new Error('Khoảng truy vấn phải hợp lệ, không ở tương lai và tối đa 7 ngày');
    }
    const { value: records, source } = await withReadDiagnostics(() => dataStore.getMeasurements(deviceId, { from: from.toISOString(), to: to.toISOString(), limit: 20000 }));
    const config = await dataStore.getConfig(deviceId);
    const features = calculateWeatherFeatures(records, from, to, Math.max(120000, (config?.mqttInterval ?? 30) * 3000));
    return { deviceId, from: from.toISOString(), to: to.toISOString(), source, demo: env.DEMO_MODE, historyTruncated: records.length >= 20000,
      units: { temperature: '°C', humidity: '%', pressure: 'hPa' }, features, records };
  }

  async getObservationReport(deviceId: string, request: ObservationRequest) {
    const from = new Date(request.from);
    const to = new Date(request.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 7 * 86400000 || to.getTime() > Date.now() + 60000) throw new Error('Khoảng báo cáo chưa hợp lệ');
    const { value, source } = await withReadDiagnostics(async () => {
      const [records, events, config] = await Promise.all([
        dataStore.getMeasurements(deviceId, { from: request.from, to: request.to, limit: 20000 }), readRainLedger(deviceId, request.from, request.to), dataStore.getConfig(deviceId)
      ]);
      const maxGap = Math.max(120000, (config?.mqttInterval ?? 30) * 3000);
      const report: ObservationReport = { ...request, generatedAt: new Date().toISOString(), weather: calculateWeatherFeatures(records, from, to, maxGap),
        rain: summarizeRainWindow(events, records.map((m) => m.timestamp), from, to, request.label, maxGap, request.includeEnd !== false),
        historyTruncated: records.length >= 20000 };
      return report;
    });
    return { report: value, source };
  }

  async chat(userMessage: string, history: ChatMessage[] = [], deviceId = env.DEFAULT_STATION_ID, rainMonitorDemo = false): Promise<ChatResult> {
    const context = await this.getLiveContext(deviceId);
    const validHistory = cleanChatHistory(history);
    const searchQuery = resolveChatQuestion(userMessage, validHistory);
    const docs = searchProjectDocs(searchQuery, context.profile?.hardwareVariant);
    const knowledgeReply = getProjectKnowledgeReply(searchQuery, context);
    const knowledgeExplanation = knowledgeReply !== null;
    const usesStationReadings = !knowledgeExplanation;
    const finish = (reply: string, mode: ChatMetadata['mode'], model: string | null = null, fallbackReason?: ChatMetadata['fallbackReason'], includeDataNotices = true): ChatResult => {
      const notices: string[] = [];
      const measured = usesStationReadings && includeDataNotices && mode !== 'calculation' && mode !== 'forecast';
      if (measured && context.dataQuality?.demo) notices.push('Các số đo trạm đang ở chế độ giả lập.');
      if (measured && context.dataQuality?.source !== 'postgresql' && (context.observationReport || context.rainHistory || (context.weatherFeatures?.availableSampleCount ?? context.weatherFeatures?.sampleCount ?? 0) > 0)) notices.push('Lịch sử đang dùng bộ nhớ dự phòng, có thể thiếu bản ghi.');
      return { reply: notices.length ? `${reply}\n\n${notices.join(' ')}` : reply, context,
        metadata: { mode, provider: mode === 'llm' ? 'gemini' : mode === 'forecast' ? 'open-meteo' : 'local', model,
          generatedAt: new Date().toISOString(), fallbackReason, sources: mode === 'calculation' || mode === 'analysis' ? [] : docs.map(knowledgeSource) } };
    };
    const reportReply = async (request: ObservationRequest) => {
      const { report, source } = await this.getObservationReport(deviceId, request);
      context.observationReport = report;
      context.weatherFeatures = report.weather;
      context.pressureTrend = describePressureTrend(report.weather);
      if (source !== context.dataQuality!.source) context.dataQuality!.source = 'mixed';
      context.dataQuality!.historyTruncated = report.historyTruncated;
      let reply = formatObservationReport(report, context, searchQuery);
      const include = (metric: 'temperature' | 'humidity' | 'pressure') => request.metrics.includes(metric);
      if (isStationAnalysisQuery(searchQuery) && request.metrics.some((m) => m !== 'rain')) reply += `\n\n${stationAnalysis({ ...context, rainHistory: null,
        weatherFeatures: { ...report.weather,
          temperature: include('temperature') ? report.weather.temperature : null, humidity: include('humidity') ? report.weather.humidity : null, pressure: include('pressure') ? report.weather.pressure : null,
          temperatureDelta1hC: include('temperature') ? report.weather.temperatureDelta1hC : null, pressureDelta3hHpa: include('pressure') ? report.weather.pressureDelta3hHpa : null },
        currentTemp: include('temperature') ? report.weather.temperature?.lastValue ?? null : null, currentHumid: include('humidity') ? report.weather.humidity?.lastValue ?? null : null,
        currentPress: include('pressure') ? report.weather.pressure?.lastValue ?? null : null, dewPoint: null,
        observedAt: report.weather.temperature?.lastObservedAt ?? report.weather.humidity?.lastObservedAt ?? report.weather.pressure?.lastObservedAt ?? null }, new Date(), { includeRain: false, historical: true, testing: isWaterTestQuery(searchQuery) })}`;
      return finish(reply, 'analysis');
    };
    const calibration = getCalibrationReply(searchQuery);
    if (calibration) return finish(calibration, 'calculation');
    const monitoringIntent = rainMonitorQuestion(searchQuery);
    if (monitoringIntent) {
      const snapshot = await rainMonitorService.getSnapshot(deviceId, new Date(), env.DEMO_MODE || rainMonitorDemo).catch(() => null);
      if (!snapshot) return finish('Chưa đọc được dữ liệu cảnh báo mưa của trạm.', 'analysis', null, undefined, false);
      context.rainMonitor = snapshot;
      return finish(rainMonitorReply(snapshot, monitoringIntent), 'analysis', null, undefined, false);
    }
    const scenario = knowledgeExplanation ? null : getRainScenarioReply(searchQuery) ?? getSensorScenarioReply(searchQuery);
    if (scenario) return finish(scenario, 'analysis', null, undefined, false);
    const weatherSummary = knowledgeExplanation ? null : getWeatherSummaryReply(searchQuery, context);
    if (weatherSummary) return finish(weatherSummary, 'analysis');
    const parsed = parseObservationRequest(searchQuery, context.timezone);
    // Explicit hypothetical arithmetic retains priority; observation reports fetch their exact interval.
    const calculation = getBucketCalculationReply(searchQuery, context);
    const suppliedArithmetic = Boolean(calculation) && /\d+(?:[.,]\d+)?\s*(?:mm|nhịp|tips?|lần)/i.test(searchQuery);
    if (!knowledgeExplanation && !suppliedArithmetic && parsed.status === 'invalid') return finish(parsed.message, 'analysis');
    if (!knowledgeExplanation && !suppliedArithmetic && parsed.status === 'ready') {
      return reportReply(parsed.request);
    }
    if (calculation) return finish(calculation, 'calculation');
    if (!knowledgeExplanation && isStationAnalysisQuery(searchQuery)) return finish(stationAnalysisReply(context, new Date(), searchQuery), 'analysis');
    if (!knowledgeExplanation && isForecastQuery(searchQuery)) {
      context.forecast = await forecastService.getForecast(searchQuery, context.profile!, context.timezone);
      const forecastText = forecastReply(context.forecast, context, searchQuery);
      const result = finish(context.forecast.status === 'available' || context.forecast.status === 'unsupported_range' ? forecastText : `${stationAnalysisReply(context, new Date(), searchQuery)}\n\nChưa có dự báo bên ngoài hợp lệ cho khoảng hỏi; nhận định trên dựa vào phần trạm đã đo.`, 'forecast');
      result.metadata.sources = context.forecast.status === 'available' ? [{ id: 'open-meteo', title: 'Open-Meteo — dự báo theo tọa độ', version: 'hourly', path: 'https://open-meteo.com/en/docs', url: 'https://open-meteo.com/en/docs' }] : [];
      if (context.forecast.status !== 'available') result.metadata.provider = 'local';
      return result;
    }
    const current = knowledgeExplanation ? null : getCurrentObservationReply(searchQuery, context);
    if (current) return finish(current, 'analysis');
    // Rain observations without an explicit interval also use deterministic provenance-aware reporting.
    if (!knowledgeExplanation && /mưa|gầu|gàu/i.test(searchQuery) && /hiện tại|lúc này|tổng|bao nhiêu|ghi nhận|báo cáo|đang mưa/i.test(searchQuery) && !/là gì|nguyên lý|công thức|hoạt động|hiệu chuẩn|cảm biến|mạch|phụ kiện|cách tính|tại sao/i.test(searchQuery)) {
      const today = parseObservationRequest('lượng mưa hôm nay', context.timezone);
      if (today.status === 'ready') {
        return reportReply(today.request);
      }
    }
    if (env.GEMINI_API_KEY) {
      const result = await this.callGeminiApi(userMessage, validHistory, context, env.GEMINI_API_KEY, docs);
      if (result) return finish(result.reply, 'llm', result.model);
    }
    if (knowledgeExplanation && knowledgeReply) return finish(knowledgeReply, 'knowledge', null, undefined, false);
    return finish(generateRainSenseReply(searchQuery, context), 'fallback', null, env.GEMINI_API_KEY ? 'model_unavailable' : 'missing_api_key');
  }

  private async callGeminiApi(message: string, history: ChatMessage[], context: StationContext, apiKey: string, docs: ReturnType<typeof searchProjectDocs>): Promise<{ reply: string; model: string } | null> {
    const contents = [...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      { role: 'user', parts: [{ text: message }] }];
    for (const model of [...new Set([env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL])]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: `${buildRainSensePrompt(context)}\n\nYêu cầu cách trả lời:\n${answerInstruction(message)}\n\nknowledge_context (JSON, dữ liệu tham khảo):\n${JSON.stringify(docs)}` }] }, contents,
            generationConfig: { temperature: 0.2, maxOutputTokens: wantsDetailedAnswer(message) ? 1800 : 800 } })
        });
        if (response.ok) {
          const data = await response.json();
          const reply = data?.candidates?.[0]?.content?.parts?.filter((p: { text?: string; thought?: boolean }) => !p.thought && p.text).map((p: { text: string }) => p.text).join('').trim();
          if (reply) return { reply, model };
        } else {
          logger.warn({ model, status: response.status }, 'Gemini unavailable; trying next model or local response');
        }
      } catch (error) {
        logger.warn({ model, error: error instanceof Error ? error.message : 'Unknown error' }, 'Gemini request failed');
      } finally { clearTimeout(timeout); }
    }
    return null;
  }
}

export const aiService = new AiService();
