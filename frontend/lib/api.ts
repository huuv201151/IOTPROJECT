const DEFAULT_REMOTE_API = 'https://rainsense-backend.onrender.com';
const rawBase =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? DEFAULT_REMOTE_API
    : 'http://localhost:5000');
const API_BASE = rawBase.replace(/\/+$/, '');

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      cache: 'no-store'
    });

    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `Lỗi khi gọi API (${res.status})`);
    }
    return json.data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const api = {
  getDashboardSummary: (deviceId?: string) =>
    request<any>(`/api/dashboard/summary${deviceId ? `?deviceId=${deviceId}` : ''}`),

  getDevices: () => request<any[]>('/api/devices'),
  getDevice: (id: string) => request<any>(`/api/devices/${id}`),
  getConfig: (id: string) => request<any>(`/api/devices/${id}/config`),
  updateConfig: (id: string, config: any) =>
    request<any>(`/api/devices/${id}/config`, {
      method: 'PATCH',
      body: JSON.stringify(config)
    }),

  sendCommand: (id: string, action: string, payload?: any) =>
    request<any>(`/api/devices/${id}/command`, {
      method: 'POST',
      body: JSON.stringify({ action, payload })
    }),
  getCommands: (id: string) => request<any[]>(`/api/devices/${id}/commands`),
  resetDeviceData: (id: string) =>
    request<any>(`/api/devices/${id}/reset-data`, { method: 'POST' }),

  getLatest: (id: string) => request<any>(`/api/devices/${id}/latest`),
  getMeasurements: (id: string, range: string = '24h', from?: string, to?: string) => {
    let q = `?range=${range}`;
    if (from) q += `&from=${encodeURIComponent(from)}`;
    if (to) q += `&to=${encodeURIComponent(to)}`;
    return request<any[]>(`/api/devices/${id}/measurements${q}`);
  },
  getEnvironmentalStats: (id: string) => request<any>(`/api/devices/${id}/statistics`),

  getRainfallStats: (id: string) => request<any>(`/api/devices/${id}/rainfall`),
  getHourlyRain: (id: string, hours: number = 24) =>
    request<any[]>(`/api/devices/${id}/hourly-rain?hours=${hours}`),
  getDailyRain: (id: string, days: number = 7) =>
    request<any[]>(`/api/devices/${id}/daily-rain?days=${days}`),

  getAlerts: (deviceId?: string, isRead?: boolean) => {
    let q = '';
    if (deviceId) q += `?deviceId=${deviceId}`;
    if (isRead !== undefined) q += `${q ? '&' : '?'}isRead=${isRead}`;
    return request<any[]>(`/api/alerts${q}`);
  },
  resolveAlert: (id: string) =>
    request<any>(`/api/alerts/${id}/resolve`, { method: 'PATCH' }),

  getAlertRules: (deviceId: string) => request<any[]>(`/api/alerts/rules/${deviceId}`),
  createAlertRule: (rule: any) =>
    request<any>('/api/alerts/rules', { method: 'POST', body: JSON.stringify(rule) }),
  updateAlertRule: (id: string, rule: any) =>
    request<any>(`/api/alerts/rules/${id}`, { method: 'PATCH', body: JSON.stringify(rule) }),

  getDemoMode: () => request<any>('/api/demo/mode'),
  toggleDemoMode: (enable?: boolean) =>
    request<any>('/api/demo/toggle', { method: 'POST', body: JSON.stringify({ enable }) }),
  simulateTip: (count: number = 1) =>
    request<any>('/api/demo/simulate-tip', { method: 'POST', body: JSON.stringify({ count }) }),

  getExportUrl: (deviceId: string, from?: string, to?: string, types?: string[]) => {
    let q = `deviceId=${deviceId}`;
    if (from) q += `&from=${encodeURIComponent(from)}`;
    if (to) q += `&to=${encodeURIComponent(to)}`;
    if (types && types.length) q += `&types=${types.join(',')}`;
    return `${API_BASE}/api/export?${q}`;
  },

  // RainSense AI Assistant
  chatWithAi: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = [], deviceId?: string) =>
    request<{ reply: string; context: any; provider?: string; model?: string }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history, deviceId })
    }),
  getAiContext: (deviceId?: string) =>
    request<any>(`/api/ai/context${deviceId ? `?deviceId=${deviceId}` : ''}`),
  getAiConfig: () =>
    request<{ hasKey: boolean; model: string; keyMasked: string; provider: string }>('/api/ai/config'),
  updateAiConfig: (apiKey?: string, model?: string) =>
    request<{ hasKey: boolean; model: string; keyMasked: string; provider: string }>('/api/ai/config', {
      method: 'POST',
      body: JSON.stringify({ apiKey, model })
    }),
  testAiKey: (apiKey?: string, model?: string) =>
    request<{ success: boolean; model: string; reply: string }>('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify({ apiKey, model })
    })
};
