"use client";

import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, CheckIcon, Cancel01Icon, CloudUploadIcon, File01Icon, Delete01Icon, CircleDashedIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import { useToast } from "@ep/ui/components/toast";
import { useReveal } from "../hooks/use-reveal";
import { apiRequest, getToken, API_URL } from "../lib/api";
import { Spinner } from "./ui/spinner";

// Assets imports
import emptyCampaignCover from "@ep/ui/assets/empty campaign cover.png";
import launchCampaign from "@ep/ui/assets/Lauch campaign.png";

interface CampaignData {
  name: string;
  category: string;
  views: number;
  budget: number;
  description: string;
  keyMessage: string;
  avoid: string;
  platforms: string[];
  contentStyle: string[];
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

const DEFAULT_PLATFORM_OPTIONS = ["TikTok", "Instagram", "X (Twitter)", "Facebook", "YouTube"];

const DRAFT_STORAGE_KEY = "ep-draft-autosave";

export function CampaignWizard({ onClose, onSuccess, draftId, isMobile }: CampaignWizardProps) {
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [pricingRates, setPricingRates] = useState<Record<string, number>>({});
  const [defaultRate, setDefaultRate] = useState(1.085);
  const [touchedStep, setTouchedStep] = useState<{ step1: boolean; step2: boolean }>({ step1: false, step2: false });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [platformOptions, setPlatformOptions] = useState<string[]>(DEFAULT_PLATFORM_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(["Music", "Fashion", "Tech", "Food", "Travel", "Fitness", "Beauty", "Gaming"]);
  const isModified = useRef(false);
  const { toast } = useToast();
  useReveal(createStep);

  useEffect(() => {
    apiRequest<{ platforms: { name: string; enabled: boolean; sortOrder: number }[] }>("/platforms")
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
    apiRequest<{ default: number; categories: Record<string, number> }>("/campaigns/pricing")
      .then((data) => {
        setPricingRates(data.categories || {});
        setDefaultRate(data.default || 1.085);
      })
      .catch((err: unknown) => console.error("Failed to load pricing:", err));
  }, []);

  useEffect(() => {
    if (!draftId) return;
    apiRequest<{ name: string; category: string; targetViews: number; budget: number; contentBrief: string; keyMessageCta: string; whatToAvoid: string; platforms: string[]; contentStyle: string[] | string; scriptUrl: string; scriptFileName: string; coverImageUrl: string }>(`/campaigns/${draftId}`, { token: getToken() || undefined })
      .then((data) => {
        setCampaign({
          name: data.name || "",
          category: data.category || "Music",
          views: data.targetViews || 1000000,
          budget: data.budget || 0,
          description: data.contentBrief || "",
          keyMessage: data.keyMessageCta || "",
          avoid: data.whatToAvoid || "",
          platforms: data.platforms || [],
          contentStyle: data.contentStyle ? (typeof data.contentStyle === "string" ? data.contentStyle.split(",").map((s: string) => s.trim()).filter(Boolean) : data.contentStyle) : [],
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

  const getRate = useCallback((category: string) => pricingRates[category] || defaultRate, [pricingRates, defaultRate]);

  // Campaign Form State
  const [campaign, setCampaign] = useState<CampaignData>({
    name: "",
    category: "Music",
    views: 1000000,
    budget: 1085000,
    description: "",
    keyMessage: "",
    avoid: "",
    platforms: ["TikTok", "Instagram"],
    contentStyle: ["Fun & Energetic"],
    scriptUrl: "",
    scriptFileName: "",
    coverImageUrl: "",
  });

  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [customStyleInput, setCustomStyleInput] = useState("");
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);
  const [platformDrawerOpen, setPlatformDrawerOpen] = useState(false);
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
          setCampaign(parsed.campaign);
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

  // beforeunload warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isModified.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

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

  const PRESET_VIEWS = [100000, 500000, 1000000, 2000000, 3000000] as const;

  const formatCompact = (value: number): string => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    return `${Math.round(value / 1000)}K`;
  };

  const handleViewsChange = (val: number) => {
    const rate = getRate(campaign.category);
    const newBudget = Math.round(val * rate);
    setCampaign(prev => ({
      ...prev,
      views: val,
      budget: newBudget,
    }));
  };

  const handleCategoryChange = (category: string) => {
    isModified.current = true;
    const rate = getRate(category);
    const newBudget = Math.round(campaign.views * rate);
    setCampaign(prev => ({
      ...prev,
      category,
      budget: newBudget,
    }));
  };

  const handleScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_URL}/upload/document`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      isModified.current = true;
      setCampaign(prev => ({
        ...prev,
        scriptUrl: data.url,
        scriptFileName: file.name,
      }));
    } catch {
      toast("Failed to upload document. Please try again.", "error");
    } finally {
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
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
      });
      isModified.current = true;
      setCampaign(prev => ({ ...prev, coverImageUrl: data.url }));
    } catch {
      toast("Failed to upload image. Please try again.", "error");
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
    platforms: campaign.platforms.map((p) => p.toLowerCase()),
    contentStyle: campaign.contentStyle.filter(Boolean).join(", "),
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
          <header className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14 border-b border-stone-200 bg-stone-100 flex-shrink-0">
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
          <div className="flex items-start justify-center gap-0 px-5 pt-3 pb-5 bg-stone-100">
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
          <div className="w-80 border-r border-stone-100 bg-stone-100 p-8 flex flex-col justify-between h-full">
            <div>
              <button
                onClick={campaign.name ? handleSaveDraft : onClose}
                className="text-stone-500 text-xs font-medium font-rethink mb-10 block"
              >
                Save and Close
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
                <div className="w-20 h-20 bg-stone-200 rounded-xl overflow-hidden flex items-center justify-center">
                  {campaign.coverImageUrl ? (
                    <img src={campaign.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
                  ) : (
                    <Image src={emptyCampaignCover} alt="Campaign cover" width={48} height={48} className="object-contain" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <h4 className="text-xs font-medium text-stone-900">Campaign cover</h4>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    className="hidden"
                  />
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
                      className="px-4 py-1.5 bg-white rounded-full text-xs font-medium text-stone-600 font-rethink"
                    >
                      {campaign.coverImageUrl ? "Change image" : "Upload image"}
                    </button>
                  )}
                  {touchedStep.step1 && !campaign.coverImageUrl && (
                    <p className="text-[10px] text-red-500 font-medium font-rethink">Please upload a cover image</p>
                  )}
                </div>
              </div>

              {/* Campaign Name */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-500 block">Campaign name</label>
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
                <label className="text-xs font-medium text-stone-500 block">What are you promoting?</label>
                {isMobile ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setCategoryDrawerOpen(true)}
                      className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] text-left flex items-center justify-between"
                    >
                      <span>{campaign.category}</span>
                      <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
                    </button>
                    <MobileDrawer open={categoryDrawerOpen} onOpenChange={setCategoryDrawerOpen}>
                      {categoryOptions.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            handleCategoryChange(cat);
                            setCategoryDrawerOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium font-rethink",
                            campaign.category === cat ? "bg-stone-100 text-stone-900" : "text-stone-600"
                          )}
                        >
                          <span>{cat}</span>
                          {campaign.category === cat && <HugeiconsIcon icon={CheckIcon} size={16} className="text-stone-900" />}
                        </button>
                      ))}
                    </MobileDrawer>
                  </>
                ) : (
                  <div className="relative">
                    <select
                      value={campaign.category}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] appearance-none placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0"
                    >
                      {categoryOptions.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                )}
                <span className="text-[10px] text-stone-400 font-medium">
                  ₦{getRate(campaign.category).toFixed(3)} per view — Budget calculated automatically
                </span>
              </div>

              {/* Campaign Views Input */}
              <div className="space-y-4">
                <label className="text-xs font-medium text-stone-500 block">How many views do you want?</label>
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
              <div className="sticky bottom-0 bg-stone-100 -mx-5 px-5 pb-[env(safe-area-inset-bottom)] z-10 pt-2 space-y-3">
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
                <label className="text-xs font-medium text-stone-500 block">Campaign description</label>
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

              {/* Upload brief */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-500 block">Upload brief</label>
                <input
                  ref={scriptInputRef}
                  type="file"
                  accept=".doc,.docx,.pdf"
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
                    <span>Attach brief (PDF, DOC, DOCX)</span>
                  </button>
                )}
                {touchedStep.step2 && !campaign.scriptUrl && (
                  <p className="text-[10px] text-red-500 font-medium font-rethink">Please upload a brief document</p>
                )}
              </div>

              {/* Key Message / CTA */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-500 block">Key message / CTA</label>
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
                <label className="text-xs font-medium text-stone-500 block">What to avoid</label>
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
                <label className="text-xs font-medium text-stone-500 block">Social Platforms</label>
                {isMobile ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPlatformDrawerOpen(true)}
                      className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium tracking-[-0.01em] text-left flex items-center justify-between"
                    >
                      <span>{campaign.platforms.length === 0 ? "Select platforms" : `${campaign.platforms.length} platform${campaign.platforms.length > 1 ? "s" : ""} selected`}</span>
                      <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
                    </button>
                    <MobileDrawer open={platformDrawerOpen} onOpenChange={setPlatformDrawerOpen}>
                      {platformOptions.map((platform) => (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => {
                            isModified.current = true;
                            setCampaign(prev => ({
                              ...prev,
                              platforms: prev.platforms.includes(platform)
                                ? prev.platforms.filter(p => p !== platform)
                                : [...prev.platforms, platform],
                            }));
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium font-rethink",
                            campaign.platforms.includes(platform) ? "bg-stone-100 text-stone-900" : "text-stone-600"
                          )}
                        >
                          <span>{platform}</span>
                          {campaign.platforms.includes(platform) && <HugeiconsIcon icon={CheckIcon} size={16} className="text-stone-900" />}
                        </button>
                      ))}
                    </MobileDrawer>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {platformOptions.map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => {
                          isModified.current = true;
                          setCampaign(prev => ({
                            ...prev,
                            platforms: prev.platforms.includes(platform)
                              ? prev.platforms.filter(p => p !== platform)
                              : [...prev.platforms, platform],
                          }));
                        }}
                        className={cn(
                          "flex items-center justify-between px-4 py-3 rounded-full text-sm font-medium font-rethink border transition-colors",
                          campaign.platforms.includes(platform)
                            ? "bg-stone-900 text-white border-stone-900"
                            : "bg-white text-stone-600 border-stone-200"
                        )}
                      >
                        <span>{platform}</span>
                        {campaign.platforms.includes(platform) && <HugeiconsIcon icon={CheckIcon} size={16} />}
                      </button>
                    ))}
                  </div>
                )}
                {campaign.platforms.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {campaign.platforms.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-stone-900 text-white text-[11px] font-medium font-rethink">
                        {p}
                        <button
                          onClick={() => { isModified.current = true; setCampaign(prev => ({ ...prev, platforms: prev.platforms.filter(pl => pl !== p) })); }}
                          aria-label={`Remove ${p}`}
                          className="ml-0.5"
                          >
                            <HugeiconsIcon icon={Cancel01Icon} size={12} />
                          </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

                {/* Preferred Content Style */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-stone-500 block">Preferred content style</label>

                  {/* Custom style input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add a custom style..."
                      value={customStyleInput}
                      onChange={(e) => setCustomStyleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customStyleInput.trim()) {
                          e.preventDefault();
                          if (!campaign.contentStyle.includes(customStyleInput.trim())) {
                            isModified.current = true;
                            setCampaign(prev => ({
                              ...prev,
                              contentStyle: [...prev.contentStyle, customStyleInput.trim()],
                            }));
                          }
                          setCustomStyleInput("");
                        }
                      }}
                      className="flex-1 px-4 py-2.5 bg-white border border-stone-200 rounded-full text-xs font-rethink font-medium tracking-[-0.01em] placeholder-stone-400 focus:outline-none focus:border-stone-400 focus:ring-0"
                    />
                    <button
                      onClick={() => {
                        if (customStyleInput.trim() && !campaign.contentStyle.includes(customStyleInput.trim())) {
                          isModified.current = true;
                          setCampaign(prev => ({
                            ...prev,
                            contentStyle: [...prev.contentStyle, customStyleInput.trim()],
                          }));
                          setCustomStyleInput("");
                        }
                      }}
                      disabled={!customStyleInput.trim()}
                      className="px-4 py-2.5 bg-[#FEB604] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-[#1C1917] text-xs font-semibold font-rethink rounded-full"
                    >
                      Add
                    </button>
                  </div>

                  {/* All style chips — presets + custom */}
                  <div className="flex flex-wrap gap-2">
                    {["Fun & Energetic", "Lifestyle", "Comedy", "Trend/Challenge"].map((style) => {
                      const isSelected = campaign.contentStyle.includes(style);
                      return (
                        <button
                          key={style}
                          type="button"
                          onClick={() => {
                            isModified.current = true;
                            setCampaign(prev => ({
                              ...prev,
                              contentStyle: isSelected
                                ? prev.contentStyle.filter(s => s !== style)
                                : [...prev.contentStyle, style],
                            }));
                          }}
                          className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium font-rethink",
                            isSelected
                              ? "bg-stone-900 text-white"
                              : "bg-stone-100 text-stone-600"
                          )}
                        >
                          {style}
                        </button>
                      );
                    })}
                    {campaign.contentStyle.filter(s => !["Fun & Energetic", "Lifestyle", "Comedy", "Trend/Challenge"].includes(s)).map((style) => (
                      <span key={style} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-stone-900 text-white text-[11px] font-medium font-rethink">
                        {style}
                        <button
                          onClick={() => { isModified.current = true; setCampaign(prev => ({ ...prev, contentStyle: prev.contentStyle.filter(s => s !== style) })); }}
                          aria-label={`Remove ${style}`}
                          className="ml-0.5"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

              {/* Bottom Navigation */}
              <div className={cn("flex gap-4 pt-6", isMobile && "sticky bottom-0 bg-stone-100 pb-[env(safe-area-inset-bottom)] -mx-5 px-5 z-10")}>
                <button
                  onClick={isMobile ? handleSaveDraft : handleBackStep}
                  className="flex-1 py-3 bg-white border border-stone-200 text-stone-900 font-semibold text-sm rounded-full font-rethink"
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
            <div data-reveal className={cn("space-y-6 flex-1", isMobile ? "w-full" : "w-[350px] mx-auto")}>
              {/* Campaign Summary */}
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

                {/* Description */}
                {campaign.description && (
                  <p className="font-rethink text-xs text-stone-500 leading-relaxed">{campaign.description}</p>
                )}

                {/* Views & Budget */}
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
              </div>

              {/* Details container */}
              <div className="bg-stone-100 rounded-[18px] py-4 space-y-6">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-stone-500">Platforms</span>
                  <span className="font-medium text-stone-800">{campaign.platforms.join(", ")}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-stone-500">Content style</span>
                  <span className="font-medium text-stone-800">{campaign.contentStyle.join(", ")}</span>
                </div>
                {campaign.scriptFileName && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium text-stone-500">Script</span>
                    <span className="font-medium text-stone-800 truncate ml-4">{campaign.scriptFileName}</span>
                  </div>
                )}
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
              <div className={cn("flex gap-4 pt-6", isMobile && "sticky bottom-0 bg-stone-100 pb-[env(safe-area-inset-bottom)] -mx-5 px-5 z-10")}>
                <button
                  onClick={isMobile ? handleSaveDraft : handleBackStep}
                  className="flex-1 py-3 bg-white text-stone-900 font-semibold text-sm rounded-full border border-stone-200 font-rethink"
                >
                  {isMobile ? (saving ? "Saving..." : "Save and Close") : "Back"}
                </button>
                <button
                  onClick={handleNextStep}
                  disabled={launching}
                  className="flex-1 py-3 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
                >
                  {launching ? <span className="flex items-center justify-center gap-2"><Spinner className="size-4" /> Pay and Launch Campaign</span> : "Pay and Launch Campaign"}
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
