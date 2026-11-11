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
import { useDemo } from '@/app/providers';
import { generateRainSenseReply, normalizeStationContext } from '@/lib/rainsense-ai';
import { rainMonitorQuestion, rainMonitorReply } from '@/shared/rain-monitor-chat';
import type { ChatMetadata } from '@/shared/ai-types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: ChatMetadata;
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: 'msg-welcome',
  role: 'assistant',
  content:
    'Mình là RainSense AI, hỗ trợ chuyên sâu về mạch, gầu lật và khí tượng của dự án. Mình trả lời ngắn theo câu hỏi; thêm “giải thích chi tiết” khi bạn muốn tìm hiểu sâu.',
  timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
};

const SUGGESTED_PROMPTS = [
  '🌤️ Phân tích thời tiết hiện tại',
  '🔧 Dự án hiện dùng cảm biến nào?',
  '🧲 Gầu lật, phễu và Hall phối hợp thế nào?',
  '💧 Vì sao nhiệt độ giảm nhưng RH tăng?',
  '📊 Nhiệt độ, độ ẩm, áp suất và lượng mưa trong 1 tiếng',
  '📐 Hiệu chuẩn 100 ml, diện tích 100 cm², 20 nhịp thì hệ số bao nhiêu?',
  '🌦️ Dự báo thời tiết ngày mai tại trạm',
  '🌧️ Ước tính lượng mưa 60 phút tới',
  '🔔 Trạm có cảnh báo mưa không?',
  '📶 Từ nước mưa đến biểu đồ web hoạt động như thế nào?',
  '🔌 Điện trở kéo lên I2C có tác dụng gì?',
  '🔍 Áp suất 1013 hPa có chắc trời đẹp không?'
];

export function ChiikawaAiChat({ stationId = 'RS-ESP32S3-01' }: { stationId?: string }) {
  const { isDemoMode } = useDemo();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([DEFAULT_WELCOME_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasNewBadge, setHasNewBadge] = useState(true);
  const [showTooltip, setShowTooltip] = useState(true);
  const generation = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    generation.current++;
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    setIsTyping(false);
    setInputValue('');
    return () => { generation.current++; };
  }, [stationId, isDemoMode]);

  // Fetch live context from station
  const { data: contextData } = useQuery({
    queryKey: ['aiContext', stationId],
    queryFn: () => api.getAiContext(stationId),
    refetchInterval: 15000,
    enabled: isOpen
  });
  const latestMetadata = [...messages].reverse().find((m) => m.metadata)?.metadata;
  const localKnowledgeOnly = latestMetadata?.mode === 'knowledge' || latestMetadata?.mode === 'fallback' || !latestMetadata && contextData?.capabilities?.languageModelConfigured === false;
  const modeLabel = latestMetadata?.mode === 'llm' ? 'AI kết nối' : latestMetadata?.mode === 'knowledge' ? 'Kiến thức dự án' : latestMetadata?.mode === 'calculation' ? 'Tính toán' : latestMetadata?.mode === 'analysis' ? 'Báo cáo số đo' : latestMetadata?.mode === 'forecast' ? 'Nguồn dự báo' : latestMetadata?.mode === 'fallback' ? 'Dự phòng' : localKnowledgeOnly ? 'Kiến thức dự án' : 'Sẵn sàng';
  const observedAge = contextData?.observedAt ? Date.now() - Date.parse(contextData.observedAt) : NaN;
  const fresh = contextData?.dataQuality?.fresh ?? (contextData?.isOnline && Number.isFinite(observedAge) && observedAge >= -60000 && observedAge <= 300000);

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
    const requestGeneration = ++generation.current;

    try {
      const history = messages.filter((m) => m.id !== 'msg-welcome').slice(-8).map((m) => ({
        role: m.role,
        content: m.content
      }));

      const res = await api.chatWithAi(text, history, stationId, isDemoMode);
      if (requestGeneration !== generation.current) return;

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        metadata: res.metadata,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      if (requestGeneration !== generation.current) return;
      const requestError = err?.status === 400 || err?.status === 429;
      const monitoringIntent = requestError ? null : rainMonitorQuestion(text);
      const snapshot = monitoringIntent ? await api.getRainMonitor(stationId, isDemoMode).catch(() => null) : null;
      if (requestGeneration !== generation.current) return;
      const content = requestError ? err.message : monitoringIntent
        ? snapshot ? rainMonitorReply(snapshot, monitoringIntent) : 'Chưa đọc được dữ liệu cảnh báo mưa của trạm.'
        : generateRainSenseReply(text, normalizeStationContext(contextData, stationId), messages.filter((m) => m.id !== 'msg-welcome'));
      const errorMsg: Message = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content,
        metadata: { mode: snapshot ? 'analysis' : 'fallback', provider: 'local', model: null, generatedAt: new Date().toISOString(), fallbackReason: requestError || snapshot ? undefined : 'backend_unavailable', sources: [] },
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      if (requestGeneration === generation.current) setIsTyping(false);
    }
  };

  const handleResetChat = () => {
    generation.current++;
    setIsTyping(false);
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
              <span className="relative inline-flex rounded-full h-4 w-4 bg-cyan-500 border-2 border-white dark:border-slate-900 text-[9px] font-bold text-white items-center justify-center">
                !
              </span>
            </span>
          )}
        </button>
      </div>

      {/* ============================================================== */}
      {/* RAINSENSE AI CHAT MODAL / DRAWER                               */}
      {/* ============================================================== */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[94vw] sm:w-[420px] h-[610px] max-h-[82vh] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-cyan-500/20 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* 1. Header */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-slate-800/80 bg-gradient-to-r from-cyan-50/90 via-sky-50/50 to-white dark:from-slate-900 dark:via-slate-900 dark:to-cyan-950/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <RainSenseIcon
                  size={42}
                  expression={isTyping ? 'thinking' : 'happy'}
                  className="rounded-full ring-2 ring-cyan-400/50 dark:ring-cyan-500/40 p-0.5 bg-white dark:bg-slate-800 shadow-sm"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>RainSense AI</span>
                    <Sparkles className="w-3.5 h-3.5 text-cyan-500 fill-cyan-500" />
                  </h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border flex items-center gap-1 ${localKnowledgeOnly ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${localKnowledgeOnly ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
                    <span>{modeLabel}</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Trợ lý thời tiết & kỹ thuật RainSense
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleResetChat}
                title="Làm mới cuộc trò chuyện"
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Đóng cửa sổ"
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 2. Live Station Glance Ribbon */}
          {contextData && (
            <div className="px-3.5 py-1.5 bg-cyan-500/5 dark:bg-slate-800/40 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <span className="flex items-center gap-1">
                  <span className="text-orange-500">🌡️</span>
                  <span>{contextData.currentTemp != null ? `${contextData.currentTemp.toFixed(1)}°C` : '--'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="text-blue-500">💧</span>
                  <span>{contextData.currentHumid != null ? `${contextData.currentHumid.toFixed(1)}%` : '--'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="text-cyan-500">🌧️</span>
                  <span>{contextData.todayRainMm == null ? '--' : `${contextData.todayRainMm.toFixed(1)} mm`}</span>
                </span>
              </div>
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-semibold border border-cyan-500/20">
                {contextData.deviceId}
              </span>
            </div>
          )}

          {contextData && (!fresh || contextData.dataQuality?.demo || contextData.dataQuality?.source === 'memory' || contextData.dataQuality?.source === 'mixed') && (
            <div role="status" className="px-3.5 py-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border-b border-amber-500/20">
              {contextData.dataQuality?.demo ? 'Dữ liệu giả lập. ' : ''}
              {!fresh ? 'Số đo chưa đủ mới hoặc trạm ngoại tuyến. ' : ''}
              {contextData.observedAt && Number.isFinite(Date.parse(contextData.observedAt)) ? `Lần đo gần nhất: ${new Date(contextData.observedAt).toLocaleString('vi-VN', { timeZone: contextData.timezone || 'Asia/Ho_Chi_Minh', hour12: false })}. ` : 'Chưa có thời điểm đo. '}
              {contextData.dataQuality?.source === 'memory' || contextData.dataQuality?.source === 'mixed' ? 'Lịch sử đang dùng bộ nhớ dự phòng và có thể thiếu.' : ''}
            </div>
          )}

          {/* 3. Messages Chat Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role === 'assistant' && (
                  <RainSenseIcon
                    size={28}
                    expression="happy"
                    className="shrink-0 mt-0.5"
                  />
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-cyan-600 to-sky-500 text-white font-medium rounded-br-xs'
                      : 'bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/50 rounded-bl-xs'
                  }`}
                >
                  <div className="whitespace-pre-line prose-xs dark:prose-invert">
                    {msg.content}
                  </div>
                  {msg.metadata && (
                    <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                      {msg.metadata.mode === 'llm' ? 'AI kết nối' : msg.metadata.mode === 'knowledge' ? 'Giải thích từ tài liệu dự án' : msg.metadata.mode === 'calculation' ? 'Tính bằng công thức' : msg.metadata.mode === 'analysis' ? 'Phân tích số đo đã ghi nhận' : msg.metadata.mode === 'forecast' ? 'Dự báo theo nguồn khí tượng' : 'Trả lời dự phòng'}
                      {msg.metadata.mode === 'fallback' && msg.metadata.fallbackReason && <span> · {msg.metadata.fallbackReason === 'missing_api_key' ? 'AI chưa được cấu hình' : msg.metadata.fallbackReason === 'model_unavailable' ? 'Dịch vụ AI tạm thời gián đoạn' : 'Chưa kết nối được máy chủ'}</span>}
                      {msg.metadata.sources.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer">Nguồn tham khảo ({msg.metadata.sources.length})</summary>
                          <ul className="mt-1 space-y-1">
                            {msg.metadata.sources.map((source) => (
                              <li key={source.id}>
                                {source.url?.startsWith('https://') ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-cyan-600">{source.title}</a> : source.title}
                                <span> · {source.version}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                  <div
                    className={`text-[9px] mt-1 font-mono text-right ${
                      msg.role === 'user'
                        ? 'text-cyan-100/75'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {msg.timestamp}
                  </div>
                </div>

                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-cyan-100 dark:bg-cyan-900/50 border border-cyan-300 dark:border-cyan-700/50 flex items-center justify-center text-cyan-600 dark:text-cyan-300 shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}

            {/* RainSense Typing Indicator */}
            {isTyping && (
              <div className="flex gap-2.5 items-center">
                <RainSenseIcon size={28} expression="thinking" className="shrink-0" />
                <div className="bg-slate-100 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50 rounded-2xl px-3.5 py-2 text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="italic font-medium">RainSense AI đang phân tích dữ liệu... 📡</span>
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 4. Quick Suggestion Pills */}
          {messages.length <= 3 && !isTyping && (
            <div className="px-3.5 py-2 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/40">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSendMessage(prompt)}
                    className="whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-cyan-500 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors shadow-2xs"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 5. Input Footer */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
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
                placeholder="Hỏi RainSense AI về lượng mưa, thời tiết, cảm biến ESP32-S3..."
                maxLength={4000}
                disabled={isTyping}
                className="flex-1 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isTyping}
                className="p-2 bg-gradient-to-r from-cyan-600 to-sky-500 hover:from-cyan-700 hover:to-sky-600 text-white rounded-xl shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
