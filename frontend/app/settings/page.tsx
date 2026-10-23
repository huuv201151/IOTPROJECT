'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Server,
  Radio,
  Palette,
  Code2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Sparkles,
  Key,
  Bot,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw
} from 'lucide-react';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  // AI Configuration State
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [aiSaveMessage, setAiSaveMessage] = useState<string | null>(null);

  const { data: aiConfig, isLoading: isLoadingAiConfig } = useQuery({
    queryKey: ['aiConfig'],
    queryFn: async () => {
      const res = await api.getAiConfig();
      if (res.model) setSelectedModel(res.model);
      return res;
    }
  });

  const saveAiMutation = useMutation({
    mutationFn: () => api.updateAiConfig(apiKeyInput.trim() || undefined, selectedModel),
    onSuccess: () => {
      setAiSaveMessage('Đã lưu cấu hình Google AI Studio thành công!');
      queryClient.invalidateQueries({ queryKey: ['aiConfig'] });
      setApiKeyInput('');
      setAiTestResult(null);
      setTimeout(() => setAiSaveMessage(null), 4000);
    },
    onError: (err: any) => {
      setAiTestResult({ success: false, message: err.message || 'Lỗi khi lưu cấu hình AI' });
    }
  });

  const testAiMutation = useMutation({
    mutationFn: () => api.testAiKey(apiKeyInput.trim() || undefined, selectedModel),
    onSuccess: (res: any) => {
      setAiTestResult({ success: true, message: `Thành công (${res.model}): ${res.reply}` });
    },
    onError: (err: any) => {
      setAiTestResult({ success: false, message: err.message || 'Kiểm tra API Key thất bại' });
    }
  });

  const { data: demoModeData } = useQuery({
    queryKey: ['demoMode'],
    queryFn: () => api.getDemoMode()
  });

  const toggleDemoMutation = useMutation({
    mutationFn: (enable: boolean) => api.toggleDemoMode(enable),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demoMode'] });
    }
  });

  const resetDataMutation = useMutation({
    mutationFn: () => api.resetDeviceData('RS-ESP32S3-01'),
    onSuccess: (data: any) => {
      setResetMessage(data?.message || 'Đã xóa toàn bộ dữ liệu đo giả lập thành công.');
      queryClient.invalidateQueries();
      setTimeout(() => setResetMessage(null), 5000);
    }
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
          <Settings className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
          <span>Cài Đặt Hệ Thống & Cấu Hình ESP32-S3 (System Settings)</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Tùy chỉnh giao diện hiển thị, cấu hình phần cứng ESP32-S3, kết nối HiveMQ Cloud và quản lý dữ liệu
        </p>
      </div>

      {/* TÙY CHỌN GIAO DIỆN LIGHT / DARK THEME */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Palette className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            <span>Tùy chỉnh Giao diện Màu sắc (Theme Settings)</span>
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Chuyển đổi tức thì, tự động lưu vào trình duyệt
          </span>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          RainSense hỗ trợ đầy đủ <strong>Chế độ Sáng (Light Mode)</strong> hiện đại, <strong>Chế độ Tối (Dark Mode)</strong> chuyên nghiệp dành cho trạm quan trắc IoT, và <strong>Tự động (System)</strong> theo cài đặt của hệ điều hành.
        </p>

        {/* 3 Interactive Cards Selector */}
        <ThemeToggle variant="cards" />
      </section>

      {/* CẤU HÌNH TRỢ LÝ AI CHIIKAWA & GOOGLE AI STUDIO */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 gap-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Bot className="w-5 h-5 text-pink-500" />
            <span>Trợ Lý AI Chiikawa & Google AI Studio (Gemini LLM)</span>
          </h2>
          <div className="flex items-center gap-2">
            {aiConfig?.hasKey ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                <span>Google Gemini ({aiConfig.model})</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                <span>Chế độ: Động cơ Chuyên gia Nội bộ (Built-in)</span>
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Tích hợp <strong>Google AI Studio (Gemini 1.5 Flash / 2.0 Flash)</strong> giúp trợ lý AI Chiikawa suy luận sâu sắc, phân tích tương quan khí tượng thời gian thực từ phần cứng ESP32-S3, hỗ trợ gỡ lỗi và giải thích công thức đo mưa cực kỳ thông minh.
        </p>

        {/* Info card with link to get free key */}
        <div className="p-3.5 rounded-xl bg-pink-500/5 dark:bg-pink-500/10 border border-pink-500/20 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Key className="w-4 h-4 text-pink-500" />
              <span>Chưa có API Key? Nhận miễn phí 100% từ Google</span>
            </div>
            <p className="text-slate-600 dark:text-slate-400">
              Truy cập Google AI Studio để tạo khóa API miễn phí chỉ trong 30 giây (không yêu cầu thẻ tín dụng).
            </p>
          </div>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white font-medium text-xs transition-colors shrink-0 shadow-sm"
          >
            <span>Lấy API Key tại AI Studio</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Form fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* API Key Input */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>Google Gemini API Key:</span>
              {aiConfig?.hasKey && (
                <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-normal">
                  Đã cấu hình: {aiConfig.keyMasked}
                </span>
              )}
            </label>
            <div className="relative flex items-center">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={aiConfig?.hasKey ? 'Dán khóa mới để thay thế khóa hiện tại...' : 'Dán API Key (AIzaSy...)'}
                className="w-full px-3.5 py-2.5 pr-20 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-pink-500/40 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 px-2 py-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title={showApiKey ? 'Ẩn' : 'Hiện'}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model Selector */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Mô hình (Gemini Model):
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-pink-500/40 text-xs"
            >
              <option value="gemini-3.5-flash">Gemini 3.5 Flash (Khuyên dùng - Nhanh & Ổn định)</option>
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (Phản hồi tức thì)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite (Tiết kiệm ngạch)</option>
              <option value="gemini-3.8-flash">Gemini 3.8 Flash (Thông minh cao cấp)</option>
            </select>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => saveAiMutation.mutate()}
            disabled={saveAiMutation.isPending || (!apiKeyInput.trim() && selectedModel === aiConfig?.model)}
            className="px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-semibold text-xs transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {saveAiMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>Lưu cấu hình AI Studio</span>
          </button>

          <button
            type="button"
            onClick={() => testAiMutation.mutate()}
            disabled={testAiMutation.isPending || (!apiKeyInput.trim() && !aiConfig?.hasKey)}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-all border border-slate-200 dark:border-slate-700 disabled:opacity-50 flex items-center gap-2"
          >
            {testAiMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>Kiểm tra kết nối (Test Key)</span>
          </button>

          {aiConfig?.hasKey && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Bạn có muốn gỡ bỏ API Key này và chuyển về chế độ chuyên gia nội bộ?')) {
                  api.updateAiConfig('', selectedModel).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['aiConfig'] });
                    setApiKeyInput('');
                    setAiSaveMessage('Đã gỡ API Key. Hệ thống chuyển về chế độ Built-in.');
                  });
                }
              }}
              className="text-xs text-rose-500 hover:text-rose-600 underline font-medium ml-auto"
            >
              Gỡ bỏ API Key
            </button>
          )}
        </div>

        {/* Messages */}
        {aiSaveMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{aiSaveMessage}</span>
          </div>
        )}

        {aiTestResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-in fade-in ${
              aiTestResult.success
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {aiTestResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>{aiTestResult.message}</span>
          </div>
        )}
      </section>

      {/* CẤU HÌNH PHẦN CỨNG ESP32-S3 */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            <span>Cấu Hình Phần Cứng ESP32-S3 (Hardware Configuration)</span>
          </h2>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
            RS-ESP32S3-01
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-1">
            <span className="text-slate-500 dark:text-slate-400 block font-semibold">Cảm biến môi trường BME280:</span>
            <span className="font-mono font-bold text-orange-600 dark:text-orange-400">I2C (SDA: GPIO 21, SCL: GPIO 22)</span>
            <span className="text-[11px] text-slate-500 block">Nguồn cấp 3.3V, đo Nhiệt độ, Độ ẩm, Áp suất</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-1">
            <span className="text-slate-500 dark:text-slate-400 block font-semibold">Cảm biến đếm mưa Hall A3144:</span>
            <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">GPIO 4 (Interrupt Edge FALLING)</span>
            <span className="text-[11px] text-slate-500 block">Khử nảy phần cứng Debounce delay 250ms</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-1">
            <span className="text-slate-500 dark:text-slate-400 block font-semibold">Hệ số hiệu chuẩn gầu lật:</span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">0.25 mm / nhịp lật (mm/tip)</span>
            <span className="text-[11px] text-slate-500 block">Có thể hiệu chỉnh lại theo dung tích phễu thực tế</span>
          </div>
        </div>
      </section>

      {/* XÓA DỮ LIỆU ĐO (RESET TOÀN BỘ TELEMETRY MẪU) */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-rose-500" />
            <span>Quản Lý Dữ Liệu & Làm Sạch Hệ Thống (Data Management)</span>
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 text-xs">
          <div className="space-y-1">
            <div className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              <span>Xóa toàn bộ dữ liệu đo giả lập / lịch sử</span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
              Xóa sạch các bản tin telemetry, sự kiện mưa và cảnh báo cũ trong cơ sở dữ liệu. Thiết bị sẽ chuyển về trạng thái sẵn sàng đón nhận dữ liệu thực tế từ ESP32-S3.
            </p>
          </div>

          <button
            onClick={() => {
              if (confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu đo và đưa hệ thống về trạng thái ban đầu?')) {
                resetDataMutation.mutate();
              }
            }}
            disabled={resetDataMutation.isPending}
            className="px-4 py-2.5 rounded-xl font-bold transition-all bg-rose-600 hover:bg-rose-500 text-white shrink-0 disabled:opacity-50"
          >
            {resetDataMutation.isPending ? 'Đang xóa...' : 'Xóa sạch dữ liệu đo'}
          </button>
        </div>

        {resetMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>{resetMessage}</span>
          </div>
        )}
      </section>

      {/* Operation Mode */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          <span>Chế độ hoạt động hệ thống (System Operational Mode)</span>
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs transition-colors">
          <div>
            <div className="font-bold text-slate-900 dark:text-slate-200 text-sm mb-1 flex items-center gap-2">
              <span>Chế độ hiện tại:</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
                  demoModeData?.mode === 'DEMO'
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {demoModeData?.mode === 'DEMO' ? 'DEMO MODE (Giả lập phần cứng)' : 'LIVE MODE (Dữ liệu phần cứng ESP32-S3)'}
              </span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              <strong>LIVE MODE (Hiện tại):</strong> Máy chủ chỉ tiếp nhận dữ liệu từ các bản tin MQTT thực tế được vi điều khiển ESP32-S3 gửi qua HiveMQ Cloud.
              <br />
              <strong>DEMO MODE:</strong> Máy chủ tự động phát dữ liệu mô phỏng để xem trước khi chưa có phần cứng.
            </p>
          </div>

          <button
            onClick={() => toggleDemoMutation.mutate(demoModeData?.mode !== 'DEMO')}
            className={`px-4 py-2.5 rounded-xl font-bold transition-all shrink-0 ${
              demoModeData?.mode === 'DEMO'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
            }`}
          >
            {demoModeData?.mode === 'DEMO' ? 'Chuyển sang LIVE MODE' : 'Bật DEMO MODE'}
          </button>
        </div>
      </section>

      {/* Cloud & IoT Connectivity Status */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Server className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <span>Thông số kết nối Broker MQTT (HiveMQ Cloud TLS)</span>
        </h2>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Địa chỉ Broker (HiveMQ Cloud):</span>
              <span className="font-mono font-bold text-cyan-600 dark:text-cyan-300">tls://cluster-id.s1.eu.hivemq.cloud:8883</span>
              <span className="text-[10px] text-slate-500 block">Cổng TLS mã hóa bảo mật 8883 (hoặc port 1883 nếu Mosquitto local)</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Cơ sở dữ liệu (Database Host):</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-300">PostgreSQL (NeonDB Cloud Serverless)</span>
              <span className="text-[10px] text-slate-500 block">Prisma ORM với tính năng khử lặp bản tin idempotent</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50 space-y-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200 block">Các Topic MQTT chuẩn của ESP32-S3:</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="p-2 bg-white dark:bg-slate-900/60 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">weather/RS-ESP32S3-01/telemetry</span>: BME280 định kỳ
              </div>
              <div className="p-2 bg-white dark:bg-slate-900/60 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">weather/RS-ESP32S3-01/rain</span>: Sự kiện lật gầu Hall A3144
              </div>
              <div className="p-2 bg-white dark:bg-slate-900/60 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">weather/RS-ESP32S3-01/status</span>: LWT / Online Heartbeat
              </div>
              <div className="p-2 bg-white dark:bg-slate-900/60 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">weather/RS-ESP32S3-01/command</span>: Lệnh điều khiển từ xa
              </div>
              <div className="p-2 bg-white dark:bg-slate-900/60 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">weather/RS-ESP32S3-01/command/ack</span>: Phản hồi xác nhận lệnh
              </div>
              <div className="p-2 bg-white dark:bg-slate-900/60 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">weather/RS-ESP32S3-01/config</span>: Đồng bộ tham số cấu hình
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Firmware Contract Documentation Reference */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-3 transition-colors">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <span>Tài liệu Kỹ thuật & Mã nguồn Nạp ESP32-S3</span>
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Mã nguồn firmware mẫu hoàn chỉnh cho ESP32-S3, sơ đồ đấu nối chân cảm biến BME280 (I2C) và cảm biến Hall A3144 (GPIO Interrupt) được lưu trữ chi tiết trong thư mục <code className="font-mono text-cyan-600 dark:text-cyan-400 font-semibold">docs/ESP32_FIRMWARE_GUIDE.md</code> và <code className="font-mono text-cyan-600 dark:text-cyan-400 font-semibold">docs/MQTT_SPECIFICATION.md</code>.
        </p>
      </section>
    </div>
  );
}
