import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, EyeOffIcon } from "@hugeicons/core-free-icons";
import { LoaderCircle } from "lucide-react";
import type { AuthFormState, AuthFormActions } from "./types";

interface LoginStepProps {
  form: Pick<AuthFormState, "email" | "password" | "showPassword">;
  actions: AuthFormActions;
  onSubmit: (e: React.FormEvent) => void;
  onForgotPassword?: () => void;
  onCreateAccount?: () => void;
  loading?: boolean;
}

export function LoginStep({ form, actions, onSubmit, onForgotPassword, onCreateAccount, loading }: LoginStepProps) {
  const handleForgot = onForgotPassword ?? (() => actions.goToStep("forgot"));
  const handleCreate = onCreateAccount ?? (() => actions.goToStep("role-select"));

  return (
    <div className="w-[350px] space-y-8">
      <div className="space-y-2 text-center">
        <h2 data-reveal className="text-2xl font-medium font-rethink text-stone-900 tracking-tighter">
          Welcome back
        </h2>
        <p data-reveal className="text-xs text-stone-500 font-medium font-rethink tracking-[-0.01em]">
          Sign in to manage your campaigns.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div data-reveal className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            Email address
          </label>
          <input
            type="email"
            required
            placeholder="Enter Email address"
            value={form.email}
            onChange={(e) => actions.setField("email", e.target.value)}
            className="w-full px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
          />
        </div>

        <div data-reveal className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
              Password
            </label>
          </div>
          <div className="relative">
            <input
              type={form.showPassword ? "text" : "password"}
              required
              placeholder="Enter password"
              value={form.password}
              onChange={(e) => actions.setField("password", e.target.value)}
              className="w-full px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
            />
            <button
              type="button"
              onClick={() => actions.setField("showPassword", !form.showPassword)}
              className="text-stone-400 absolute right-4 top-1/2 -translate-y-1/2"
            >
              {form.showPassword ? <HugeiconsIcon icon={EyeOffIcon} size={16} /> : <HugeiconsIcon icon={EyeIcon} size={16} />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleForgot}
            className="text-sm font-medium text-stone-900 block pt-1 font-rethink"
          >
            Forgot password?
          </button>
        </div>

        <button
          data-reveal
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 text-stone-900 font-semibold text-sm rounded-full disabled:cursor-not-allowed font-rethink flex items-center justify-center"
        >
          {loading ? <LoaderCircle role="status" aria-label="Loading" className="size-4 animate-spin" /> : "Sign in"}
        </button>
      </form>

      <div data-reveal className="text-center">
        <span className="text-sm font-semibold text-stone-400 font-rethink">
          New to EasilyPromote?{" "}
          <button
            type="button"
            onClick={handleCreate}
            className="text-stone-900 font-medium"
          >
            Create an account
          </button>
        </span>
      </div>
    </div>
  );
}
