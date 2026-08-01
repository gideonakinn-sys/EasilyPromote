"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LeftPanel } from "../../components/auth/left-panel";
import { RoleSelectStep } from "../../components/auth/role-select-step";
import { RegisterStep } from "../../components/auth/register-step";
import { OtpStep } from "../../components/auth/otp-step";
import type { UserRole, AuthFormState } from "../../components/auth/types";
import { apiRequest, saveAuth } from "../../lib/api";
import { useReveal } from "../../hooks/use-reveal";

type CreateAccountStep = "role-select" | "register" | "otp";

export default function CreateAccountPage() {
  const router = useRouter();
  const [step, setStep] = useState<CreateAccountStep>("role-select");
  const [role, setRole] = useState<UserRole>("business");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useReveal(step);

  useEffect(() => {
    const handlePopState = () => {
      setStep((prev) => (prev === "register" ? "role-select" : prev));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
    if (role === "business") {
      setStep("register");
      window.history.pushState({}, "");
    } else {
      alert("Creator flows are currently in beta. Redirecting to Business Registration...");
      setStep("register");
      window.history.pushState({}, "");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.agreed) return;
    setError("");
    setLoading(true);

    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.businessName,
          businessName: form.businessName,
          email: form.email,
          phone: form.phone,
          industry: form.industry,
          password: form.password,
          role: "business",
        }),
      });

      await apiRequest("/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ email: form.email, purpose: "registration" }),
      });

      setStep("otp");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
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

      const data = await apiRequest<{ token: string; user: { id: string; name: string; email: string; role: string } }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email: form.email, otp: code, purpose: "registration" }),
      });

      saveAuth(data.token, data.user);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  const actions = { setField, goToStep: () => {} };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-white">
      <LeftPanel />

      <div className="col-span-1 md:col-span-7 flex items-center justify-center p-10 h-screen overflow-y-auto bg-stone-100">
        {error && (
          <div className="fixed top-4 right-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3 z-50">
            {error}
          </div>
        )}

        {step === "role-select" && (
          <RoleSelectStep role={role} onSelectRole={setRole} onContinue={handleRoleContinue} />
        )}

        {step === "register" && (
          <RegisterStep form={form} actions={actions} onSubmit={handleRegister} loading={loading} />
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

        {step !== "otp" && (
          <div className="absolute bottom-8 left-0 right-0 text-center md:hidden">
            <span className="text-sm font-semibold text-stone-400 font-rethink">
              Already have an account?{" "}
              <Link href="/login" className="text-stone-900 font-medium">
                Sign in
              </Link>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
