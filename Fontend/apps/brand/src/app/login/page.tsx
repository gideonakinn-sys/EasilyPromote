"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LeftPanel } from "../../components/auth/left-panel";
import { LoginStep } from "../../components/auth/login-step";
import { OtpStep } from "../../components/auth/otp-step";
import type { AuthFormState } from "../../components/auth/types";
import { apiRequest, saveAuth } from "../../lib/api";
import { useReveal } from "../../hooks/use-reveal";

type LoginPageStep = "login" | "otp";

export default function LoginPage() {
  const router = useRouter();
  useReveal();

  const [step, setStep] = useState<LoginPageStep>("login");

  const [form, setForm] = useState<AuthFormState>({
    businessName: "",
    industry: "Technology",
    firstName: "",
    lastName: "",
    nickname: "",
    email: "",
    phone: "",
    password: "",
    showPassword: false,
    agreed: true,
    otpValues: ["", "", "", "", "", ""],
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const setField = <K extends keyof AuthFormState>(key: K, value: AuthFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleOtpChange = (index: number, value: string) => {
    const char = value.replace(/[^a-zA-Z0-9]/g, "").slice(-1).toUpperCase();
    const newOtp = [...form.otpValues];
    newOtp[index] = char;
    setField("otpValues", newOtp);
  };

  const actions = { setField, goToStep: () => {} };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiRequest<{
        token: string;
        refreshToken: string;
        user: { id: string; name: string; email: string; role: string; emailVerified: boolean };
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.email, password: form.password }),
      });

      saveAuth(data.token, data.user);

      if (!data.user.emailVerified) {
        await apiRequest("/auth/send-otp", {
          method: "POST",
          body: JSON.stringify({ email: form.email, purpose: "registration" }),
        });
        setStep("otp");
        return;
      }

      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const code = form.otpValues.join("");
      if (code.length !== 6) throw new Error("Enter all 6 digits");

      const data = await apiRequest<{ token: string; user: { id: string; name: string; email: string; role: string; emailVerified: boolean } }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email: form.email, otp: code, purpose: "registration" }),
      });

      saveAuth(data.token, data.user);

      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-white">
      <LeftPanel />

      <div className="col-span-1 md:col-span-7 flex items-center justify-center p-10 overflow-y-auto h-screen bg-stone-100">
        {error && (
          <div className="fixed top-4 right-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3 z-50">
            {error}
          </div>
        )}

        {step === "login" && (
          <LoginStep
            form={form}
            actions={actions}
            onSubmit={handleLogin}
            onForgotPassword={() => router.push("/forgot-password")}
            onCreateAccount={() => router.push("/create-account")}
            loading={loading}
          />
        )}

        {step === "otp" && (
          <OtpStep
            email={form.email}
            otpValues={form.otpValues}
            onOtpChange={handleOtpChange}
            onSubmit={handleVerifyOtp}
            loading={loading}
            onResend={async () => {
              try {
                await apiRequest("/auth/send-otp", {
                  method: "POST",
                  body: JSON.stringify({ email: form.email, purpose: "registration" }),
                });
              } catch {}
            }}
          />
        )}
      </div>
    </div>
  );
}
