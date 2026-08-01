"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LeftPanel } from "@ep/ui/components/auth/left-panel";
import { ForgotStep } from "@ep/ui/components/auth/forgot-step";
import { OtpStep } from "@ep/ui/components/auth/otp-step";
import { ResetPasswordStep } from "@ep/ui/components/auth/reset-password-step";
import { apiRequest } from "../../../lib/api";
import { useReveal } from "../../../hooks/use-reveal";

type ForgotPasswordStep = "forgot" | "otp" | "reset-password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<ForgotPasswordStep>("forgot");
  useReveal(step);

  const [email, setEmail] = useState("");
  const [otpValues, setOtpValues] = useState<string[]>(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleOtpChange = (index: number, value: string) => {
    const char = value.replace(/[^a-zA-Z0-9]/g, "").slice(-1).toUpperCase();
    const newOtp = [...otpValues];
    newOtp[index] = char;
    setOtpValues(newOtp);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiRequest("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });

      setStep("otp");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const code = otpValues.join("");
      if (code.length !== 6) throw new Error("Enter all 6 digits");

      const data = await apiRequest<{ resetToken: string }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp: code, purpose: "forgot_password" }),
      });

      sessionStorage.setItem("resetToken", data.resetToken);
      setStep("reset-password");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return;
    setError("");
    setLoading(true);

    try {
      const resetToken = sessionStorage.getItem("resetToken");
      if (!resetToken) throw new Error("Session expired. Please try again.");

      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, token: resetToken, newPassword }),
      });

      sessionStorage.removeItem("resetToken");
      router.push("/login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setLoading(false);
    }
  };

  const actions = { setField: () => {}, goToStep: () => {} };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-white">
      <LeftPanel />
      <div className="col-span-1 md:col-span-7 flex items-center justify-center p-10 overflow-y-auto h-screen bg-stone-100">
        {error && (
          <div className="fixed top-4 right-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-3 z-50">
            {error}
          </div>
        )}

        {step === "forgot" && (
          <ForgotStep email={email} setEmail={setEmail} onSubmit={handleSendCode} actions={actions} onBackToLogin={() => router.push("/login")} loading={loading} />
        )}
        {step === "otp" && (
          <OtpStep
            email={email}
            otpValues={otpValues}
            onOtpChange={handleOtpChange}
            onSubmit={handleVerifyOtp}
            loading={loading}
            onResend={async () => {
              try {
                await apiRequest("/auth/forgot-password", {
                  method: "POST",
                  body: JSON.stringify({ email }),
                });
              } catch {}
            }}
          />
        )}
        {step === "reset-password" && (
          <ResetPasswordStep
            newPassword={newPassword}
            confirmPassword={confirmPassword}
            showPassword={showPassword}
            setNewPassword={setNewPassword}
            setConfirmPassword={setConfirmPassword}
            setShowPassword={setShowPassword}
            onSubmit={handleResetPassword}
            actions={actions}
            onBackToLogin={() => router.push("/login")}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}
