"use client";

// Brand ratings (M8): on the brand's campaign page, the creators whose work on the campaign is
// complete, with a prompt to rate each one 1–5 (optional comment and tags). A rating can be changed
// for 7 days. Only shows once there's someone to rate.
import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { StarInput } from "./creator-rating-summary";
import { ratingsApi } from "../lib/api";
import type { CampaignRatingList, RateableCreator, RatingTag } from "./types";

const COMMENT_MAX = 500;

interface CreatorRatingsProps {
  campaignId: string;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export function CreatorRatings({ campaignId }: CreatorRatingsProps) {
  const [data, setData] = React.useState<CampaignRatingList | null>(null);
  const [error, setError] = React.useState("");
  const [rating, setRating] = React.useState<RateableCreator | null>(null);

  const load = React.useCallback(async () => {
    try {
      setError("");
      setData(await ratingsApi.list(campaignId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load creators to rate");
    }
  }, [campaignId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="border border-neutral-200 rounded-2xl p-4 font-rethink">
        <p className="text-xs font-medium text-red-600">{error}</p>
      </div>
    );
  }
  if (!data || data.creators.length === 0) return null;

  return (
    <div className="border border-neutral-200 rounded-2xl p-4 space-y-4 font-rethink" data-testid="creator-ratings">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-neutral-900">Rate Your Creators</h3>
          {data.toRate > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FEB604] text-neutral-950">{data.toRate} To Rate</span>
          )}
        </div>
        <p className="text-xs font-medium text-neutral-500 leading-relaxed">
          How was working with them? Other brands see each creator&apos;s average, never who rated or what you wrote.
        </p>
      </div>

      <div className="divide-y divide-neutral-100">
        {data.creators.map((creator) => (
          <div key={creator.creatorId} className="flex items-center gap-3 py-3">
            <div className="w-9 h-9 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center text-xs font-medium text-neutral-600 shrink-0">
              {creator.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={creator.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                creator.name.charAt(0)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">{creator.name}</p>
              <p className="text-[11px] font-medium text-neutral-500 truncate">
                {creator.rating?.hidden
                  ? "Your rating was hidden by our team"
                  : creator.rating
                    ? creator.rating.editable
                      ? `Rated · you can change it until ${formatDate(creator.rating.editableUntil)}`
                      : "Rated"
                    : creator.username
                      ? `@${creator.username} · work complete`
                      : "Work complete"}
              </p>
            </div>
            {creator.rating && (
              <span className="inline-flex items-center gap-0.5 shrink-0" aria-label={`${creator.rating.score} out of 5`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <HugeiconsIcon
                    key={star}
                    icon={StarIcon}
                    size={12}
                    className={cn(star <= creator.rating!.score ? "text-[#D97706] fill-[#FEB604]" : "text-neutral-300 fill-transparent")}
                  />
                ))}
              </span>
            )}
            {(!creator.rating || creator.rating.editable) && (
              <button
                type="button"
                onClick={() => setRating(creator)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 border",
                  creator.rating ? "bg-white text-neutral-900 border-neutral-200" : "bg-[#FEB604] text-neutral-950 border-neutral-100"
                )}
              >
                {creator.rating ? "Edit" : "Rate"}
              </button>
            )}
          </div>
        ))}
      </div>

      <RateCreatorModal
        campaignId={campaignId}
        creator={rating}
        tags={data.tags}
        onClose={() => setRating(null)}
        onSaved={() => {
          setRating(null);
          load();
        }}
      />
    </div>
  );
}

interface RateCreatorModalProps {
  campaignId: string;
  creator: RateableCreator | null;
  tags: CampaignRatingList["tags"];
  onClose: () => void;
  onSaved: () => void;
}

function RateCreatorModal({ campaignId, creator, tags, onClose, onSaved }: RateCreatorModalProps) {
  const [score, setScore] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [selected, setSelected] = React.useState<RatingTag[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!creator) return;
    setScore(creator.rating?.score ?? 0);
    setComment(creator.rating?.comment ?? "");
    setSelected(creator.rating?.tags ?? []);
    setError("");
  }, [creator]);

  React.useEffect(() => {
    if (!creator) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [creator, busy, onClose]);

  if (!creator) return null;

  const toggle = (tag: RatingTag) => setSelected((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await ratingsApi.rate(campaignId, creator.creatorId, { score, comment: comment.trim(), tags: selected });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save your rating");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rate-creator-title"
      onClick={() => !busy && onClose()}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 font-rethink" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1 text-center">
          <h3 id="rate-creator-title" className="font-medium text-base text-neutral-900">
            {creator.rating ? `Change Your Rating Of ${creator.name}` : `Rate ${creator.name}`}
          </h3>
          <p className="text-xs text-neutral-500 font-medium leading-relaxed">
            You can change it for 7 days. The creator sees their average, never who rated or your comment.
          </p>
        </div>

        <StarInput value={score} onChange={setScore} disabled={busy} />

        <div className="flex flex-wrap justify-center gap-2">
          {tags.map((tag) => (
            <button
              key={tag.value}
              type="button"
              onClick={() => toggle(tag.value)}
              disabled={busy}
              aria-pressed={selected.includes(tag.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border",
                selected.includes(tag.value) ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"
              )}
            >
              {tag.label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rate-creator-comment" className="text-xs font-medium text-neutral-500">
            Comment (Optional)
          </label>
          <textarea
            id="rate-creator-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={COMMENT_MAX}
            disabled={busy}
            placeholder="What went well, or what could be better?"
            className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-medium text-neutral-900 placeholder-neutral-300 focus:outline-none focus:border-neutral-400 resize-none min-h-[88px]"
          />
          <p className="text-[10px] font-medium text-neutral-400 text-right">
            {comment.length}/{COMMENT_MAX}
          </p>
        </div>

        {error && <p className="text-xs font-medium text-red-600 text-center">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 py-2.5 bg-neutral-100 text-neutral-900 font-semibold text-sm rounded-full disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || score < 1}
            className="flex-1 py-2.5 font-semibold text-sm rounded-full border bg-[#FEB604] text-neutral-900 border-neutral-100 disabled:opacity-50"
          >
            {busy ? "Saving…" : creator.rating ? "Save Rating" : "Submit Rating"}
          </button>
        </div>
      </div>
    </div>
  );
}
