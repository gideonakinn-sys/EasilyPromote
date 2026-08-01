export const FONTS = {
  rethink: "font-rethink",
  inter: "font-inter",
  raleway: "font-raleway",
  motterdam: "font-motterdam",
} as const;

export const TYPOGRAPHY = {
  // "Home" - Rethink Sans 600 14px 20px #1C1917
  home: "font-rethink font-semibold text-sm leading-[20px] text-stone-900",
  
  // "NEW" (badge) - Inter 500 11px 12px #6E330C
  newBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#6E330C]",
  
  // "2" (badge) - Inter 500 11px 12px #FFFFFF
  countBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#FFFFFF]",
  
  // "⌘ 1" - Inter 500 14px 20px #868C98
  shortcut: "font-inter font-medium text-sm leading-[20px] text-[#868C98]",
  
  // "Wallet" - Rethink Sans 500 13px 20px #78716C
  wallet: "font-rethink font-medium text-[13px] leading-[20px] text-stone-500",
  
  // "NEW" (wallet badge) - Inter 500 11px 12px #6E330C
  walletNewBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#6E330C]",
  
  // "2" (wallet badge) - Inter 500 11px 12px #FFFFFF
  walletCountBadge: "font-inter font-medium text-[11px] leading-[12px] text-[#FFFFFF]",
  
  // "⌘ 1" (wallet) - Inter 500 14px 20px #868C98
  walletShortcut: "font-inter font-medium text-sm leading-[20px] text-[#868C98]",
  
  // "EasilyPromote" - Raleway 600 14px 20px #0A0D14
  brandLogo: "font-raleway font-semibold text-sm leading-[20px] text-[#0A0D14]",
  
  // "Acme Inc." - Rethink Sans 500 14px 20px #0C0A09
  userProfile: "font-rethink font-medium text-sm leading-[20px] text-stone-950",
  
  // "Welcome, Acme Inc." - Motterdam 400 33px 42.67px #1C1917
  welcomeHeader: "font-motterdam font-normal text-[33px] leading-[42.67px] text-stone-900",
  
  // "Let's create a campaign that gets real results." - Rethink Sans 500 14px 20px #1C1917
  welcomeSubtitle: "font-rethink font-medium text-sm leading-[20px] text-stone-900 tracking-[-0.01em]",
  
  // "Create Campaign" - Rethink Sans 600 14px 20px #1C1917
  createCampaignButton: "font-rethink font-semibold text-sm leading-[20px] text-stone-900",
} as const;

export const COLORS = {
  brandPrimary: "#FEB604",
  stone: {
    50: "#FAFAF9",
    100: "#F5F5F4",
    200: "#E7E5E4",
    300: "#D6D3D1",
    400: "#A8A29E",
    500: "#78716C",
    600: "#57534E",
    700: "#44403C",
    800: "#292524",
    900: "#1C1917",
  }
} as const;
