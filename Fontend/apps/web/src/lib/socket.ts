"use client";

import { useEffect, useRef, useCallback } from "react";
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
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;

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
      updateRef.current?.(data);
    };

    socket.on("campaign-update", handleUpdate);

    return () => {
      socket?.off("campaign-update", handleUpdate);
    };
  }, []);

  return socket;
}

export function useSocket(
  onPaymentSuccess?: (data: { campaignId: string; status: string }) => void,
  onCampaignStatus?: (data: { campaignId: string; status: string; viewsDelivered?: number; targetViews?: number }) => void
) {
  const paymentRef = useRef(onPaymentSuccess);
  paymentRef.current = onPaymentSuccess;
  const statusRef = useRef(onCampaignStatus);
  statusRef.current = onCampaignStatus;

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

    const handlePayment = (data: { campaignId: string; status: string }) => {
      console.log("[Socket] Payment success:", data);
      paymentRef.current?.(data);
    };

    const handleCampaignStatus = (data: { campaignId: string; status: string; viewsDelivered?: number; targetViews?: number }) => {
      console.log("[Socket] Campaign status:", data);
      statusRef.current?.(data);
    };

    socket.on("payment-success", handlePayment);
    socket.on("campaign-status", handleCampaignStatus);

    return () => {
      socket?.off("payment-success", handlePayment);
      socket?.off("campaign-status", handleCampaignStatus);
    };
  }, []);

  return socket;
}

export interface ReferralConversionUpdate {
  campaignId: string;
  referralCodeId: string;
  code: string;
  eventType: string;
  counted: boolean;
  conversions: number;
}

export function useReferralConversions(onConversion?: (data: ReferralConversionUpdate) => void) {
  const conversionRef = useRef(onConversion);
  conversionRef.current = onConversion;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    if (!socket) {
      socket = io(SOCKET_URL, {
        auth: { token },
        transports: ["websocket", "polling"],
      });
    }

    const handleConversion = (data: ReferralConversionUpdate) => {
      conversionRef.current?.(data);
    };

    socket.on("referral-conversion", handleConversion);

    return () => {
      socket?.off("referral-conversion", handleConversion);
    };
  }, []);

  return socket;
}
