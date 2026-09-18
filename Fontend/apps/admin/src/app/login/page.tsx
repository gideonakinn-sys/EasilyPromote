"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAuth, API_URL } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");

      const allowedRoles = ["admin", "super_admin", "finance_admin", "support"];
      if (!allowedRoles.includes(data.user.role)) {
        throw new Error("Access denied: Not authorized for Admin Console");
      }

      saveAuth(data.token, data.user);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa] font-rethink p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-neutral-200/90 p-8">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#FEB604] flex items-center justify-center shadow-lg shadow-[#FEB604]/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-neutral-950">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center text-neutral-900 tracking-tight mb-1">EasilyPromote</h1>
        <p className="text-xs font-semibold text-neutral-500 text-center uppercase tracking-wider font-mono mb-8">Admin Console Authentication</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl p-3.5 mb-6 flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-neutral-700 mb-1">Administrator Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@easilypromote.com"
              className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          <div>
            <label className="block font-bold text-neutral-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 hover:bg-neutral-800 text-white py-3 rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50 mt-2"
          >
            {loading ? "Authenticating..." : "Sign In to Console"}
          </button>
        </form>

        <div className="mt-8 pt-4 border-t border-neutral-100 text-center">
          <p className="text-[11px] text-neutral-400">Protected Administrative System · EasilyPromote</p>
        </div>
      </div>
    </div>
  );
}
