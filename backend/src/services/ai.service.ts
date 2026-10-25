import fs from 'fs';
import path from 'path';
import { dataStore } from '../db/store';
import { rainfallService } from '../services/rainfall.service';
import { measurementService } from '../services/measurement.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  calculateDewPoint,
  calculateHeatIndex,
  classifyPressureTrend,
  getHumidityStatusVi,
  getRainRateCategoryVi
} from '../shared';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function sanitizeMathText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\times/g, '×')
    .replace(/\\Delta\s*t/gi, 'Δt')
    .replace(/\\Delta/gi, 'Δ')
    .replace(/\\le/g, '≤')
    .replace(/\\ge/g, '≥')
    .replace(/\\pm/g, '±')
    .replace(/\\degree/g, '°')
    .replace(/\\cdot/g, '·')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2')
    .replace(/\$([^\$]+)\$/g, '$1')
    .replace(/\\([a-zA-Z]+)/g, '$1');
}

export class AiService {
  private runtimeApiKey: string = (process.env.GEMINI_API_KEY || (env as any).GEMINI_API_KEY || '').trim();
  private runtimeModel: string = (process.env.GEMINI_MODEL || (env as any).GEMINI_MODEL || 'gemini-2.5-flash').trim();

  public getApiKey(): string {
    return (this.runtimeApiKey || process.env.GEMINI_API_KEY || (env as any).GEMINI_API_KEY || '').trim();
  }

  public getModel(): string {
    return (this.runtimeModel || process.env.GEMINI_MODEL || (env as any).GEMINI_MODEL || 'gemini-2.5-flash').trim();
  }

  public getConfig() {
    const key = this.getApiKey();
    return {
      hasKey: Boolean(key && key.length > 0),
      model: this.getModel(),
      keyMasked: key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : '',
      provider: key ? 'gemini' : 'builtin'
    };
  }

  public updateConfig(apiKey?: string, model?: string) {
    if (typeof apiKey === 'string') {
      this.runtimeApiKey = apiKey.trim();
      process.env.GEMINI_API_KEY = this.runtimeApiKey;
    }
    if (typeof model === 'string' && model.trim()) {
      this.runtimeModel = model.trim();
      process.env.GEMINI_MODEL = this.runtimeModel;
    }

    try {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf8');
        if (typeof apiKey === 'string') {
          if (/^GEMINI_API_KEY=.*$/m.test(content)) {
            content = content.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY="${this.runtimeApiKey}"`);
          } else {
            content += `\nGEMINI_API_KEY="${this.runtimeApiKey}"`;
          }
        }
        if (typeof model === 'string' && model.trim()) {
          if (/^GEMINI_MODEL=.*$/m.test(content)) {
            content = content.replace(/^GEMINI_MODEL=.*$/m, `GEMINI_MODEL="${this.runtimeModel}"`);
          } else {
            content += `\nGEMINI_MODEL="${this.runtimeModel}"`;
          }
        }
        fs.writeFileSync(envPath, content, 'utf8');
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Failed to persist GEMINI config to .env file');
    }

    return this.getConfig();
  }

  public async testGeminiKey(apiKey?: string, modelName?: string): Promise<{ success: boolean; model: string; reply: string }> {
    const key = apiKey?.trim() || this.getApiKey();
    if (!key) {
      throw new Error('Chưa có Gemini API Key để kiểm tra. Vui lòng nhập API Key từ Google AI Studio.');
    }
    const requested = modelName?.trim() || this.getModel();
    const candidateModels = Array.from(new Set([
      requested,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest'
    ])).filter(Boolean);

    let lastError: any = null;
    for (const m of candidateModels) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: 'Trả lời đúng 1 câu ngắn gọn chuyên nghiệp: "Kết nối Google AI Studio thành công! RainSense AI sẵn sàng đồng hành cùng hệ thống trạm quan trắc."' }]
                }
              ]
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Kết nối thành công!';
          if (m !== this.runtimeModel) {
            this.updateConfig(undefined, m);
          }
          return { success: true, model: m, reply };
        } else {
          const errJson = await response.json().catch(() => null);
          const errDetail = errJson?.error?.message || response.statusText;
          lastError = new Error(`Lỗi (${response.status}) với ${m}: ${errDetail}`);
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    throw lastError || new Error('Không thể kết nối đến mô hình Gemini nào với API Key này.');
  }

  /**
   * Get current live weather context for the station
   */
  async getLiveContext(deviceId: string = env.DEFAULT_STATION_ID) {
    const device = await dataStore.getDevice(deviceId);
    const latest = await dataStore.getLatestMeasurement(deviceId);
    const rainfall = await rainfallService.getStatistics(deviceId);
    const envSummary = await measurementService.getEnvironmentalSummary(deviceId);
    const config = await dataStore.getConfig(deviceId);
    const recentAlerts = await dataStore.getAlerts({ deviceId, limit: 3 });

    const currentTemp = latest?.temperature ?? envSummary?.temperature?.current ?? null;
    const currentHumid = latest?.humidity ?? envSummary?.humidity?.current ?? null;
    const currentPress = latest?.pressure ?? envSummary?.pressure?.current ?? null;
    const dewPoint = currentTemp !== null && currentHumid !== null ? calculateDewPoint(currentTemp, currentHumid) : null;
    const heatIndex = currentTemp !== null && currentHumid !== null ? calculateHeatIndex(currentTemp, currentHumid) : null;
    const rainCategory = getRainRateCategoryVi(rainfall?.currentRateMmH ?? 0);
    const humidityStatus = currentHumid !== null ? getHumidityStatusVi(currentHumid) : null;
    const pressureTrend = currentPress !== null ? classifyPressureTrend(currentPress) : null;

    return {
      deviceId: device?.deviceId || deviceId,
      stationName: device?.name || 'Trạm Quan Trắc ESP32-S3',
      isOnline: device?.isOnline ?? false,
      lastSeen: device?.lastSeen || null,
      wifiRssi: device?.wifiRssi ?? latest?.wifiRssi ?? null,
      uptime: latest?.uptime ?? null,
      currentTemp,
      currentHumid,
      currentPress,
      dewPoint,
      heatIndex,
      todayRainMm: rainfall?.todayMm ?? 0,
      rolling24hRainMm: rainfall?.rolling24hMm ?? 0,
      currentRainRateMmH: rainfall?.currentRateMmH ?? 0,
      totalTipsToday: rainfall?.totalTipsToday ?? 0,
      calibrationFactor: config?.rainMmPerTip ?? rainfall?.calibrationFactor ?? 0.64,
      rainCategory: rainCategory.labelVi,
      humidityStatus: humidityStatus?.label || 'Chờ dữ liệu',
      pressureTrend: pressureTrend?.labelVi || 'Chờ dữ liệu',
      recentAlerts: recentAlerts.map((a) => a.message)
    };
  }

  /**
   * Process a chat message with live context
   */
  async chat(
    userMessage: string,
    history: ChatMessage[] = [],
    deviceId: string = env.DEFAULT_STATION_ID
  ): Promise<{ reply: string; context: any; provider?: string }> {
    const context = await this.getLiveContext(deviceId);

    // 1. If GEMINI_API_KEY is configured in environment, attempt external LLM call
    const geminiKey = this.getApiKey();
    if (geminiKey) {
      try {
        const reply = await this.callGeminiApi(userMessage, history, context, geminiKey, this.getModel());
        if (reply) {
          return { reply: sanitizeMathText(reply), context, provider: 'gemini' };
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Gemini API call failed, falling back to built-in RainSense reasoning engine');
      }
    }

    // 2. Intelligent Built-in RainSense Engine (Rule & Expert reasoning)
    const reply = this.generateBuiltinResponse(userMessage, context);
    return { reply: sanitizeMathText(reply), context, provider: 'builtin' };
  }

  /**
   * Gemini API integration with grounding and strict alternating turns
   */
  private async callGeminiApi(
    userMessage: string,
    history: ChatMessage[],
    context: any,
    apiKey: string,
    modelName: string = 'gemini-2.5-flash'
  ): Promise<string | null> {
    const systemPrompt = `Bạn là RainSense AI — Trợ lý Khí tượng & Giám sát Mưa Đô thị thông minh trực thuộc hệ thống trạm quan trắc RainSense (kết nối ESP32-S3, BME280 và cảm biến lật gầu Hall A3144 qua EMQX Cloud MQTT và Aiven PostgreSQL).
Tính cách & Phong cách: Chuyên nghiệp, nhã nhặn, am hiểu sâu sắc về khoa học khí quyển và kỹ thuật phần cứng IoT. Sử dụng văn phong tiếng Việt chuẩn mực, mạch lạc, có cấu trúc bullet point rõ ràng và các biểu tượng thời tiết trực quan (🌧️, 🌡️, 💧, 🧭, ⚡, ⚠️). Không sử dụng ký hiệu LaTeX phức tạp, viết công thức thuần văn bản tự nhiên.
Kiến thức chuyên môn:
- Công thức tính mưa gầu lật: Lượng mưa (mm) = Số nhịp (tips) × ${context.calibrationFactor} mm/tip.
- Cường độ mưa (Rain Rate): Tính theo cửa sổ trượt 5 phút quy đổi về mm/h (hoặc 900 / Δt giây).
- Cảm biến môi trường BME280: Nhiệt độ, Độ ẩm tương đối, Khí áp, Điểm sương Magnus-Tetens, Chỉ số nhiệt Rothfusz.
- Phần cứng ESP32-S3: I2C (SDA GPIO 8, SCL GPIO 9, xung 100kHz), Cảm biến Hall A3144 (GPIO 10, ngắt FALLING), Nút BOOT/Reset (GPIO 0).
- Kết nối: MQTT TLS 8883 (EMQX Cloud), Wi-Fi Multi tự động chuyển mạng.

DỮ LIỆU THỰC TẾ HIỆN TẠI TỪ TRẠM QUAN TRẮC:
- Mã trạm: ${context.stationName} (${context.deviceId})
- Trạng thái kết nối: ${context.isOnline ? 'ĐANG TRỰC TUYẾN' : 'NGOẠI TUYẾN (Chờ ESP32-S3)'}
- Nhiệt độ môi trường: ${context.currentTemp !== null ? `${context.currentTemp.toFixed(1)} °C` : 'Chưa có dữ liệu'}
- Độ ẩm không khí: ${context.currentHumid !== null ? `${context.currentHumid.toFixed(1)} % (${context.humidityStatus})` : 'Chưa có'}
- Áp suất khí quyển: ${context.currentPress !== null ? `${context.currentPress.toFixed(1)} hPa (Xu hướng: ${context.pressureTrend})` : 'Chưa có'}
- Điểm sương (Dew Point): ${context.dewPoint !== null ? `${context.dewPoint.toFixed(1)} °C` : '--'}
- Chỉ số nhiệt cảm nhận (Heat Index): ${context.heatIndex !== null ? `${context.heatIndex.toFixed(1)} °C` : '--'}
- Lượng mưa hôm nay: ${context.todayRainMm.toFixed(2)} mm (${context.totalTipsToday} nhịp lật gầu)
- Cường độ mưa tức thời: ${context.currentRainRateMmH.toFixed(1)} mm/h (${context.rainCategory})
- Hệ số hiệu chuẩn gầu lật: ${context.calibrationFactor} mm/tip
- Cường độ sóng Wi-Fi RSSI: ${context.wifiRssi !== null ? `${context.wifiRssi} dBm` : '--'}
- Uptime hoạt động: ${context.uptime ? `${Math.floor(context.uptime / 3600)}h ${Math.floor((context.uptime % 3600) / 60)}m` : '--'}
- Cảnh báo hệ thống: ${context.recentAlerts.length > 0 ? context.recentAlerts.join('; ') : 'Không có'}

Hãy trả lời bằng tiếng Việt, ngắn gọn, súc tích, cấu trúc Markdown đẹp mắt, phân tích dựa trên dữ liệu thực tế ở trên để hỗ trợ người dùng.`;

    // Strictly alternating contents between user and model
    const cleanContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const msg of history.slice(-6)) {
      const role = msg.role === 'user' ? 'user' : 'model';
      const text = (msg.content || '').trim();
      if (!text) continue;
      if (cleanContents.length > 0 && cleanContents[cleanContents.length - 1].role === role) {
        cleanContents[cleanContents.length - 1].parts[0].text += `\n${text}`;
      } else {
        cleanContents.push({ role, parts: [{ text }] });
      }
    }

    if (cleanContents.length > 0 && cleanContents[cleanContents.length - 1].role === 'user') {
      cleanContents[cleanContents.length - 1].parts[0].text += `\n${userMessage.trim()}`;
    } else {
      cleanContents.push({ role: 'user', parts: [{ text: userMessage.trim() }] });
    }

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: cleanContents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 1500
      }
    };

    const candidateModels = Array.from(new Set([
      modelName,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest'
    ])).filter(Boolean);

    for (const m of candidateModels) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        );

        if (response.ok) {
          const data = await response.json();
          const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) return candidate;
        }
      } catch (err: any) {
        logger.warn({ model: m, err: err.message }, 'Gemini model request failed, trying next candidate');
      }
    }

    return null;
  }

  /**
   * Built-in Expert Reasoning Engine for RainSense AI
   */
  private generateBuiltinResponse(query: string, context: any): string {
    const q = query.toLowerCase().trim();

    // Specific topic detection to avoid greeting collision
    const hasSpecificTopic =
      q.includes('nhiệt độ') ||
      q.includes('độ ẩm') ||
      q.includes('khí áp') ||
      q.includes('áp suất') ||
      q.includes('thời tiết') ||
      q.includes('mưa') ||
      q.includes('gầu lật') ||
      q.includes('esp32') ||
      q.includes('pinout') ||
      q.includes('sơ đồ') ||
      q.includes('code') ||
      q.includes('firmware') ||
      q.includes('mqtt') ||
      q.includes('bão') ||
      q.includes('giông');

    // 1. Lời chào & Giới thiệu (Word boundary matching to prevent matching 'nhiệt độ', 'hiện tại', 'khí áp')
    const isGreeting =
      q.includes('chào') ||
      q.includes('hello') ||
      /\bhi\b/i.test(q) ||
      q === 'hi' ||
      q.includes('bạn là ai') ||
      q.includes('giới thiệu') ||
      q.includes('tên gì') ||
      q.includes('rainsense ai');

    if (isGreeting && !hasSpecificTopic) {
      return (
        `Xin chào! Tôi là **RainSense AI** 🌧️ — Trợ lý Khí tượng & Giám sát Mưa Đô thị thông minh.\n\n` +
        `Tôi đang kết nối trực tiếp với trạm quan trắc **${context.deviceId}** để hỗ trợ bạn:\n` +
        `- 🌤️ **Giám sát môi trường thời gian thực:** Đọc và phân tích Nhiệt độ, Độ ẩm, Áp suất khí quyển từ BME280.\n` +
        `- 🌧️ **Đo đạc lưu lượng mưa:** Đếm xung gầu lật Hall A3144, lượng mưa tích lũy và tốc độ mưa tức thời (mm/h).\n` +
        `- ⚡ **Cảnh báo giông bão & ngập úng:** Dự báo thời tiết cực đoan dựa vào độ sụt áp suất khí quyển.\n` +
        `- 🔌 **Kỹ thuật phần cứng IoT:** Sơ đồ chân ESP32-S3, cấu hình Multi-WiFi và giao thức MQTT TLS.\n\n` +
        `Bạn cần tôi cung cấp thông tin hoặc phân tích dữ liệu nào lúc này? 📡`
      );
    }

    // 2. Phân tích thời tiết hiện tại / Tổng quan / Nhiệt độ / Độ ẩm / Khí áp
    if (
      q.includes('thời tiết') ||
      q.includes('hiện tại') ||
      q.includes('chỉ số') ||
      q.includes('tổng quan') ||
      q.includes('hôm nay') ||
      q.includes('đánh giá') ||
      q.includes('nhiệt độ') ||
      q.includes('độ ẩm')
    ) {
      if (!context.isOnline && context.currentTemp === null) {
        return (
          `⚠️ Hiện tại trạm quan trắc **${context.deviceId}** đang ở trạng thái **Ngoại tuyến (Chờ kết nối)**.\n\n` +
          `🔍 **Thông tin trạm:**\n` +
          `- **Tên trạm:** ${context.stationName}\n` +
          `- **Trạng thái:** Chưa nhận bản tin telemetry từ vi điều khiển ESP32-S3.\n` +
          `- **Lượng mưa ghi nhận:** 0.00 mm (0 nhịp lật).\n\n` +
          `👉 **Hướng dẫn:** Vui lòng kiểm tra cáp nguồn ESP32-S3 và kết nối Wi-Fi. Ngay khi trạm gửi bản tin MQTT đầu tiên, tôi sẽ cập nhật báo cáo phân tích chi tiết ngay lập tức!`
        );
      }

      const tempStr = context.currentTemp !== null ? `${context.currentTemp.toFixed(1)}°C` : '--';
      const humidStr = context.currentHumid !== null ? `${context.currentHumid.toFixed(1)}%` : '--';
      const pressStr = context.currentPress !== null ? `${context.currentPress.toFixed(1)} hPa` : '--';
      const dewStr = context.dewPoint !== null ? `${context.dewPoint.toFixed(1)}°C` : '--';
      const heatStr = context.heatIndex !== null ? `${context.heatIndex.toFixed(1)}°C` : '--';

      return (
        `Dưới đây là báo cáo khí tượng thời gian thực từ trạm **${context.deviceId}**: 🌤️\n\n` +
        `- 🌡️ **Nhiệt độ không khí:** **${tempStr}** (Điểm sương: ${dewStr})\n` +
        `- 💧 **Độ ẩm tương đối:** **${humidStr}** (Trạng thái: ${context.humidityStatus})\n` +
        `- 🧭 **Áp suất khí quyển:** **${pressStr}** (Xu hướng: ${context.pressureTrend})\n` +
        `- 🌧️ **Lượng mưa hôm nay:** **${context.todayRainMm.toFixed(2)} mm** (${context.totalTipsToday} lần lật gầu)\n` +
        `- ⚡ **Cường độ tức thời:** **${context.currentRainRateMmH.toFixed(1)} mm/h** (Cấp độ: ${context.rainCategory})\n` +
        `- 🌡️ **Nhiệt cảm nhận (Heat Index):** **${heatStr}**\n\n` +
        `💡 **Nhận định:** ${
          context.todayRainMm > 15
            ? 'Khu vực đang ghi nhận lượng mưa đáng kể, cần chú ý hiện tượng thoát nước chậm và mang đồ che mưa khi ra ngoài. ☔'
            : context.currentTemp > 35
            ? 'Thời tiết nắng nóng gay gắt, chỉ số nhiệt cao, cần hạn chế hoạt động ngoài trời kéo dài vào giờ cao điểm. ☀️'
            : 'Điều kiện khí tượng tương đối thuận lợi, nhiệt độ và độ ẩm ở ngưỡng dễ chịu cho sinh hoạt ngoài trời.'
        }`
      );
    }

    // 3. Cảm biến mưa, gầu lật A3144 Hall Effect, công thức tính mưa
    if (
      q.includes('mưa') ||
      q.includes('gầu lật') ||
      q.includes('hall') ||
      q.includes('a3144') ||
      q.includes('công thức') ||
      q.includes('tính lượng mưa') ||
      q.includes('calibration') ||
      q.includes('hiệu chuẩn') ||
      q.includes('nhịp lật') ||
      q.includes('tip')
    ) {
      return (
        `Dưới đây là cơ chế và công thức đo lượng mưa của trạm **RainSense**: 🌧️\n\n` +
        `### 1. Nguyên lý gầu lật đo mưa (Tipping Bucket)\n` +
        `- Phễu hứng gom nước mưa chảy vào một trong hai ngăn của gầu bập bênh.\n` +
        `- Khi lượng nước đạt đúng thể tích thiết kế (tương ứng với chiều dày lớp nước mưa **${context.calibrationFactor} mm**), gầu mất thăng bằng và **lật sang ngăn đối diện**.\n` +
        `- Nam châm gắn trên gầu quét qua **cảm biến Hall A3144** (nối chân GPIO 10 của ESP32-S3), kích hoạt ngắt phần cứng (Edge FALLING).\n\n` +
        `### 2. Công thức tính lượng mưa tích lũy\n` +
        `- Lượng mưa (mm) = Số lần lật (Tips) × Hệ số hiệu chuẩn (${context.calibrationFactor} mm/tip)\n` +
        `- Tổng số nhịp hôm nay: **${context.totalTipsToday} lần lật** ➔ **${context.todayRainMm.toFixed(2)} mm**.\n\n` +
        `### 3. Công thức tính cường độ mưa tức thời (Rain Rate)\n` +
        `- Cường độ (mm/h) = 900 / Δt (với Δt là khoảng thời gian tính bằng giây giữa 2 nhịp lật).\n` +
        `- Cửa sổ trượt 5 phút giúp cường độ mưa phản ánh chính xác từng đợt mưa rào mà không bị đột biến ảo.`
      );
    }

    // 4. Khí áp, Bão, Dự báo thời tiết xấu
    if (
      q.includes('bão') ||
      q.includes('khí áp') ||
      q.includes('áp suất') ||
      q.includes('giông') ||
      q.includes('gió') ||
      q.includes('thời tiết xấu') ||
      q.includes('áp thấp')
    ) {
      const pressVal = context.currentPress !== null ? `${context.currentPress.toFixed(1)} hPa` : 'Chưa có dữ liệu';
      return (
        `Áp suất khí quyển là chỉ số nhạy bén hàng đầu để nhận diện sớm thời tiết cực đoan: 🧭\n\n` +
        `### 🧭 Khí áp quan trắc hiện tại: **${pressVal}** (Xu hướng: **${context.pressureTrend}**)\n\n` +
        `### ⚠️ Quy tắc nhận diện thời tiết qua biến thiên áp suất:\n` +
        `- **Khí áp giảm nhanh (ΔP ≤ -3.0 hPa trong 3 giờ):** Cảnh báo rãnh áp thấp hoặc tâm xoáy thuận nhiệt đới / bão đang tiếp cận, khả năng cao kèm gió giật và dông sét mạnh.\n` +
        `- **Khí áp giảm chậm (-1.0 hPa ≥ ΔP > -3.0 hPa):** Mây phát triển, thời tiết có xu hướng chuyển mưa.\n` +
        `- **Khí áp ổn định (-1.0 < ΔP < +1.0 hPa):** Thời tiết giữ trạng thái bình thường, ít xáo trộn.\n` +
        `- **Khí áp tăng mạnh (ΔP ≥ +1.5 hPa):** Không khí lạnh tăng cường tràn về hoặc bão vừa đi qua, thời tiết chuyển khô ráo.\n\n` +
        `Hệ thống RainSense giám sát liên tục từng phút và tự động kích hoạt cảnh báo khi phát hiện áp suất sụt giảm bất thường.`
      );
    }

    // 5. Phần cứng ESP32-S3, Sơ đồ nối chân, Đấu dây
    if (
      q.includes('esp32') ||
      q.includes('nối dây') ||
      q.includes('chân') ||
      q.includes('pinout') ||
      q.includes('gpio') ||
      q.includes('sơ đồ') ||
      q.includes('phần cứng') ||
      q.includes('bme280') ||
      q.includes('lắp ráp')
    ) {
      return (
        `Dưới đây là sơ đồ đấu nối phần cứng chuẩn xác cho trạm **ESP32-S3 RainSense**: 🛠️\n\n` +
        `### 1. Cảm biến Môi trường BME280 & Màn hình OLED SH1106 (I2C)\n` +
        `- **VCC** ➔ Chân **3V3** của ESP32-S3 *(Lưu ý: Không cắm 5V để tránh hỏng cảm biến)*\n` +
        `- **GND** ➔ Chân **GND**\n` +
        `- **SDA** ➔ Chân **GPIO 8**\n` +
        `- **SCL** ➔ Chân **GPIO 9**\n` +
        `- *Tốc độ xung I2C:* Khuyến nghị **100kHz** để đảm bảo tín hiệu ổn định chống nhiễu trên dây cắm breadboard.\n\n` +
        `### 2. Cảm biến đếm xung mưa Hall A3144\n` +
        `- **VCC** ➔ Chân **3V3**\n` +
        `- **GND** ➔ Chân **GND**\n` +
        `- **OUT** ➔ Chân **GPIO 10** *(Cấu hình INPUT_PULLUP, ngắt FALLING)*\n\n` +
        `### 3. Nút Reset lượng mưa phần cứng (BOOT)\n` +
        `- **Nút BOOT** tích hợp trên mạch: Chân **GPIO 0** (nhấn để reset lượng mưa về 0.00 mm).\n\n` +
        `- **Chống dội xung mưa (Debounce):** Firmware đã tích hợp sẵn khóa chống dội phần mềm 200ms (\`DEBOUNCE_DELAY = 200\`) để loại bỏ hoàn toàn các xung rung lắc cơ học của gầu lật.`
      );
    }

    // 6. Firmware & Code nạp
    if (
      q.includes('code') ||
      q.includes('firmware') ||
      q.includes('ino') ||
      q.includes('arduino') ||
      q.includes('nạp') ||
      q.includes('thư viện')
    ) {
      return (
        `Mã nguồn firmware hoàn chỉnh cho ESP32-S3 được quản lý tại file:\n` +
        `👉 \`firmware/IOT_MQTT_TLS/IOT_MQTT_TLS.ino\`\n\n` +
        `### Các thư viện cần cài đặt trong Arduino IDE:\n` +
        `1. **PubSubClient** — Giao tiếp giao thức MQTT.\n` +
        `2. **Adafruit BME280 Library** & **Adafruit Unified Sensor** — Đọc cảm biến môi trường.\n` +
        `3. **Adafruit SH110X** & **Adafruit GFX** — Điều khiển màn hình OLED I2C.\n` +
        `4. **WiFiMulti** & **Preferences** — Tích hợp sẵn trong ESP32 Core (tự động chuyển mạng và lưu hiệu chuẩn Flash).\n\n` +
        `### Quy trình nạp code:\n` +
        `1. Mở file \`IOT_MQTT_TLS.ino\` trong Arduino IDE.\n` +
        `2. Điền danh sách Wi-Fi của bạn vào mảng \`WIFI_NETWORKS[]\`.\n` +
        `3. Chọn board **ESP32S3 Dev Module**, cổng COM tương ứng và bấm **Upload**.`
      );
    }

    // 7. MQTT & EMQX Cloud
    if (
      q.includes('mqtt') ||
      q.includes('emqx') ||
      q.includes('aiven') ||
      q.includes('broker') ||
      q.includes('topic') ||
      q.includes('tls')
    ) {
      return (
        `Hệ thống RainSense vận hành qua **EMQX Cloud MQTT Broker** với chứng chỉ bảo mật TLS (Port 8883): ☁️\n\n` +
        `### Danh sách MQTT Topics của trạm:\n` +
        `- \`weather/station01/data\`: Bản tin telemetry định kỳ mỗi 10s (Nhiệt độ, Độ ẩm, Áp suất, Nhịp mưa, RSSI, Uptime).\n` +
        `- \`weather/station01/status\`: Trạng thái kết nối trực tuyến (online / offline Last Will & Testament).\n\n` +
        `### Cơ chế bảo mật & Đồng bộ:\n` +
        `- Sử dụng mã hóa TLS với chứng chỉ DigiCert Global Root G2 CA.\n` +
        `- Dữ liệu được backend ghi nhận và lưu trữ lâu dài vào cơ sở dữ liệu **Aiven PostgreSQL**.`
      );
    }

    // 8. Trạm Offline / Mất kết nối
    if (
      q.includes('offline') ||
      q.includes('ngoại tuyến') ||
      q.includes('mất kết nối') ||
      q.includes('lỗi') ||
      q.includes('không nhận') ||
      q.includes('tại sao trạm')
    ) {
      return (
        `Nếu trạm quan trắc **${context.deviceId}** đang ở trạng thái **Ngoại tuyến**, vui lòng kiểm tra theo các bước sau: 🔍\n\n` +
        `1. 🔌 **Kiểm tra nguồn điện:** Quan sát đèn LED trên ESP32-S3 có sáng không? Cáp nguồn USB-C có cấp đủ dòng 5V/1A không?\n` +
        `2. 📶 **Kiểm tra kết nối Wi-Fi:** Mạch hỗ trợ Multi-WiFi; hãy kiểm tra xem tên Wi-Fi (SSID) và mật khẩu đã được khai báo chính xác trong mảng \`WIFI_NETWORKS[]\` chưa.\n` +
        `3. ☁️ **Kiểm tra Broker EMQX:** Đảm bảo tài khoản \`MQTT_USERNAME\` và \`MQTT_PASSWORD\` trong firmware khớp với cài đặt trên EMQX Cloud.\n` +
        `4. 💻 **Xem Serial Monitor:** Mở Serial Monitor với baudrate **115200** trong Arduino IDE để xem trực tiếp log thông báo kết nối của ESP32-S3.`
      );
    }

    // 9. Câu trả lời mặc định
    return (
      `Tôi đã nhận được câu hỏi của bạn: *"${query}"*\n\n` +
      `Trạm quan trắc **${context.deviceId}** hiện đang ghi nhận các thông số:\n` +
      `- 🌡️ Nhiệt độ: **${context.currentTemp !== null ? `${context.currentTemp.toFixed(1)}°C` : 'Chờ dữ liệu'}**\n` +
      `- 💧 Độ ẩm: **${context.currentHumid !== null ? `${context.currentHumid.toFixed(1)}%` : 'Chờ dữ liệu'}**\n` +
      `- 🧭 Khí áp: **${context.currentPress !== null ? `${context.currentPress.toFixed(1)} hPa` : 'Chờ dữ liệu'}**\n` +
      `- 🌧️ Lượng mưa hôm nay: **${context.todayRainMm.toFixed(2)} mm** (${context.totalTipsToday} lần lật gầu)\n\n` +
      `Bạn có muốn tôi phân tích chuyên sâu thêm về dữ liệu khí tượng nào, hoặc cần hỗ trợ về kỹ thuật phần cứng ESP32-S3 không?`
    );
  }
}

export const aiService = new AiService();
