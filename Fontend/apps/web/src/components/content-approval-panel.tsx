"use client";

// Campaign engine: content approval (ticket 07)
// A creator's side of a content campaign: submit content, see the brand's feedback and
// resubmit, then post it live or deliver a download link, depending on where it goes.
import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { ApiRequestError, contentApprovalApi } from "../lib/api";
import { ContentActionModal } from "./content-action-modal";
import { ContentStatusBadge, DESTINATION_LABELS, formatContentDate, missingHashtags } from "./content-status-badge";
import type { CampaignItem, ContentApproval } from "./types";

interface ContentApprovalPanelProps {
  campaign: CampaignItem;
  approval: ContentApproval;
  onChanged?: () => Promise<void> | void;
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  twitter: "X",
  facebook: "Facebook",
};

const inputClass =
  "w-full min-w-0 px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-medium text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400 font-rethink";
const textareaClass =
  "w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-medium text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400 font-rethink resize-none min-h-[88px]";
const primaryButtonClass = "w-full py-3 rounded-full font-semibold text-sm border font-rethink";

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError || error instanceof Error) return error.message;
  return fallback;
}

interface NoticeProps {
  title: string;
  children: React.ReactNode;
  tone?: "pending" | "done" | "stopped";
}

function Notice({ title, children, tone = "pending" }: NoticeProps) {
  return (
    <div
      className={cn(
        "border border-dashed rounded-[16px] p-3 space-y-1 font-rethink",
        tone === "pending" && "bg-[#FEFCE8] border-[#854D0E] text-[#854D0E]",
        tone === "done" && "bg-green-50 border-green-200 text-green-800",
        tone === "stopped" && "bg-red-50 border-red-200 text-red-800"
      )}
    >
      <h4 className="font-medium text-sm tracking-[-0.01em]">{title}</h4>
      <div className="text-sm font-medium leading-normal tracking-[-0.01em]">{children}</div>
    </div>
  );
}

interface FieldLabelProps {
  htmlFor: string;
  children: React.ReactNode;
}

function FieldLabel({ htmlFor, children }: FieldLabelProps) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">
      {children}
    </label>
  );
}

interface HashtagChecklistProps {
  required: string[];
  caption: string;
}

function HashtagChecklist({ required, caption }: HashtagChecklistProps) {
  if (required.length === 0) return null;
  const missing = new Set(missingHashtags(required, caption).map((tag) => tag.toLowerCase()));
  return (
    <div className="flex flex-wrap gap-1.5">
      {required.map((raw) => {
        const tag = `#${raw.trim().replace(/^#+/, "")}`;
        const ok = !missing.has(tag.toLowerCase());
        return (
          <span
            key={tag}
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-medium font-rethink",
              ok ? "bg-[#CBF5E5] text-[#176448]" : "bg-stone-100 text-stone-500"
            )}
          >
            {tag}
          </span>
        );
      })}
    </div>
  );
}

export function ContentApprovalPanel({ campaign, approval, onChanged }: ContentApprovalPanelProps) {
  const { toast } = useToast();
  const submissionId = campaign.submissionId;
  const requiredHashtags = approval.requiredHashtags || [];
  const status = approval.status;

  const [videoUrl, setVideoUrl] = React.useState(campaign.videoUrl || "");
  const [caption, setCaption] = React.useState(campaign.caption || "");
  const [downloadUrl, setDownloadUrl] = React.useState(approval.delivery?.url || "");
  const [acceptRights, setAcceptRights] = React.useState(false);
  const platformOptions = campaign.platforms?.length ? campaign.platforms : ["tiktok", "instagram"];
  const [postPlatform, setPostPlatform] = React.useState(platformOptions[0]);
  const [postUrl, setPostUrl] = React.useState("");
  const [postCaption, setPostCaption] = React.useState(campaign.caption || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [appealOpen, setAppealOpen] = React.useState(false);

  React.useEffect(() => {
    setVideoUrl(campaign.videoUrl || "");
    setCaption(campaign.caption || "");
    setError("");
  }, [campaign.videoUrl, campaign.caption, status]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      toast(success, "success");
      setAppealOpen(false);
      await onChanged?.();
    } catch (err: unknown) {
      setError(errorMessage(err, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const latestRequest = approval.changeRequests[approval.changeRequests.length - 1];
  const canSubmitContent = isLink(videoUrl) && !busy;
  const postMissing = missingHashtags(requiredHashtags, postCaption);
  const canPost = isLink(postUrl) && postMissing.length === 0 && !busy;
  const canDeliver = isLink(downloadUrl) && acceptRights && !busy;

  const contentForm = (label: string) => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel htmlFor="content-link">Content Link</FieldLabel>
        <input
          id="content-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://drive.google.com/..."
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          className={inputClass}
        />
        <p className="text-xs font-medium text-stone-400 font-rethink">A link the brand can open to watch your video.</p>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="content-caption">Caption</FieldLabel>
        <textarea
          id="content-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="The caption you plan to post with"
          className={textareaClass}
        />
        <HashtagChecklist required={requiredHashtags} caption={caption} />
      </div>
      <button
        type="button"
        disabled={!canSubmitContent}
        onClick={() =>
          run(
            () =>
              submissionId && status === "changes_requested"
                ? contentApprovalApi.resubmit(submissionId, videoUrl.trim(), caption)
                : contentApprovalApi.submit(campaign.id, videoUrl.trim(), caption),
            "Content sent to the brand for review"
          )
        }
        className={cn(
          primaryButtonClass,
          canSubmitContent ? "bg-[#FEB604] text-stone-900 border-stone-100" : "bg-stone-200 text-stone-400 border-stone-200 cursor-not-allowed"
        )}
      >
        {busy ? "Sending…" : label}
      </button>
    </div>
  );

  return (
    <div className="space-y-5 font-rethink">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h4 className="font-medium text-sm text-stone-900 tracking-[-0.01em]">Content Approval</h4>
          <p className="text-xs font-medium text-stone-500">Goes to the {DESTINATION_LABELS[approval.destination]}</p>
        </div>
        {status && <ContentStatusBadge status={status} />}
      </div>

      {status === null && contentForm("Submit For Review")}

      {status === "new" && (
        <Notice title="Waiting For The Brand">
          {approval.reviewDueAt
            ? `The brand reviews it by ${formatContentDate(approval.reviewDueAt)}. If they don't, it's approved automatically.`
            : "The brand is reviewing your content."}
        </Notice>
      )}

      {status === "changes_requested" && (
        <>
          <Notice title="Changes Requested" tone="stopped">
            {latestRequest?.notes || "The brand asked for changes."}
          </Notice>
          <p className="text-xs font-medium text-stone-500">
            {approval.changeRequestsLeft > 0
              ? `The brand can ask for changes ${approval.changeRequestsLeft} more time${approval.changeRequestsLeft === 1 ? "" : "s"}.`
              : "This is the last round. After this the brand approves or rejects."}
          </p>
          {contentForm("Resubmit Content")}
        </>
      )}

      {status === "rejected" && (
        <>
          <Notice title="Content Rejected" tone="stopped">
            {approval.rejectionReason || "The brand rejected this content."}
          </Notice>
          <button
            type="button"
            onClick={() => setAppealOpen(true)}
            className={cn(primaryButtonClass, "bg-white text-stone-900 border-stone-200")}
          >
            Appeal Rejection
          </button>
        </>
      )}

      {status === "appealed" && (
        <Notice title="Appeal Under Review">EasilyPromote is reviewing your appeal. We&apos;ll let you know the outcome.</Notice>
      )}

      {approval.autoApproved && status !== "new" && status !== null && (
        <p className="text-xs font-medium text-stone-500">
          The brand didn&apos;t respond within 72 hours, so your content was approved automatically.
        </p>
      )}

      {(status === "awaiting_delivery" || status === "delivered") && (
        <div className="space-y-4">
          {status === "awaiting_delivery" ? (
            <Notice title="Approved" tone="done">
              Share a download link to the original file so the brand can post it.
            </Notice>
          ) : (
            <Notice title="Delivered">Waiting for the brand to confirm it received your content. You can replace the link below.</Notice>
          )}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="download-link">Download Link</FieldLabel>
            <input
              id="download-link"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://drive.google.com/..."
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              className={inputClass}
            />
          </div>
          {approval.licence && (
            <label className="flex items-start gap-3 bg-white border border-stone-200 rounded-2xl p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptRights}
                onChange={(e) => setAcceptRights(e.target.checked)}
                className="mt-0.5 accent-stone-900"
              />
              <span className="space-y-1">
                <span className="block text-xs font-medium text-stone-500">Usage Rights</span>
                <span className="block text-sm font-medium text-stone-900 leading-relaxed">{approval.licence}</span>
              </span>
            </label>
          )}
          <button
            type="button"
            disabled={!canDeliver}
            onClick={() =>
              submissionId &&
              run(() => contentApprovalApi.deliver(submissionId, downloadUrl.trim(), acceptRights), "Download link shared with the brand")
            }
            className={cn(
              primaryButtonClass,
              canDeliver ? "bg-[#FEB604] text-stone-900 border-stone-100" : "bg-stone-200 text-stone-400 border-stone-200 cursor-not-allowed"
            )}
          >
            {busy ? "Sharing…" : status === "delivered" ? "Replace Link" : "Deliver To Brand"}
          </button>
        </div>
      )}

      {status === "awaiting_post" && (
        <div className="space-y-4">
          <Notice title="Ready To Post" tone="done">
            {approval.destination === "both"
              ? "The brand has your file. Now post it on your page and share the live link."
              : "Post it on your page, then share the live link and the caption you used."}
          </Notice>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="post-platform">Platform</FieldLabel>
            <div id="post-platform" className="flex flex-wrap gap-2">
              {platformOptions.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPostPlatform(p)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold border",
                    postPlatform === p ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-200"
                  )}
                >
                  {PLATFORM_LABELS[p] || p}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="post-link">Live Post Link</FieldLabel>
            <input
              id="post-link"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://..."
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="post-caption">Posted Caption</FieldLabel>
            <textarea
              id="post-caption"
              value={postCaption}
              onChange={(e) => setPostCaption(e.target.value)}
              placeholder="Paste the caption exactly as posted"
              className={textareaClass}
            />
            <HashtagChecklist required={requiredHashtags} caption={postCaption} />
            {postMissing.length > 0 && (
              <p className="text-xs font-medium text-stone-500">Your caption needs {postMissing.join(", ")}.</p>
            )}
          </div>
          <button
            type="button"
            disabled={!canPost}
            onClick={() =>
              submissionId &&
              run(
                () => contentApprovalApi.markPosted(submissionId, [{ platform: postPlatform, postUrl: postUrl.trim() }], postCaption),
                "Live post sent to the brand to verify"
              )
            }
            className={cn(
              primaryButtonClass,
              canPost ? "bg-[#FEB604] text-stone-900 border-stone-100" : "bg-stone-200 text-stone-400 border-stone-200 cursor-not-allowed"
            )}
          >
            {busy ? "Sending…" : "Submit Live Post"}
          </button>
        </div>
      )}

      {status === "verifying" && (
        <Notice title="Verifying Your Post">
          The brand is checking your live post.
          {(campaign.postedPlatforms || [])
            .filter((p) => p.postUrl)
            .map((p) => (
              <a
                key={p.platform}
                href={p.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block underline truncate mt-1"
              >
                {PLATFORM_LABELS[p.platform] || p.platform}: {p.postUrl}
              </a>
            ))}
        </Notice>
      )}

      {status === "completed" && (
        <Notice title="Completed" tone="done">
          Your deliverable is complete. ₦{campaign.reward.toLocaleString()} is due to you for it.
        </Notice>
      )}

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      {approval.changeRequests.length > 0 && (
        <div className="space-y-3">
          <h5 className="text-xs font-medium text-stone-500 tracking-[-0.01em]">Feedback History</h5>
          {approval.changeRequests.map((request) => (
            <div key={request.round} className="bg-stone-100 rounded-[16px] p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-stone-500">
                <span>
                  Round {request.round} of {approval.maxChangeRequests}
                </span>
                <span>{formatContentDate(request.requestedAt)}</span>
              </div>
              <p className="text-sm font-medium text-stone-900 leading-relaxed">{request.notes}</p>
              <p className="text-xs font-medium text-stone-500">
                {request.resubmittedAt ? `You resubmitted ${formatContentDate(request.resubmittedAt)}` : "Waiting for your update"}
              </p>
            </div>
          ))}
        </div>
      )}

      <ContentActionModal
        open={appealOpen}
        title="Appeal This Rejection?"
        description="EasilyPromote reviews the content against the brief and decides."
        confirmLabel="Send Appeal"
        noteLabel="Why It Meets The Brief"
        notePlaceholder="Explain what the brand missed"
        busy={busy}
        error={error}
        onCancel={() => setAppealOpen(false)}
        onConfirm={(reason) => submissionId && run(() => contentApprovalApi.appeal(submissionId, reason), "Appeal sent")}
      />
    </div>
  );
}
