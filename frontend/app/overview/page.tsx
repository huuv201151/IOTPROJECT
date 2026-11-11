'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Thermometer,
  Droplets,
  Gauge,
  CloudRain,
  Wifi,
  Radio,
  Clock,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Activity,
  CheckCircle2,
  RotateCcw,
  Waves
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useTheme, useDemo } from '@/app/providers';
import { useStationId } from '@/components/layout/AppShell';
import { RainMonitorPanel } from '@/components/RainMonitorPanel';
import { DEMO_SCENARIOS } from '@/lib/demo-scenarios';
import { formatDateTimeVi, formatTimeVi } from '@/lib/utils';
import {
  classifyPressureTrend,
  getHumidityStatusVi,
  calculateDewPoint,
  calculateFloodRisk
} from '@/lib/weather-calc';

export default function OverviewPage() {
  const stationId = useStationId();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const { isDemoMode, demoScenario, setDemoScenario, demoEnvironment, runtimePoints } = useDemo();
  const isDark = resolvedTheme === 'dark';

  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d' | '30d'>('24h');
  const [activeTab, setActiveTab] = useState<'all' | 'temp' | 'humidity' | 'pressure' | 'rain'>('all');
  const [isResettingRain, setIsResettingRain] = useState(false);

  const handleResetRain = async () => {
    if (!window.confirm('Bạn có chắc chắn muốn đặt lại lượng mưa và số nhịp lật gàu về 0 không?')) {
      return;
    }
    setIsResettingRain(true);
    try {
      queryClient.setQueryData(['dashboardSummary', stationId], (prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          rainfall: {
            ...prev.rainfall,
            todayMm: 0,
            totalTipsToday: 0,
            currentRateMmH: 0,
            rainRate: 0,
            last1hMm: 0,
            last24hMm: 0,
          }
        };
      });

      await api.resetRainOnly(stationId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] }),
        queryClient.invalidateQueries({ queryKey: ['rainfall'] }),
        queryClient.invalidateQueries({ queryKey: ['hourlyRain'] }),
        queryClient.invalidateQueries({ queryKey: ['telemetrySeries'] }),
        queryClient.invalidateQueries({ queryKey: ['rain-monitor', stationId, false] })
      ]);
      alert('Đã đặt lại lượng mưa và số nhịp lật về 0 thành công!');
    } catch (err: any) {
      alert(err?.message || 'Có lỗi xảy ra khi đặt lại lượng mưa');
    } finally {
      setIsResettingRain(false);
    }
  };

  // Fetch unified dashboard summary data
  const { data: summary, isLoading } = useQuery({
    queryKey: ['dashboardSummary', stationId],
    queryFn: () => api.getDashboardSummary(stationId),
    refetchInterval: 10000
  });

  // Fetch historical time series for charts
  const { data: series = [] } = useQuery({
    queryKey: ['telemetrySeries', stationId, timeRange],
    queryFn: () => api.getMeasurements(stationId, timeRange),
    refetchInterval: 15000
  });

  // Fetch hourly rain for rainfall chart
  const { data: hourlyRain = [] } = useQuery({
    queryKey: ['hourlyRain', stationId],
    queryFn: () => api.getHourlyRain(stationId, 24),
    refetchInterval: 20000
  });

  // Real-time Socket.IO subscriptions with monotonic rain guard and debounced server sync
  useEffect(() => {
    const socket = getSocket();
    let debounceTimer: NodeJS.Timeout | null = null;

    const triggerDebouncedRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
        queryClient.invalidateQueries({ queryKey: ['hourlyRain'] });
        queryClient.invalidateQueries({ queryKey: ['rainfall'] });
        queryClient.invalidateQueries({ queryKey: ['telemetrySeries'] });
      }, 2500);
    };

    const handleTelemetryUpdate = (data: any) => {
      if (data?.deviceId !== stationId || !data.measurement) return;
      queryClient.setQueryData(['dashboardSummary', stationId], (prev: any) => {
        if (!prev) return prev;


        return {
          ...prev,
          latestMeasurement: data.measurement,
          rainfall: prev.rainfall,
          device: {
            ...prev.device,
            wifiRssi: data.measurement.wifiRssi,
            uptime: data.measurement.uptime,
            lastSeen: data.measurement.timestamp
          }
        };
      });

      triggerDebouncedRefetch();
    };

    const handleRainUpdate = (data: any) => {
      if (data?.deviceId !== stationId || !data.statistics) return;
      queryClient.setQueryData(['dashboardSummary', stationId], (prev: any) => {
        if (!prev) return prev;

        return {
          ...prev,
          rainfall: data.statistics
        };
      });

      triggerDebouncedRefetch();
    };

    socket.on('telemetry:broadcast', handleTelemetryUpdate);
    socket.on('rain:broadcast', handleRainUpdate);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.off('telemetry:broadcast', handleTelemetryUpdate);
      socket.off('rain:broadcast', handleRainUpdate);
    };
  }, [queryClient, stationId]);

  // Biểu đồ tích lũy liên tục: giữ nguyên dữ liệu lịch sử cũ, chỉ nối thêm điểm mới nhất theo mode
  const chartData = useMemo(() => {
    const baseMapped = series.map((m: any) => ({
      time: formatTimeVi(m.timestamp),
      fullTime: formatDateTimeVi(m.timestamp),
      timestamp: m.timestamp,
      temperature: m.temperature,
      humidity: m.humidity,
      pressure: m.pressure,
      dewPoint: m.dewPoint ?? calculateDewPoint(m.temperature, m.humidity)
    }));

    const stationPoints = stationId === 'RS-ESP32S3-01'
      ? runtimePoints
      : runtimePoints.filter((point) => point.source === 'demo');
    if (stationPoints.length === 0) {
      return baseMapped;
    }

    const firstTime = new Date(stationPoints[0].timestamp).getTime();
    const historical = baseMapped.filter((p: any) => new Date(p.timestamp).getTime() < firstTime);
    return [...historical, ...stationPoints];
  }, [series, runtimePoints, stationId]);

  if (isLoading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] space-y-4">
        <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Đang đồng bộ dữ liệu trạm quan trắc...</p>
      </div>
    );
  }

  const device = summary?.device;
  const latest = summary?.latestMeasurement;
  const rainfall = summary?.rainfall;
  const health = summary?.systemHealth;

  const effectiveTemp = isDemoMode ? demoEnvironment.temperature : latest?.temperature;
  const effectiveHumid = isDemoMode ? demoEnvironment.humidity : latest?.humidity;
  const effectivePressure = isDemoMode ? demoEnvironment.pressure : latest?.pressure;
  const effectiveDewPoint = isDemoMode
    ? calculateDewPoint(effectiveTemp ?? 25, effectiveHumid ?? 60)
    : (latest?.dewPoint ?? calculateDewPoint(latest?.temperature ?? 25, latest?.humidity ?? 60));
  const effectivePressureTrend = isDemoMode
    ? demoEnvironment.pressureTrend
    : classifyPressureTrend(latest?.pressure ?? 1013);

  const humidityStatus = getHumidityStatusVi(effectiveHumid ?? 50);
  const pressureTrend = effectivePressureTrend;

  // LƯỢNG MƯA LUÔN LẤY TỪ GÀU LẬT THỰC TẾ
  const floodRisk = calculateFloodRisk({
    rainRate: rainfall?.currentRateMmH ?? latest?.rainRate ?? 0,
    todayMm: rainfall?.todayMm ?? 0,
    rolling24hMm: rainfall?.rolling24hMm ?? rainfall?.todayMm ?? 0,
    humidity: effectiveHumid,
    pressure: effectivePressure,
    pressureTrendCategory: pressureTrend?.category,
    demoScenarioId: isDemoMode ? demoScenario : undefined,
    demoScoreJitter: isDemoMode ? demoEnvironment.scoreJitter : 0
  });


  const tooltipStyle = isDark
    ? { backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#F1F5F9' }
    : { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '12px', color: '#0F172A', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' };

  const gridStroke = isDark ? '#334155' : '#E2E8F0';
  const axisStroke = isDark ? '#64748B' : '#94A3B8';

  return (
    <div className="space-y-6">
      {/* ============================================================== */}
      {/* SECTION A: STATION STATUS BANNER                               */}
      {/* ============================================================== */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm backdrop-blur-md relative overflow-hidden transition-colors">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {device?.name || 'Trạm Quan Trắc Khí Tượng & Mưa Đô Thị'}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border border-cyan-500/30">
                {device?.deviceId || stationId}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <span>{device?.location}</span>
              <span>•</span>
              <span>Múi giờ: {device?.timezone || 'Asia/Ho_Chi_Minh'}</span>
            </p>
          </div>

          {/* Quick Hardware & Connectivity Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Online / Offline status */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                device?.isOnline && !health?.isStale
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  device?.isOnline && !health?.isStale
                    ? 'bg-emerald-500 animate-pulse-live'
                    : 'bg-rose-500'
                }`}
              />
              <span>
                {device?.isOnline && !health?.isStale
                  ? 'Trực tuyến'
                  : latest
                  ? 'Mất tín hiệu telemetry'
                  : 'Ngoại tuyến (Chờ ESP32-S3)'}
              </span>
            </div>

            {/* WiFi RSSI */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-border text-slate-700 dark:text-slate-300 font-mono">
              <Wifi className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>
                {latest?.wifiRssi !== undefined && latest?.wifiRssi !== null
                  ? `${latest.wifiRssi} dBm`
                  : device?.wifiRssi !== undefined && device?.wifiRssi !== null
                  ? `${device.wifiRssi} dBm`
                  : '-- dBm'}
              </span>
            </div>

            {/* Firmware */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-border text-slate-700 dark:text-slate-300 font-mono">
              <span className="text-slate-500">FW:</span>
              <span>{device?.firmwareVersion || '1.2.0'}</span>
            </div>

            {/* Uptime */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-border text-slate-700 dark:text-slate-300 font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Uptime:{' '}
                {latest?.uptime !== undefined && latest?.uptime !== null
                  ? `${Math.floor(latest.uptime / 3600)}h ${Math.floor((latest.uptime % 3600) / 60)}m`
                  : '--'}
              </span>
            </div>
          </div>
        </div>

        {/* Stale Data or Waiting for Hardware Banner */}
        {health?.isStale ? (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span>
              <strong>Cảnh báo dữ liệu trễ:</strong> Trạm đã không gửi bản tin telemetry trong{' '}
              {health?.lastSeenSecondsAgo} giây qua. Vui lòng kiểm tra kết nối nguồn điện hoặc Wi-Fi của ESP32-S3.
            </span>
          </div>
        ) : !latest ? (
          <div className="mt-4 p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center gap-3 text-xs text-cyan-800 dark:text-cyan-300">
            <Radio className="w-4 h-4 shrink-0 text-cyan-500 animate-pulse" />
            <span>
              <strong>Chờ kết nối từ phần cứng ESP32-S3:</strong> Hệ thống đang lắng nghe bản tin MQTT qua topic <code className="font-mono bg-cyan-500/20 px-1 py-0.5 rounded">weather/{stationId}/telemetry</code>.
            </span>
          </div>
        ) : null}
      </section>

      {/* ============================================================== */}
      {/* SECTION B: 4 KEY ENVIRONMENTAL METRIC CARDS                    */}
      {/* ============================================================== */}
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

      <RainMonitorPanel deviceId={stationId} dashboardDemo={isDemoMode} />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* Card 1: Nhiệt độ */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:border-orange-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Nhiệt độ không khí
            </span>
            <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform">
              <Thermometer className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl md:text-4xl font-extrabold tracking-tight font-mono text-slate-900 dark:text-slate-100">
              {effectiveTemp !== undefined ? effectiveTemp.toFixed(1) : '--'}
            </span>
            <span className="text-lg font-bold text-orange-500">°C</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Điểm sương (Dew):</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
              {effectiveDewPoint !== undefined ? `${effectiveDewPoint.toFixed(1)} °C` : '--'}
            </span>
          </div>
        </div>

        {/* Card 2: Độ ẩm tương đối */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:border-blue-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Độ ẩm tương đối
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
              <Droplets className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl md:text-4xl font-extrabold tracking-tight font-mono text-slate-900 dark:text-slate-100">
              {effectiveHumid !== undefined ? effectiveHumid.toFixed(1) : '--'}
            </span>
            <span className="text-lg font-bold text-blue-500">%</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Đánh giá:</span>
            <span className={`font-medium ${humidityStatus.color}`}>{humidityStatus.label}</span>
          </div>
        </div>

        {/* Card 3: Áp suất khí quyển */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:border-purple-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Áp suất khí quyển
            </span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 group-hover:scale-110 transition-transform">
              <Gauge className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl md:text-4xl font-extrabold tracking-tight font-mono text-slate-900 dark:text-slate-100">
              {effectivePressure !== undefined ? effectivePressure.toFixed(1) : '--'}
            </span>
            <span className="text-lg font-bold text-purple-500">hPa</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Xu hướng:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1">
              {pressureTrend.category === 'RISING' || pressureTrend.category === 'RAPIDLY_RISING' ? (
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
              ) : pressureTrend.category === 'FALLING' || pressureTrend.category === 'RAPIDLY_FALLING' ? (
                <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
              ) : (
                <Minus className="w-3.5 h-3.5 text-slate-400" />
              )}
              {pressureTrend.labelVi}
            </span>
          </div>
        </div>

        {/* Card 4: Lượng mưa hôm nay */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:border-cyan-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Lượng mưa hôm nay
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetRain}
                disabled={isResettingRain}
                title="Đặt lại lượng mưa về 0"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all border border-rose-500/20 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isResettingRain ? 'animate-spin' : ''}`} />
                <span>Reset</span>
              </button>
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-600 dark:text-cyan-400 group-hover:scale-110 transition-transform">
                <CloudRain className="w-5 h-5" />
              </div>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl md:text-4xl font-extrabold tracking-tight font-mono text-slate-900 dark:text-slate-100">
              {rainfall?.todayMm !== undefined ? rainfall.todayMm.toFixed(2) : '0.00'}
            </span>
            <span className="text-lg font-bold text-cyan-600 dark:text-cyan-400">mm</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Tổng nhịp lật gầu:</span>
            <span className="font-mono text-cyan-600 dark:text-cyan-400 font-medium">
              {rainfall?.totalTipsToday ?? 0} nhịp ({rainfall?.calibrationFactor ?? 0.64} mm/tip)
            </span>
          </div>
        </div>

        {/* Card 5: Nguy cơ ngập lụt */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:border-cyan-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Nguy cơ ngập lụt
            </span>
            <div className={`w-9 h-9 rounded-xl ${floodRisk.bgClass} border ${floodRisk.borderClass} flex items-center justify-center ${floodRisk.textClass} group-hover:scale-110 transition-transform`}>
              <Waves className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl md:text-4xl font-extrabold tracking-tight font-mono ${floodRisk.textClass}`}>
              {floodRisk.levelVi}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {floodRisk.score}%
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Đánh giá:</span>
            <span className={`font-medium ${floodRisk.textClass} line-clamp-1`}>{floodRisk.summary}</span>
          </div>
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION C: LIVE WEATHER CHARTS & TIME RANGE SELECTOR          */}
      {/* ============================================================== */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              <span>Biểu đồ quan trắc khí tượng theo chuỗi thời gian</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cập nhật liên tục từ cảm biến BMP180 + DHT11 và phễu đo mưa lật A3144
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Metric Selector Tabs */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs transition-colors">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                  activeTab === 'all'
                    ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Tổng hợp
              </button>
              <button
                onClick={() => setActiveTab('temp')}
                className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                  activeTab === 'temp'
                    ? 'bg-white dark:bg-orange-500/20 text-orange-600 dark:text-orange-300 font-bold shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Nhiệt độ
              </button>
              <button
                onClick={() => setActiveTab('humidity')}
                className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                  activeTab === 'humidity'
                    ? 'bg-white dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 font-bold shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Độ ẩm
              </button>
              <button
                onClick={() => setActiveTab('pressure')}
                className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                  activeTab === 'pressure'
                    ? 'bg-white dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 font-bold shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Áp suất
              </button>
              <button
                onClick={() => setActiveTab('rain')}
                className={`px-3 py-1.5 rounded-lg transition-all font-medium ${
                  activeTab === 'rain'
                    ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Lượng mưa
              </button>
            </div>

            {/* Time range pills */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs transition-colors">
              {(['1h', '6h', '24h', '7d', '30d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={`px-2.5 py-1.5 rounded-lg transition-all font-mono font-medium ${
                    timeRange === r
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart View */}
        <div className="h-80 w-full">
          {activeTab === 'rain' ? (
            hourlyRain.length === 0 || hourlyRain.every((b: any) => b.rainfallMm === 0) ? (
              <div className="flex flex-col items-center justify-center h-full border border-dashed border-border rounded-xl p-8 text-center space-y-2 bg-slate-50/50 dark:bg-slate-900/20">
                <CloudRain className="w-9 h-9 text-cyan-500/40" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Chưa ghi nhận lượng mưa trong 24 giờ qua
                </p>
                <p className="text-xs text-slate-500 max-w-sm">
                  Dữ liệu phân bố mưa theo giờ sẽ tự động hiển thị khi cảm biến lật gầu Hall A3144 ghi nhận các nhịp lật.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyRain}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.6} />
                  <XAxis dataKey="hour" stroke={axisStroke} fontSize={11} />
                  <YAxis stroke={axisStroke} fontSize={11} unit=" mm" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="rainfallMm" name="Lượng mưa (mm)" fill="#06B6D4" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full border border-dashed border-border rounded-xl p-8 text-center space-y-2 bg-slate-50/50 dark:bg-slate-900/20">
              <Activity className="w-9 h-9 text-cyan-500/40 animate-pulse" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Chưa có dữ liệu quan trắc từ trạm ESP32-S3
              </p>
              <p className="text-xs text-slate-500 max-w-sm">
                Biểu đồ sẽ tự động vẽ theo thời gian thực ngay khi nhận được bản tin telemetry đầu tiên từ bo mạch ESP32-S3.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorHumid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPress" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#A855F7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#A855F7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.6} />
                <XAxis dataKey="time" stroke={axisStroke} fontSize={11} minTickGap={30} />
                <YAxis stroke={axisStroke} fontSize={11} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} />
                {(activeTab === 'all' || activeTab === 'temp') && (
                  <Area
                    type="monotone"
                    dataKey="temperature"
                    name="Nhiệt độ (°C)"
                    stroke="#F97316"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorTemp)"
                  />
                )}
                {(activeTab === 'all' || activeTab === 'humidity') && (
                  <Area
                    type="monotone"
                    dataKey="humidity"
                    name="Độ ẩm (%)"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorHumid)"
                  />
                )}
                {activeTab === 'pressure' && (
                  <Area
                    type="monotone"
                    dataKey="pressure"
                    name="Áp suất (hPa)"
                    stroke="#A855F7"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorPress)"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION D & E: RAINFALL SUMMARY & SYSTEM HEALTH                */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SECTION D: Chi tiết lượng mưa */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span>Tổng hợp & Thống kê lượng mưa</span>
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 font-medium">
              {(rainfall?.currentRateMmH ?? 0) > 0 ? 'Có nước qua gầu' : 'Chưa có nhịp gần đây'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">Cường độ tức thời</span>
              <span className="text-lg font-bold font-mono text-cyan-600 dark:text-cyan-300">
                {rainfall?.currentRateMmH?.toFixed(1) ?? '0.0'} mm/h
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">24 giờ qua</span>
              <span className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                {rainfall?.rolling24hMm?.toFixed(2) ?? '0.00'} mm
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">Tháng hiện tại</span>
              <span className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                {rainfall?.currentMonthMm?.toFixed(2) ?? '0.00'} mm
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">Cường độ đỉnh</span>
              <span className="text-lg font-bold font-mono text-amber-600 dark:text-amber-300">
                {rainfall?.maxObservedRateMmH?.toFixed(1) ?? '0.0'} mm/h
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">Nhịp lật gần nhất</span>
              <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
                {rainfall?.lastTipTimestamp ? formatTimeVi(rainfall.lastTipTimestamp) : 'Chưa ghi nhận'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">Hệ số hiệu chuẩn</span>
              <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
                {rainfall?.calibrationFactor ?? 0.25} mm / tip
              </span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">Nước thử hôm nay: {rainfall?.testTodayMm?.toFixed(2) ?? '0.00'} mm, đã tách khỏi tổng ngày. Các số còn lại chưa xác minh là mưa tự nhiên.</p>
          {/* Active Rain Shower Box */}
          {rainfall?.currentRainEvent?.active ? (
            <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-ping" />
                <span className="font-semibold text-cyan-700 dark:text-cyan-300">Có nước qua gầu:</span>
                <span className="text-slate-700 dark:text-slate-300">
                  Tích lũy {rainfall.currentRainEvent.totalMm.toFixed(2)} mm trong {rainfall.currentRainEvent.durationMinutes} phút
                </span>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
              <span>Chưa ghi nhận nhịp ngoài thử nước gần đây; chưa kết luận thời tiết.</span>
            </div>
          )}
        </section>

        {/* SECTION E: System Health */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Sức khỏe & Trạng thái phần cứng</span>
            </h3>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {latest ? `Cập nhật ${health?.lastSeenSecondsAgo}s trước` : 'Chờ kết nối thiết bị'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            {/* BMP180 & DHT11 sensor */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2.5">
                <Thermometer className="w-4 h-4 text-orange-500" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Cảm biến BMP180 (I2C) & DHT11 (GPIO)</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Khí áp (BMP180) • Nhiệt độ & Độ ẩm (DHT11)</div>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg font-semibold border ${
                  latest && !health?.isStale
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
                }`}
              >
                {latest && !health?.isStale ? 'HOẠT ĐỘNG' : 'CHỜ KẾT NỐI'}
              </span>
            </div>

            {/* Rain gauge Hall sensor */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2.5">
                <CloudRain className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Cảm biến lật gầu Hall A3144 (GPIO Interrupt)</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Đếm xung từ tính, khử nhiễu phần cứng</div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-500/30">
                SẴN SÀNG
              </span>
            </div>

            {/* MQTT Broker */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2.5">
                <Radio className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">HiveMQ Cloud MQTT Broker (TLS Port 8883)</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Thu thập vi sai và cảnh báo khẩn cấp</div>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg font-semibold border ${
                  health?.mqttStatus === 'CONNECTED'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
                }`}
              >
                {health?.mqttStatus === 'CONNECTED' ? 'KẾT NỐI TLS' : 'CHỜ KẾT NỐI MQTT'}
              </span>
            </div>

            {/* Backend & Database */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Node.js Server & Socket.IO Engine</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">PostgreSQL / NeonDB ORM Layer</div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-500/30">
                ỔN ĐỊNH
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
