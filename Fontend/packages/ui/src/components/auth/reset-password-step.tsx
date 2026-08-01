import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, EyeOffIcon } from "@hugeicons/core-free-icons";
import { Spinner } from "../spinner";
import type { AuthFormActions } from "./types";

interface ResetPasswordStepProps {
  newPassword: string;
  confirmPassword: string;
  showPassword: boolean;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  setShowPassword: (value: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  actions: AuthFormActions;
  onBackToLogin?: () => void;
  loading?: boolean;
}

export function ResetPasswordStep({
  newPassword,
  confirmPassword,
  showPassword,
  setNewPassword,
  setConfirmPassword,
  setShowPassword,
  onSubmit,
  actions,
  onBackToLogin,
  loading,
}: ResetPasswordStepProps) {
  return (
    <div className="w-[350px] space-y-8">
      <div className="space-y-2 text-center">
        <h2 data-reveal className="text-2xl font-medium font-rethink text-stone-900 tracking-tighter">
          Choose a new password
        </h2>
        <p data-reveal className="text-xs text-stone-500 font-medium font-rethink tracking-[-0.01em]">
          Enter a new password for your account.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div data-reveal className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            New password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="Enter password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-stone-400 absolute right-4 top-1/2 -translate-y-1/2"
            >
              {showPassword ? <HugeiconsIcon icon={EyeOffIcon} size={16} /> : <HugeiconsIcon icon={EyeIcon} size={16} />}
            </button>
          </div>
          <span className="text-xs font-medium text-stone-400 block font-rethink">
            Use at least 8 characters, with a number.
          </span>
        </div>

        <div data-reveal className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            Confirm new password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="Enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-stone-400 absolute right-4 top-1/2 -translate-y-1/2"
            >
              {showPassword ? <HugeiconsIcon icon={EyeOffIcon} size={16} /> : <HugeiconsIcon icon={EyeIcon} size={16} />}
            </button>
          </div>
        </div>

        <button
          data-reveal
          type="submit"
          disabled={!newPassword || newPassword !== confirmPassword || loading}
          className="w-full py-3 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 text-stone-900 font-semibold text-sm rounded-full disabled:cursor-not-allowed font-rethink flex items-center justify-center"
        >
          {loading ? <Spinner /> : "Reset password"}
        </button>
      </form>

      {onBackToLogin && (
        <div data-reveal className="text-center">
          <button
            onClick={onBackToLogin}
            className="text-sm font-medium text-stone-900 font-rethink"
          >
            Back to sign in
          </button>
        </div>
      )}
    </div>
  );
}
