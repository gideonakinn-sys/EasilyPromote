"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckIcon, CircleDashedIcon, Delete01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { Spinner } from "./ui/spinner";
import { Skeleton } from "./ui/skeleton";
import { useReveal } from "../hooks/use-reveal";
import { apiRequest, getToken, quoteCampaign } from "../lib/api";
import { useReferralConnection } from "./connect-app-checklist";
import type { CampaignObjective, CampaignQuote } from "./types";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { StepObjective } from "./brand-wizard/step-objective";
import { StepDestination } from "./brand-wizard/step-destination";
import { StepAudience } from "./brand-wizard/step-audience";
import { StepPay } from "./brand-wizard/step-pay";
import { StepBrief } from "./brand-wizard/step-brief";
import { StepLaunch } from "./brand-wizard/step-launch";
import {
  INITIAL_WIZARD_DATA,
  WIZARD_STEPS,
  campaignPayload,
  isObjectiveAvailable,
  pricingPayload,
  resumeStep,
  savedWizardStep,
  stepProblems,
  usesReferralBudget,
  wizardDataFromCampaign,
  type SavedCampaign,
  type WizardData,
  type WizardStep,
} from "./brand-wizard/wizard-state";

interface CampaignWizardProps {
  onClose: () => void;
  onSuccess: () => void;
  isMobile?: boolean;
  draftId?: string;
}

// v2: the five-step wizard's shape; drafts autosaved by the older wizard are ignored.
const DRAFT_STORAGE_KEY = "ep-draft-autosave-v2";
const FALLBACK_CATEGORIES = ["Music", "Fashion", "Tech", "Food", "Travel", "Fitness", "Beauty", "Gaming"];
const LAST_STEP: WizardStep = 6;

export function CampaignWizard({ onClose, onSuccess, draftId, isMobile }: CampaignWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>(1);
  const [furthestStep, setFurthestStep] = useState<WizardStep>(1);
  const [data, setData] = useState<WizardData>(INITIAL_WIZARD_DATA);
  const [touched, setTouched] = useState<Partial<Record<WizardStep, boolean>>>({});
  // Set once the campaign exists, so a failed payment doesn't create a second campaign.
  const [campaignId, setCampaignId] = useState<string | undefined>(draftId);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftId));
  // While a draft can't be loaded there's no form, so nothing can save over the real draft.
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savedObjective, setSavedObjective] = useState<CampaignObjective | null>(null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(FALLBACK_CATEGORIES);
  const [quote, setQuote] = useState<CampaignQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const isModified = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useReveal(step);

  const storageKey = draftId ? `${DRAFT_STORAGE_KEY}-${draftId}` : DRAFT_STORAGE_KEY;
  const referral = usesReferralBudget(data.objective);
  const connection = useReferralConnection(referral && step === LAST_STEP);
  const needsConnection = referral && !connection.verified;
  const problems = step < LAST_STEP ? stepProblems(data, step) : [];

  const update = useCallback((patch: Partial<WizardData>) => {
    isModified.current = true;
    setData((prev) => ({ ...prev, ...patch }));
  }, []);

  const goTo = useCallback((next: WizardStep) => {
    setStep(next);
    setFurthestStep((prev) => (next > prev ? next : prev));
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    apiRequest<{ industries: { name: string; enabled: boolean }[] }>("/industries")
      .then((res) => {
        const enabled = (res.industries || []).filter((industry) => industry.enabled).map((industry) => industry.name);
        if (enabled.length > 0) setCategoryOptions(enabled);
      })
      .catch(() => {});
  }, []);

  // A saved draft opens on the step the brand last saved it on. Drafts from the older wizard
  // have no step, so they open at the first step that still needs something.
  useEffect(() => {
    if (!draftId) return;
    setLoadingDraft(true);
    setLoadError("");
    apiRequest<SavedCampaign>(`/campaigns/${draftId}`, { token: getToken() || undefined })
      .then((saved) => {
        const loaded = wizardDataFromCampaign(saved);
        const resume = savedWizardStep(saved) || resumeStep(loaded);
        setData(loaded);
        setSavedObjective(saved.campaignObjective || null);
        setStep(resume);
        setFurthestStep(resume);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "We couldn't load this draft."))
      .finally(() => setLoadingDraft(false));
  }, [draftId, loadAttempt]);

  useEffect(() => {
    if (draftId) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { data?: Partial<WizardData>; step?: WizardStep };
      if (!parsed.data) return;
      const restored: WizardData = { ...INITIAL_WIZARD_DATA, ...parsed.data, brief: { ...INITIAL_WIZARD_DATA.brief, ...parsed.data.brief } };
      const restoredStep = parsed.step && parsed.step >= 1 && parsed.step <= LAST_STEP ? parsed.step : 1;
      setData(restored);
      setStep(restoredStep);
      setFurthestStep(restoredStep);
      toast("We restored the campaign you were working on", "success");
    } catch {
      // Unreadable autosave: start fresh.
    }
    // Runs once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isModified.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ data, step }));
    } catch {
      // Storage full or unavailable.
    }
  }, [data, step, storageKey]);

  const clearAutoSave = useCallback(() => {
    isModified.current = false;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore.
    }
  }, [storageKey]);

  // The pay and launch steps show the API's quote, so the numbers match what checkout charges.
  // A saved campaign is quoted at its own platform fee.
  const pricingKey = JSON.stringify({ ...pricingPayload(data), ...(campaignId && { campaignId }) });
  const payReady = stepProblems(data, 4).length === 0;
  useEffect(() => {
    if (step !== 4 && step !== LAST_STEP) return;
    if (!payReady) {
      setQuote(null);
      setQuoteError("");
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      quoteCampaign(JSON.parse(pricingKey) as Record<string, unknown>, getToken() || undefined)
        .then((res) => {
          if (cancelled) return;
          setQuote(res.quote);
          setQuoteError("");
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : "We couldn't work out the price. Try again.");
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setQuoteLoading(false);
    };
  }, [step, pricingKey, payReady]);

  // Creates the campaign the first time, then updates it, remembering the step it's saved on.
  const saveCampaign = async (): Promise<string> => {
    const body = JSON.stringify(campaignPayload(data, { savedObjective, wizardStep: step }));
    const token = getToken() || undefined;
    let id = campaignId;
    if (id) {
      await apiRequest(`/campaigns/${id}`, { method: "PATCH", token, body });
    } else {
      const created = await apiRequest<{ id: string }>("/campaigns", { method: "POST", token, body });
      id = created.id;
      setCampaignId(id);
    }
    setSavedObjective(data.objective);
    return id;
  };

  const handleSaveDraft = async () => {
    if (saving) return;
    if (!data.name.trim()) {
      toast("Give your campaign a name before saving.", "error");
      return;
    }
    if (!isObjectiveAvailable(data.objective)) {
      toast("Choose an objective that's available now before saving.", "error");
      return;
    }
    setSaving(true);
    try {
      await saveCampaign();
      clearAutoSave();
      toast("Draft saved", "success");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "We couldn't save your draft. Try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleLaunch = async () => {
    if (launching || needsConnection) return;
    const incomplete = WIZARD_STEPS.find(({ step: s }) => s < LAST_STEP && stepProblems(data, s).length > 0);
    if (incomplete) {
      setTouched((prev) => ({ ...prev, [incomplete.step]: true }));
      goTo(incomplete.step);
      return;
    }
    setLaunching(true);
    setLaunchError("");
    try {
      const id = await saveCampaign();
      const payment = await apiRequest<{ authorization_url: string }>(`/campaigns/${id}/pay`, {
        method: "POST",
        token: getToken() || undefined,
      });
      clearAutoSave();
      window.location.href = payment.authorization_url;
    } catch (err: unknown) {
      setLaunchError(err instanceof Error ? err.message : "We couldn't start your payment. Try again.");
      // The API refuses payment while the app isn't connected; show the checklist again.
      if (referral) connection.refresh();
    } finally {
      setLaunching(false);
    }
  };

  const handleNext = () => {
    if (step === LAST_STEP) {
      handleLaunch();
      return;
    }
    if (problems.length > 0) {
      setTouched((prev) => ({ ...prev, [step]: true }));
      return;
    }
    goTo((step + 1) as WizardStep);
  };

  const handleBack = () => {
    if (step > 1) goTo((step - 1) as WizardStep);
  };

  const handleDelete = async () => {
    if (!campaignId || deleting) return;
    setDeleting(true);
    try {
      await apiRequest(`/campaigns/${campaignId}`, { method: "DELETE", token: getToken() || undefined });
      clearAutoSave();
      toast("Draft deleted", "success");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "We couldn't delete this draft.", "error");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const primaryLabel =
    step < LAST_STEP ? "Continue" : needsConnection ? "Connect your app to launch" : "Pay and launch campaign";

  const stepContent = loadError ? (
    <div className="bg-white border border-red-200 rounded-2xl p-5 space-y-3" role="alert">
      <p className="text-sm font-medium text-stone-900 font-rethink">We couldn&apos;t load this draft</p>
      <p className="text-xs text-stone-500 font-medium font-rethink">{loadError}</p>
      <button
        type="button"
        onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        className="px-4 py-2 bg-stone-900 text-white rounded-full text-xs font-semibold font-rethink"
      >
        Try again
      </button>
    </div>
  ) : loadingDraft ? (
    <div className="space-y-6">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
    </div>
  ) : (
    <>
      {step === 1 && <StepObjective data={data} update={update} categoryOptions={categoryOptions} />}
      {step === 2 && <StepDestination data={data} update={update} />}
      {step === 3 && <StepAudience data={data} update={update} />}
      {step === 4 && <StepPay data={data} update={update} quote={quote} quoteLoading={quoteLoading} quoteError={quoteError} />}
      {step === 5 && <StepBrief data={data} update={update} />}
      {step === LAST_STEP && (
        <StepLaunch data={data} quote={quote} quoteLoading={quoteLoading} quoteError={quoteError} connection={connection} />
      )}
    </>
  );

  return (
    <div className={cn("w-full h-full", isMobile ? "flex flex-col" : "flex overflow-hidden")}>
      {isMobile && (
        <header className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14 border-b border-stone-200 bg-stone-50 flex-shrink-0">
          <button
            type="button"
            onClick={step === 1 ? onClose : handleBack}
            aria-label="Go back"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h3 className="font-rethink font-medium text-base text-stone-900 truncate flex-1">{draftId ? "Edit draft" : "Create a campaign"}</h3>
          {campaignId && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete draft"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200 flex-shrink-0"
            >
              <HugeiconsIcon icon={Delete01Icon} size={14} className="text-stone-600" />
            </button>
          )}
        </header>
      )}

      {isMobile && (
        <nav aria-label="Campaign steps" className="flex items-start justify-between gap-1 px-4 pt-3 pb-4 bg-stone-50 overflow-x-auto">
          {WIZARD_STEPS.map(({ step: s, short }) => (
            <button
              key={s}
              type="button"
              onClick={() => s <= furthestStep && goTo(s)}
              aria-current={step === s ? "step" : undefined}
              className="flex flex-col items-center gap-1.5 flex-1 min-w-[48px]"
            >
              <span className={cn("w-7 h-7 rounded-full flex items-center justify-center", s < step && "bg-green-600 text-white")}>
                {s < step ? (
                  <HugeiconsIcon icon={CheckIcon} size={14} />
                ) : (
                  <HugeiconsIcon icon={CircleDashedIcon} size={18} className={step === s ? "text-stone-900" : "text-stone-400"} />
                )}
              </span>
              <span className={cn("text-[10px] font-medium font-rethink", step === s ? "text-stone-900" : "text-stone-400")}>{short}</span>
            </button>
          ))}
        </nav>
      )}

      {!isMobile && (
        <div className="w-80 border-r border-stone-100 bg-stone-50 p-8 flex flex-col justify-between h-full">
          <div>
            <button
              type="button"
              onClick={data.name.trim() && !loadError && !loadingDraft ? handleSaveDraft : onClose}
              disabled={saving}
              className="text-stone-500 text-xs font-medium font-rethink mb-10 block disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save and close"}
            </button>

            <nav aria-label="Campaign steps" className="space-y-7">
              {WIZARD_STEPS.map(({ step: s, title }) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => s <= furthestStep && goTo(s)}
                  aria-current={step === s ? "step" : undefined}
                  className={cn("flex items-center gap-3 w-full text-left", s <= furthestStep ? "cursor-pointer" : "cursor-default")}
                >
                  <span className={cn("w-6 h-6 rounded-full flex items-center justify-center", s < step && "bg-green-600 text-white")}>
                    {s < step ? (
                      <HugeiconsIcon icon={CheckIcon} size={14} />
                    ) : (
                      <HugeiconsIcon icon={CircleDashedIcon} size={16} className={step === s ? "text-stone-900" : "text-stone-500"} />
                    )}
                  </span>
                  <span className={cn("text-sm font-medium font-rethink", step === s ? "text-stone-900" : "text-stone-400")}>{title}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-stone-400 font-medium font-rethink">
              {step < LAST_STEP ? `Step ${step} of 5` : "Ready to launch"}
            </p>
            {campaignId && (
              <button type="button" onClick={() => setShowDeleteConfirm(true)} className="text-xs font-medium text-red-500 font-rethink">
                Delete draft
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className={cn("flex-1 flex flex-col", isMobile ? "p-5" : "p-12 overflow-y-auto overflow-x-hidden h-full")}
        data-lenis-prevent
      >
        {!isMobile && (
          <div className="text-center mb-8">
            <h3 className="font-rethink font-medium tracking-tight text-lg text-stone-900">{draftId ? "Edit draft" : "Create a campaign"}</h3>
          </div>
        )}

        <div data-reveal key={step} className={cn("flex-1 space-y-8", isMobile ? "w-full" : "w-[380px] mx-auto")}>
          {stepContent}

          {!loadError && touched[step] && problems.length > 0 && (
            <ul className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 space-y-1" role="alert">
              {problems.map((problem) => (
                <li key={problem} className="text-xs text-red-600 font-medium font-rethink">
                  {problem}
                </li>
              ))}
            </ul>
          )}

          <div className={cn("flex gap-4 pt-2", isMobile && "sticky bottom-0 bg-stone-50 pt-3 pb-[env(safe-area-inset-bottom)] -mx-5 px-5 z-10")}>
            {(isMobile || step > 1) && (
              <button
                type="button"
                onClick={isMobile ? handleSaveDraft : handleBack}
                disabled={saving || loadingDraft || Boolean(loadError)}
                className="flex-1 py-3 bg-white border border-stone-200 text-stone-900 font-semibold text-sm rounded-full font-rethink disabled:opacity-50"
              >
                {isMobile ? (saving ? "Saving…" : "Save and close") : "Back"}
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              disabled={loadingDraft || Boolean(loadError) || launching || (step === LAST_STEP && needsConnection)}
              className="flex-1 py-3 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {launching ? <Spinner className="size-4" /> : primaryLabel}
            </button>
          </div>
          {launchError && <p className="text-xs text-red-600 font-medium text-center font-rethink" role="alert">{launchError}</p>}
        </div>
      </div>

      <ConfirmDeleteModal
        open={showDeleteConfirm}
        title="Delete this draft?"
        busy={deleting}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
