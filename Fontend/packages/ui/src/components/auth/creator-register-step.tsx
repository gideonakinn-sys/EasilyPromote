import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, EyeOffIcon, ChevronDownIcon, CheckIcon } from "@hugeicons/core-free-icons";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "../../lib/utils";
import type { AuthFormState, AuthFormActions } from "./types";

interface CreatorRegisterStepProps {
  form: Pick<AuthFormState, "firstName" | "lastName" | "nickname" | "email" | "phone" | "password" | "showPassword" | "agreed">;
  actions: AuthFormActions;
  onSubmit: (e: React.FormEvent) => void;
  loading?: boolean;
}

export function CreatorRegisterStep({ form, actions, onSubmit, loading }: CreatorRegisterStepProps) {
  return (
    <div className="w-[350px] space-y-8">
      <div className="space-y-1.5">
        <h1 data-reveal className="text-2xl font-medium font-rethink text-stone-900 tracking-tighter">
          Create your creator account
        </h1>
        <p data-reveal className="text-xs text-stone-400 font-medium font-rethink tracking-[-0.01em]">
          Claim slots and get paid for real views.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div data-reveal className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            Full name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              required
              placeholder="First name"
              value={form.firstName}
              onChange={(e) => actions.setField("firstName", e.target.value)}
              className="w-1/2 px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
            />
            <input
              type="text"
              required
              placeholder="Last name"
              value={form.lastName}
              onChange={(e) => actions.setField("lastName", e.target.value)}
              className="w-1/2 px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
            />
          </div>
        </div>

        <div data-reveal className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            Nickname / Alias
          </label>
          <input
            type="text"
            required
            placeholder="Enter your nickname or alias"
            value={form.nickname}
            onChange={(e) => actions.setField("nickname", e.target.value)}
            className="w-full px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
          />
        </div>

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
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            Phone number
          </label>
          <div className="flex gap-2">
            <div className="relative flex-shrink-0">
              <select className="px-4 py-3 border border-stone-200 rounded-full text-sm font-medium text-stone-800 appearance-none focus:outline-none focus:border-stone-400 focus:ring-0 bg-white cursor-pointer transition-colors font-rethink">
                <option value="+234">+234</option>
                <option value="+1">+1</option>
                <option value="+44">+44</option>
              </select>
              <HugeiconsIcon icon={ChevronDownIcon} size={14} className="text-stone-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <input
              type="tel"
              required
              placeholder="Enter Phone number"
              value={form.phone}
              onChange={(e) => actions.setField("phone", e.target.value)}
              className="flex-1 px-4 py-3 border border-stone-200 rounded-full text-sm font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 transition-colors font-rethink"
            />
          </div>
        </div>

        <div data-reveal className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 block font-rethink tracking-[-0.01em]">
            Password
          </label>
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
          <span className="text-xs font-medium text-stone-400 block font-rethink tracking-[-0.01em]">
            Use at least 8 characters, with a number.
          </span>
        </div>

        <div data-reveal className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => actions.setField("agreed", !form.agreed)}
              className={cn(
                "w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0",
                form.agreed
                  ? "bg-stone-950 border-stone-950 text-white"
                  : "border-stone-300 bg-white"
              )}
            >
              {form.agreed && <HugeiconsIcon icon={CheckIcon} size={12} />}
            </button>
            <span className="text-xs font-medium text-stone-500 font-rethink">
              I agree to the Terms of Service and Privacy Policy
            </span>
          </div>

          <button
            type="submit"
            disabled={!form.agreed || loading}
            className="w-full py-3 bg-[#FEB604] disabled:bg-stone-200 text-stone-900 disabled:text-stone-400 font-semibold text-sm rounded-full disabled:cursor-not-allowed font-rethink flex items-center justify-center"
          >
            {loading ? <LoaderCircle role="status" aria-label="Loading" className="size-4 animate-spin" /> : "Continue"}
          </button>

          <p className="text-center text-sm font-medium text-stone-500 font-rethink tracking-[-0.01em]">
            Already have an account?{" "}
            <Link href="/login" className="text-stone-900 font-semibold">
              Login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
