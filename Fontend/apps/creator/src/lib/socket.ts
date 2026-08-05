"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getToken } from "./api";

const SOCKET_URL = (() => {
  if (typeof window === "undefined") return "http://localhost:5000";
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    try {
      return new URL(apiUrl).origin;
    } catch {
      return "http://localhost:5000";
    }
  }
  return "http://localhost:5000";
})();

let socket: Socket | null = null;

export interface CampaignUpdate {
  campaignId: string;
  slotId?: string | null;
  status?: string;
  reward?: number | null;
  viewTarget?: number;
  costPerView?: number;
  progress?: number;
  currentViews?: number;
  targetViews?: number;
  submissionId?: string;
  comment?: string;
  delivery?: string;
  postedPlatforms?: Array<{ platform: string; views: number }>;
}

export function useCampaignUpdates(onUpdate?: (data: CampaignUpdate) => void) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    if (!socket) {
      socket = io(SOCKET_URL, {
        auth: { token },
        transports: ["websocket", "polling"],
      });

      socket.on("connect", () => {
        console.log("[Socket] Connected");
      });

      socket.on("disconnect", () => {
        console.log("[Socket] Disconnected");
      });
    }

    const handleUpdate = (data: CampaignUpdate) => {
      console.log("[Socket] Campaign update:", data);
      callbackRef.current?.(data);
    };

    socket.on("campaign-update", handleUpdate);

    return () => {
      socket?.off("campaign-update", handleUpdate);
    };
  }, []);

  return socket;
}
