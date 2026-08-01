import Image from "next/image";
import { cn } from "../../lib/utils";
import illustration5 from "../../assets/illustrations/illustration5.svg";
import illustration6 from "../../assets/illustrations/illustration6.svg";
import type { UserRole } from "./types";

interface RoleSelectStepProps {
  role: UserRole;
  onSelectRole: (role: UserRole) => void;
  onContinue: () => void;
}

export function RoleSelectStep({ role, onSelectRole, onContinue }: RoleSelectStepProps) {
  return (
    <div className="w-full max-w-[480px] space-y-8">
      <div className="text-center">
        <h1 data-reveal className="text-2xl font-medium font-rethink text-stone-900 tracking-tighter">
          How do you want to<br />use EasilyPromote?
        </h1>
      </div>

      <div data-reveal className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => onSelectRole("business")}
          className={cn(
            "p-4 rounded-2xl border text-left space-y-4 transition-all duration-200 outline-none flex flex-col justify-between",
            role === "business"
              ? "border-[#FEB604] bg-white"
              : "border-transparent bg-white"
          )}
        >
          <div className="w-full h-32 flex items-center justify-center relative">
            <Image src={illustration5} alt="I'm a business" width={110} height={110} />
          </div>
          <div className="space-y-1.5 mt-auto">
            <h3 className="font-medium text-lg text-stone-900 font-rethink tracking-tighter">I&apos;m a business</h3>
            <p className="text-base text-stone-500 font-medium leading-normal font-rethink tracking-[-0.01em]">
              Create and fund campaigns, get verified views
            </p>
          </div>
        </button>

        <button
          onClick={() => onSelectRole("creator")}
          className={cn(
            "p-4 rounded-2xl border text-left space-y-4 transition-all duration-200 outline-none flex flex-col justify-between",
            role === "creator"
              ? "border-[#FEB604] bg-white"
              : "border-transparent bg-white"
          )}
        >
          <div className="w-full h-32 flex items-center justify-center relative">
            <Image src={illustration6} alt="I'm a creator" width={110} height={110} />
          </div>
          <div className="space-y-1.5 mt-auto">
            <h3 className="font-medium text-lg text-stone-900 font-rethink tracking-tighter">I&apos;m a creator</h3>
            <p className="text-base text-stone-500 font-medium leading-normal font-rethink tracking-[-0.01em]">
              Claim slots and get paid<br />for real views
            </p>
          </div>
        </button>
      </div>

      <div data-reveal className="flex justify-center">
        <button
          onClick={onContinue}
          className="w-[300px] max-w-full py-3 bg-[#FEB604] text-stone-900 font-semibold text-sm rounded-full font-rethink"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
