export const FONTS = {
  rethink: "font-rethink",
  inter: "font-inter",
  raleway: "font-raleway",
  motterdam: "font-motterdam",
} as const;

export const TYPOGRAPHY = {
  // "Home" - Rethink Sans 600 14px 20px #171717
  home: "font-rethink font-semibold text-sm leading-[20px] text-neutral-900",
  
  // "NEW" (badge) - Inter 500 11px 12px #6E330C
  newBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#6E330C]",
  
  // "2" (badge) - Inter 500 11px 12px #FFFFFF
  countBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#FFFFFF]",
  
  // "⌘ 1" - Inter 500 14px 20px #868C98
  shortcut: "font-inter font-medium text-sm leading-[20px] text-[#868C98]",
  
  // "Wallet" - Rethink Sans 500 13px 20px #737373
  wallet: "font-rethink font-medium text-[13px] leading-[20px] text-neutral-500",
  
  // "NEW" (wallet badge) - Inter 500 11px 12px #6E330C
  walletNewBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#6E330C]",
  
  // "2" (wallet badge) - Inter 500 11px 12px #FFFFFF
  walletCountBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#FFFFFF]",
  
  // "⌘ 1" (wallet) - Inter 500 14px 20px #868C98
  walletShortcut: "font-inter font-medium text-sm leading-[20px] text-[#868C98]",
  
  // "EasilyPromote" - Raleway 600 14px 20px #0A0D14
  brandLogo: "font-raleway font-semibold text-sm leading-[20px] text-[#0A0D14]",
  
  // "Acme Inc." - Rethink Sans 500 14px 20px #0a0a0a
  userProfile: "font-rethink font-medium text-sm leading-[20px] text-neutral-950",
  
  // "Welcome, Acme Inc." - Motterdam 400 33px 42.67px #171717
  welcomeHeader: "font-motterdam font-normal text-[33px] leading-[42.67px] text-neutral-900",
  
  // "Let's create a campaign that gets real results." - Rethink Sans 500 14px 20px #171717
  welcomeSubtitle: "font-rethink font-medium text-sm leading-[20px] text-neutral-900 tracking-[-0.01em]",
  
  // "Create Campaign" - Rethink Sans 600 14px 20px #171717
  createCampaignButton: "font-rethink font-semibold text-sm leading-[20px] text-neutral-900",
} as const;

export const COLORS = {
  brandPrimary: "#FEB604",
  neutral: {
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#e5e5e5",
    300: "#d4d4d4",
    400: "#a3a3a3",
    500: "#737373",
    600: "#525252",
    700: "#404040",
    800: "#262626",
    900: "#171717",
  }
} as const;
