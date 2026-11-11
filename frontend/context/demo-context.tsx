'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DemoScenarioId, DEMO_SCENARIOS, getDemoEnvironment, DemoEnvironmentData } from '@/lib/demo-scenarios';
import { calculateDewPoint, calculateHeatIndex } from '@/lib/weather-calc';
import { formatTimeVi, formatDateTimeVi } from '@/lib/utils';
import { api } from '@/lib/api';

export interface RuntimeChartPoint {
  id: string;
  timestamp: string;
  time: string;
  fullTime: string;
  temperature: number;
  humidity: number;
  pressure: number;
  dewPoint: number;
  heatIndex?: number;
  source: 'live' | 'demo';
}

interface DemoContextType {
  isDemoMode: boolean;
  demoScenario: DemoScenarioId;
  demoEnvironment: DemoEnvironmentData;
  runtimePoints: RuntimeChartPoint[];
  setDemoMode: (enable: boolean) => void;
  setDemoScenario: (scenario: DemoScenarioId) => void;
  toggleDemoMode: () => void;
}

const defaultEnv = getDemoEnvironment('low', 0);

const DemoContext = createContext<DemoContextType>({
  isDemoMode: false,
  demoScenario: 'low',
  demoEnvironment: defaultEnv,
  runtimePoints: [],
  setDemoMode: () => {},
  setDemoScenario: () => {},
  toggleDemoMode: () => {}
});

export function useDemo() {
  return useContext(DemoContext);
}

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [demoScenario, setDemoScenarioState] = useState<DemoScenarioId>('low');
  const [tick, setTick] = useState<number>(0);
  const [runtimePoints, setRuntimePoints] = useState<RuntimeChartPoint[]>([]);

  // Load saved preferences
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('rainsense-demo-mode') === 'true';
      const savedScenario = (localStorage.getItem('rainsense-demo-scenario') as DemoScenarioId) || 'low';
      setIsDemoMode(savedMode);
      if (DEMO_SCENARIOS[savedScenario]) {
        setDemoScenarioState(savedScenario);
      }
    } catch (e) {}
  }, []);

  const setDemoMode = useCallback(
    (enable: boolean) => {
      setIsDemoMode(enable);
      try {
        localStorage.setItem('rainsense-demo-mode', enable ? 'true' : 'false');
      } catch (e) {}

      // Keep real hardware data fresh
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      queryClient.invalidateQueries({ queryKey: ['rainfall'] });
      queryClient.invalidateQueries({ queryKey: ['hourlyRain'] });
      queryClient.invalidateQueries({ queryKey: ['telemetrySeries'] });
      queryClient.invalidateQueries({ queryKey: ['demoMode'] });
      api.toggleDemoMode(enable).catch(() => {});
    },
    [queryClient]
  );

  const toggleDemoMode = useCallback(() => {
    setDemoMode(!isDemoMode);
  }, [isDemoMode, setDemoMode]);

  const setDemoScenario = useCallback((scenario: DemoScenarioId) => {
    if (DEMO_SCENARIOS[scenario]) {
      setDemoScenarioState(scenario);
      setTick(0);
      try {
        localStorage.setItem('rainsense-demo-scenario', scenario);
      } catch (e) {}
    }
  }, []);

  const demoEnvironment = useMemo(
    () => getDemoEnvironment(demoScenario, tick),
    [demoScenario, tick]
  );

  const envRef = useRef({ isDemoMode, demoEnvironment });
  useEffect(() => {
    envRef.current = { isDemoMode, demoEnvironment };
  }, [isDemoMode, demoEnvironment]);

  // Chu kỳ ghi nhận biểu đồ 10 giây/lần (giữ nguyên dữ liệu cũ, chỉ nối thêm điểm mới nhất theo mode)
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);

      const { isDemoMode: currentIsDemo, demoEnvironment: currentDemoEnv } = envRef.current;
      const now = new Date();
      const iso = now.toISOString();

      let temp: number | null = null;
      let hum: number | null = null;
      let press: number | null = null;
      let source: 'live' | 'demo' = 'live';

      if (currentIsDemo) {
        temp = currentDemoEnv.temperature;
        hum = currentDemoEnv.humidity;
        press = currentDemoEnv.pressure;
        source = 'demo';
      } else {
        const overview = queryClient.getQueryState<any>(['dashboardSummary', 'RS-ESP32S3-01']);
        const environmental = queryClient.getQueryState<any>(['dashboardSummary']);
        const summary = overview && overview.dataUpdatedAt >= (environmental?.dataUpdatedAt ?? 0)
          ? overview.data : environmental?.data;
        const latest = summary?.latestMeasurement;
        if (latest && typeof latest.temperature === 'number') {
          temp = latest.temperature;
          hum = latest.humidity;
          press = latest.pressure;
          source = 'live';
        }
      }

      if (temp !== null && hum !== null && press !== null) {
        const pt: RuntimeChartPoint = {
          id: `rt-${now.getTime()}`,
          timestamp: iso,
          time: formatTimeVi(iso),
          fullTime: formatDateTimeVi(iso),
          temperature: temp,
          humidity: hum,
          pressure: press,
          dewPoint: calculateDewPoint(temp, hum),
          heatIndex: calculateHeatIndex(temp, hum),
          source
        };

        setRuntimePoints((prev) => {
          const next = [...prev, pt];
          return next.length > 120 ? next.slice(next.length - 120) : next;
        });
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [queryClient]);

  return (
    <DemoContext.Provider
      value={{
        isDemoMode,
        demoScenario,
        demoEnvironment,
        runtimePoints,
        setDemoMode,
        setDemoScenario,
        toggleDemoMode
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}
