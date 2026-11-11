'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatRainEvidence, rainObservationLabel, rainQualityLabels } from '@/shared/rain-monitor';
import type { AlertRecord } from '@/shared/types/alert';

const card = 'rounded-xl border border-border bg-card p-4';
const titles: Record<number, string> = { 15: '15 phút', 60: '1 giờ', 180: '3 giờ', 1440: '24 giờ' };
const severityLabels = { INFO: 'Theo dõi', WARNING: 'Cảnh báo', CRITICAL: 'Nghiêm trọng' };

export function RainMonitorPanel({ deviceId, dashboardDemo }: { deviceId: string; dashboardDemo: boolean }) {
  const [previewDemo, setPreviewDemo] = useState(false);
  const demo = dashboardDemo || previewDemo;
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ['rain-monitor', deviceId, demo],
    queryFn: () => api.getRainMonitor(deviceId, demo),
    refetchInterval: demo ? false : 60000
  });
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
  return (
    <section id="rain-monitor" className="space-y-3" aria-labelledby="rain-monitor-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="rain-monitor-title" className="text-base font-semibold">Theo dõi và cảnh báo mưa</h2>
          <p className="text-xs text-muted-foreground">
            {deviceId}{data && ` · Chốt lúc ${time(data.generatedAt)}`}{data?.demo && ' · Mô phỏng'}
          </p>
        </div>
        {!dashboardDemo && (
          <button type="button" aria-pressed={previewDemo} onClick={() => setPreviewDemo(!previewDemo)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">
            {previewDemo ? 'Thoát xem thử' : 'Xem mô phỏng'}
          </button>
        )}
      </div>
      {!data || isError ? (
        <p className={card} role="status">{isError ? 'Chưa tải được kết quả theo dõi mưa của trạm.' : 'Đang tải kết quả theo dõi mưa…'}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className={card}>
            <h3 className="text-sm font-semibold">{data.demo ? 'Mưa mô phỏng' : 'Mưa thực đo'}</h3>
            <dl className="mt-2 space-y-1 text-xs">
              {data.windows.filter((window) => window.minutes !== 5).map((window) => (
                <div key={window.minutes} className="flex justify-between gap-2">
                  <dt>{titles[window.minutes]}</dt>
                  <dd className="text-right font-medium" title={rainQualityLabels[window.quality]}>
                    {window.rainfallMm === null ? rainQualityLabels[window.quality] : `${number(window.rainfallMm)} mm`}
                    {window.averageMmH !== null && (
                      <span className="ml-1 whitespace-nowrap text-muted-foreground">· {number(window.averageMmH)} mm/h TB</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {data.observedAt && <p className="mt-2 text-xs text-muted-foreground">Bản tin mới nhất {time(data.observedAt)}</p>}
          </div>
          <div className={card}>
            <h3 className="text-sm font-semibold">Xu hướng khí áp</h3>
            <p className="mt-2 font-semibold">{data.pressure.hpa === null ? 'Thiếu số đo' : `${number(data.pressure.hpa)} hPa`}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.pressure.delta3hHpa === null ? data.pressure.reason : `${data.pressure.delta3hHpa > 0 ? '+' : ''}${number(data.pressure.delta3hHpa)} hPa trong 3 giờ`}
            </p>
          </div>
          <div className={card}>
            <h3 className="text-sm font-semibold">Ước tính 60 phút tới</h3>
            <p className="mt-2 font-semibold">{data.forecast.estimatedRainMm === null ? 'Chưa có ước tính' : `${number(data.forecast.estimatedRainMm)} mm`}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.forecast.method === 'ridge' ? `Ridge đã kiểm định · ${data.forecast.modelVersion}` : data.forecast.reason}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{time(data.forecast.validFrom)} – {time(data.forecast.validTo)}</p>
          </div>
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h3 className="text-sm font-semibold">Cảnh báo quan trắc</h3>
              {evidence && (
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${evidence.severity === 'CRITICAL'
                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
                  {severityLabels[evidence.severity]}
                </span>
              )}
            </div>
            <p role="status" className={`mt-2 font-semibold ${data.observation.alert ? 'text-amber-700 dark:text-amber-300' : ''}`}>
              {rainObservationLabel(data.observation)}
            </p>
            {evidence && <p className="mt-1 text-xs">{formatRainEvidence(evidence)}</p>}
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.observation.thresholds?.filter((rule) => rule.ruleId !== data.observation.alert?.ruleId).map((rule) => (
                <li key={rule.ruleId}>
                  <span>Ngưỡng &gt; {number(rule.threshold)} {rule.unit} trong {rule.windowMinutes} phút</span>
                  <span className="block">{rule.value === null ? rainQualityLabels[rule.quality] : `Đã đo ${number(rule.value)} ${rule.unit}`}</span>
                </li>
              ))}
            </ul>
            {!data.observation.rulesConfigured && <p className="mt-1 text-xs text-muted-foreground">Trạm chưa bật ngưỡng cảnh báo mưa.</p>}
            <Link href="/alerts#alert-rules" className="mt-2 inline-block text-xs font-medium text-cyan-700 underline dark:text-cyan-300">Lịch sử và ngưỡng cảnh báo</Link>
          </div>
        </div>
      )}
    </section>
  );
}
