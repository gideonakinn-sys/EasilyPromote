import Image from "next/image";
import imagePng from "../../assets/image.png";
import logoSvg from "../../assets/logo.svg";

interface LeftPanelProps {
  title?: string;
  description?: string;
}

export function LeftPanel({
  title = "Get thousands of creators promoting your business",
  description = "EasilyPromote is a performance marketplace for businesses that want proof, not promises. Fund a target, let creators deliver it, and your budget stays in escrow until the views are verified.",
}: LeftPanelProps) {
  return (
    <div
      className="hidden md:flex md:col-span-5 bg-[#FEB604] p-10 flex-col justify-between relative overflow-hidden h-screen"
      style={{
        backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.16) 1.5px, transparent 1.5px)",
        backgroundSize: "18px 18px",
      }}
    >
      <div data-reveal-left>
        <Image src={logoSvg} alt="EasilyPromote" width={40} height={40} priority />
      </div>

      <div data-reveal-left className="relative w-64 h-64 mx-auto my-10 flex-1 flex items-center justify-center">
        <div className="absolute w-52 h-52 rounded-[24px] bg-stone-900/10 transform rotate-[-6deg] translate-x-2 translate-y-1" />
        <div className="absolute w-52 h-52 rounded-[24px] overflow-hidden border-4 border-white transform rotate-[-3deg]">
          <Image
            src={imagePng}
            alt="Creator smiling in hoodie"
            fill
            className="object-cover"
            priority
          />
        </div>
      </div>

      <div data-reveal-left className="space-y-4 w-[430px]">
        <h2 className="text-4xl font-medium text-stone-900 font-rethink leading-tight tracking-tighter">
          {title}
        </h2>
        <p className="text-sm font-medium text-stone-900/80 leading-relaxed font-rethink tracking-[-0.01em]">
          {description}
        </p>
      </div>
    </div>
  );
}
