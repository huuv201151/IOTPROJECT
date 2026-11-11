import { io, Socket } from 'socket.io-client';

const DEFAULT_REMOTE_SOCKET = 'https://rainsense-backend-dlxg.onrender.com';

function getSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_DASHBOARD_SAME_ORIGIN === '1' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  const envUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (envUrl && envUrl.trim() !== '') {
    if (
      typeof window === 'undefined' ||
      !envUrl.includes('localhost') ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    ) {
      return envUrl.replace(/\/+$/, '');
    }
  }

  if (typeof window !== 'undefined') {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return DEFAULT_REMOTE_SOCKET;
    }
  }

  return 'http://localhost:5000';
}

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getSocketUrl(), {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling']
    });
  }
  return socket;
}
