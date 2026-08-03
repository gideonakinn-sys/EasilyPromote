import Image from "next/image";
import logoSvg from "../../assets/logo.svg";
import MarqueeAlongSvgPath from "../marquee-along-svg-path";

const MARQUEE_PATH =
  "M1 209.434C58.5872 255.935 387.926 325.938 482.583 209.434C600.905 63.8051 525.516 -43.2211 427.332 19.9613C329.149 83.1436 352.902 242.723 515.041 267.302C644.752 286.966 943.56 181.94 995 156.5";

const MARQUEE_IMGS = [
  { src: "https://cdn.cosmos.so/b9909337-7a53-48bc-9672-33fbd0f040a1?format=jpeg" },
  { src: "https://cdn.cosmos.so/ecdc9dd7-2862-4c28-abb1-dcc0947390f3?format=jpeg" },
  { src: "https://cdn.cosmos.so/79de41ec-baa4-4ac0-a9a4-c090005ca640?format=jpeg" },
  { src: "https://cdn.cosmos.so/1a18b312-21cd-4484-bce5-9fb7ed1c5e01?format=jpeg" },
  { src: "https://cdn.cosmos.so/d765f64f-7a66-462f-8b2d-3d7bc8d7db55?format=jpeg" },
  { src: "https://cdn.cosmos.so/6b9f08ea-f0c5-471f-a620-71221ff1fb65?format=jpeg" },
  { src: "https://cdn.cosmos.so/40a09525-4b00-4666-86f0-3c45f5d77605?format=jpeg" },
  { src: "https://cdn.cosmos.so/14f05ab6-b4d0-4605-9007-8a2190a249d0?format=jpeg" },
  { src: "https://cdn.cosmos.so/d05009a2-a2f8-4a4c-a0de-e1b0379dddb8?format=jpeg" },
  { src: "https://cdn.cosmos.so/ba646e35-efc2-494a-961b-b40f597e6fc9?format=jpeg" },
  { src: "https://cdn.cosmos.so/e899f9c3-ed48-4899-8c16-fbd5a60705da?format=jpeg" },
  { src: "https://cdn.cosmos.so/24e83c11-c607-45cd-88fb-5059960b56a0?format=jpeg" },
  { src: "https://cdn.cosmos.so/cd346bce-f415-4ea7-8060-99c5f7c1741a?format=jpeg" },
];

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

      <div data-reveal-left className="relative flex-1 my-4 overflow-hidden -mx-10">
        <MarqueeAlongSvgPath
          path={MARQUEE_PATH}
          viewBox="0 0 996 330"
          baseVelocity={8}
          slowdownOnHover
          draggable
          repeat={2}
          dragSensitivity={0.1}
          className="w-full h-full scale-125"
          responsive
          grabCursor
        >
          {MARQUEE_IMGS.map((img, i) => (
            <div key={i} className="w-16 h-16">
              <img src={img.src} alt="" className="w-full h-full object-cover rounded-xl" draggable={false} />
            </div>
          ))}
        </MarqueeAlongSvgPath>
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
