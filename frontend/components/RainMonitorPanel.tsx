'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BrainCircuit,
  Sparkles,
  CloudRain,
  Gauge,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  AlertOctagon,
  TrendingDown,
  TrendingUp,
  Minus,
  Activity,
  ArrowRight,
  Droplets,
  Clock,
  CheckCircle2,
  Info,
  Waves
} from 'lucide-react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useDemo } from '@/context/demo-context';
import { DEMO_SCENARIOS, getDemoRainMonitorSnapshot } from '@/lib/demo-scenarios';
import { formatRainEvidence, rainObservationLabel, rainQualityLabels } from '@/shared/rain-monitor';
import type { AlertRecord } from '@/shared/types/alert';

const titles: Record<number, string> = { 15: '15 phút', 60: '1 giờ', 180: '3 giờ', 1440: '24 giờ' };

export function RainMonitorPanel({ deviceId, dashboardDemo }: { deviceId: string; dashboardDemo: boolean }) {
  const [previewDemo, setPreviewDemo] = useState(false);
  const { isDemoMode, demoScenario } = useDemo();
  const demo = dashboardDemo || isDemoMode || previewDemo;
  const scenario = demo ? demoScenario : undefined;
  const queryClient = useQueryClient();

  // Instant client-side simulation for 0ms reactivity across all 4 demo scenarios
  const localDemoSnapshot = useMemo(() => {
    if (demo) {
      return getDemoRainMonitorSnapshot(deviceId, (scenario as any) || 'high');
    }
    return null;
  }, [demo, deviceId, scenario]);

  const { data: serverData, isError, isLoading } = useQuery({
    queryKey: ['rain-monitor', deviceId, demo, scenario],
    queryFn: () => api.getRainMonitor(deviceId, demo, scenario),
    refetchInterval: demo ? false : 30000,
    enabled: !demo
  });

  const data = demo ? localDemoSnapshot : serverData;

  useEffect(() => {
    if (demo) return;
    const socket = getSocket();
    const reload = () => { void queryClient.invalidateQueries({ queryKey: ['rain-monitor', deviceId, false] }); };
    const refresh = (alert: AlertRecord) => {
      if (alert.deviceId === deviceId && alert.rainEvidence) reload();
    };
    socket.on('alert:new', refresh);
    socket.on('connect', reload);
    return () => {
      socket.off('alert:new', refresh);
      socket.off('connect', reload);
    };
  }, [demo, deviceId, queryClient]);

  const time = (value: string) => new Intl.DateTimeFormat('vi-VN', {
    timeZone: data?.timezone ?? 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short'
  }).format(new Date(value));
  const number = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  const evidence = data?.observation.alert;
  const activeScenarioConfig = DEMO_SCENARIOS[demoScenario];

  // Determine current active risk tier (1: Safe, 2: Moderate, 3: Warning, 4: Critical)
  // Integrates both direct observation thresholds and AI short-term forecast dynamics
  let currentTier: 1 | 2 | 3 | 4 = 1;
  const forecastRain = data?.forecast?.estimatedRainMm ?? 0;

  if (demo && demoScenario) {
    if (demoScenario === 'critical') currentTier = 4;
    else if (demoScenario === 'high') currentTier = 3;
    else if (demoScenario === 'moderate') currentTier = 2;
    else currentTier = 1;
  } else if (evidence?.severity === 'CRITICAL' || forecastRain >= 50) {
    currentTier = 4;
  } else if (evidence?.severity === 'WARNING' || data?.observation.status === 'heavy' || forecastRain >= 15) {
    currentTier = 3;
  } else if (data?.observation.status === 'rain' || (data?.windows.find((w) => w.minutes === 60)?.rainfallMm ?? 0) > 0 || forecastRain > 0) {
    currentTier = 2;
  } else {
    currentTier = 1;
  }

  // AI Actionable Operational Recommendation
  const getAiRecommendation = () => {
    switch (currentTier) {
      case 4:
        return 'CẢNH BÁO KHẨN CẤP: Lượng mưa đặc biệt lớn, nguy cơ ngập sâu diện rộng 30–50cm và ngập tầng hầm. Chủ động kê cao tài sản, phương tiện và theo dõi máy bơm chống ngập!';
      case 3:
        return 'CẢNH BÁO MƯA LỚN: Nguy cơ ngập úng cục bộ 15–25cm tại các điểm trũng thấp. Khuyến cáo kiểm tra phễu thu nước và hạn chế di chuyển qua các tuyến đường ngập!';
      case 2:
        return 'LƯU Ý THEO DÕI: Mưa rào rải rác, cống rãnh lưu thông chậm tại một số hố ga. Chú ý quan sát và duy trì theo dõi diễn biến mây dông.';
      case 1:
      default:
        return 'TRẠNG THÁI AN TOÀN: Khí quyển ổn định, cống rãnh lưu thông tốt. Không có rủi ro ngập lụt trên địa bàn trạm quan trắc.';
    }
  };

  return (
    <section
      id="rain-monitor"
      className="rounded-2xl border border-border bg-card p-5 md:p-6 shadow-sm space-y-5 transition-all relative overflow-hidden backdrop-blur-md"
      aria-labelledby="rain-monitor-title"
    >
      {/* Decorative ambient glow */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 dark:bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-2xl -z-10 pointer-events-none" />

      {/* TOP HEADER: Brand & Status Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white shadow-sm shadow-cyan-500/20">
              <BrainCircuit className="w-5 h-5 animate-pulse" />
            </div>
            <h2 id="rain-monitor-title" className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>RainSense AI Intelligence</span>
              <span className="text-xs font-normal text-muted-foreground hidden sm:inline">|</span>
              <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">Giám Sát & Dự Báo Mưa Ngắn Hạn</span>
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-ping" />
              <span>AI Active</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Mã trạm: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{deviceId}</span>
            {data && ` · Cập nhật: ${time(data.generatedAt)}`}
            {data?.demo && (
              <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
                · {activeScenarioConfig ? activeScenarioConfig.name : 'Chế độ mô phỏng'}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!dashboardDemo && !isDemoMode && (
            <button
              type="button"
              aria-pressed={previewDemo}
              onClick={() => setPreviewDemo(!previewDemo)}
              className="rounded-xl border border-border px-3.5 py-1.5 text-xs font-semibold bg-background hover:bg-muted text-slate-700 dark:text-slate-300 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
              <span>{previewDemo ? 'Thoát xem thử' : 'Xem mô phỏng AI'}</span>
            </button>
          )}
          <Link
            href="/alerts#alert-rules"
            className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 px-3.5 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <span>Cấu hình ngưỡng</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* VISUAL AI RISK THREAT METER */}
      <div className="rounded-xl bg-slate-100/70 dark:bg-slate-900/60 p-3.5 border border-border space-y-2">
        <div className="flex items-center justify-between text-xs font-medium">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <Activity className="w-4 h-4 text-cyan-500" />
            <span>Thang mức độ nguy cơ thời tiết theo AI đánh giá:</span>
          </span>
          <span className="font-bold text-xs uppercase tracking-wider">
            {currentTier === 4 && <span className="text-rose-600 dark:text-rose-400">Mức 4: Nguy hiểm khẩn cấp</span>}
            {currentTier === 3 && <span className="text-amber-600 dark:text-amber-400">Mức 3: Cảnh báo mưa lớn</span>}
            {currentTier === 2 && <span className="text-blue-600 dark:text-blue-400">Mức 2: Theo dõi mưa vừa</span>}
            {currentTier === 1 && <span className="text-emerald-600 dark:text-emerald-400">Mức 1: An toàn (Tạnh ráo)</span>}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2 text-[11px] font-semibold text-center">
          <div
            className={`py-1.5 px-2 rounded-lg transition-all border ${
              currentTier === 1
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/25 border-emerald-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 opacity-60'
            }`}
          >
            1. An toàn
          </div>
          <div
            className={`py-1.5 px-2 rounded-lg transition-all border ${
              currentTier === 2
                ? 'bg-blue-500 text-white font-bold shadow-md shadow-blue-500/25 border-blue-400'
                : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 opacity-60'
            }`}
          >
            2. Theo dõi
          </div>
          <div
            className={`py-1.5 px-2 rounded-lg transition-all border ${
              currentTier === 3
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25 border-amber-400'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 opacity-60'
            }`}
          >
            3. Cảnh báo
          </div>
          <div
            className={`py-1.5 px-2 rounded-lg transition-all border ${
              currentTier === 4
                ? 'bg-rose-600 text-white font-bold shadow-md shadow-rose-600/25 border-rose-400 animate-pulse'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20 opacity-60'
            }`}
          >
            4. Khẩn cấp
          </div>
        </div>
      </div>

      {!data || isError ? (
        <div className="p-8 text-center rounded-xl border border-border bg-card" role="status">
          <div className="w-8 h-8 mx-auto mb-2 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">{isError ? 'Chưa tải được kết quả theo dõi mưa của trạm.' : 'Đang phân tích số liệu khí tượng thời gian thực…'}</p>
        </div>
      ) : (
        /* MAIN 4-PANEL INTELLIGENCE GRID */
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

          {/* CARD 1: DỰ BÁO LƯỢNG MƯA 60 PHÚT TỚI (AI MODEL) */}
          <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 via-card to-card p-4 space-y-3 relative overflow-hidden shadow-xs">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Sparkles className="w-4 h-4 text-cyan-500" />
                <span>AI Dự Báo 60 Phút Tới</span>
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                {data.forecast.method === 'ridge' ? 'Ridge Model' : 'Mô hình thích ứng'}
              </span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold font-mono text-slate-900 dark:text-slate-100">
                  {data.forecast.estimatedRainMm === null ? '0.00' : number(data.forecast.estimatedRainMm)}
                </span>
                <span className="text-sm font-bold text-cyan-600 dark:text-cyan-400">mm</span>
                {data.forecast.estimatedRainMm !== null && data.forecast.estimatedRainMm > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto font-mono">
                    ~{number(data.forecast.estimatedRainMm)} mm/h TB
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="w-3.5 h-3.5 text-cyan-500" />
                <span>Thời hạn dự báo: {time(data.forecast.validFrom)} – {time(data.forecast.validTo)}</span>
              </div>
            </div>

            {/* AI Reasoning Insight Box */}
            <div className="p-2.5 rounded-lg bg-cyan-500/5 dark:bg-slate-800/60 border border-cyan-500/20 text-xs text-slate-700 dark:text-slate-300 space-y-1">
              <div className="font-semibold text-[11px] text-cyan-700 dark:text-cyan-400 flex items-center gap-1">
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>Nhận định thuật toán AI:</span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                {data.forecast.reason || 'Dự báo lượng mưa trong 60 phút tới dựa trên động lực học khí áp và chuỗi đo.'}
              </p>
            </div>
          </div>

          {/* CARD 2: QUAN TRẮC MƯA ĐA CỬA SỔ TRƯỢT */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <CloudRain className="w-4 h-4 text-blue-500" />
                <span>{data.demo ? 'Mưa Quan Trắc (Mô phỏng)' : 'Mưa Quan Trắc Thực Đo'}</span>
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">Gàu A3144</span>
            </div>

            <dl className="space-y-2 text-xs">
              {data.windows.filter((window) => window.minutes !== 5).map((window) => {
                const maxVal = Math.max(1, ...(data.windows.map((w) => w.rainfallMm ?? 0)));
                const pct = Math.min(100, Math.round(((window.rainfallMm ?? 0) / (maxVal || 1)) * 100));
                return (
                  <div key={window.minutes} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <dt className="text-muted-foreground font-medium">{titles[window.minutes]}:</dt>
                      <dd className="font-mono font-bold text-slate-800 dark:text-slate-200" title={rainQualityLabels[window.quality]}>
                        {window.rainfallMm === null ? (
                          <span className="text-[11px] font-normal text-muted-foreground">{rainQualityLabels[window.quality]}</span>
                        ) : (
                          <>
                            <span>{number(window.rainfallMm)} mm</span>
                            {window.averageMmH !== null && (
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground font-sans">
                                ({number(window.averageMmH)} mm/h)
                              </span>
                            )}
                          </>
                        )}
                      </dd>
                    </div>
                    {window.rainfallMm !== null && (
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(window.rainfallMm > 0 ? 8 : 0, pct)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </dl>

            {data.observedAt && (
              <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                Bản tin mới nhất: {time(data.observedAt)}
              </p>
            )}
          </div>

          {/* CARD 3: ĐỘNG LỰC KHÍ ÁP & BIẾN THIÊN */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Gauge className="w-4 h-4 text-purple-500" />
                <span>Áp Suất Khí Quyển (BMP180)</span>
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">3 giờ trượt</span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold font-mono text-slate-900 dark:text-slate-100">
                  {data.pressure.hpa === null ? '---' : number(data.pressure.hpa)}
                </span>
                <span className="text-sm font-bold text-slate-400">hPa</span>
              </div>

              {/* Delta 3h Badge */}
              <div className="mt-2 flex items-center gap-2">
                {data.pressure.delta3hHpa !== null ? (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                      data.pressure.delta3hHpa < -2.5
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                        : data.pressure.delta3hHpa < 0
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {data.pressure.delta3hHpa < -2.5 ? (
                      <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                    ) : data.pressure.delta3hHpa < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span>
                      {data.pressure.delta3hHpa > 0 ? '+' : ''}
                      {number(data.pressure.delta3hHpa)} hPa / 3h
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{data.pressure.reason || 'Thiếu số đo'}</span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-border/50">
              {data.pressure.delta3hHpa !== null && data.pressure.delta3hHpa < -2.5
                ? 'Khí áp suy giảm sâu báo hiệu mây dông đối lưu mạnh và nguy cơ mưa lớn.'
                : data.pressure.delta3hHpa !== null && data.pressure.delta3hHpa < 0
                ? 'Áp suất khí quyển giảm nhẹ, độ ẩm tăng cao, thời tiết có thể chuyển mưa.'
                : 'Khí quyển duy trì trạng thái ổn định, ít có khả năng biến động thời tiết cực đoan.'}
            </p>
          </div>

          {/* CARD 4: TRUNG TÂM CẢNH BÁO NGUY CƠ & KHUYẾN NGHỊ */}
          <div
            className={`rounded-xl border p-4 space-y-3 shadow-xs transition-colors ${
              evidence?.severity === 'CRITICAL'
                ? 'bg-rose-500/5 border-rose-500/30'
                : evidence?.severity === 'WARNING'
                ? 'bg-amber-500/5 border-amber-500/30'
                : 'bg-card border-border'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                {evidence ? (
                  <ShieldAlert className={`w-4 h-4 ${evidence.severity === 'CRITICAL' ? 'text-rose-500' : 'text-amber-500'}`} />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                )}
                <span>Cảnh Báo Quan Trắc</span>
              </span>

              {evidence ? (
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                    evidence.severity === 'CRITICAL'
                      ? 'bg-rose-500 text-white shadow-xs'
                      : 'bg-amber-500 text-slate-950 shadow-xs'
                  }`}
                >
                  {evidence.severity === 'CRITICAL' ? 'KHẨN CẤP' : 'CẢNH BÁO'}
                </span>
              ) : (
                <span className="rounded-md px-2 py-0.5 text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                  {data.observation.status === 'dry' ? 'AN TOÀN' : 'THEO DÕI'}
                </span>
              )}
            </div>

            <div>
              <p
                role="status"
                className={`text-sm font-bold ${
                  evidence?.severity === 'CRITICAL'
                    ? 'text-rose-600 dark:text-rose-400'
                    : evidence?.severity === 'WARNING'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                {rainObservationLabel(data.observation)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {evidence ? formatRainEvidence(evidence) : 'Lượng mưa tích lũy 60 phút nằm dưới ngưỡng trạm cấu hình.'}
              </p>
            </div>

            {/* AI Operational Action Recommendation */}
            <div
              className={`p-2.5 rounded-lg text-xs leading-relaxed border ${
                currentTier === 4
                  ? 'bg-rose-500/10 text-rose-800 dark:text-rose-200 border-rose-500/30 font-medium'
                  : currentTier === 3
                  ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30 font-medium'
                  : 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-border'
              }`}
            >
              {getAiRecommendation()}
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground">
                Ngưỡng: &gt; 15 mm / 60 phút
              </span>
              <Link
                href="/alerts#alert-rules"
                className="text-xs font-semibold text-cyan-600 hover:text-cyan-500 dark:text-cyan-400 flex items-center gap-1"
              >
                <span>Xem quy tắc</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
