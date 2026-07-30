"use client";

import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, { path: "/socket.io", transports: ["websocket", "polling"] });
  }
  return socket;
}

export function joinRoom(sessionId: number, role: "student" | "lecturer") {
  const s = getSocket();
  const emit = () => s.emit("join_session", { session_id: sessionId, role });
  if (s.connected) emit();
  s.on("connect", emit);
  return s;
}
