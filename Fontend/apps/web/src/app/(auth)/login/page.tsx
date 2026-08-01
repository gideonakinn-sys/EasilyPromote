"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LeftPanel } from "@ep/ui/components/auth/left-panel";
import { RoleSelectStep } from "@ep/ui/components/auth/role-select-step";
import { RegisterStep } from "@ep/ui/components/auth/register-step";
import { CreatorRegisterStep } from "@ep/ui/components/auth/creator-register-step";
import { OtpStep } from "@ep/ui/components/auth/otp-step";
import { LoginStep } from "@ep/ui/components/auth/login-step";
import { ForgotStep } from "@ep/ui/components/auth/forgot-step";
import { ResetPasswordStep } from "@ep/ui/components/auth/reset-password-step";
import type { OnboardingStep, UserRole, AuthFormState } from "@ep/ui/components/auth/types";
import { useReveal } from "../../../hooks/use-reveal";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("login");
  useReveal(step);
  const [role, setRole] = useState<UserRole>("creator");
  const [postOtpTarget, setPostOtpTarget] = useState<"dashboard" | "reset-password">("dashboard");

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

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const routeAfterAuth = (user: { role?: string }) => {
    const role = user?.role;
    if (role === "creator") {
      router.push("/dashboard/creator");
    } else if (role === "business") {
      router.push("/dashboard/brand");
    } else if (role === "admin" || role === "super_admin" || role === "finance_admin" || role === "support") {
      window.location.href = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3003";
    } else {
      router.push("/");
    }
  };

  const setField = <K extends keyof AuthFormState>(key: K, value: AuthFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleOtpChange = (index: number, value: string) => {
    const char = value.replace(/[^a-zA-Z0-9]/g, "").slice(-1).toUpperCase();
    const newOtp = [...form.otpValues];
    newOtp[index] = char;
    setField("otpValues", newOtp);
  };

  const handleRoleContinue = () => {
    setStep("register");
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.agreed) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          role === "creator"
            ? {
                name: form.nickname || `${form.firstName} ${form.lastName}`.trim(),
                displayName: form.nickname || `${form.firstName} ${form.lastName}`.trim(),
                firstName: form.firstName,
                lastName: form.lastName,
                nickname: form.nickname,
                email: form.email,
                phone: form.phone,
                password: form.password,
                role: "creator",
                username: (form.nickname || form.email.split("@")[0]).toLowerCase().replace(/\s+/g, "_"),
              }
            : {
                name: form.businessName || form.email.split("@")[0],
                businessName: form.businessName,
                email: form.email,
                phone: form.phone,
                industry: form.industry,
                password: form.password,
                role: "business",
                username: form.email.split("@")[0],
              }
        ),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      await fetch(`${API_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, purpose: "registration" }),
      });

      setPostOtpTarget("dashboard");
      setStep("otp");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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

      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, otp: code, purpose: postOtpTarget === "reset-password" ? "forgot_password" : "registration" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "OTP verification failed");

      if (postOtpTarget === "reset-password") {
        sessionStorage.setItem("resetToken", data.resetToken);
        setStep("reset-password");
      } else {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        routeAfterAuth(data.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      if (!data.user.emailVerified) {
        await fetch(`${API_URL}/auth/send-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, purpose: "registration" }),
        });
        setPostOtpTarget("dashboard");
        setStep("otp");
        return;
      }

      routeAfterAuth(data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reset code");

      setPostOtpTarget("reset-password");
      setStep("otp");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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

      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, token: resetToken, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Password reset failed");

      sessionStorage.removeItem("resetToken");
      setStep("login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const actions = { setField, goToStep: setStep };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-white">
      <LeftPanel
        title="Claim campaign slots and earn from real views"
        description="EasilyPromote connects creators with brands. Claim slots, deliver content, and get paid for verified views."
      />

      <div className="col-span-1 md:col-span-7 flex items-center justify-center p-8 md:p-16 overflow-y-auto h-screen bg-white">
        {error && (
          <div className="fixed top-4 right-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-3 z-50">
            {error}
          </div>
        )}

        {step === "role-select" && (
          <RoleSelectStep role={role} onSelectRole={setRole} onContinue={handleRoleContinue} />
        )}

        {step === "register" && (
          role === "creator" ? (
            <CreatorRegisterStep form={form} actions={actions} onSubmit={handleRegister} />
          ) : (
            <RegisterStep form={form} actions={actions} onSubmit={handleRegister} />
          )
        )}

        {step === "otp" && (
          <OtpStep
            email={form.email}
            otpValues={form.otpValues}
            onOtpChange={handleOtpChange}
            onSubmit={handleVerifyOtp}
            onResend={async () => {
              try {
                await fetch(`${API_URL}/auth/send-otp`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: form.email, purpose: "registration" }),
                });
              } catch {}
            }}
          />
        )}

        {step === "login" && (
          <LoginStep form={form} actions={actions} onSubmit={handleLogin} />
        )}

        {step === "forgot" && (
          <ForgotStep
            email={form.email}
            setEmail={(v) => setField("email", v)}
            onSubmit={handleForgotPassword}
            actions={actions}
          />
        )}

        {step === "reset-password" && (
          <ResetPasswordStep
            newPassword={newPassword}
            confirmPassword={confirmPassword}
            showPassword={form.showPassword}
            setNewPassword={setNewPassword}
            setConfirmPassword={setConfirmPassword}
            setShowPassword={(v) => setField("showPassword", v)}
            onSubmit={handleResetPassword}
            actions={actions}
          />
        )}

        {loading && (
          <div className="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50">
            <span className="text-sm font-semibold text-stone-500">Loading...</span>
          </div>
        )}
      </div>
    </div>
  );
}
