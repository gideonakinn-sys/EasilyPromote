"use client";

// Campaign engine: content approval (ticket 07)
// The brand's review of a content campaign's submissions: the content, its caption and the
// brief side by side; approve, request changes or reject; then confirm the delivered file or
// verify the live post.
import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { contentApprovalApi } from "../lib/api";
import { useSocket } from "../lib/socket";
import { CampaignBriefDetails } from "./campaign-brief";
import { ContentActionModal } from "./content-action-modal";
import { ContentStatusBadge, DESTINATION_LABELS, formatContentDate, missingHashtags } from "./content-status-badge";
import { Skeleton } from "./ui/skeleton";
import type { ContentReviewData, ContentSubmission } from "./types";

type ReviewAction = "approve" | "request_changes" | "reject" | "confirm_receipt" | "confirm_post" | "dispute_post";

const NEEDS_BRAND: ContentSubmission["status"][] = ["new", "delivered", "verifying"];

const isVideoFile = (url: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);

interface ContentSubmissionsReviewProps {
  campaignId: string;
  isMobile?: boolean;
}

export function ContentSubmissionsReview({ campaignId, isMobile }: ContentSubmissionsReviewProps) {
  const [data, setData] = React.useState<ContentReviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await contentApprovalApi.list(campaignId));
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Creators' submissions, resubmissions, deliveries and posts arrive over the socket.
  useSocket(undefined, (update) => {
    if (String(update.campaignId) === campaignId) load();
  });

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 space-y-4 flex flex-col items-center font-rethink">
        <p className="text-xs text-stone-500 font-medium">{error || "Failed to load submissions"}</p>
        <button onClick={load} className="px-6 py-2.5 bg-stone-900 text-white text-sm font-semibold rounded-full">
          Try Again
        </button>
      </div>
    );
  }

  const submissions = [...data.submissions].sort(
    (a, b) => Number(NEEDS_BRAND.includes(b.status)) - Number(NEEDS_BRAND.includes(a.status))
  );
  const selected = submissions.find((s) => s.id === selectedId) || null;

  return (
    <div className="space-y-4 font-rethink">
      {data.contentApproval && (
        <p className="text-xs font-medium text-stone-500">
          Approved content goes to the {DESTINATION_LABELS[data.contentApproval.destination]}. Content you don&apos;t review within 72
          hours is approved automatically.
        </p>
      )}

      {submissions.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <h3 className="font-medium text-lg text-stone-900 tracking-tight">Nothing To Review Yet</h3>
          <p className="text-xs text-stone-500 font-medium">Creators&apos; content shows up here when they submit it.</p>
        </div>
      ) : (
        submissions.map((submission) => (
          <button
            key={submission.id}
            type="button"
            onClick={() => setSelectedId(submission.id)}
            className="w-full text-left bg-white border border-stone-200 rounded-2xl p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-sm text-stone-900 truncate">@{submission.creatorHandle}</span>
              {submission.status && <ContentStatusBadge status={submission.status} />}
            </div>
            {submission.caption && <p className="text-xs text-stone-500 font-medium line-clamp-2">{submission.caption}</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-medium text-stone-400">
              <span>Submitted {formatContentDate(submission.submittedAt)}</span>
              {submission.status === "new" && submission.reviewDueAt && (
                <span>Auto-approves {formatContentDate(submission.reviewDueAt)}</span>
              )}
              {submission.changeRequests.length > 0 && (
                <span>
                  {submission.changeRequests.length} of {submission.maxChangeRequests} change requests used
                </span>
              )}
              {submission.autoApproved && <span>Approved automatically</span>}
            </div>
          </button>
        ))
      )}

      {selected && (
        <ContentReviewDrawer
          submission={selected}
          review={data}
          isMobile={isMobile}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

interface ContentReviewDrawerProps {
  submission: ContentSubmission;
  review: ContentReviewData;
  isMobile?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

const ACTION_COPY: Record<ReviewAction, { title: string; confirm: string; success: string; tone?: "danger"; note?: string; placeholder?: string }> = {
  approve: { title: "Approve This Content?", confirm: "Approve", success: "Content approved" },
  request_changes: {
    title: "Request Changes",
    confirm: "Send Request",
    success: "Changes requested",
    note: "What Should Change",
    placeholder: "Be specific so the creator can fix it in one go",
  },
  reject: {
    title: "Reject This Content?",
    confirm: "Reject",
    success: "Content rejected",
    tone: "danger",
    note: "Reason",
    placeholder: "Why this doesn't meet the brief",
  },
  confirm_receipt: { title: "Confirm You Received It?", confirm: "Confirm Receipt", success: "Receipt confirmed" },
  confirm_post: { title: "Confirm The Live Post?", confirm: "Confirm Post", success: "Live post verified" },
  dispute_post: {
    title: "Can't Verify The Post",
    confirm: "Send To Creator",
    success: "Sent back to the creator",
    tone: "danger",
    note: "What's Wrong",
    placeholder: "e.g. the link doesn't open, or the caption is missing the hashtags",
  },
};

function ContentReviewDrawer({ submission, review, isMobile, onClose, onChanged }: ContentReviewDrawerProps) {
  const { toast } = useToast();
  const [action, setAction] = React.useState<ReviewAction | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const brief = review.contentApproval?.brief;
  const captionMissing = missingHashtags(brief?.hashtags, submission.caption || "");
  const postedMissing = submission.postedCaption ? missingHashtags(brief?.hashtags, submission.postedCaption) : [];
  const roundsLeft = submission.changeRequestsLeft;

  const confirm = async (note: string) => {
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      const id = submission.id;
      if (action === "approve") await contentApprovalApi.approve(id);
      if (action === "request_changes") await contentApprovalApi.requestChanges(id, note);
      if (action === "reject") await contentApprovalApi.reject(id, note);
      if (action === "confirm_receipt") await contentApprovalApi.confirmReceipt(id);
      if (action === "confirm_post") await contentApprovalApi.confirmPost(id);
      if (action === "dispute_post") await contentApprovalApi.disputePost(id, note);
      toast(ACTION_COPY[action].success, "success");
      setAction(null);
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const openAction = (next: ReviewAction) => {
    setError("");
    setAction(next);
  };

  const copy = action ? ACTION_COPY[action] : null;
  const modalDescription =
    action === "request_changes"
      ? roundsLeft === 1
        ? "This is your last change request. After the creator resubmits, you can only approve or reject."
        : `You can request changes ${roundsLeft} more times.`
      : action === "reject"
        ? "The creator can appeal a rejection to EasilyPromote."
        : action === "approve"
          ? review.contentApproval?.destination === "creator_page"
            ? "The creator will post it on their page and send you the live link."
            : "The creator will send you a download link to the file."
          : action === "confirm_receipt" && review.contentApproval?.destination === "brand_page"
            ? "This completes the deliverable."
            : action === "confirm_post"
              ? "This completes the deliverable."
              : undefined;

  const content = (
    <div className="space-y-6 font-rethink">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-medium tracking-tighter text-xl text-stone-900">@{submission.creatorHandle}</h2>
          <p className="text-xs font-medium text-stone-500">Submitted {formatContentDate(submission.submittedAt)}</p>
        </div>
        {submission.status && <ContentStatusBadge status={submission.status} />}
      </div>

      <div className={cn("grid gap-6", !isMobile && "md:grid-cols-2")}>
        {/* The content */}
        <div className="space-y-4">
          <h4 className="text-xs font-medium text-stone-500">Content</h4>
          {submission.videoUrl && isVideoFile(submission.videoUrl) ? (
            <video src={submission.videoUrl} controls className="w-full max-h-[420px] rounded-2xl bg-black" />
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
              <p className="text-sm font-medium text-stone-900 break-all">{submission.videoUrl || "No link"}</p>
            </div>
          )}
          {submission.videoUrl && (
            <a
              href={submission.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-semibold text-stone-900"
            >
              Open Content
            </a>
          )}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-stone-500">Caption</h4>
            <p className="text-sm font-medium text-stone-900 leading-relaxed whitespace-pre-wrap">{submission.caption || "No caption"}</p>
            {captionMissing.length > 0 && (
              <p className="text-xs font-medium text-red-600">Missing from the caption: {captionMissing.join(", ")}</p>
            )}
          </div>

          {submission.changeRequests.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-stone-500">Feedback History</h4>
              {submission.changeRequests.map((request) => (
                <div key={request.round} className="bg-stone-100 rounded-2xl p-3 space-y-1">
                  <div className="flex justify-between text-xs font-medium text-stone-500">
                    <span>
                      Round {request.round} of {submission.maxChangeRequests}
                    </span>
                    <span>{formatContentDate(request.requestedAt)}</span>
                  </div>
                  <p className="text-sm font-medium text-stone-900">{request.notes}</p>
                  {request.videoUrl && (
                    <a href={request.videoUrl} target="_blank" rel="noopener noreferrer" className="block text-xs font-medium text-stone-500 underline truncate">
                      Version reviewed
                    </a>
                  )}
                  <p className="text-xs font-medium text-stone-500">
                    {request.resubmittedAt ? `Resubmitted ${formatContentDate(request.resubmittedAt)}` : "Waiting for the creator"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The brief's requirements */}
        <div className="space-y-4">
          <h4 className="text-xs font-medium text-stone-500">Brief Requirements</h4>
          <div className="bg-white border border-stone-200 rounded-2xl p-4">
            <CampaignBriefDetails brief={brief} showSummary />
          </div>
        </div>
      </div>

      {/* Where it stands and what the brand does next */}
      {submission.status === "new" && (
        <div className="space-y-3">
          {submission.reviewDueAt && (
            <p className="text-xs font-medium text-stone-500">
              Review by {formatContentDate(submission.reviewDueAt)} or it&apos;s approved automatically.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => openAction("approve")}
              className="flex-1 py-3 rounded-full font-semibold text-sm bg-[#FEB604] text-stone-900 border border-stone-100"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => openAction("request_changes")}
              disabled={roundsLeft <= 0}
              className="flex-1 py-3 rounded-full font-semibold text-sm bg-white text-stone-900 border border-stone-200 disabled:opacity-50"
            >
              Request Changes ({roundsLeft} Left)
            </button>
            <button
              type="button"
              onClick={() => openAction("reject")}
              className="flex-1 py-3 rounded-full font-semibold text-sm bg-red-50 text-red-600 border border-red-200"
            >
              Reject
            </button>
          </div>
          {roundsLeft <= 0 && (
            <p className="text-xs font-medium text-stone-500">You&apos;ve used both change requests. Approve or reject this version.</p>
          )}
        </div>
      )}

      {submission.status === "changes_requested" && (
        <p className="text-sm font-medium text-stone-500">Waiting for the creator to resubmit.</p>
      )}
      {submission.status === "rejected" && (
        <p className="text-sm font-medium text-stone-500">Rejected: {submission.rejectionReason}</p>
      )}
      {submission.status === "appealed" && (
        <p className="text-sm font-medium text-stone-500">
          The creator appealed{submission.appealReason ? `: "${submission.appealReason}"` : ""}. EasilyPromote is reviewing it.
        </p>
      )}
      {submission.status === "awaiting_delivery" && (
        <p className="text-sm font-medium text-stone-500">
          {submission.autoApproved ? "Approved automatically. " : "Approved. "}Waiting for the creator&apos;s download link.
        </p>
      )}
      {submission.status === "awaiting_post" && (
        <p className="text-sm font-medium text-stone-500">
          {submission.autoApproved ? "Approved automatically. " : ""}Waiting for the creator to post and share the live link.
        </p>
      )}

      {submission.delivery && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-medium text-stone-500">Delivered File</h4>
          <a
            href={submission.delivery.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex px-4 py-2 bg-stone-900 text-white rounded-full text-sm font-semibold"
          >
            Download Content
          </a>
          {submission.usageRights && (
            <p className="text-xs font-medium text-stone-500 leading-relaxed">
              Usage rights accepted {formatContentDate(submission.usageRights.acceptedAt)}: {submission.usageRights.licence}
            </p>
          )}
          {submission.delivery.confirmedAt ? (
            <p className="text-xs font-medium text-stone-500">You confirmed receipt {formatContentDate(submission.delivery.confirmedAt)}.</p>
          ) : (
            submission.status === "delivered" && (
              <button
                type="button"
                onClick={() => openAction("confirm_receipt")}
                className="w-full py-3 rounded-full font-semibold text-sm bg-[#FEB604] text-stone-900 border border-stone-100"
              >
                Confirm Receipt
              </button>
            )
          )}
        </div>
      )}

      {(submission.status === "verifying" || submission.postVerifiedAt) && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-medium text-stone-500">Live Post</h4>
          {(submission.postedPlatforms || [])
            .filter((p) => p.postUrl)
            .map((p) => (
              <a
                key={p.platform}
                href={p.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm font-medium text-stone-900 underline break-all"
              >
                {p.platform}: {p.postUrl}
              </a>
            ))}
          {submission.postedCaption && (
            <p className="text-xs font-medium text-stone-500 whitespace-pre-wrap">Posted caption: {submission.postedCaption}</p>
          )}
          {postedMissing.length > 0 && (
            <p className="text-xs font-medium text-red-600">Missing from the posted caption: {postedMissing.join(", ")}</p>
          )}
          {submission.status === "verifying" && (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => openAction("confirm_post")}
                className="flex-1 py-3 rounded-full font-semibold text-sm bg-[#FEB604] text-stone-900 border border-stone-100"
              >
                Confirm Post
              </button>
              <button
                type="button"
                onClick={() => openAction("dispute_post")}
                className="flex-1 py-3 rounded-full font-semibold text-sm bg-white text-stone-900 border border-stone-200"
              >
                Can&apos;t Verify Post
              </button>
            </div>
          )}
        </div>
      )}

      {submission.status === "completed" && (
        <p className="text-sm font-medium text-stone-500">Completed {formatContentDate(submission.completedAt)}.</p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      {!isMobile && <div onClick={onClose} className="w-1/5 bg-stone-900/10 backdrop-blur-md cursor-pointer" />}
      <div
        className={cn(
          "relative h-full bg-[#FAFAF9] overflow-y-auto",
          isMobile ? "w-full px-5 pt-16 pb-10" : "w-4/5 rounded-l-[24px] border-l border-stone-200 pt-16 pb-12 px-10"
        )}
        data-lenis-prevent
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-6 right-6 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-stone-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div className={cn("mx-auto", isMobile ? "w-full" : "max-w-[900px]")}>{content}</div>
      </div>

      <ContentActionModal
        open={Boolean(action)}
        title={copy?.title || ""}
        description={modalDescription}
        confirmLabel={copy?.confirm || ""}
        tone={copy?.tone}
        noteLabel={copy?.note}
        notePlaceholder={copy?.placeholder}
        busy={busy}
        error={error}
        onCancel={() => setAction(null)}
        onConfirm={confirm}
      />
    </div>
  );
}
