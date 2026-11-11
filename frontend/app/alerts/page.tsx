'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  Sliders,
  Plus,
  ShieldAlert
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTimeVi } from '@/lib/utils';
import { useStationId } from '@/components/layout/AppShell';
import { getSocket } from '@/lib/socket';
import type { AlertRecord } from '@/shared/types/alert';

export default function AlertsPage() {
  const stationId = useStationId();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState<string>('all');
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);

  // Form states for new alert rule
  const [alertType, setAlertType] = useState('RAIN_ACCUMULATION');
  const [threshold, setThreshold] = useState<number>(15);
  const [comparison, setComparison] = useState<'GREATER_THAN' | 'LESS_THAN'>('GREATER_THAN');
  const [severity, setSeverity] = useState<'INFO' | 'WARNING' | 'CRITICAL'>('WARNING');
  const [description, setDescription] = useState('');

  // Fetch alerts
  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', stationId],
    queryFn: () => api.getAlerts(stationId),
    refetchInterval: 5000
  });

  // Fetch alert rules
  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['alertRules', stationId],
    queryFn: () => api.getAlertRules(stationId)
  });

  useEffect(() => {
    const socket = getSocket();
    const refresh = (alert: AlertRecord) => {
      if (alert.deviceId === stationId) {
        void queryClient.invalidateQueries({ queryKey: ['alerts', stationId] });
        void queryClient.invalidateQueries({ queryKey: ['rain-monitor', stationId] });
      }
    };
    socket.on('alert:new', refresh);
    return () => { socket.off('alert:new', refresh); };
  }, [queryClient, stationId]);

  // Resolve alert mutation
  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.resolveAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
    }
  });

  // Toggle rule enabled mutation
  const updateRuleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updateAlertRule(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertRules'] });
      queryClient.invalidateQueries({ queryKey: ['rain-monitor', stationId] });
    }
  });

  // Create rule mutation
  const createRuleMutation = useMutation({
    mutationFn: (newRule: any) => api.createAlertRule(newRule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertRules'] });
      queryClient.invalidateQueries({ queryKey: ['rain-monitor', stationId] });
      setIsRuleModalOpen(false);
    }
  });

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    createRuleMutation.mutate({
      deviceId: stationId,
      alertType,
      threshold: Number(threshold),
      comparison: alertType === 'RAIN_ACCUMULATION' || alertType === 'HEAVY_RAIN' ? 'GREATER_THAN' : comparison,
      severity,
      enabled: true,
      description: description || `Quy tắc cảnh báo ${alertType}`
    });
  };

  const filteredAlerts = alerts.filter((a: any) => {
    if (filterType === 'all') return true;
    if (filterType === 'unread') return !a.isRead;
    if (filterType === 'CRITICAL') return a.severity === 'CRITICAL';
    if (filterType === 'WARNING') return a.severity === 'WARNING';
    return true;
  });

  if (alertsLoading || rulesLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] space-y-4">
        <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Đang tải trung tâm cảnh báo...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <ShieldAlert className="w-7 h-7 text-amber-500" />
            <span>Trung Tâm Cảnh Báo & Sự Kiện (Alerts & Notifications)</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Giám sát các ngưỡng khí tượng vượt mức an toàn, mất kết nối trạm và cấu hình quy tắc cảnh báo
          </p>
        </div>

        <button
          onClick={() => setIsRuleModalOpen(true)}
          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 transition-colors self-start sm:self-auto shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Thêm ngưỡng cảnh báo</span>
        </button>
      </div>

      {/* Alert Rules Section */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <span>Quy tắc cảnh báo đã kích hoạt (Active Alert Rules)</span>
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">{rules.length} quy tắc</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {rules.map((rule: any) => (
            <div
              key={rule.id}
              className={`p-3.5 rounded-xl border transition-all ${
                rule.enabled
                  ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60'
                  : 'bg-slate-100/50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800/40 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    rule.severity === 'CRITICAL'
                      ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                      : rule.severity === 'WARNING'
                      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                      : 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30'
                  }`}
                >
                  {rule.severity}
                </span>

                {/* Toggle switch */}
                <button
                  onClick={() =>
                    updateRuleMutation.mutate({ id: rule.id, enabled: !rule.enabled })
                  }
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
                    rule.enabled ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      rule.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
                {rule.description || rule.alertType}
              </div>
              <div className="font-mono text-cyan-600 dark:text-cyan-300 text-[11px]">
                Ngưỡng: {rule.comparison === 'GREATER_THAN' ? '>' : '<'} {rule.threshold}
                {rule.alertType === 'RAIN_ACCUMULATION'
                  ? ' mm trong 60 phút'
                  : rule.alertType === 'HEAVY_RAIN'
                  ? ' mm/h trong cửa sổ 5 phút'
                  : rule.alertType.includes('TEMPERATURE')
                  ? ' °C'
                  : rule.alertType.includes('HUMIDITY')
                  ? ' %'
                  : ' s'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Alert Log Table */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              <span>Nhật ký Sự kiện & Cảnh báo (Alert History)</span>
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-mono font-bold">
              {alerts.filter((a: any) => !a.isRead).length} chưa đọc
            </span>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs self-start sm:self-auto">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-lg ${filterType === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setFilterType('unread')}
              className={`px-3 py-1 rounded-lg ${filterType === 'unread' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              Chưa đọc
            </button>
            <button
              onClick={() => setFilterType('CRITICAL')}
              className={`px-3 py-1 rounded-lg ${filterType === 'CRITICAL' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              Nghiêm trọng
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          {filteredAlerts.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500/60" />
              <span>Không có sự kiện cảnh báo nào phù hợp với bộ lọc.</span>
            </div>
          ) : (
            filteredAlerts.map((alert: any) => {
              const isCrit = alert.severity === 'CRITICAL';
              const isWarn = alert.severity === 'WARNING';
              return (
                <div
                  key={alert.id}
                  className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                    alert.isRead
                      ? 'bg-slate-50 dark:bg-slate-800/20 border-slate-200 dark:border-slate-800/60 opacity-70'
                      : isCrit
                      ? 'bg-rose-500/10 border-rose-500/30'
                      : isWarn
                      ? 'bg-amber-500/10 border-amber-500/30'
                      : 'bg-blue-500/10 border-blue-500/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {isCrit ? (
                        <AlertOctagon className="w-4 h-4 text-rose-500" />
                      ) : isWarn ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Info className="w-4 h-4 text-blue-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-200">
                        {alert.message}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                        <span>{formatDateTimeVi(alert.createdAt)}</span>
                        <span>•</span>
                        <span>Trạm: {alert.deviceId}</span>
                      </div>
                    </div>
                  </div>

                  {!alert.isRead ? (
                    <button
                      onClick={() => resolveMutation.mutate(alert.id)}
                      disabled={resolveMutation.isPending}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-cyan-700 dark:text-cyan-400 rounded-lg font-medium transition-colors shrink-0 self-end sm:self-auto"
                    >
                      Đánh dấu đã xử lý
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-mono italic shrink-0 self-end sm:self-auto">
                      Đã giải quyết lúc {formatDateTimeVi(alert.resolvedAt)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Modal tạo quy tắc mới */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>Thêm Quy Tắc Cảnh Báo Mới</span>
              </h3>
              <button
                onClick={() => setIsRuleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-3.5">
              <div className="space-y-1">
                <label className="font-medium text-slate-700 dark:text-slate-300">Loại cảnh báo:</label>
                <select
                  value={alertType}
                  onChange={(e) => setAlertType(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-800 dark:text-slate-200 text-xs"
                >
                  <option value="RAIN_ACCUMULATION">Lượng mưa trong 60 phút (mm)</option>
                  <option value="HEAVY_RAIN">Cường độ trong 5 phút (mm/h)</option>
                  <option value="HIGH_TEMPERATURE">Nhiệt độ cao (HIGH_TEMPERATURE)</option>
                  <option value="LOW_TEMPERATURE">Nhiệt độ thấp (LOW_TEMPERATURE)</option>
                  <option value="HIGH_HUMIDITY">Độ ẩm cao (HIGH_HUMIDITY)</option>
                  <option value="LOW_HUMIDITY">Độ ẩm thấp (LOW_HUMIDITY)</option>
                  <option value="DEVICE_OFFLINE">Trạm mất kết nối (DEVICE_OFFLINE)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300">So sánh:</label>
                  <select
                    value={alertType === 'RAIN_ACCUMULATION' || alertType === 'HEAVY_RAIN' ? 'GREATER_THAN' : comparison}
                    disabled={alertType === 'RAIN_ACCUMULATION' || alertType === 'HEAVY_RAIN'}
                    onChange={(e: any) => setComparison(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-800 dark:text-slate-200 text-xs"
                  >
                    <option value="GREATER_THAN">Lớn hơn (&gt;)</option>
                    <option value="LESS_THAN">Nhỏ hơn (&lt;)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    {alertType === 'RAIN_ACCUMULATION' ? 'Ngưỡng (mm trong 60 phút)' : alertType === 'HEAVY_RAIN' ? 'Ngưỡng (mm/h)' : 'Ngưỡng kích hoạt'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min={alertType === 'RAIN_ACCUMULATION' || alertType === 'HEAVY_RAIN' ? '0.1' : undefined}
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100 font-mono text-xs"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-700 dark:text-slate-300">Mức độ nghiêm trọng:</label>
                <select
                  value={severity}
                  onChange={(e: any) => setSeverity(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-800 dark:text-slate-200 text-xs"
                >
                  <option value="INFO">INFO (Thông tin)</option>
                  <option value="WARNING">WARNING (Cảnh báo)</option>
                  <option value="CRITICAL">CRITICAL (Khẩn cấp)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-700 dark:text-slate-300">Mô tả hiển thị:</label>
                <input
                  type="text"
                  placeholder="VD: Cảnh báo mưa to vượt 15 mm/h"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsRuleModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={createRuleMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                >
                  Tạo quy tắc
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
