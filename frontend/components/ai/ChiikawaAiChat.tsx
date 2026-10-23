'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Send,
  RotateCcw,
  Sparkles,
  Bot,
  User,
  Radio,
  ChevronDown,
  Info,
  ExternalLink
} from 'lucide-react';
import { ChiikawaIcon } from './ChiikawaIcon';
import { api } from '@/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  provider?: string;
  model?: string;
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: 'msg-welcome',
  role: 'assistant',
  content:
    'Waaah! Chào bạn nha, mình là **Chiikawa** ( ˶ᵔ ᵕ ᵔ˶ )! Mình là trợ lý AI Khí tượng & IoT thông minh kết nối trực tiếp với trạm quan trắc **RainSense**.\n\nMình có thể giúp bạn phân tích chỉ số BME280 thời gian thực, giải thích công thức tính mưa gầu lật A3144, hoặc hướng dẫn sơ đồ đấu nối vi điều khiển ESP32-S3. Bạn cần Chiikawa hỗ trợ gì nè? ✨',
  timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
};

const SUGGESTED_PROMPTS = [
  '🌤️ Phân tích thời tiết hiện tại',
  '🌧️ Cách gầu lật A3144 tính lượng mưa?',
  '🔌 Sơ đồ nối chân ESP32-S3 & BME280',
  '⚠️ Khí áp giảm có nguy cơ bão không?',
  '📶 Hướng dẫn xử lý khi trạm ngoại tuyến'
];

function formatChatMessage(text: string, isUser = false) {
  if (!text) return null;
  // 1. Sanitize any residual LaTeX or raw math syntax
  const clean = text
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
    .replace(/\$([^\$]+)\$/g, '$1');

  // 2. Parse inline bold (**bold**) and inline code (`code`) per line
  const lines = clean.split('\n');
  return lines.map((line, lineIdx) => {
    if (line.trim() === '') {
      return <div key={lineIdx} className="h-1.5" />;
    }
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <div key={lineIdx} className="min-h-[1.25rem] leading-relaxed">
        {parts.map((part, partIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong
                key={partIdx}
                className={
                  isUser
                    ? 'font-bold text-white'
                    : 'font-semibold text-slate-900 dark:text-slate-100'
                }
              >
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code
                key={partIdx}
                className={
                  isUser
                    ? 'px-1.5 py-0.5 rounded bg-white/20 font-mono text-[11px] text-white'
                    : 'px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700/60 font-mono text-[11px] text-pink-600 dark:text-pink-400'
                }
              >
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={partIdx}>{part}</span>;
        })}
      </div>
    );
  });
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

  // Fetch AI engine configuration (Gemini vs Built-in)
  const { data: aiConfig } = useQuery({
    queryKey: ['aiConfig'],
    queryFn: () => api.getAiConfig(),
    staleTime: 30000
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
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        provider: res.provider,
        model: res.model
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: `bot-err-${Date.now()}`,
        role: 'assistant',
        content:
          'Waaah! Chiikawa bị gián đoạn kết nối một chút rồi (｡•́‿•̀｡). Bạn hãy thử gửi lại câu hỏi hoặc kiểm tra server đang chạy tại cổng 5000 nhé!',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, errorMsg]);
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
        {/* Cute Speech Bubble Tooltip when idle */}
        {!isOpen && showTooltip && (
          <div className="mr-3 hidden sm:flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl px-3.5 py-2 rounded-2xl text-xs animate-in fade-in slide-in-from-right-4 duration-300 relative group">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-spin-slow shrink-0" />
            <span className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
              Hỏi Chiikawa nè! ( ˶ᵔ ᵕ ᵔ˶ )
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

        {/* Main Floating Round Button with Chiikawa Icon */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Gọi trợ lý AI Chiikawa"
          className={`relative group flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full shadow-2xl transition-all duration-300 transform active:scale-95 ${
            isOpen
              ? 'bg-rose-500 text-white rotate-90 ring-4 ring-rose-500/20'
              : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border-2 border-pink-300/80 dark:border-pink-500/40 hover:scale-105 hover:shadow-pink-500/20 hover:border-pink-400 ring-4 ring-pink-500/10'
          }`}
        >
          {isOpen ? (
            <X className="w-7 h-7 transition-transform" />
          ) : (
            <div className="relative">
              <ChiikawaIcon
                size={48}
                expression="happy"
                withBadge={true}
                className="group-hover:rotate-6 transition-transform"
              />
              {/* Pulsing ring around button */}
              <span className="absolute -inset-1 rounded-full bg-pink-400/20 animate-ping -z-10 pointer-events-none" />
            </div>
          )}

          {/* New alert badge */}
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
      {/* CHIIKAWA AI CHAT MODAL / DRAWER                               */}
      {/* ============================================================== */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[94vw] sm:w-[410px] h-[600px] max-h-[82vh] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800/80 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* 1. Header */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-slate-800/80 bg-gradient-to-r from-pink-50/80 via-white to-cyan-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <ChiikawaIcon
                  size={42}
                  expression={isTyping ? 'thinking' : 'happy'}
                  withBadge={true}
                  className="rounded-full ring-2 ring-pink-300 dark:ring-pink-500/40 p-0.5 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>Chiikawa AI</span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  </h3>
                  {aiConfig?.hasKey ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 flex items-center gap-1 shadow-xs">
                      <Sparkles className="w-2.5 h-2.5 text-pink-500" />
                      <span>Gemini AI</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Trực tuyến</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {aiConfig?.hasKey ? `Google Gemini (${aiConfig.model})` : 'Trợ lý Khí tượng & Phần cứng ESP32-S3'}
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
            <div className="px-3.5 py-1.5 bg-slate-100/70 dark:bg-slate-800/40 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <span className="flex items-center gap-1">
                  <span className="text-orange-500">🌡️</span>
                  <span>{contextData.currentTemp !== null ? `${contextData.currentTemp.toFixed(1)}°C` : '--'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="text-blue-500">💧</span>
                  <span>{contextData.currentHumid !== null ? `${contextData.currentHumid.toFixed(1)}%` : '--'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="text-cyan-500">🌧️</span>
                  <span>{contextData.todayRainMm?.toFixed(1) ?? '0.0'}mm</span>
                </span>
              </div>
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/60 font-semibold">
                {contextData.deviceId}
              </span>
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
                  <ChiikawaIcon
                    size={28}
                    expression="happy"
                    className="shrink-0 mt-0.5"
                  />
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white font-medium rounded-br-xs'
                      : 'bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/50 rounded-bl-xs'
                  }`}
                >
                  <div className="space-y-0.5">
                    {formatChatMessage(msg.content, msg.role === 'user')}
                  </div>
                  <div
                    className={`text-[9px] mt-1.5 font-mono flex items-center justify-between gap-3 ${
                      msg.role === 'user'
                        ? 'text-cyan-100/75 justify-end'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {msg.role === 'assistant' && (
                      <span className="flex items-center gap-1 text-[9px] font-sans">
                        {msg.provider === 'gemini' ? (
                          <span className="text-pink-600 dark:text-pink-400 font-medium flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>Gemini</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">RainSense Engine</span>
                        )}
                      </span>
                    )}
                    <span>{msg.timestamp}</span>
                  </div>
                </div>

                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-cyan-100 dark:bg-cyan-900/50 border border-cyan-300 dark:border-cyan-700/50 flex items-center justify-center text-cyan-600 dark:text-cyan-300 shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}

            {/* Chiikawa Typing Indicator */}
            {isTyping && (
              <div className="flex gap-2.5 items-center">
                <ChiikawaIcon size={28} expression="thinking" className="shrink-0" />
                <div className="bg-slate-100 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50 rounded-2xl px-3.5 py-2 text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="italic font-medium">Chiikawa đang suy nghĩ... ( •̀ ω •́ )✧</span>
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce [animation-delay:0.4s]" />
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
                    className="whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-pink-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors shadow-2xs"
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
                placeholder="Hỏi Chiikawa về thời tiết, ESP32-S3, cảm biến..."
                disabled={isTyping}
                className="flex-1 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isTyping}
                className="p-2 bg-gradient-to-r from-pink-500 to-cyan-500 hover:from-pink-600 hover:to-cyan-600 text-white rounded-xl shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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
