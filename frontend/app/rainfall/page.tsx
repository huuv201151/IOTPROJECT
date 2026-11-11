'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CloudRain,
  Droplets,
  TrendingUp,
  BarChart3,
  Waves,
  Zap,
  RotateCcw,
  AlertTriangle,
  Activity,
  ArrowDownRight,
  Minus,
  Sparkles
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';
import { api } from '@/lib/api';
import { useTheme, useDemo } from '@/app/providers';
import { DEMO_SCENARIOS } from '@/lib/demo-scenarios';
import { formatDateTimeVi, formatTimeVi } from '@/lib/utils';
import { RainDataAudit } from '@/components/RainDataAudit';
import { calculateFloodRisk, classifyPressureTrend } from '@/lib/weather-calc';
import { RainMonitorPanel } from '@/components/RainMonitorPanel';
import { useStationId } from '@/components/layout/AppShell';

export default function RainfallPage() {
  const stationId = useStationId();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const { isDemoMode, demoScenario, setDemoScenario, demoEnvironment } = useDemo();
  const isDark = resolvedTheme === 'dark';
  const [chartMode, setChartMode] = useState<'hourly' | 'daily'>('hourly');
  const [isResettingRain, setIsResettingRain] = useState(false);

  const handleResetRain = async () => {
    if (!window.confirm('Bạn có chắc chắn muốn đặt lại lượng mưa và số nhịp lật gàu về 0 không?')) {
      return;
    }
    setIsResettingRain(true);
    try {
      await api.resetRainOnly(stationId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rainfall'] }),
        queryClient.invalidateQueries({ queryKey: ['hourlyRain'] }),
        queryClient.invalidateQueries({ queryKey: ['dailyRain'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] }),
        queryClient.invalidateQueries({ queryKey: ['rain-monitor', stationId, false] })
      ]);
      alert('Đã đặt lại lượng mưa và số nhịp lật về 0 thành công!');
    } catch (err: any) {
      alert(err?.message || 'Có lỗi xảy ra khi đặt lại lượng mưa');
    } finally {
      setIsResettingRain(false);
    }
  };

  // Fetch rainfall statistics
  const { data: stats, isLoading } = useQuery({
    queryKey: ['rainfall', stationId],
    queryFn: () => api.getRainfallStats(stationId),
    refetchInterval: 10000
  });

  // Fetch hourly rain
  const { data: hourlyRain = [] } = useQuery({
    queryKey: ['hourlyRain', stationId],
    queryFn: () => api.getHourlyRain(stationId, 24),
    refetchInterval: 10000
  });

  // Fetch daily rain (7 days)
  const { data: dailyRain = [] } = useQuery({
    queryKey: ['dailyRain', stationId],
    queryFn: () => api.getDailyRain(stationId, 7),
    refetchInterval: 10000
  });

  // Fetch unified dashboard summary for environmental context
  const { data: summary } = useQuery({
    queryKey: ['dashboardSummary', stationId],
    queryFn: () => api.getDashboardSummary(stationId),
    refetchInterval: 10000
  });

  const latest = summary?.latestMeasurement;

  const effectiveHumid = isDemoMode ? demoEnvironment.humidity : (latest?.humidity ?? 70);
  const effectivePressure = isDemoMode ? demoEnvironment.pressure : (latest?.pressure ?? 1013);
  const effectivePressureTrend = isDemoMode
    ? demoEnvironment.pressureTrend
    : classifyPressureTrend(latest?.pressure ?? 1013);

  // LƯỢNG MƯA LUÔN LẤY TỪ GÀU LẬT THỰC TẾ
  const floodRisk = calculateFloodRisk({
    rainRate: stats?.currentRateMmH ?? latest?.rainRate ?? 0,
    todayMm: stats?.todayMm ?? 0,
    rolling24hMm: stats?.rolling24hMm ?? stats?.todayMm ?? 0,
    humidity: effectiveHumid,
    pressure: effectivePressure,
    pressureTrendCategory: effectivePressureTrend?.category,
    demoScenarioId: isDemoMode ? demoScenario : undefined,
    demoScoreJitter: isDemoMode ? demoEnvironment.scoreJitter : 0
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] space-y-4">
        <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Đang tổng hợp số liệu lượng mưa...</p>
      </div>
    );
  }


  const tooltipStyle = isDark
    ? { backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#F1F5F9' }
    : { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '12px', color: '#0F172A', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' };

  const gridStroke = isDark ? '#334155' : '#E2E8F0';
  const axisStroke = isDark ? '#64748B' : '#94A3B8';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <CloudRain className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
            <span>Phân Tích Chi Tiết Lượng Mưa (Rainfall Analytics)</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Theo dõi lượng mưa tích lũy, cường độ mưa theo cửa sổ trượt, và xung đếm cảm biến Hall A3144
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 flex items-center gap-1.5">
            <Waves className="w-3.5 h-3.5" />
            <span>{(stats?.currentRateMmH ?? 0) > 0 ? 'Có nước qua gầu — chưa xác minh mưa' : 'Chưa ghi nhận nhịp ngoài thử nước gần đây'}</span>
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
            Hiệu chuẩn: {stats?.calibrationFactor ?? 0.64} mm/lần lật
          </span>
          <button
            type="button"
            onClick={handleResetRain}
            disabled={isResettingRain}
            title="Đặt lại lượng mưa về 0"
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all border border-rose-500/20 disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isResettingRain ? 'animate-spin' : ''}`} />
            <span>Reset lượng mưa</span>
          </button>
        </div>
      </div>

      {isDemoMode && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" />
            <span className="text-amber-900 dark:text-amber-200">
              <strong>CHẾ ĐỘ DEMO:</strong> Đang mô phỏng <strong>{DEMO_SCENARIOS[demoScenario].code}: {DEMO_SCENARIOS[demoScenario].name}</strong>. Thông số tự động dao động nhẹ mỗi 10 giây (giống Live mode). Lượng mưa luôn đo từ gàu lật thực tế.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {(['low', 'moderate', 'high', 'critical'] as const).map((sc) => (
              <button
                key={sc}
                onClick={() => setDemoScenario(sc)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  demoScenario === sc
                    ? 'bg-amber-500 text-white font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {sc === 'low' ? 'Demo 1: Thấp' : sc === 'moderate' ? 'Demo 2: T.Bình' : sc === 'high' ? 'Demo 3: Cao' : 'Demo 4: Rất cao'}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-muted-foreground">Tổng đã loại thử nước: {stats?.todayMm?.toFixed(2) ?? '0.00'} mm. Nước thử hôm nay: {stats?.testTodayMm?.toFixed(2) ?? '0.00'} mm ({stats?.testTipsToday ?? 0} nhịp). Tổng ghi nhận gồm thử: {stats?.recordedTodayMm?.toFixed(2) ?? '0.00'} mm. Phần còn lại chưa xác minh là mưa tự nhiên.</p>
      {/* A. THỐNG KÊ LƯỢNG MƯA TÍCH LŨY */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
            Hôm nay (00:00 - nay)
          </span>
          <div className="text-2xl font-bold font-mono text-cyan-600 dark:text-cyan-400">
            {stats?.todayMm?.toFixed(2) ?? '0.00'} <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {stats?.totalTipsToday ?? 0} nhịp lật
          </span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
            Hôm qua
          </span>
          <div className="text-2xl font-bold font-mono text-slate-800 dark:text-slate-200">
            {stats?.yesterdayMm?.toFixed(2) ?? '0.00'} <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Cả ngày hôm qua</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
            24 giờ trượt
          </span>
          <div className="text-2xl font-bold font-mono text-cyan-600 dark:text-cyan-300">
            {stats?.rolling24hMm?.toFixed(2) ?? '0.00'} <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Cửa sổ 24h gần nhất</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
            7 ngày qua
          </span>
          <div className="text-2xl font-bold font-mono text-slate-800 dark:text-slate-200">
            {stats?.last7DaysMm?.toFixed(2) ?? '0.00'} <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Tổng 7 ngày gần đây</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
            Tháng này
          </span>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
            {stats?.currentMonthMm?.toFixed(2) ?? '0.00'} <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Từ ngày 1 đầu tháng</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
            Tổng vòng đời
          </span>
          <div className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
            {stats?.lifetimeMm?.toFixed(2) ?? '0.00'} <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {stats?.lifetimeTips ?? 0} nhịp tổng
          </span>
        </div>
      </section>

      {/* B. CƯỜNG ĐỘ MƯA & TIPPING BUCKET */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cường độ tức thời (5 phút) */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-2 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wider">Cường độ mưa tức thời (5 phút)</span>
            <Zap className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold font-mono text-cyan-600 dark:text-cyan-400">
              {stats?.currentRateMmH?.toFixed(1) ?? '0.0'}
            </span>
            <span className="text-sm font-bold text-slate-400">mm/h</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            Công thức: Lượng mưa trong cửa sổ 5 phút / (5 / 60 giờ)
          </p>
        </div>

        {/* Cường độ mưa đỉnh (Max observed) */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-2 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wider">Cường độ đỉnh ghi nhận</span>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold font-mono text-amber-600 dark:text-amber-400">
              {stats?.maxObservedRateMmH?.toFixed(1) ?? '0.0'}
            </span>
            <span className="text-sm font-bold text-slate-400">mm/h</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            Thời điểm đỉnh: {stats?.timeOfMaxRate ? formatTimeVi(stats.timeOfMaxRate) : 'Chưa có mưa'}
          </p>
        </div>

        {/* Thông số gầu lật A3144 */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-2 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wider">Cảm biến lật gầu Hall A3144</span>
            <Droplets className="w-4 h-4 text-blue-500" />
          </div>
          <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 pt-1">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Tổng số xung lật (Lifetime):</span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{stats?.lifetimeTips ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Hệ số hiệu chuẩn trạm:</span>
              <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">{stats?.calibrationFactor ?? 0.25} mm/tip</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Lần lật gần nhất:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">
                {stats?.lastTipTimestamp ? formatDateTimeVi(stats.lastTipTimestamp) : 'Chưa ghi nhận'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <RainMonitorPanel deviceId={stationId} dashboardDemo={isDemoMode} />

      {/* ============================================================== */}
      {/* 2. AI FLOOD RISK ANALYSIS                                      */}
      {/* ============================================================== */}
      <section className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6 transition-colors">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Waves className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                <span>AI Flood Risk Analysis</span>
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mô hình AI phân tích nguy cơ ngập lụt đa yếu tố: lượng mưa tích lũy, cường độ mưa, độ bão hòa ẩm đất và biến thiên khí quyển
            </p>
          </div>

          {/* Overall Status Badge */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Chỉ số rủi ro AI
              </span>
              <span className={`text-lg font-mono font-extrabold ${floodRisk.textClass}`}>
                {floodRisk.score} / 100
              </span>
            </div>
            <div className={`px-4 py-2 rounded-xl border font-bold text-sm flex items-center gap-2 ${floodRisk.bgClass} ${floodRisk.borderClass} ${floodRisk.textClass}`}>
              <AlertTriangle className="w-4 h-4" />
              <span>Nguy cơ ngập: {floodRisk.levelVi}</span>
            </div>
          </div>
        </div>

        {/* Main 2-column grid: Score & Trend Gauge + Contributing Factors */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left Column: Risk Score & Trend */}
          <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
                Mức độ nguy cơ ngập
              </span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${floodRisk.bgClass} ${floodRisk.textClass}`}>
                {floodRisk.summary}
              </span>
            </div>

            {/* Visual Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">0% (An toàn)</span>
                <span className={`font-bold ${floodRisk.textClass}`}>{floodRisk.score}%</span>
                <span className="text-slate-400">100% (Nguy hiểm)</span>
              </div>
              <div className="h-3 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden p-0.5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    floodRisk.level === 'CRITICAL'
                      ? 'bg-rose-500'
                      : floodRisk.level === 'HIGH'
                      ? 'bg-orange-500'
                      : floodRisk.level === 'MODERATE'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.max(floodRisk.score, 6)}%` }}
                />
              </div>
            </div>

            {/* Trend indicator */}
            <div className="p-3 rounded-lg bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Xu hướng nguy cơ:</span>
              </div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                {floodRisk.trendIcon === 'rising' ? (
                  <TrendingUp className="w-4 h-4 text-rose-500" />
                ) : floodRisk.trendIcon === 'falling' ? (
                  <ArrowDownRight className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Minus className="w-4 h-4 text-slate-400" />
                )}
                {floodRisk.trendVi}
              </span>
            </div>
          </div>

          {/* Right 2 Columns: Các yếu tố ảnh hưởng (Contributing Factors) */}
          <div className="lg:col-span-2 space-y-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Các yếu tố ảnh hưởng và chỉ số môi trường
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {floodRisk.factors.map((f, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50 space-y-1.5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{f.name}</span>
                    <span className={`font-mono font-bold text-xs ${f.color}`}>{f.value}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Đánh giá trạng thái:</span>
                    <span className={`font-semibold ${f.color}`}>{f.statusVi}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight pt-1 border-t border-slate-200/60 dark:border-slate-700/40">
                    {f.impact}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom AI Explanation & Recommendation Box */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-indigo-500/10 border border-cyan-500/20 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
              Giải thích AI & Nhận định xu hướng
            </span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {floodRisk.aiExplanation}
          </p>
          <div className="pt-2 border-t border-cyan-500/20 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-cyan-700 dark:text-cyan-300 shrink-0">Khuyến cáo an toàn:</span>
            <span>{floodRisk.actionRecommendation}</span>
          </div>
        </div>
      </section>

      <RainDataAudit deviceId={stationId} />
      {/* C. INTERACTIVE RAINFALL CHARTS */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              <span>Biểu đồ phân bố lượng mưa</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Lượng mưa tích lũy được gom theo từng giờ (24h qua) hoặc từng ngày (7 ngày qua)
            </p>
          </div>

          <div className="flex items-center bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs">
            <button
              onClick={() => setChartMode('hourly')}
              className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                chartMode === 'hourly'
                  ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Theo từng giờ (24h)
            </button>
            <button
              onClick={() => setChartMode('daily')}
              className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                chartMode === 'daily'
                  ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Theo từng ngày (7 ngày)
            </button>
          </div>
        </div>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartMode === 'hourly' ? hourlyRain : dailyRain}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.6} />
              <XAxis
                dataKey={chartMode === 'hourly' ? 'hour' : 'dayLabel'}
                stroke={axisStroke}
                fontSize={11}
              />
              <YAxis stroke={axisStroke} fontSize={11} unit=" mm" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="rainfallMm" name="Lượng mưa (mm)" fill="#06B6D4" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
