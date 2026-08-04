"use client";

import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, CheckIcon, Cancel01Icon, CloudUploadIcon, File01Icon, Delete01Icon, CircleDashedIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@ep/ui/components/dropdown-menu";
import { InfoTooltip } from "@ep/ui/components/info-tooltip";
import { useReveal } from "../hooks/use-reveal";
import { apiRequest, getToken, API_URL } from "../lib/api";
import { Spinner } from "./ui/spinner";
import { AVAILABLE_NICHES } from "./constants";

// Assets imports
import emptyCampaignCover from "@ep/ui/assets/empty campaign cover.png";
import launchCampaign from "@ep/ui/assets/Lauch campaign.png";

import { DEFAULT_TIERS, computePriceForViews, type TierPoint } from "../lib/pricing";

interface CampaignData {
  name: string;
  category: string;
  views: number;
  budget: number;
  description: string;
  keyMessage: string;
  avoid: string;
  goal: string;
  competitors: string;
  uniqueSellingPoint: string;
  funFact: string;
  platforms: string[];
  contentStyle: string[];
  niches: string[];
  scriptUrl: string;
  scriptFileName: string;
  coverImageUrl: string;
}

interface CampaignWizardProps {
  onClose: () => void;
  onSuccess: () => void;
  isMobile?: boolean;
  draftId?: string;
}

interface PlatformOption {
  name: string;
  enabled: boolean;
  sortOrder: number;
}

const PLATFORM_OPTIONS = ["TikTok", "Facebook", "Instagram", "YouTube", "X (Twitter)"];

const PLATFORM_KEY_MAP: Record<string, string> = {
  TikTok: "tiktok",
  Facebook: "facebook",
  Instagram: "instagram",
  YouTube: "youtube",
  "X (Twitter)": "twitter",
};

const FALLBACK_CATEGORIES = ["Music", "Fashion", "Tech", "Food", "Travel", "Fitness", "Beauty", "Gaming"];

const STYLE_PRESETS = ["Fun & Energetic", "Lifestyle", "Comedy", "Trend/Challenge"];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const DRAFT_STORAGE_KEY = "ep-draft-autosave";

interface ComboboxProps {
  options: string[];
  selected: string[];
  inputValue: string;
  setInputValue: (value: string) => void;
  onSelect: (value: string) => void;
  onAddCustom: (value: string) => void;
  placeholder: string;
}

function Combobox({ options, selected, inputValue, setInputValue, onSelect, onAddCustom, placeholder }: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const trimmed = inputValue.trim();
  const filtered = options.filter((o) => o.toLowerCase().includes(trimmed.toLowerCase()));
  const isExact = options.some((o) => o.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed.length > 0 && !isExact;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            placeholder={placeholder}
            onChange={(e) => { setInputValue(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0"
          />
          <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <button
          type="button"
          onClick={() => { if (canAdd) { onAddCustom(trimmed); setInputValue(""); setOpen(false); } }}
          disabled={!canAdd}
          className={cn(
            "shrink-0 px-5 py-3 rounded-full text-sm font-semibold font-rethink transition-colors",
            canAdd ? "bg-[#FEB604] text-[#1C1917]" : "bg-stone-200 text-stone-400 cursor-not-allowed"
          )}
        >
          Add
        </button>
      </div>

      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-2 max-h-48 overflow-y-auto bg-white border border-stone-200 rounded-xl py-1 font-rethink" data-lenis-prevent>
          {filtered.length > 0 ? (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onSelect(opt); setInputValue(""); setOpen(false); }}
                className={cn(
                  "flex items-center w-full px-4 py-2.5 text-sm text-left",
                  selected.includes(opt) ? "font-semibold text-stone-900" : "font-medium text-stone-700"
                )}
              >
                {opt}
              </button>
            ))
          ) : (
            <p className="px-4 py-2.5 text-sm text-stone-400 font-medium">No matches — click Add to include it.</p>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selected.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-stone-900 text-white text-xs font-medium font-rethink"
            >
              {s}
              <HugeiconsIcon icon={Cancel01Icon} size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CampaignWizard({ onClose, onSuccess, draftId, isMobile }: CampaignWizardProps) {
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [tiers, setTiers] = useState<TierPoint[]>(DEFAULT_TIERS);
  const [touchedStep, setTouchedStep] = useState<{ step1: boolean; step2: boolean }>({ step1: false, step2: false });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [nicheOptions, setNicheOptions] = useState<string[]>([...AVAILABLE_NICHES]);
  const [platformOptions, setPlatformOptions] = useState<string[]>(PLATFORM_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(FALLBACK_CATEGORIES);
  const isModified = useRef(false);
  const { toast } = useToast();
  useReveal(createStep);

  useEffect(() => {
    apiRequest<{ industries: { name: string; enabled: boolean }[] }>("/industries")
      .then((data) => {
        const enabled = (data.industries || [])
          .filter((i) => i.enabled)
          .map((i) => i.name);
        if (enabled.length > 0) setCategoryOptions(enabled);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiRequest<{ platforms: PlatformOption[] }>("/platforms")
      .then((data) => {
        const enabled = (data.platforms || [])
          .filter((p) => p.enabled)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((p) => p.name);
        if (enabled.length > 0) setPlatformOptions(enabled);
      })
      .catch((err: unknown) => console.error("Failed to load platforms:", err));
  }, []);

  useEffect(() => {
    apiRequest<{ niches: { name: string }[] }>("/niches")
      .then((data) => {
        const names = (data.niches || []).map((n) => n.name).filter(Boolean);
        if (names.length > 0) setNicheOptions(names);
      })
      .catch((err: unknown) => console.error("Failed to load niches:", err));
  }, []);

  useEffect(() => {
    apiRequest<{ tiers: TierPoint[] }>("/campaigns/pricing")
      .then((data) => {
        if (data.tiers && data.tiers.length > 0) setTiers(data.tiers);
      })
      .catch((err: unknown) => console.error("Failed to load pricing:", err));
  }, []);

  useEffect(() => {
    if (!draftId) return;
    apiRequest<{ name: string; category: string; targetViews: number; budget: number; contentBrief: string; keyMessageCta: string; whatToAvoid: string; goal: string; competitors: string; uniqueSellingPoint: string; funFact: string; platforms: string[]; contentStyle: string[] | string; niches: string[]; scriptUrl: string; scriptFileName: string; coverImageUrl: string }>(`/campaigns/${draftId}`, { token: getToken() || undefined })
      .then((data) => {
        setCampaign({
          name: data.name || "",
          category: data.category || "Music",
          views: data.targetViews || 1000000,
          budget: data.budget || 0,
          description: data.contentBrief || "",
          keyMessage: data.keyMessageCta || "",
          avoid: data.whatToAvoid || "",
          goal: data.goal || "",
          competitors: data.competitors || "",
          uniqueSellingPoint: data.uniqueSellingPoint || "",
          funFact: data.funFact || "",
          platforms: data.platforms || [],
          contentStyle: data.contentStyle ? (typeof data.contentStyle === "string" ? data.contentStyle.split(",").map((s: string) => s.trim()).filter(Boolean) : data.contentStyle) : [],
          niches: data.niches || [],
          scriptUrl: data.scriptUrl || "",
          scriptFileName: data.scriptFileName || "",
          coverImageUrl: data.coverImageUrl || "",
        });

        const hasBrief = data.contentBrief && data.keyMessageCta;
        setCreateStep(hasBrief ? 3 : 1);

        setViewsInput((data.targetViews || 1000000).toLocaleString());
      })
      .catch((err: unknown) => {
        console.error("Failed to load draft:", err);
        setLaunchError("Failed to load draft data.");
      });
  }, [draftId]);

  const getPriceForViews = useCallback((views: number) => computePriceForViews(tiers, views), [tiers]);

  // Campaign Form State
  const [campaign, setCampaign] = useState<CampaignData>({
    name: "",
    category: "Music",
    views: 1000000,
    budget: 3330000,
    description: "",
    keyMessage: "",
    avoid: "",
    goal: "",
    competitors: "",
    uniqueSellingPoint: "",
    funFact: "",
    platforms: ["TikTok", "Instagram"],
    contentStyle: ["Fun & Energetic"],
    niches: [],
    scriptUrl: "",
    scriptFileName: "",
    coverImageUrl: "",
  });

  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [uploadingScript, setUploadingScript] = useState(false);
  const [scriptProgress, setScriptProgress] = useState(0);
  const [customStyleInput, setCustomStyleInput] = useState("");
  const [customNicheInput, setCustomNicheInput] = useState("");
  const scriptInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [viewsInput, setViewsInput] = useState(() => campaign.views.toLocaleString());

  // Auto-save to localStorage
  useEffect(() => {
    if (!isModified.current) return;
    const key = draftId ? `${DRAFT_STORAGE_KEY}-${draftId}` : DRAFT_STORAGE_KEY;
    try {
      localStorage.setItem(key, JSON.stringify({ campaign, createStep, viewsInput }));
    } catch {
      // storage full or unavailable
    }
  }, [campaign, createStep, viewsInput, draftId]);

  // Restore from auto-save on mount (no draft from server)
  useEffect(() => {
    if (draftId) return;
    const key = DRAFT_STORAGE_KEY;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.campaign) {
          setCampaign({
            name: parsed.campaign.name || "",
            category: parsed.campaign.category || "Music",
            views: parsed.campaign.views || 1000000,
            budget: parsed.campaign.budget || 0,
            description: parsed.campaign.description || "",
            keyMessage: parsed.campaign.keyMessage || "",
            avoid: parsed.campaign.avoid || "",
            goal: parsed.campaign.goal || "",
            competitors: parsed.campaign.competitors || "",
            uniqueSellingPoint: parsed.campaign.uniqueSellingPoint || "",
            funFact: parsed.campaign.funFact || "",
            platforms: Array.isArray(parsed.campaign.platforms) ? parsed.campaign.platforms : [],
            contentStyle: Array.isArray(parsed.campaign.contentStyle) ? parsed.campaign.contentStyle : [],
            niches: Array.isArray(parsed.campaign.niches) ? parsed.campaign.niches : [],
            scriptUrl: parsed.campaign.scriptUrl || "",
            scriptFileName: parsed.campaign.scriptFileName || "",
            coverImageUrl: parsed.campaign.coverImageUrl || "",
          });
          if (parsed.createStep) setCreateStep(parsed.createStep);
          if (parsed.viewsInput) setViewsInput(parsed.viewsInput);
          toast("Draft restored from previous session", "success");
        }
      }
    } catch {
      // corrupted data
    }
  }, []);

  // Clear auto-save on successful operations
  const clearAutoSave = useCallback(() => {
    isModified.current = false;
    try {
      const key = draftId ? `${DRAFT_STORAGE_KEY}-${draftId}` : DRAFT_STORAGE_KEY;
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [draftId]);

  const formatViewsString = (val: number) => val.toLocaleString();

  const parseViewsInput = (raw: string): number | null => {
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) return null;
    const num = parseInt(digits, 10);
    if (num < 100000) return null;
    return num;
  };

  const handleViewsInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isModified.current = true;
    const raw = e.target.value;
    const num = parseViewsInput(raw);
    if (num !== null) {
      setViewsInput(formatViewsString(num));
      handleViewsChange(num);
    } else {
      setViewsInput(raw.replace(/[^0-9,]/g, ""));
    }
  };

  const handleViewsInputBlur = () => {
    setViewsInput(formatViewsString(campaign.views));
  };

  const PRESET_VIEWS = [100000, 1000000, 5000000, 10000000, 20000000] as const;

  const formatCompact = (value: number): string => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    return `${Math.round(value / 1000)}K`;
  };

  const handleViewsChange = (val: number) => {
    const newBudget = getPriceForViews(val);
    setCampaign(prev => ({
      ...prev,
      views: val,
      budget: newBudget,
    }));
  };

  const handleCategoryChange = (category: string) => {
    isModified.current = true;
    setCampaign(prev => ({
      ...prev,
      category,
    }));
  };

  const toggleStyle = (style: string) => {
    isModified.current = true;
    setCampaign(prev => ({
      ...prev,
      contentStyle: (prev.contentStyle || []).includes(style)
        ? (prev.contentStyle || []).filter(s => s !== style)
        : [...(prev.contentStyle || []), style],
    }));
  };

  const addStyle = (style: string) => {
    if (!(campaign.contentStyle || []).includes(style)) {
      isModified.current = true;
      setCampaign(prev => ({ ...prev, contentStyle: [...(prev.contentStyle || []), style] }));
    }
  };

  const toggleNiche = (niche: string) => {
    isModified.current = true;
    setCampaign(prev => ({
      ...prev,
      niches: (prev.niches || []).includes(niche)
        ? (prev.niches || []).filter(n => n !== niche)
        : [...(prev.niches || []), niche],
    }));
  };

  const addNiche = (niche: string) => {
    if (!(campaign.niches || []).includes(niche)) {
      isModified.current = true;
      setCampaign(prev => ({ ...prev, niches: [...(prev.niches || []), niche] }));
    }
  };

  const handleScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type && file.type !== "application/pdf") {
      toast("Only PDF files are supported.", "error");
      if (scriptInputRef.current) scriptInputRef.current.value = "";
      return;
    }
    setUploadingScript(true);
    setScriptProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = getToken();
      const url = `${API_URL}/upload/document`;
      const data = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setScriptProgress(Math.round((e.loaded / e.total) * 90));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let msg = "Upload failed";
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed?.error) msg = parsed.error;
            } catch {
              // ignore
            }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
      isModified.current = true;
      setCampaign(prev => ({
        ...prev,
        scriptUrl: data.url,
        scriptFileName: file.name,
      }));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Failed to upload document. Please try again.", "error");
    } finally {
      setUploadingScript(false);
      setScriptProgress(0);
      if (scriptInputRef.current) scriptInputRef.current.value = "";
    }
  };

  const handleRemoveScript = () => {
    isModified.current = true;
    setCampaign(prev => ({ ...prev, scriptUrl: "", scriptFileName: "" }));
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE) {
      toast("Image exceeds 10MB. Please upload a smaller file.", "error");
      if (coverInputRef.current) coverInputRef.current.value = "";
      return;
    }
    setUploadingImage(true);
    setImageProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = getToken();
      const url = `${API_URL}/upload/image`;
      const data = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setImageProgress(Math.round((e.loaded / e.total) * 90));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let msg = "Upload failed";
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed?.error) msg = parsed.error;
            } catch {
              // ignore
            }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
      isModified.current = true;
      setCampaign(prev => ({ ...prev, coverImageUrl: data.url }));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Failed to upload image. Please try again.", "error");
    } finally {
      setUploadingImage(false);
      setImageProgress(0);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const buildPayload = () => ({
    name: campaign.name,
    category: campaign.category,
    targetViews: campaign.views,
    contentBrief: campaign.description,
    keyMessageCta: campaign.keyMessage,
    whatToAvoid: campaign.avoid,
    goal: campaign.goal,
    competitors: campaign.competitors,
    uniqueSellingPoint: campaign.uniqueSellingPoint,
    funFact: campaign.funFact,
    platforms: (campaign.platforms || []).map((p) => PLATFORM_KEY_MAP[p] || p.toLowerCase()),
    contentStyle: (campaign.contentStyle || []).filter(Boolean),
    niches: (campaign.niches || []).filter(Boolean),
    scriptUrl: campaign.scriptUrl || undefined,
    scriptFileName: campaign.scriptFileName || undefined,
    coverImageUrl: campaign.coverImageUrl || undefined,
  });

  const handleNextStep = async () => {
    if (createStep === 1) {
      if (!campaign.name || !campaign.coverImageUrl) {
        setTouchedStep(prev => ({ ...prev, step1: true }));
        return;
      }
      setCreateStep(2);
      return;
    }

    if (createStep === 2) {
      if (!campaign.description || !campaign.scriptUrl || !campaign.keyMessage) {
        setTouchedStep(prev => ({ ...prev, step2: true }));
        return;
      }
      setCreateStep(3);
      return;
    }

    if (createStep === 3) {
      setLaunching(true);
      setLaunchError("");
      try {
        const endpoint = draftId ? `/campaigns/${draftId}` : "/campaigns";
        const method = draftId ? "PATCH" : "POST";
        const campaignData = await apiRequest<{ id: string; budget: number }>(endpoint, {
          method,
          token: getToken() || undefined,
          body: JSON.stringify(buildPayload()),
        });

        const payData = await apiRequest<{ authorization_url: string }>("/campaigns/" + (draftId || campaignData.id) + "/pay", {
          method: "POST",
          token: getToken() || undefined,
        });

        clearAutoSave();
        window.location.href = payData.authorization_url;
      } catch (err: unknown) {
        setLaunchError(err instanceof Error ? err.message : "Failed to create campaign");
      } finally {
        setLaunching(false);
      }
    }
  };

  const handleSaveDraft = async () => {
    if (saving) return;
    if (!campaign.name) {
      toast("Please enter a campaign name before saving.", "error");
      return;
    }
    setSaving(true);
    try {
      const endpoint = draftId ? `/campaigns/${draftId}` : "/campaigns";
      const method = draftId ? "PATCH" : "POST";
      await apiRequest(endpoint, {
        method,
        token: getToken() || undefined,
        body: JSON.stringify(buildPayload()),
      });
      clearAutoSave();
      toast("Draft saved!", "success");
      onSuccess();
      onClose();
    } catch {
      toast("Failed to save draft. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleBackStep = () => {
    if (createStep > 1) {
      setCreateStep((prev) => (prev - 1) as 1 | 2 | 3);
    }
  };

  const getStepClasses = (step: 1 | 2 | 3) => {
    if (createStep > step) {
      return "rounded-full border-green-600 bg-green-600 text-white";
    }
    return "";
  };

  const getStepLabelClasses = (step: 1 | 2 | 3) => {
    return createStep === step ? "text-stone-900" : "text-stone-400";
  };

  return (
    <div className={cn(
      "w-full h-full",
      isMobile ? "flex flex-col" : "flex overflow-hidden"
    )}>
        {/* Mobile Header with back icon */}
        {isMobile && (
          <header className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14 border-b border-stone-200 bg-stone-50 flex-shrink-0">
            <button
              onClick={createStep === 1 ? onClose : handleBackStep}
              aria-label="Go back"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h3 className="font-rethink font-semibold text-base text-stone-900 truncate flex-1">{draftId ? "Edit Draft" : "Create a Campaign"}</h3>
            {draftId && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                aria-label="Delete draft"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200 flex-shrink-0"
              >
                <HugeiconsIcon icon={Delete01Icon} size={14} className="text-stone-600" />
              </button>
            )}
          </header>
        )}
        {/* Mobile Stepper Bar */}
        {isMobile && (
          <div className="flex items-start justify-center gap-0 px-5 pt-3 pb-5 bg-stone-50">
            {/* Step 1 */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <button
                onClick={() => createStep >= 1 && setCreateStep(1)}
                className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0", createStep > 1 ? getStepClasses(1) : "")}
              >
                {createStep > 1 ? <HugeiconsIcon icon={CheckIcon} size={16} /> : <HugeiconsIcon icon={CircleDashedIcon} size={20} className={createStep === 1 ? "text-stone-900" : "text-stone-500"} />}
              </button>
              <span className={cn("text-[10px] font-medium font-rethink", getStepLabelClasses(1))}>Setup</span>
            </div>
            <div className={cn("h-[1px] mt-4 w-12 flex-shrink-0", createStep > 1 ? "bg-green-600" : "bg-stone-200")} />
            {/* Step 2 */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <button
                onClick={() => createStep >= 2 && setCreateStep(2)}
                className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0", createStep > 2 ? getStepClasses(2) : "")}
              >
                {createStep > 2 ? <HugeiconsIcon icon={CheckIcon} size={16} /> : <HugeiconsIcon icon={CircleDashedIcon} size={20} className={createStep === 2 ? "text-stone-900" : "text-stone-500"} />}
              </button>
              <span className={cn("text-[10px] font-medium font-rethink", getStepLabelClasses(2))}>Brief</span>
            </div>
            <div className={cn("h-[1px] mt-4 w-12 flex-shrink-0", createStep > 2 ? "bg-green-600" : "bg-stone-200")} />
            {/* Step 3 */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <button
                onClick={() => createStep >= 3 && setCreateStep(3)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
              >
                <HugeiconsIcon icon={CircleDashedIcon} size={20} className={createStep === 3 ? "text-stone-900" : "text-stone-500"} />
              </button>
              <span className={cn("text-[10px] font-medium font-rethink", getStepLabelClasses(3))}>Launch</span>
            </div>
          </div>
        )}

        {/* Desktop Left Sidebar Progress Indicator */}
        {!isMobile && (
          <div className="w-80 border-r border-stone-100 bg-stone-50 p-8 flex flex-col justify-between h-full">
            <div>
              <button
                onClick={campaign.name ? handleSaveDraft : onClose}
                disabled={saving}
                className="text-stone-500 text-xs font-medium font-rethink mb-10 block disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save and Close"}
              </button>

              <div className="space-y-8">
                {/* Step 1 Indicator */}
                <button
                  onClick={() => createStep >= 1 && setCreateStep(1)}
                  className={cn(
                    "flex items-center gap-3 w-full text-left",
                    createStep >= 1 ? "cursor-pointer" : "cursor-default"
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
                      createStep > 1 ? getStepClasses(1) : ""
                    )}
                  >
                    {createStep > 1 ? <HugeiconsIcon icon={CheckIcon} size={14} /> : <HugeiconsIcon icon={CircleDashedIcon} size={16} className={createStep === 1 ? "text-stone-900" : "text-stone-500"} />}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium font-rethink",
                      getStepLabelClasses(1)
                    )}
                  >
                    Set up your campaign
                  </span>
                </button>

                {/* Step 2 Indicator */}
                <button
                  onClick={() => createStep >= 2 && setCreateStep(2)}
                  className={cn(
                    "flex items-center gap-3 w-full text-left",
                    createStep >= 2 ? "cursor-pointer" : "cursor-default"
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
                      createStep > 2 ? getStepClasses(2) : ""
                    )}
                  >
                    {createStep > 2 ? <HugeiconsIcon icon={CheckIcon} size={14} /> : <HugeiconsIcon icon={CircleDashedIcon} size={16} className={createStep === 2 ? "text-stone-900" : "text-stone-500"} />}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium font-rethink",
                      getStepLabelClasses(2)
                    )}
                  >
                    Campaign brief
                  </span>
                </button>

                {/* Step 3 Indicator */}
                <button
                  onClick={() => createStep >= 3 && setCreateStep(3)}
                  className={cn(
                    "flex items-center gap-3 w-full text-left",
                    createStep >= 3 ? "cursor-pointer" : "cursor-default"
                  )}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
                  >
                    <HugeiconsIcon icon={CircleDashedIcon} size={16} className={createStep === 3 ? "text-stone-900" : "text-stone-500"} />
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium font-rethink",
                      getStepLabelClasses(3)
                    )}
                  >
                    Review & launch
                  </span>
                </button>
              </div>
            </div>

            <div className="text-xs text-stone-400 font-medium">Step {createStep} of 3</div>

            {draftId && (
              <button
                onClick={async () => {
                  if (!window.confirm("Delete this draft campaign?")) return;
                  try {
                    await apiRequest(`/campaigns/${draftId}`, { method: "DELETE", token: getToken() || undefined });
                    clearAutoSave();
                    onSuccess();
                    onClose();
                  } catch {
                    toast("Failed to delete draft", "error");
                  }
                }}
                className="mt-3 text-xs font-medium text-red-500 font-rethink"
              >
                Delete draft
              </button>
            )}
          </div>
        )}

        {/* Right Form Content */}
        <div className={cn(
          "flex-1 flex flex-col justify-between",
          isMobile ? "p-5" : "p-12 overflow-y-auto overflow-x-hidden h-full"
        )} data-lenis-prevent>
          {/* Header (desktop only) */}
          {!isMobile && (
            <div className="text-center mb-8">
              <h3 className="font-rethink font-semibold tracking-tighter text-lg text-stone-900">{draftId ? "Edit Draft" : "Create a Campaign"}</h3>
            </div>
          )}

          {/* Wizard Step 1: Set up campaign */}
          {createStep === 1 && (<>
            <div data-reveal className={cn("space-y-10 flex-1", isMobile ? "w-full" : "w-[350px] mx-auto")}>
              {/* Campaign Cover */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 bg-stone-100 rounded-xl overflow-hidden flex items-center justify-center">
                  {campaign.coverImageUrl ? (
                    <img src={campaign.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
                  ) : (
                    <Image src={emptyCampaignCover} alt="Campaign cover" width={48} height={48} className="object-contain" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-medium text-stone-900">Campaign cover</h4>
                    <InfoTooltip text="The image creators see as the campaign thumbnail." />
                  </div>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    className="hidden"
                  />
                  <div className="space-y-2">
                    {uploadingImage ? (
                      <div className="w-full space-y-1">
                        <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-stone-900 rounded-full transition-all duration-150"
                            style={{ width: `${imageProgress}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium text-stone-500 font-rethink">{imageProgress}%</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => coverInputRef.current?.click()}
                        className="px-4 py-1.5 bg-white rounded-full text-xs font-medium text-stone-900 font-rethink"
                      >
                        {campaign.coverImageUrl ? "Change image" : "Upload image"}
                      </button>
                    )}
                    <span className="block text-[10px] font-medium text-stone-400 font-rethink">Max file size: 10MB</span>
                  </div>
                  {touchedStep.step1 && !campaign.coverImageUrl && (
                    <p className="text-[10px] text-red-500 font-medium font-rethink">Please upload a cover image</p>
                  )}
                </div>
              </div>

              {/* Campaign Name */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Campaign name</label>
                  <InfoTooltip text="The public name creators will see for this campaign" />
                </div>
                <input
                  type="text"
                  placeholder="Campaign name"
                  value={campaign.name}
                  onChange={(e) => { isModified.current = true; setCampaign({ ...campaign, name: e.target.value }); }}
                  className={cn(
                    "w-full px-4 py-3 bg-white border rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0",
                    touchedStep.step1 && !campaign.name ? "border-red-400" : "border-stone-200"
                  )}
                />
                {touchedStep.step1 && !campaign.name && (
                  <p className="text-[10px] text-red-500 font-medium font-rethink">Please enter a campaign name</p>
                )}
              </div>

              {/* Promotion category */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Industry</label>
                  <InfoTooltip text="The industry your campaign belongs to — this sets your per-view rate" />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] text-left flex items-center justify-between"
                    >
                      <span>{campaign.category}</span>
                      <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
                    </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] max-h-56 overflow-y-auto">
                      {categoryOptions.map((cat) => (
                        <DropdownMenuItem
                          key={cat}
                          onSelect={() => handleCategoryChange(cat)}
                          className={campaign.category === cat ? "font-semibold text-stone-900" : "font-medium text-stone-700"}
                        >
                          {cat}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                <span className="text-[10px] text-stone-400 font-medium">
                  ₦{(campaign.views > 0 ? campaign.budget / campaign.views : 0).toFixed(2)} per view — Budget calculated automatically
                </span>
              </div>

              {/* Campaign goal */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Campaign goal</label>
                  <InfoTooltip text="The main outcome you're after — e.g. brand awareness, a product launch, or driving sales." />
                </div>
                <textarea
                  placeholder="What are you hoping to achieve?"
                  value={campaign.goal}
                  onChange={(e) => { isModified.current = true; setCampaign({ ...campaign, goal: e.target.value }); }}
                  className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 resize-none min-h-[88px]"
                />
              </div>

              {/* Competitors */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Competitors</label>
                  <InfoTooltip text="The brands or creators you're up against. Helps creators craft content that stands out." />
                </div>
                <input
                  type="text"
                  placeholder="Who are you competing with?"
                  value={campaign.competitors}
                  onChange={(e) => { isModified.current = true; setCampaign({ ...campaign, competitors: e.target.value }); }}
                  className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0"
                />
              </div>

              {/* Unique selling point */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Unique selling point</label>
                  <InfoTooltip text="What makes your product different from the competition — the thing creators should highlight." />
                </div>
                <textarea
                  placeholder="What makes your product different?"
                  value={campaign.uniqueSellingPoint}
                  onChange={(e) => { isModified.current = true; setCampaign({ ...campaign, uniqueSellingPoint: e.target.value }); }}
                  className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 resize-none min-h-[88px]"
                />
              </div>

              {/* Fun fact */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Fun fact</label>
                  <InfoTooltip text="A memorable detail about your product creators can weave into their videos." />
                </div>
                <input
                  type="text"
                  placeholder="A fun fact creators should know"
                  value={campaign.funFact}
                  onChange={(e) => { isModified.current = true; setCampaign({ ...campaign, funFact: e.target.value }); }}
                  className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0"
                />
              </div>

              {/* Campaign Views Input */}
              <div className="space-y-4">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">How many views do you want?</label>
                  <InfoTooltip text="The total number of verified views you want to buy" />
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={viewsInput}
                  onChange={handleViewsInputChange}
                  onBlur={handleViewsInputBlur}
                  className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0"
                />
                <div className="flex gap-2">
                  {PRESET_VIEWS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setViewsInput(formatViewsString(preset));
                        handleViewsChange(preset);
                      }}
                      className={cn(
                        "flex-1 py-2 rounded-full text-xs font-medium font-rethink transition-colors",
                        campaign.views === preset
                          ? "bg-stone-900 text-white"
                          : "bg-stone-100 text-stone-600"
                      )}
                    >
                      {formatCompact(preset)}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-stone-400 font-medium">
                  100,000 views minimum — Budget calculated automatically
                </span>
              </div>

              {/* Campaign Budget Display */}
              {!isMobile && (
                <div className="pt-4 border-t border-stone-100 space-y-1">
                  <span className="text-xs font-medium text-stone-500 block">Campaign Budget</span>
                  <span className="text-[23px] font-medium text-stone-900 font-rethink tracking-tighter">
                    ₦{campaign.budget.toLocaleString()}
                  </span>
                </div>
              )}

              {/* Continue Button (desktop only) */}
              {!isMobile && (
                <button
                  onClick={handleNextStep}
                  disabled={!campaign.name || !campaign.coverImageUrl}
                  className="w-full py-3 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink"
                >
                  Continue
                </button>
              )}
            </div>
            {/* Mobile: sticky bottom bar for Step 1 */}
            {isMobile && (
              <div className="sticky bottom-0 bg-stone-50 -mx-5 px-5 pb-[env(safe-area-inset-bottom)] z-10 pt-2 space-y-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-medium text-stone-500">Budget</span>
                  <span className="text-[20px] font-medium text-stone-900 font-rethink tracking-tighter">
                    ₦{campaign.budget.toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={handleNextStep}
                  disabled={!campaign.name || !campaign.coverImageUrl}
                  className="w-full py-3 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink"
                >
                  Continue
                </button>
              </div>
            )}
          </>)}

          {/* Wizard Step 2: Campaign Brief */}
          {createStep === 2 && (
            <div data-reveal className={cn("space-y-8 flex-1", isMobile ? "w-full" : "w-[350px] mx-auto")}>
              {/* Campaign Description */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Campaign description</label>
                  <InfoTooltip text="What creators see to understand your product and goals" />
                </div>
                <textarea
                  placeholder="Describe your campaign..."
                  value={campaign.description}
                  onChange={(e) => { isModified.current = true; setCampaign(prev => ({ ...prev, description: e.target.value })); }}
                  rows={3}
                  className={cn(
                    "w-full px-4 py-3 bg-white border rounded-xl text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 resize-none min-h-[80px]",
                    touchedStep.step2 && !campaign.description ? "border-red-400" : "border-stone-200"
                  )}
                />
                {touchedStep.step2 && !campaign.description && (
                  <p className="text-[10px] text-red-500 font-medium font-rethink">Campaign description is required</p>
                )}
              </div>

              {/* Campaign brief */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Campaign brief</label>
                  <InfoTooltip text="The full document creators read before producing their content" />
                </div>
                <p className="text-[10px] text-stone-400 font-medium font-rethink leading-relaxed">
                  The full detail creators read to know exactly what to produce in their videos.
                </p>
                <input
                  ref={scriptInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleScriptUpload}
                  className="hidden"
                />
                {campaign.scriptFileName ? (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full">
                    <HugeiconsIcon icon={File01Icon} size={14} className="text-stone-500" />
                    <span className="text-xs font-medium text-stone-600 font-rethink">{campaign.scriptFileName}</span>
                    <button onClick={handleRemoveScript} aria-label="Remove brief" className="text-stone-400 ml-0.5">
                      <HugeiconsIcon icon={Delete01Icon} size={12} />
                    </button>
                  </div>
                ) : uploadingScript ? (
                  <div className="w-full space-y-1.5 bg-white border-2 border-dashed border-stone-300 rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-stone-500 font-rethink">Uploading brief...</span>
                      <span className="text-[10px] font-medium text-stone-500 font-rethink">{scriptProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                      <div className="h-full bg-stone-900 rounded-full transition-all duration-150" style={{ width: `${scriptProgress}%` }} />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => scriptInputRef.current?.click()}
                    className={cn(
                      "w-full flex flex-col items-center justify-center gap-2 py-8 bg-white border-2 border-dashed rounded-2xl text-sm font-medium text-stone-500 font-rethink",
                      touchedStep.step2 && !campaign.scriptUrl ? "border-red-300" : "border-stone-300"
                    )}
                  >
                    <HugeiconsIcon icon={CloudUploadIcon} size={24} className="text-stone-400" />
                    <span>Attach brief (PDF only)</span>
                  </button>
                )}
                {touchedStep.step2 && !campaign.scriptUrl && (
                  <p className="text-[10px] text-red-500 font-medium font-rethink">Please upload a brief document</p>
                )}
              </div>

              {/* Key Message / CTA */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Key message / CTA</label>
                  <InfoTooltip text="The exact message or call-to-action creators must include" />
                </div>
                <input
                  type="text"
                  placeholder="What's the main message or call to action?"
                  value={campaign.keyMessage}
                  onChange={(e) => { isModified.current = true; setCampaign(prev => ({ ...prev, keyMessage: e.target.value })); }}
                  className={cn(
                    "w-full px-4 py-3 bg-white border rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0",
                    touchedStep.step2 && !campaign.keyMessage ? "border-red-400" : "border-stone-200"
                  )}
                />
                {touchedStep.step2 && !campaign.keyMessage && (
                  <p className="text-[10px] text-red-500 font-medium font-rethink">Key message is required</p>
                )}
              </div>

              {/* What to Avoid */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">What to avoid</label>
                  <InfoTooltip text="Anything creators should not do or say in their content" />
                </div>
                <input
                  type="text"
                  placeholder="Anything creators should avoid mentioning?"
                  value={campaign.avoid}
                  onChange={(e) => { isModified.current = true; setCampaign(prev => ({ ...prev, avoid: e.target.value })); }}
                  className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0"
                />
              </div>

              {/* Platform Selection */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-stone-500">Social Platforms</label>
                  <InfoTooltip text="Where you want creators to post their content" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {platformOptions.map((platform) => {
                    const selected = (campaign.platforms || []).includes(platform);
                    return (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => {
                          isModified.current = true;
                          setCampaign(prev => ({
                            ...prev,
                            platforms: (prev.platforms || []).includes(platform)
                              ? (prev.platforms || []).filter(p => p !== platform)
                              : [...(prev.platforms || []), platform],
                          }));
                        }}
                        className={cn(
                          "px-4 py-2 rounded-full text-sm font-medium font-rethink transition-colors",
                          selected ? "bg-stone-900 text-white" : "bg-white text-stone-600 border border-stone-200"
                        )}
                      >
                        {platform}
                      </button>
                    );
                  })}
                </div>
              </div>

                {/* Preferred Content Style */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-stone-500">Preferred content style</label>
                    <InfoTooltip text="The tone or format your content should follow" />
                  </div>
                  <Combobox
                    options={Array.from(new Set([...STYLE_PRESETS, ...(campaign.contentStyle || [])]))}
                    selected={campaign.contentStyle || []}
                    inputValue={customStyleInput}
                    setInputValue={setCustomStyleInput}
                    onSelect={toggleStyle}
                    onAddCustom={addStyle}
                    placeholder="Type to search or add a style"
                  />
                </div>

                {/* Target Niches */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-stone-500">Target niches</label>
                    <InfoTooltip text="The audience categories your creators should appeal to" />
                  </div>
                  <Combobox
                    options={nicheOptions}
                    selected={campaign.niches || []}
                    inputValue={customNicheInput}
                    setInputValue={setCustomNicheInput}
                    onSelect={toggleNiche}
                    onAddCustom={addNiche}
                    placeholder="Type to search or add a niche"
                  />
                </div>

              {/* Bottom Navigation */}
              <div className={cn("flex gap-4 pt-6", isMobile && "sticky bottom-0 bg-stone-50 pb-[env(safe-area-inset-bottom)] -mx-5 px-5 z-10")}>
                <button
                  onClick={isMobile ? handleSaveDraft : handleBackStep}
                  disabled={saving}
                  className="flex-1 py-3 bg-white border border-stone-200 text-stone-900 font-semibold text-sm rounded-full font-rethink disabled:opacity-50"
                >
                  {isMobile ? (saving ? "Saving..." : "Save and Close") : "Back"}
                </button>
                <button
                  onClick={handleNextStep}
                  disabled={!campaign.description || !campaign.scriptUrl || !campaign.keyMessage}
                  className="flex-1 py-3 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Wizard Step 3: Review & Launch */}
          {createStep === 3 && (
            <div data-reveal className={cn("space-y-10 flex-1", isMobile ? "w-full" : "w-[350px] mx-auto")}>
              {/* Section 1: image, name, badge */}
              <div className="space-y-4">
                {/* Image */}
                <div>
                  <div className="w-[90px] h-[90px] bg-purple-100 rounded-2xl overflow-hidden flex items-center justify-center border border-purple-200">
                    {campaign.coverImageUrl ? (
                      <img src={campaign.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
                    ) : (
                      <svg className="w-8 h-8 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
                      </svg>
                    )}
                  </div>
                </div>

                {/* Name */}
                <h4 className="font-rethink font-medium md:text-[22px] text-lg text-stone-900 tracking-tighter">{campaign.name}</h4>

                {/* Category tag */}
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-stone-200 text-stone-600 text-[11px] font-medium font-rethink">
                  {campaign.category}
                </span>
              </div>

              {/* Brief stack: label → content */}
              <div className="space-y-6">
                {campaign.description && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Description</h5>
                    <p className="font-rethink text-sm text-stone-900 leading-relaxed tracking-[-0.01em]">{campaign.description}</p>
                  </div>
                )}
                {campaign.goal && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Campaign goal</h5>
                    <p className="font-rethink text-sm text-stone-900 leading-relaxed tracking-[-0.01em]">{campaign.goal}</p>
                  </div>
                )}
                {campaign.competitors && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Competitors</h5>
                    <p className="font-rethink text-sm text-stone-900 leading-relaxed tracking-[-0.01em]">{campaign.competitors}</p>
                  </div>
                )}
                {campaign.uniqueSellingPoint && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Unique selling point</h5>
                    <p className="font-rethink text-sm text-stone-900 leading-relaxed tracking-[-0.01em]">{campaign.uniqueSellingPoint}</p>
                  </div>
                )}
                {campaign.funFact && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Fun fact</h5>
                    <p className="font-rethink text-sm text-stone-900 leading-relaxed tracking-[-0.01em]">{campaign.funFact}</p>
                  </div>
                )}
                {campaign.scriptFileName && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Script</h5>
                    <p className="font-rethink text-sm text-stone-900 tracking-[-0.01em]">{campaign.scriptFileName}</p>
                  </div>
                )}
              </div>

              {/* Views & budget */}
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-[11px] font-medium text-stone-400 block">Target views</span>
                  <span className="text-lg font-medium text-stone-900 font-rethink tracking-tighter">{campaign.views.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-stone-400 block">Budget</span>
                  <span className="text-lg font-medium text-stone-900 font-rethink tracking-tighter">₦{campaign.budget.toLocaleString()}</span>
                </div>
              </div>

              {/* Details container */}
              <div className="bg-stone-50 rounded-[18px] py-4 space-y-6">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-stone-500">Platforms</span>
                  <span className="font-medium text-stone-800">{(campaign.platforms || []).join(", ")}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-stone-500">Content style</span>
                  <span className="font-medium text-stone-800">{(campaign.contentStyle || []).join(", ")}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-stone-500">Niches</span>
                  <span className="font-medium text-stone-800">{(campaign.niches || []).length > 0 ? (campaign.niches || []).join(", ") : "Any"}</span>
                </div>
              </div>

              {/* Warning Info Box */}
              <div className="flex items-center gap-3 bg-[#EBF3FF] border border-dashed border-blue-200 rounded-[20px] py-2 pr-2">
                <div className="flex-shrink-0">
                  <Image src={launchCampaign} alt="Info" width={56} height={56} className="object-contain" />
                </div>
                <p className="font-rethink text-xs text-stone-600 leading-normal">
                  You only pay for results. Creators get paid when their views are delivered.
                </p>
              </div>

              {/* Bottom Navigation */}
              <div className={cn("flex gap-4 pt-6", isMobile && "sticky bottom-0 bg-stone-50 pb-[env(safe-area-inset-bottom)] -mx-5 px-5 z-10")}>
                <button
                  onClick={isMobile ? handleSaveDraft : handleBackStep}
                  disabled={saving}
                  className="flex-1 py-3 bg-white text-stone-900 font-semibold text-sm rounded-full border border-stone-200 font-rethink disabled:opacity-50"
                >
                  {isMobile ? (saving ? "Saving..." : "Save and Close") : "Back"}
                </button>
                <button
                  onClick={handleNextStep}
                  disabled={launching}
                  className="flex-1 py-3 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
                >
                  {launching ? <Spinner className="size-4" /> : "Pay and Launch Campaign"}
                </button>
              </div>
              {launchError && (
                <p className="text-xs text-red-600 font-medium text-center mt-2">{launchError}</p>
              )}
            </div>
          )}

      </div>

      {/* Delete confirmation modal (mobile) */}
      {showDeleteConfirm && isMobile && (
        <div className="fixed inset-0 z-[100] bg-stone-900/40 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs space-y-4">
            <h3 className="font-rethink font-semibold text-base text-stone-900 text-center tracking-tighter">Delete this draft?</h3>
            <p className="font-rethink text-xs text-stone-500 font-medium text-center">This cannot be undone.</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 bg-stone-100 text-stone-900 font-semibold text-sm rounded-full font-rethink"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!draftId) return;
                  try {
                    await apiRequest(`/campaigns/${draftId}`, { method: "DELETE", token: getToken() || undefined });
                    clearAutoSave();
                    toast("Draft deleted", "success");
                    onClose();
                  } catch {
                    toast("Failed to delete draft", "error");
                  }
                  setShowDeleteConfirm(false);
                }}
                className="flex-1 py-2.5 bg-red-50 text-red-600 font-semibold text-sm rounded-full border border-red-200 font-rethink"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
