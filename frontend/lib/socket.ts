import { io, Socket } from 'socket.io-client';

const DEFAULT_REMOTE_SOCKET = 'https://rainsense-backend.onrender.com';
const rawSocketUrl =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? DEFAULT_REMOTE_SOCKET
    : 'http://localhost:5000');
const SOCKET_URL = rawSocketUrl.replace(/\/+$/, '');

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling']
    });
  }
  return socket;
}
