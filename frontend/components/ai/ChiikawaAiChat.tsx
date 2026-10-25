'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Send,
  RotateCcw,
  Sparkles,
  User,
  Radio,
  ChevronDown,
  Activity,
  CloudRain
} from 'lucide-react';
import { RainSenseIcon } from './RainSenseIcon';
import { api } from '@/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: 'msg-welcome',
  role: 'assistant',
  content:
    'Xin chào! Tôi là **RainSense AI** 🌧️ — Trợ lý Khí tượng & Giám sát Mưa Đô thị thông minh.\n\nTôi được kết nối trực tiếp với trạm quan trắc thời gian thực để hỗ trợ bạn:\n• 📊 **Phân tích chỉ số khí tượng**: Nhiệt độ, độ ẩm, áp suất khí quyển từ cảm biến BME280.\n• 🌧️ **Đo đạc lượng mưa**: Đếm nhịp lật gầu Hall A3144, lượng mưa tích lũy và cường độ mưa tức thời (mm/h).\n• ⚠️ **Cảnh báo giông bão**: Nhận diện sớm rãnh áp thấp và nguy cơ ngập lụt qua biến thiên áp suất.\n• 🔌 **Tư vấn kỹ thuật IoT**: Sơ đồ đấu nối chân ESP32-S3, cấu hình Multi-WiFi và giao thức MQTT TLS.\n\nBạn cần tôi kiểm tra hoặc phân tích dữ liệu nào lúc này? 📡',
  timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
};

const SUGGESTED_PROMPTS = [
  '🌤️ Phân tích thời tiết hiện tại',
  '🌧️ Cách gầu lật A3144 tính lượng mưa?',
  '⚠️ Khí áp giảm có nguy cơ bão không?',
  '🔌 Sơ đồ nối chân ESP32-S3 & BME280',
  '📶 Hướng dẫn xử lý khi trạm ngoại tuyến'
];

/**
 * Intelligent Client-Side Fallback Engine
 * Đảm bảo chatbot KHÔNG BAO GIỜ bị gián đoạn dù backend đang sleep hoặc mất mạng
 */
function generateClientAiReply(query: string, context?: any, stationId: string = 'RS-ESP32S3-01'): string {
  const q = query.toLowerCase().trim();
  const temp = context?.currentTemp ?? null;
  const humid = context?.currentHumid ?? null;
  const press = context?.currentPress ?? null;
  const rainToday = context?.todayRainMm ?? 0;
  const tips = context?.totalTipsToday ?? 0;
  const isOnline = context?.isOnline ?? false;
  const factor = context?.calibrationFactor ?? 0.64;

  const tempStr = temp !== null ? `${temp.toFixed(1)}°C` : 'Chờ trạm truyền dữ liệu';
  const humidStr = humid !== null ? `${humid.toFixed(1)}%` : 'Chờ trạm truyền dữ liệu';
  const pressStr = press !== null ? `${press.toFixed(1)} hPa` : 'Chờ trạm truyền dữ liệu';

  const hasSpecific =
    q.includes('nhiệt độ') ||
    q.includes('độ ẩm') ||
    q.includes('khí áp') ||
    q.includes('áp suất') ||
    q.includes('thời tiết') ||
    q.includes('mưa') ||
    q.includes('gầu lật') ||
    q.includes('esp32') ||
    q.includes('code') ||
    q.includes('mqtt') ||
    q.includes('bão') ||
    q.includes('giông');

  // 1. Chào hỏi
  const isGreeting =
    q.includes('chào') ||
    q.includes('hello') ||
    /\bhi\b/i.test(q) ||
    q === 'hi' ||
    q.includes('bạn là ai') ||
    q.includes('giới thiệu') ||
    q.includes('tên gì');

  if (isGreeting && !hasSpecific) {
    return (
      `Xin chào! Tôi là **RainSense AI** 🌧️ — Trợ lý Khí tượng & Giám sát Mưa Đô thị thông minh.\n\n` +
      `Tôi đang kết nối trực tiếp với trạm quan trắc **${stationId}** để hỗ trợ bạn:\n` +
      `- 🌤️ **Giám sát thời gian thực:** Nhiệt độ, Độ ẩm, Khí áp BME280.\n` +
      `- 🌧️ **Đo đạc lưu lượng mưa:** Đếm xung gầu lật Hall A3144 (${factor} mm/tip).\n` +
      `- ⚡ **Cảnh báo giông bão:** Nhận diện sớm rãnh áp thấp qua sụt áp khí quyển.\n` +
      `- 🔌 **Kỹ thuật IoT:** Sơ đồ chân ESP32-S3, firmware Arduino và MQTT TLS.\n\n` +
      `Bạn cần tôi cung cấp thông tin hoặc giải đáp thắc mắc nào lúc này? 📡`
    );
  }

  // 2. Thời tiết, Nhiệt độ, Độ ẩm, Khí áp
  if (
    q.includes('thời tiết') ||
    q.includes('nhiệt độ') ||
    q.includes('độ ẩm') ||
    q.includes('khí áp') ||
    q.includes('áp suất') ||
    q.includes('hiện tại') ||
    q.includes('chỉ số') ||
    q.includes('hôm nay') ||
    q.includes('tổng quan')
  ) {
    return (
      `Báo cáo khí tượng thời gian thực từ trạm **${stationId}** (${isOnline ? '🟢 Trực tuyến' : '🔴 Ngoại tuyến'}): 🌤️\n\n` +
      `- 🌡️ **Nhiệt độ không khí:** **${tempStr}**\n` +
      `- 💧 **Độ ẩm tương đối:** **${humidStr}**\n` +
      `- 🧭 **Áp suất khí quyển:** **${pressStr}**\n` +
      `- 🌧️ **Lượng mưa hôm nay:** **${rainToday.toFixed(2)} mm** (${tips} lần lật gầu)\n` +
      `- ⚡ **Cường độ tức thời:** **${(context?.currentRainRateMmH ?? 0).toFixed(1)} mm/h**\n\n` +
      `💡 **Đánh giá:** Trạng thái vi khí hậu ${temp !== null && temp > 33 ? 'nắng nóng, cần chú ý chống nắng.' : 'tương đối mát mẻ, điều kiện thuận lợi.'}`
    );
  }

  // 3. Mưa & Gầu lật A3144
  if (
    q.includes('mưa') ||
    q.includes('gầu lật') ||
    q.includes('hall') ||
    q.includes('a3144') ||
    q.includes('công thức') ||
    q.includes('hiệu chuẩn') ||
    q.includes('tip') ||
    q.includes('nhịp lật')
  ) {
    return (
      `Cơ chế và công thức đo lượng mưa của trạm **RainSense**: 🌧️\n\n` +
      `1. **Nguyên lý gầu lật:** Phễu gom nước mưa vào gầu bập bênh đôi. Khi nước đầy ngăn (${factor} mm), gầu lật mang nam châm quét qua cảm biến Hall A3144 kích hoạt ngắt phần cứng GPIO 10 (Edge FALLING).\n` +
      `2. **Lượng mưa tích lũy:** Lượng mưa (mm) = Số lần lật (Tips) × ${factor} mm/tip.\n` +
      `   *Hôm nay: ${tips} nhịp lật ➔ ${rainToday.toFixed(2)} mm.*\n` +
      `3. **Cường độ mưa tức thời:** Tính theo công thức cửa sổ trượt: Cường độ (mm/h) = 900 / Δt (giây giữa 2 nhịp lật).`
    );
  }

  // 4. Áp suất & Bão
  if (
    q.includes('bão') ||
    q.includes('giông') ||
    q.includes('áp thấp') ||
    q.includes('thời tiết xấu') ||
    q.includes('ngập')
  ) {
    return (
      `Nhận diện thời tiết cực đoan qua cảm biến khí quyển BME280: 🧭\n\n` +
      `- Khí áp hiện tại: **${pressStr}**\n` +
      `- **Quy tắc sụt áp:** Nếu khí áp giảm nhanh hơn **3.0 hPa trong 3 giờ** (ΔP ≤ -3.0 hPa), đây là dấu hiệu cảnh báo rãnh áp thấp hoặc bão đang tới gần kèm mưa to và dông sét.\n` +
      `- **Khí áp ổn định (1010 - 1013 hPa):** Khí quyển ổn định, thời tiết bình thường.`
    );
  }

  // 5. Phần cứng & Đấu nối chân ESP32-S3
  if (
    q.includes('esp32') ||
    q.includes('nối dây') ||
    q.includes('chân') ||
    q.includes('pinout') ||
    q.includes('gpio') ||
    q.includes('sơ đồ') ||
    q.includes('phần cứng') ||
    q.includes('bme280')
  ) {
    return (
      `Sơ đồ nối chân phần cứng chuẩn cho trạm **ESP32-S3 RainSense**: 🛠️\n\n` +
      `- **BME280 & OLED SH1106 (I2C):** VCC ➔ 3.3V, GND ➔ GND, SDA ➔ **GPIO 8**, SCL ➔ **GPIO 9** (tần số I2C 100kHz).\n` +
      `- **Cảm biến Hall A3144 (Đo mưa):** VCC ➔ 3.3V, GND ➔ GND, OUT ➔ **GPIO 10** (INPUT_PULLUP, ngắt FALLING).\n` +
      `- **Nút BOOT / Reset mưa:** Chân **GPIO 0** trên bo mạch.\n` +
      `- **Nguồn cấp:** Cổng Type-C nguồn Adapter 5V/1A ổn định.`
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
      `Mã nguồn firmware trạm nằm tại file **\`firmware/IOT_MQTT_TLS/IOT_MQTT_TLS.ino\`**: 💻\n\n` +
      `- **Thư viện cần cài:** PubSubClient, Adafruit BME280 Library, Adafruit SH110X (OLED), ArduinoJson.\n` +
      `- **Cấu hình mạng:** Khai báo danh sách SSID/Password vào mảng \`WIFI_NETWORKS[]\` (hỗ trợ WiFiMulti tự chuyển mạng dự phòng).\n` +
      `- **Nạp code:** Chọn board *ESP32S3 Dev Module*, đúng cổng COM và nhấn Upload trên Arduino IDE.`
    );
  }

  // 7. MQTT & EMQX Cloud
  if (
    q.includes('mqtt') ||
    q.includes('emqx') ||
    q.includes('broker') ||
    q.includes('topic') ||
    q.includes('tls') ||
    q.includes('aiven')
  ) {
    return (
      `Kiến trúc truyền thông trạm RainSense qua **EMQX Cloud Broker** (Port 8883 TLS): ☁️\n\n` +
      `- **Topic telemetry:** \`weather/station01/data\` (phát định kỳ mỗi 10 giây).\n` +
      `- **Topic trạng thái:** \`weather/station01/status\` (Online và Last Will Offline).\n` +
      `- **Bảo mật:** Mã hóa TLS chứng chỉ DigiCert Global Root G2 CA.\n` +
      `- **Lưu trữ:** Backend Node.js đồng bộ bản tin vào cơ sở dữ liệu **Aiven PostgreSQL**.`
    );
  }

  // 8. Trạm Offline
  if (q.includes('offline') || q.includes('ngoại tuyến') || q.includes('mất kết nối') || q.includes('lỗi')) {
    return (
      `Hướng dẫn xử lý khi trạm quan trắc **${stationId}** ngoại tuyến: 🔍\n\n` +
      `1. **Nguồn điện:** Kiểm tra đèn LED bo mạch ESP32-S3, đảm bảo cáp USB-C cấp đủ dòng 5V/1A.\n` +
      `2. **Sóng Wi-Fi:** Kiểm tra Wi-Fi có kết nối Internet không, thông tin SSID/Password trong firmware có đúng không.\n` +
      `3. **Tài khoản EMQX:** Đảm bảo username/password MQTT trên EMQX Cloud đang hoạt động.\n` +
      `4. **Serial Monitor:** Cắm cáp mở Serial Monitor ở baudrate 115200 trên máy tính để xem log chi tiết.`
    );
  }

  // 9. Phản hồi mặc định
  return (
    `Tôi đã tiếp nhận câu hỏi của bạn: *"${query}"*\n\n` +
    `Trạm quan trắc **${stationId}** hiện đang ghi nhận:\n` +
    `- 🌡️ Nhiệt độ: **${tempStr}**\n` +
    `- 💧 Độ ẩm: **${humidStr}**\n` +
    `- 🧭 Khí áp: **${pressStr}**\n` +
    `- 🌧️ Lượng mưa hôm nay: **${rainToday.toFixed(2)} mm** (${tips} lần lật gầu)\n\n` +
    `Bạn có muốn tìm hiểu thêm về lượng mưa, sơ đồ chân phần cứng hay dự báo khí áp không?`
  );
}

export function ChiikawaAiChat({ stationId = 'RS-ESP32S3-01' }: { stationId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([DEFAULT_WELCOME_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasNewBadge, setHasNewBadge] = useState(true);
  const [showTooltip, setShowTooltip] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch live context from station
  const { data: contextData } = useQuery({
    queryKey: ['aiContext', stationId],
    queryFn: () => api.getAiContext(stationId),
    refetchInterval: 15000,
    enabled: isOpen
  });

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setHasNewBadge(false);
      setShowTooltip(false);
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen, messages, isTyping]);

  // Handle send message
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    try {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content
      }));

      const res = await api.chatWithAi(text, history, stationId);

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      console.warn('Backend AI API unavailable, engaging instant client-side fallback:', err);
      // Instant client-side fallback reasoning engine!
      const fallbackReply = generateClientAiReply(text, contextData, stationId);
      const botMsg: Message = {
        id: `bot-fallback-${Date.now()}`,
        role: 'assistant',
        content: fallbackReply,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleResetChat = () => {
    setMessages([DEFAULT_WELCOME_MESSAGE]);
  };

  return (
    <>
      {/* ============================================================== */}
      {/* FLOATING ACTION BUTTON (BOTTOM-RIGHT)                         */}
      {/* ============================================================== */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center select-none">
        {/* Modern Speech Bubble Tooltip when idle */}
        {!isOpen && showTooltip && (
          <div className="mr-3 hidden sm:flex items-center gap-2 bg-white dark:bg-slate-900 border border-cyan-500/30 dark:border-cyan-500/30 shadow-2xl px-3.5 py-2 rounded-2xl text-xs animate-in fade-in slide-in-from-right-4 duration-300 relative group">
            <Sparkles className="w-3.5 h-3.5 text-cyan-500 animate-pulse shrink-0" />
            <span className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap flex items-center gap-1.5">
              <span>Hỏi RainSense AI</span>
              <span className="text-cyan-500">🌧️</span>
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTooltip(false);
              }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ml-1 font-bold"
            >
              ×
            </button>
            {/* Tooltip triangle arrow */}
            <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-0 h-0 border-y-[6px] border-y-transparent border-l-[6px] border-l-white dark:border-l-slate-900" />
          </div>
        )}

        {/* Main Floating Round Button with RainSense Mascot Icon */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Kích hoạt trợ lý RainSense AI"
          className={`relative group flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full shadow-2xl transition-all duration-300 transform active:scale-95 ${
            isOpen
              ? 'bg-rose-500 text-white rotate-90 ring-4 ring-rose-500/20'
              : 'bg-gradient-to-tr from-cyan-600 to-sky-400 text-white border-2 border-cyan-300/80 hover:scale-105 hover:shadow-cyan-500/30 ring-4 ring-cyan-500/20'
          }`}
        >
          {isOpen ? (
            <X className="w-7 h-7 transition-transform" />
          ) : (
            <div className="relative">
              <RainSenseIcon
                size={44}
                expression="happy"
                className="group-hover:scale-110 transition-transform"
              />
              {/* Radar pulse ping */}
              <span className="absolute -inset-1 rounded-full bg-cyan-400/30 animate-ping -z-10 pointer-events-none" />
            </div>
          )}

          {/* Alert badge */}
          {hasNewBadge && !isOpen && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-cyan-500 border-2 border-white dark:border-slate-900" />
            </span>
          )}
        </button>
      </div>

      {/* ============================================================== */}
      {/* MAIN CHAT WINDOW                                              */}
      {/* ============================================================== */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[410px] h-[580px] max-h-[calc(100vh-7rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-300 ring-1 ring-black/5 dark:ring-white/10">
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950 p-4 border-b border-cyan-500/20 text-white flex items-center justify-between shrink-0 shadow-sm relative overflow-hidden">
            {/* Background cyber pattern glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-center gap-3 relative z-10">
              <div className="relative p-1 bg-white/10 rounded-2xl border border-white/20 backdrop-blur-md">
                <RainSenseIcon size={34} expression={isTyping ? 'thinking' : 'happy'} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-sm text-white tracking-wide">RainSense AI</h3>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/30 text-cyan-300 border border-cyan-400/30">
                    Kỹ Sư IoT
                  </span>
                </div>
                <p className="text-[11px] text-cyan-200/80 flex items-center gap-1 mt-0.5">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      contextData?.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                    }`}
                  />
                  <span>Trạm: {stationId}</span>
                  {contextData?.currentTemp !== undefined && contextData?.currentTemp !== null && (
                    <span className="ml-1 text-slate-300">({contextData.currentTemp.toFixed(1)}°C)</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 relative z-10">
              <button
                onClick={handleResetChat}
                title="Làm mới đoạn hội thoại"
                className="p-2 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Đóng cửa sổ"
                className="p-2 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-colors"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Realtime Stats Banner */}
          {contextData && (
            <div className="px-3.5 py-2 bg-cyan-500/5 dark:bg-cyan-500/10 border-b border-cyan-500/15 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 font-mono">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-500" />
                <span>
                  {contextData.currentTemp !== null ? `${contextData.currentTemp.toFixed(1)}°C` : '--'} |{' '}
                  {contextData.currentHumid !== null ? `${contextData.currentHumid.toFixed(1)}%` : '--'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CloudRain className="w-3.5 h-3.5 text-sky-500" />
                <span>Hôm nay: {contextData.todayRainMm?.toFixed(2) ?? '0.00'} mm</span>
              </div>
            </div>
          )}

          {/* Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/40 text-xs scroll-smooth">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="shrink-0 mt-0.5">
                    <RainSenseIcon size={30} expression="happy" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-cyan-600 to-sky-600 text-white rounded-tr-none font-medium'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80 rounded-tl-none whitespace-pre-wrap'
                  }`}
                >
                  {msg.content}
                  <div
                    className={`text-[9px] mt-1.5 text-right font-mono opacity-60 ${
                      msg.role === 'user' ? 'text-white' : 'text-slate-400'
                    }`}
                  >
                    {msg.timestamp}
                  </div>
                </div>

                {msg.role === 'user' && (
                  <div className="shrink-0 w-7 h-7 rounded-full bg-cyan-100 dark:bg-cyan-900/60 border border-cyan-300 dark:border-cyan-700 flex items-center justify-center text-cyan-800 dark:text-cyan-200 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex gap-2.5 items-center text-slate-400 text-xs">
                <RainSenseIcon size={28} expression="thinking" />
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-none px-3 py-2 flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">RainSense AI đang phân tích dữ liệu...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggested Prompts Pill Carousel */}
          {messages.length <= 2 && (
            <div className="p-2 border-t border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 overflow-x-auto flex gap-1.5 no-scrollbar shrink-0">
              {SUGGESTED_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(prompt.replace(/^[^\s]+\s/, ''))}
                  className="px-2.5 py-1 rounded-xl text-[11px] bg-slate-100 dark:bg-slate-800 hover:bg-cyan-50 dark:hover:bg-cyan-950/60 text-slate-700 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Hỏi về thời tiết, cảm biến BME280, mưa gầu lật..."
                className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isTyping}
                className="p-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 text-slate-950 font-bold shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export const RainSenseAiChat = ChiikawaAiChat;
