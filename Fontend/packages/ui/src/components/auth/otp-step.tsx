import { useRef, useState, useEffect, useCallback } from "react";
import { LoaderCircle } from "lucide-react";

interface OtpStepProps {
  email: string;
  otpValues: string[];
  onOtpChange: (index: number, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onResend?: () => void;
  loading?: boolean;
}

export function OtpStep({ email, otpValues, onOtpChange, onSubmit, onResend, loading }: OtpStepProps) {
  const refs = Array.from({ length: 6 }, () => useRef<HTMLInputElement>(null));
  const [secondsLeft, setSecondsLeft] = useState(30);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const handleResend = useCallback(() => {
    setSecondsLeft(30);
    onResend?.();
  }, [onResend]);

  const handleChange = (index: number, val: string) => {
    const char = val.replace(/[^a-zA-Z0-9]/g, "").slice(-1).toUpperCase();
    onOtpChange(index, char);
    if (char && index < 5) {
      refs[index + 1].current?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      onOtpChange(index - 1, "");
      refs[index - 1].current?.focus();
    }
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="w-[350px] space-y-8">
      <div className="space-y-2 text-center">
        <h2 data-reveal className="text-2xl font-medium font-rethink text-stone-900 tracking-tighter">
          Check your inbox
        </h2>
        <p data-reveal className="text-xs text-stone-500 font-medium font-rethink tracking-[-0.01em]">
          Enter the code we sent to {email || "name@business.com"}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div data-reveal className="flex gap-2 justify-center">
          {otpValues.map((val, index) => (
            <input
              key={index}
              ref={refs[index]}
              type="text"
              maxLength={1}
              value={val}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className="w-12 h-14 border border-stone-200 rounded-xl text-center text-lg font-medium text-stone-900 focus:outline-none focus:border-stone-400 focus:ring-0 bg-[#FBFBFA] font-rethink"
            />
          ))}
        </div>

        <div data-reveal className="text-center">
          <span className="text-sm font-semibold text-stone-400 font-rethink">
            Didn&apos;t get it?{" "}
            {secondsLeft > 0 ? (
              <span className="text-stone-900">Resend code ({mm}:{ss})</span>
            ) : (
              <button type="button" onClick={handleResend} className="text-stone-900 underline">
                Resend code
              </button>
            )}
          </span>
        </div>

        <button
          data-reveal
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 text-stone-900 font-semibold text-sm rounded-full disabled:cursor-not-allowed font-rethink flex items-center justify-center"
        >
          {loading ? <LoaderCircle role="status" aria-label="Loading" className="size-4 animate-spin" /> : "Verify"}
        </button>
      </form>
    </div>
  );
}
