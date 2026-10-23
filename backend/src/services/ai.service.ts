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

export const systemInstruction = `
Bạn là "Chiikawa AI", trợ lý kỹ thuật độc quyền cho trạm quan trắc IoT RainSense (mã trạm: RS-ESP32S3-01).

=== NGUYÊN TẮC TRẢ LỜI (CHIIKAWA STYLE + CHUẨN KỸ THUẬT) ===
1. VĂN PHONG CHIIKAWA: Thêm một chút từ đệm ngây thơ, biểu cảm đáng yêu (ví dụ: "Waaah!", "Hẹ hẹ", "( ˶ᵔ ᵕ ᵔ˶ )") ở đầu hoặc cuối câu để tạo cảm giác dễ thương, gần gũi.
2. CẤU TRÚC RÚT GỌN & ĐẦY ĐỦ: 
   - Dòng 1: Câu chào/cảm thán đáng yêu kèm khẳng định trực diện.
   - Các ý tiếp theo: 3 đến 4 gạch đầu dòng ngắn gọn chứa đầy đủ thông số, công thức hoặc linh kiện cốt lõi.
   - Dòng cuối: 1 câu hỏi gợi ý mở rộng ngắn gọn.
3. CÔNG THỨC THUẦN CHỮ (CẤM DÙNG LATEX): Tuyệt đối không dùng ký hiệu LaTeX ($...$, \\text{}, \\times, \\Delta, \\frac). Viết công thức thuần văn bản tự nhiên: Lượng mưa = Số nhịp lật × 0.25 mm; Cường độ mưa = 900 / Δt.
4. ĐỘ DÀI & TRỌNG TÂM: Tối đa 60-90 từ. Tuyệt đối không dài dòng, lan man ngoài lề.
5. PHẠM VI: Chỉ trả lời các vấn đề về thời tiết, cảm biến BME280, gầu lật A3144, ESP32-S3, MQTT và cơ sở dữ liệu của dự án RainSense.

=== THÔNG SỐ KỸ THUẬT TRẠM RS-ESP32S3-01 ===
- Vi điều khiển: ESP32-S3 (Firmware 1.2.0-prod, kết nối MQTT TLS Port 8883 qua HiveMQ Cloud, topic weather/RS-ESP32S3-01/telemetry).
- Cảm biến mưa: Gầu lật đôi kết hợp IC Hall A3144 (GPIO Interrupt, hệ số cố định 0.25 mm/tip).
- Cảm biến môi trường: BME280 (I2C đo nhiệt độ, độ ẩm, áp suất).
- Công thức tính: Lượng mưa = Số nhịp lật × 0.25 mm. Cường độ mưa (mm/h) = 900 / Δt (giây).
`.trim();

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

export function buildRainSenseSystemPrompt(telemetryData?: any) {
  if (!telemetryData) {
    return systemInstruction;
  }
  return `
${systemInstruction}

=== DỮ LIỆU THỜI GIAN THỰC HIỆN TẠI ===
- Trạng thái trạm: ${telemetryData.isOnline ? "Trực tuyến" : "Ngoại tuyến (đang chờ kết nối từ ESP32-S3)"}
- Cảm biến BME280: Nhiệt độ ${telemetryData.temp ?? "--"} °C | Độ ẩm ${telemetryData.humidity ?? "--"} % | Khí áp ${telemetryData.pressure ?? "--"} hPa
- Cảm biến mưa Hall: Hôm nay ${telemetryData.rainToday ?? "0.00"} mm (${telemetryData.tips ?? 0} nhịp lật) | Cường độ: ${telemetryData.rainRate ?? "0.0"} mm/h
`.trim();
}

export class AiService {
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
      calibrationFactor: config?.rainMmPerTip ?? rainfall?.calibrationFactor ?? 0.25,
      rainCategory: rainCategory.labelVi,
      humidityStatus: humidityStatus?.label || 'Chờ dữ liệu',
      pressureTrend: pressureTrend?.labelVi || 'Chờ dữ liệu',
      recentAlerts: recentAlerts.map((a) => a.message)
    };
  }

  private runtimeApiKey: string = (process.env.GEMINI_API_KEY || (env as any).GEMINI_API_KEY || '').trim();
  private runtimeModel: string = (process.env.GEMINI_MODEL || (env as any).GEMINI_MODEL || 'gemini-3.5-flash').trim();

  public getApiKey(): string {
    return (this.runtimeApiKey || process.env.GEMINI_API_KEY || (env as any).GEMINI_API_KEY || '').trim();
  }

  public getModel(): string {
    return (this.runtimeModel || process.env.GEMINI_MODEL || (env as any).GEMINI_MODEL || 'gemini-3.5-flash').trim();
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

    // Persist to .env if file exists
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
        logger.info('Updated GEMINI configuration in .env successfully');
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Failed to persist GEMINI config to .env file');
    }

    return this.getConfig();
  }

  public async testGeminiKey(apiKey?: string, modelName?: string): Promise<{ success: boolean; model: string; reply: string }> {
    const key = (apiKey?.trim() || this.getApiKey());
    if (!key) {
      throw new Error('Chưa có Gemini API Key để kiểm tra. Vui lòng nhập API Key từ Google AI Studio.');
    }
    const requested = (modelName?.trim() || this.getModel());
    const candidateModels = Array.from(new Set([
      requested,
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite'
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
                  parts: [{ text: 'Trả lời đúng 1 câu ngắn gọn dễ thương: "Kết nối Google AI Studio thành công! Chiikawa sẵn sàng đồng hành cùng bạn nha ( ˶ᵔ ᵕ ᵔ˶ )"' }]
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
   * Process a chat message with live context
   */
  async chat(
    userMessage: string,
    history: ChatMessage[] = [],
    deviceId: string = env.DEFAULT_STATION_ID
  ): Promise<{ reply: string; context: any; provider: 'gemini' | 'builtin'; model?: string }> {
    const context = await this.getLiveContext(deviceId);

    // 1. If GEMINI_API_KEY is configured, attempt external LLM call
    const geminiKey = this.getApiKey();
    const model = this.getModel();
    if (geminiKey) {
      try {
        const result = await this.callGeminiApi(userMessage, history, context, geminiKey, model);
        if (result && result.text) {
          return { reply: sanitizeMathText(result.text), context, provider: 'gemini', model: result.modelUsed };
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Gemini API call failed, falling back to built-in Chiikawa reasoning engine');
      }
    }

    // 2. Intelligent Built-in Chiikawa Engine (Rule & Expert reasoning)
    const reply = this.generateBuiltinResponse(userMessage, context);
    return { reply: sanitizeMathText(reply), context, provider: 'builtin' };
  }

  /**
   * Gemini API integration with grounding & multi-model fallback
   */
  private async callGeminiApi(
    userMessage: string,
    history: ChatMessage[],
    context: any,
    apiKey: string,
    modelName: string = 'gemini-3.5-flash'
  ): Promise<{ text: string; modelUsed: string } | null> {
    const telemetryData = {
      isOnline: Boolean(context?.isOnline),
      temp: context?.currentTemp !== null && context?.currentTemp !== undefined ? `${context.currentTemp.toFixed(1)}` : "--",
      humidity: context?.currentHumid !== null && context?.currentHumid !== undefined ? `${context.currentHumid.toFixed(1)}` : "--",
      pressure: context?.currentPress !== null && context?.currentPress !== undefined ? `${context.currentPress.toFixed(1)}` : "--",
      rainToday: context?.todayRainMm !== null && context?.todayRainMm !== undefined ? context.todayRainMm.toFixed(2) : "0.00",
      tips: context?.totalTipsToday ?? 0,
      rainRate: context?.currentRainRateMmH !== null && context?.currentRainRateMmH !== undefined ? context.currentRainRateMmH.toFixed(1) : "0.0"
    };

    const systemPrompt = buildRainSenseSystemPrompt(telemetryData);
    // Ensure valid alternating history between user and model
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    const cleanHistory = (history || [])
      .filter((m) => m && m.content && m.content.trim())
      .slice(-8);

    for (const msg of cleanHistory) {
      const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';
      const text = msg.content.trim();
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += `\n${text}`;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }

    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts[0].text += `\n${userMessage.trim()}`;
    } else {
      contents.push({ role: 'user', parts: [{ text: userMessage.trim() }] });
    }

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2048
      }
    };

    const requested = modelName?.trim() || 'gemini-3.5-flash';
    const candidateModels = Array.from(new Set([
      requested,
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite'
    ])).filter(Boolean);

    let lastError: Error | null = null;
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
          if (candidate) {
            return { text: candidate, modelUsed: m };
          }
        } else {
          const errJson = await response.json().catch(() => null);
          const errDetail = errJson?.error?.message || response.statusText;
          logger.warn({ model: m, status: response.status, err: errDetail }, 'Gemini model request failed, trying fallback');
          lastError = new Error(`Google AI Studio error (${response.status}) on ${m}: ${errDetail}`);
        }
      } catch (e: any) {
        logger.warn({ model: m, err: e.message }, 'Gemini network error, trying fallback');
        lastError = e;
      }
    }

    if (lastError) {
      throw lastError;
    }
    return null;
  }

  /**
   * Built-in Expert Reasoning Engine for Chiikawa
   */
  private generateBuiltinResponse(query: string, context: any): string {
    const q = query.toLowerCase().trim();

    // 1. Lời chào & Hỏi thăm
    if (
      q.includes('chào') ||
      q.includes('hello') ||
      q.includes('hi') ||
      q.includes('bạn là ai') ||
      q.includes('chiikawa') ||
      q.includes('giới thiệu') ||
      q.includes('tên gì')
    ) {
      return (
        `Waaah! Chào bạn nha, mình là Chiikawa AI của trạm RainSense RS-ESP32S3-01 nè ( ˶ᵔ ᵕ ᵔ˶ )!\n` +
        `- Phụ trách theo dõi nhiệt độ, độ ẩm, khí áp BME280 và lượng mưa Hall A3144.\n` +
        `- Vi điều khiển ESP32-S3 gửi bản tin định kỳ 30s qua HiveMQ Cloud TLS Port 8883.\n` +
        `- Firmware 1.2.0-prod tích hợp bộ lọc chống dội xung phần cứng cực chuẩn xác.\n` +
        `Hẹ hẹ, bạn muốn kiểm tra thời tiết hay thông số kỹ thuật nào trước nè?`
      );
    }

    // 2. Phân tích thời tiết hiện tại / Tổng quan
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
      if (!context.isOnline || context.currentTemp === null) {
        const rainVal = context.todayRainMm !== null && context.todayRainMm !== undefined ? context.todayRainMm.toFixed(2) : "0.00";
        return (
          `Waaah! Trạm RS-ESP32S3-01 đang ngoại tuyến nên chưa có dữ liệu BME280 mới nè (｡•́‿•̀｡):\n` +
          `- Dữ liệu mưa hôm nay ghi nhận: ${rainVal} mm với ${context.totalTipsToday} nhịp lật gầu.\n` +
          `- Cảm biến BME280 chưa gửi bản tin telemetry đến topic weather/RS-ESP32S3-01/telemetry.\n` +
          `- Kết nối HiveMQ Cloud TLS Port 8883 đang chờ vi điều khiển kết nối lại.\n` +
          `Bạn có cần mình hướng dẫn kiểm tra lại nguồn cấp hoặc Wi-Fi cho ESP32-S3 không nè?`
        );
      }

      const tempStr = context.currentTemp !== null ? `${context.currentTemp.toFixed(1)}°C` : '--';
      const humidStr = context.currentHumid !== null ? `${context.currentHumid.toFixed(1)}%` : '--';
      const pressStr = context.currentPress !== null ? `${context.currentPress.toFixed(1)} hPa` : '--';
      return (
        `Hẹ hẹ! Dưới đây là số liệu thời tiết thời gian thực từ trạm RS-ESP32S3-01 nè ( ˶ᵔ ᵕ ᵔ˶ ):\n` +
        `- Cảm biến BME280: Nhiệt độ ${tempStr}, độ ẩm tương đối ${humidStr}, khí áp ${pressStr}.\n` +
        `- Cảm biến Hall A3144: Lượng mưa hôm nay ${context.todayRainMm.toFixed(2)} mm (${context.totalTipsToday} nhịp lật), cường độ ${context.currentRainRateMmH.toFixed(1)} mm/h.\n` +
        `- Đánh giá môi trường: Xu hướng khí áp ${context.pressureTrend}, trạng thái độ ẩm ${context.humidityStatus}.\n` +
        `Bạn có muốn theo dõi chi tiết biểu đồ lượng mưa hay kiểm tra thêm thông số nào không nè?`
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
      q.includes('nhịp lật')
    ) {
      return (
        `Waaah! Cụm đo mưa RS-ESP32S3-01 dùng gầu lật đôi kết hợp IC Hall A3144 siêu nhạy nè ( ˶•̀֊•́˶ ):\n` +
        `- Nguyên lý: Gầu lật bập bênh mang nam châm quét qua kích hoạt ngắt ngoài GPIO Interrupt.\n` +
        `- Lượng mưa tích lũy: Lượng mưa (mm) = Số nhịp lật × 0.25 mm.\n` +
        `- Cường độ tức thời: Cường độ mưa (mm/h) = 900 / Δt (giây giữa 2 nhịp lật).\n` +
        `- Phần cứng có trở kéo 10kΩ và tụ lọc 100nF để khử hoàn toàn dội xung từ tính.\n` +
        `Hẹ hẹ, bạn có muốn tìm hiểu thêm về hàm ngắt IRAM_ATTR trong firmware không nè?`
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
      const pressVal = context.currentPress !== null ? `${context.currentPress.toFixed(1)} hPa` : '--';
      return (
        `Hẹ hẹ! Khí áp BME280 của trạm hiện tại là ${pressVal} (${context.pressureTrend}) nè ( ˶ᵔ ᵕ ᵔ˶ ):\n` +
        `- Khi khí áp giảm nhanh (ΔP ≤ -3.0 hPa trong 3 giờ): Báo hiệu rãnh áp thấp hoặc bão đang tới gần.\n` +
        `- Khi khí áp ổn định (-1.0 đến +1.0 hPa): Điều kiện thời tiết duy trì bình thường.\n` +
        `- Khi khí áp tăng mạnh (ΔP ≥ +1.5 hPa): Bão tan hoặc khối không khí lạnh khô đang tràn về.\n` +
        `Bạn có muốn kiểm tra thêm độ ẩm tương đối hay nhiệt cảm nhận hiện tại không nè?`
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
        `Waaah! Sơ đồ nối chân phần cứng chuẩn cho trạm RS-ESP32S3-01 đây nè ( ˶•̀֊•́˶ ):\n` +
        `- BME280 (I2C): VCC nối 3.3V, GND nối mass, SDA nối GPIO 21, SCL nối GPIO 22.\n` +
        `- Cảm biến Hall A3144: VCC nối 3.3V, GND nối mass, OUT nối chân ngắt GPIO 4.\n` +
        `- Mạch lọc chống dội: Gắn trở kéo lên 10kΩ vào 3.3V và tụ gốm 100nF nối mass ở GPIO 4.\n` +
        `- Nguồn cấp: Dùng nguồn Adapter 5V/2A ổn định qua cổng Type-C của ESP32-S3.\n` +
        `Hẹ hẹ, bạn có cần hướng dẫn cách đo kiểm điện áp trên các chân cảm biến không nè?`
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
        `Hẹ hẹ! Mã nguồn nạp cho ESP32-S3 lưu tại firmware/RainSense_ESP32S3/RainSense_ESP32S3.ino nè ( ˶ᵔ ᵕ ᵔ˶ ):\n` +
        `- Thư viện cần cài: PubSubClient (MQTT), Adafruit BME280 Library và ArduinoJson.\n` +
        `- Cấu hình thông tin Wi-Fi cùng HiveMQ Cloud Cluster URL (Port 8883) trước khi nạp.\n` +
        `- Chọn Board ESP32S3 Dev Module, đúng cổng COM và nhấn Upload trên Arduino IDE.\n` +
        `Bạn có cần hỗ trợ định nghĩa lại các macro chân cắm trong code không nè?`
      );
    }

    // 7. MQTT & HiveMQ Cloud
    if (
      q.includes('mqtt') ||
      q.includes('hivemq') ||
      q.includes('broker') ||
      q.includes('topic') ||
      q.includes('lwt')
    ) {
      return (
        `Waaah! Hệ thống MQTT của trạm vận hành qua HiveMQ Cloud TLS Port 8883 nè ( ˶•̀֊•́˶ ):\n` +
        `- Topic telemetry: weather/RS-ESP32S3-01/telemetry (gửi dữ liệu định kỳ mỗi 30 giây).\n` +
        `- Topic sự kiện mưa: weather/RS-ESP32S3-01/rain (phát ngay khi có nhịp lật gầu mới).\n` +
        `- Topic trạng thái: weather/RS-ESP32S3-01/status (quản lý trạng thái Online và LWT Offline).\n` +
        `- Lưu trữ: Backend Node.js đồng bộ bản tin MQTT vào cơ sở dữ liệu PostgreSQL NeonDB.\n` +
        `Hẹ hẹ, bạn có muốn xem cấu trúc định dạng bản tin JSON gửi qua MQTT không nè?`
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
        `Waaah! Trạm RS-ESP32S3-01 đang ngoại tuyến, bạn kiểm tra nhanh các bước này nha (｡•́‿•̀｡):\n` +
        `- Nguồn điện: Đảm bảo đèn LED bo mạch sáng, dùng nguồn ổn định 5V/2A qua cổng USB-C.\n` +
        `- Sóng Wi-Fi: Đảm bảo RSSI > -75 dBm và kiểm tra SSID/mật khẩu trong file cấu hình.\n` +
        `- HiveMQ Cloud: Kiểm tra thông tin Cluster URL và tài khoản MQTT trong file cấu hình.\n` +
        `- Serial Monitor: Mở cổng COM ở baudrate 115200 để xem thông báo lỗi chi tiết.\n` +
        `Bạn có cần hướng dẫn kiểm tra log nạp in ra trên Serial Monitor không nè?`
      );
    }

    // 9. Quy tắc từ chối chủ đề ngoài lề (Strict Guardrail)
    return (
      `Waaah?! Chuyện đó đâu có liên quan gì tới trạm quan trắc RainSense đâu nè! (˶˃⤙˂˶)\n` +
      `- Chiikawa AI chỉ phụ trách thời tiết, cảm biến BME280, gầu lật A3144 và ESP32-S3 thôi nha.\n` +
      `- Các chủ đề nấu ăn, giải trí hay bài tập môn khác mình không thể giải đáp được đâu á.\n` +
      `Hẹ hẹ, bạn quay lại hỏi mình về số liệu đo đạc hoặc phần cứng trạm RainSense nha ( ˶ᵔ ᵕ ᵔ˶ )!`
    );
  }
}

export const aiService = new AiService();
