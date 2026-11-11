'use client';

import React, { createContext, useContext, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

const StationContext = createContext('RS-ESP32S3-01');
export const useStationId = () => useContext(StationContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [stationId, setStationId] = useState<string>('RS-ESP32S3-01');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <StationContext.Provider value={stationId}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header
            selectedStation={stationId}
            onSelectStation={setStationId}
            onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          />
          <main className="flex-1 overflow-y-auto p-3 sm:p-5 md:p-6 lg:p-8 space-y-4 sm:space-y-6">
            {children}
          </main>
        </div>
      </div>
    </StationContext.Provider>
  );
}
