"use client";

import { useState, useRef, type ChangeEvent } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { TiktokIcon, File01Icon, Download01Icon, CloudUploadIcon, CheckIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import { useToast } from "@ep/ui/components/toast";
import { usePlatforms } from "@ep/ui/hooks/use-platforms";
import emptyActivityImg from "@ep/ui/assets/empty-activity.png";
import inReviewCreatorImg from "@ep/ui/assets/in-review-creator.png";
import changesFeedbackImg from "@ep/ui/assets/Changes-feedback-creator.png";
import approvedCreatorImg from "@ep/ui/assets/approved-creator.png";
import deliveredCreatorImg from "@ep/ui/assets/delievered-creators.png";
import { API_URL, getToken } from "../lib/api";
import type { CampaignItem } from "./types";
import { STATUS_BADGES } from "./campaign-card";

interface CampaignDetailsDrawerProps {
  campaign: CampaignItem;
  onClose: () => void;
  onSubmitContent: (id: string, videoUrl: string, caption: string) => void;
  onUpdateContent: (id: string, videoUrl: string, caption: string) => void;
  onSubmitPostUrl: (id: string, urls: Record<string, string>) => void;
  onRefresh?: () => Promise<void>;
  isMobile?: boolean;
}

export function CampaignDetailsDrawer({
  campaign,
  isMobile = false,
  onClose,
  onSubmitContent,
  onUpdateContent,
  onSubmitPostUrl,
  onRefresh,
}: CampaignDetailsDrawerProps) {
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({});

  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const displayCampaign = campaign;

  const videoThumbUrl = displayCampaign.videoUrl
    ? displayCampaign.videoUrl.replace(/\.(mp4|mov|webm|avi)$/i, ".jpg")
    : undefined;

  const linkPlatforms = displayCampaign.platforms?.length ? displayCampaign.platforms : ["tiktok", "instagram"];
  const allLinksFilled = linkPlatforms.every((p) => (linkInputs[p] || "").trim().length > 0);

  const handleLinkSubmit = () => {
    onSubmitPostUrl(displayCampaign.id, linkInputs);
  };

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      toast("Views refreshed!", "success");
    } catch (err) {
      console.error("Failed to refresh views:", err);
      toast("Could not refresh views. Try again.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploading(true);
    setUploadProgress(0);
    setVideoUrl("");

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/upload/video`);
    xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { url: string };
          setVideoUrl(data.url);
          setUploadProgress(100);
        } catch (err) {
          console.error("Failed to parse upload response:", err);
          toast("Upload failed. Please try again.", "error");
        }
      } else {
        console.error("Video upload failed:", xhr.status, xhr.responseText);
        toast("Upload failed. Please try again.", "error");
      }
      setUploading(false);
    };
    xhr.onerror = () => {
      console.error("Video upload failed");
      setUploading(false);
      setVideoUrl("");
      toast("Upload failed. Please try again.", "error");
    };
    xhr.send(formData);

    e.target.value = "";
  };

  const handleSubmitUpload = () => {
    if (!videoUrl) return;
    if (displayCampaign.status === "changes_requested") {
      onUpdateContent(displayCampaign.id, videoUrl, caption);
    } else {
      onSubmitContent(displayCampaign.id, videoUrl, caption);
    }
    toast("Content uploaded successfully!", "success");
    setUploadOpen(false);
    setSelectedFile(null);
    setUploading(false);
    setUploadProgress(0);
    setVideoUrl("");
    setCaption("");
  };

  const renderUploadPanel = () => (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
      {!selectedFile ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 py-8 bg-white border-2 border-dashed border-stone-200 rounded-2xl font-rethink"
        >
          <HugeiconsIcon icon={CloudUploadIcon} size={24} className="text-stone-400" />
          <span className="text-sm font-medium text-stone-600">Select video</span>
          <span className="text-[10px] font-medium text-stone-400 tracking-[-0.01em]">MP4, MOV up to 100MB</span>
        </button>
      ) : uploading ? (
        <div className="w-full space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700 truncate font-rethink tracking-[-0.01em]">{selectedFile.name}</span>
            <span className="text-[10px] font-medium text-stone-500 font-rethink">{Math.round(uploadProgress)}%</span>
          </div>
          <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      ) : videoUrl ? (
        <div className="flex items-center gap-3 bg-white border border-stone-200 rounded-2xl p-3">
          <div className="w-8 h-8 rounded-full bg-[#CBF5E5] flex items-center justify-center shrink-0">
            <HugeiconsIcon icon={CheckIcon} size={16} className="text-[#176448]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-900 truncate font-rethink tracking-[-0.01em]">{selectedFile.name}</p>
            <p className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Ready to submit</p>
          </div>
          <button
            onClick={() => {
              setSelectedFile(null);
              setVideoUrl("");
            }}
            className="text-xs font-medium text-stone-500 font-rethink shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 py-8 bg-white border-2 border-dashed border-stone-200 rounded-2xl font-rethink"
        >
          <HugeiconsIcon icon={CloudUploadIcon} size={24} className="text-stone-400" />
          <span className="text-sm font-medium text-stone-600">Upload failed, try again</span>
          <span className="text-[10px] font-medium text-stone-400 tracking-[-0.01em]">Select another video</span>
        </button>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Tell the brand about your video..."
          className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-medium text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400 font-rethink resize-none min-h-[88px]"
        />
      </div>

      <button
        onClick={handleSubmitUpload}
        disabled={!videoUrl}
        className={cn(
          "w-full py-3 rounded-full font-semibold text-sm border font-rethink",
          videoUrl
            ? "bg-[#FEB604] text-stone-900 border-stone-100"
            : "bg-stone-200 text-stone-400 border-stone-200 cursor-not-allowed"
        )}
      >
        Submit for review
      </button>
    </div>
  );

  const renderMobileUploadSheet = () => (
    <MobileDrawer open={uploadOpen} onOpenChange={setUploadOpen}>
      <div className="space-y-1.5 mb-4">
        <h3 className="font-rethink font-semibold text-lg text-stone-900 tracking-tighter">
          {displayCampaign.status === "changes_requested" ? "Upload new content" : "Upload content"}
        </h3>
        <p className="font-rethink text-sm text-stone-500 font-medium tracking-[-0.01em]">
          Select your video and add a caption
        </p>
      </div>
      {renderUploadPanel()}
    </MobileDrawer>
  );

  const { platforms } = usePlatforms();
  const platformLabels: Record<string, string> = {
    tiktok: "TikTok",
    instagram: "Instagram",
    youtube: "YouTube",
    twitter: "X (Twitter)",
    facebook: "Facebook",
    ...Object.fromEntries(platforms.map((p) => [p.name.toLowerCase(), p.name])),
  };

  const displayPlatforms = (displayCampaign.platforms || ["tiktok", "instagram"])
    .map((p) => platformLabels[p] || p);

  const renderInlineUploadPanel = () => (
    <div className="bg-stone-50 border border-stone-200 rounded-[20px] p-4 space-y-4">
      {renderUploadPanel()}
      <button
        onClick={() => setUploadOpen(false)}
        className="w-full text-xs font-medium text-stone-500 font-rethink text-center"
      >
        Cancel
      </button>
    </div>
  );

  const renderActivity = () => {
    const items = [];

    const renderContentCard = (badgeStatus: CampaignItem["status"], review?: string) => (
      <div className={cn("bg-stone-100 rounded-[16px] p-2", review && "space-y-2")}>
        <div className="flex gap-3">
          <button
            onClick={() => displayCampaign.videoUrl && setPreviewVideoUrl(displayCampaign.videoUrl)}
            disabled={!displayCampaign.videoUrl}
            className="w-20 h-28 rounded-xl bg-stone-200 relative flex items-center justify-center overflow-hidden shrink-0 cursor-pointer"
          >
            {videoThumbUrl && (
              <Image
                src={videoThumbUrl}
                alt=""
                fill
                sizes="80px"
                unoptimized
                className="object-cover"
              />
            )}
            <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center text-stone-900 z-10">
              <svg className="w-2.5 h-2.5 translate-x-[1px]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="absolute inset-0 bg-gradient-to-tr from-purple-200 to-indigo-100 opacity-40"></div>
          </button>
          <div className="flex-1 min-w-0 space-y-2">
            <p className="font-rethink text-sm font-medium text-stone-900 leading-relaxed tracking-[-0.01em]">
              &quot;{displayCampaign.caption || "New drop from Musta4a is banging!!! This new jam called Pass am is so good #nusound #viral"}&quot;
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-stone-500 tracking-[-0.01em] font-rethink">
              <span>{displayCampaign.videoDuration || "0:45"}</span>
              <span className="w-1 h-1 rounded-full bg-stone-300" />
              <span>uploaded {displayCampaign.submittedAgo || "23 mins ago"}</span>
              <span className="w-1 h-1 rounded-full bg-stone-300" />
              <StatusDetailsBadge status={badgeStatus} />
            </div>
          </div>
        </div>
        {review && (
          <div className="bg-white rounded-[16px] p-3">
            <p className="font-rethink text-sm font-medium text-stone-900 leading-relaxed tracking-[-0.01em]">
              {review}
            </p>
          </div>
        )}
      </div>
    );

    if (displayCampaign.status === "delivered") {
      items.push(
        <div key="activity-delivered" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("delivered")}
        </div>
      );

      items.push(
        <div key="activity-live" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("live_tracking")}
        </div>
      );

      items.push(
        <div key="activity-approved" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("approved_post")}
        </div>
      );

      items.push(
        <div key="activity-changes" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("changes_requested", displayCampaign.comment || "Please revise the content")}
        </div>
      );

      items.push(
        <div key="activity-submitted" className="space-y-4">
          {renderContentCard("under_review")}
        </div>
      );
    }

    if (displayCampaign.status === "live_tracking") {
      items.push(
        <div key="activity-live" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("live_tracking")}
        </div>
      );

      items.push(
        <div key="activity-approved" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("approved_post")}
        </div>
      );

      items.push(
        <div key="activity-changes" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("changes_requested", displayCampaign.comment || "Please revise the content")}
        </div>
      );

      items.push(
        <div key="activity-submitted" className="space-y-4">
          {renderContentCard("under_review")}
        </div>
      );
    }

    if (displayCampaign.status === "changes_requested") {
      items.push(
        <div key="activity-changes" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("changes_requested", displayCampaign.comment || "Please revise the content")}
        </div>
      );

      items.push(
        <div key="activity-submitted" className="space-y-4">
          {renderContentCard("under_review")}
        </div>
      );
    }

    if (displayCampaign.status === "under_review") {
      items.push(
        <div key="activity-submitted" className="space-y-4">
          {renderContentCard("under_review")}
        </div>
      );
    }

    if (displayCampaign.status === "approved_post") {
      items.push(
        <div key="activity-approved" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("approved_post")}
        </div>
      );

      items.push(
        <div key="activity-changes" className="space-y-4 border-b border-stone-100 pb-5">
          {renderContentCard("changes_requested", displayCampaign.comment || "Please revise the content")}
        </div>
      );

      items.push(
        <div key="activity-submitted" className="space-y-4">
          {renderContentCard("under_review")}
        </div>
      );
    }

    return items;
  };

  const panelContent = (
    <div className={cn("mx-auto space-y-8 pb-10", isMobile ? "w-full max-w-[350px]" : "w-[350px]")}>
          {/* Identity header */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200 flex-shrink-0 overflow-hidden">
              {displayCampaign.coverImageUrl ? (
                <img
                  src={displayCampaign.coverImageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : (
                <HugeiconsIcon icon={TiktokIcon} size={24} className="text-purple-600" />
              )}
            </div>
            <div className="space-y-1.5">
              <h2 className="font-rethink font-medium tracking-tighter text-xl text-stone-900 leading-tight">
                {displayCampaign.title}
              </h2>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px] font-rethink">
                  {displayCampaign.category}
                </span>
                <StatusDetailsBadge status={displayCampaign.status} />
              </div>
            </div>
          </div>

          {/* Live CTA */}
          {displayCampaign.status === "live_tracking" && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setUploadOpen(true)}
                className="flex-1 py-3 bg-[#FEB604] text-stone-900 rounded-full font-semibold text-sm border border-stone-100 font-rethink"
              >
                Upload more contents
              </button>
              {onRefresh && (
                <button
                  onClick={handleRefresh}
                  aria-label="Refresh views"
                  className="w-11 h-11 flex-shrink-0 flex items-center justify-center bg-white text-stone-600 border border-stone-200 rounded-full font-rethink"
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    size={18}
                    className={cn("text-stone-600", refreshing && "animate-spin")}
                  />
                </button>
              )}
            </div>
          )}
          {uploadOpen && !isMobile && displayCampaign.status === "live_tracking" && renderInlineUploadPanel()}

          {/* Views stats */}
          {(displayCampaign.status === "live_tracking" || displayCampaign.status === "delivered") && (
            <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-4">
              <div className="space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block tracking-[-0.01em]">Total views</span>
                <div className="flex items-center gap-3">
                  <span className="font-rethink font-medium text-2xl text-stone-900 tracking-tighter">
                    {(displayCampaign.currentViews || 0).toLocaleString()}
                  </span>
                  <div className="flex-1 max-w-[200px] h-1.5 bg-stone-100 border border-stone-200/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${displayCampaign.status === "delivered" ? "bg-teal-500" : "bg-blue-600"}`}
                      style={{ width: displayCampaign.status === "delivered" ? "100%" : `${displayCampaign.progress || 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-stone-500 tracking-[-0.01em]">
                    {Number((displayCampaign.progress || 0).toFixed(3))}%
                  </span>
                  <span className="text-xs font-medium text-stone-500 tracking-[-0.01em]">
                    / {(displayCampaign.viewTarget || displayCampaign.targetViews || 0).toLocaleString()} target
                  </span>
                </div>
              </div>

              <div className="border-t border-stone-100" />
              <div className="space-y-3">
                <span className="text-[10px] font-medium text-stone-500 block tracking-[-0.01em]">Views breakdown</span>
                <div className="space-y-3">
                  {(displayCampaign.platforms || ["tiktok", "instagram"]).map((platform) => {
                    const entry = (displayCampaign.postedPlatforms || []).find(
                      (p) => String(p.platform).toLowerCase() === String(platform).toLowerCase()
                    );
                    const platformViews = entry?.views || 0;
                    const earned = platformViews * (displayCampaign.costPerView || 0);
                    return (
                      <div key={platform} className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                        <span className="text-stone-500">{platformLabels[platform] || platform}</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-stone-900">{platformViews.toLocaleString()} views</span>
                          {earned > 0 && (
                            <span className="text-[11px] text-stone-400">₦{earned.toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Status alerts */}
          {displayCampaign.status === "under_review" && (
            <div className="flex items-center gap-4 border border-dashed rounded-[16px] p-2 pl-0 bg-[#FEFCE8] border-[#854D0E]">
              <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden">
                <Image src={inReviewCreatorImg} alt="Under review" width={48} height={48} unoptimized className="w-full h-full object-contain" />
              </div>
              <div className="space-y-1">
                <h4 className="font-rethink font-medium text-sm text-[#854D0E] tracking-[-0.01em]">Under review</h4>
                <p className="font-rethink text-sm font-medium leading-normal text-[#854D0E] tracking-[-0.01em]">
                  Submitted recently. Most reviews are completed within 24 hours.
                </p>
              </div>
            </div>
          )}

          {displayCampaign.status === "changes_requested" && (
            <div className="flex items-center gap-4 border border-dashed rounded-[16px] p-2 pl-0 bg-red-50 border-red-200">
              <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden">
                <Image src={changesFeedbackImg} alt="Changes requested" width={48} height={48} unoptimized className="w-full h-full object-contain" />
              </div>
              <div className="space-y-1">
                <h4 className="font-rethink font-medium text-sm text-red-800 tracking-[-0.01em]">Changes requested</h4>
                <p className="font-rethink text-sm font-medium leading-normal text-red-800 tracking-[-0.01em]">
                  {displayCampaign.comment || "Please revise the content"}
                </p>
              </div>
            </div>
          )}

          {displayCampaign.status === "approved_post" && (
            <div className="flex items-center gap-4 border border-dashed rounded-[16px] p-2 pl-0 bg-[#EBF3FF] border-[#BFDBFE]">
              <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden">
                <Image src={approvedCreatorImg} alt="Approved" width={48} height={48} unoptimized className="w-full h-full object-contain" />
              </div>
              <div className="space-y-1">
                <h4 className="font-rethink font-medium text-sm text-blue-800 tracking-[-0.01em]">Approved</h4>
                <p className="font-rethink text-sm font-medium leading-normal text-blue-800 tracking-[-0.01em]">
                  Post this on {displayPlatforms.join(", ")}, then paste the link below so we can start tracking your views.
                </p>
              </div>
            </div>
          )}

          {displayCampaign.status === "delivered" && (
            <div className="flex items-center gap-4 border border-dashed rounded-[16px] p-2 pl-0 bg-green-50 border-green-200">
              <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden">
                <Image src={deliveredCreatorImg} alt="Delivered" width={48} height={48} unoptimized className="w-full h-full object-contain" />
              </div>
              <div className="space-y-1">
                <h4 className="font-rethink font-medium text-sm text-green-800 tracking-[-0.01em]">Delivered</h4>
                <p className="font-rethink text-sm font-medium leading-normal text-green-800 tracking-[-0.01em]">
                  Target reached and verified. ₦{displayCampaign.reward.toLocaleString()} was paid to your wallet
                </p>
              </div>
            </div>
          )}

          {/* Primary actions */}
          {displayCampaign.status === "needs_content" && (
            <button
              onClick={() => setUploadOpen(true)}
              className="w-full py-3 bg-[#FEB604] text-stone-900 rounded-full font-semibold text-sm border border-stone-100 font-rethink"
            >
              Upload content
            </button>
          )}

          {displayCampaign.status === "changes_requested" && (
            <button
              onClick={() => setUploadOpen(true)}
              className="w-full py-3 bg-[#FEB604] text-stone-900 rounded-full font-semibold text-sm border border-stone-100 font-rethink"
            >
              Upload new content
            </button>
          )}

          {uploadOpen &&
            !isMobile &&
            (displayCampaign.status === "needs_content" || displayCampaign.status === "changes_requested") &&
            renderInlineUploadPanel()}

          {displayCampaign.status === "approved_post" && (
            <div className="space-y-2.5">
              <div className={cn("grid gap-2.5", isMobile ? "grid-cols-1" : "grid-cols-3")}>
                {linkPlatforms.map((p) => (
                  <input
                    key={p}
                    type="text"
                    placeholder={`${platformLabels[p] || p} post link`}
                    value={linkInputs[p] || ""}
                    onChange={(e) => setLinkInputs((prev) => ({ ...prev, [p]: e.target.value }))}
                    className="w-full min-w-0 px-3 py-2.5 bg-white border border-stone-200 rounded-full text-sm font-medium text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400 font-rethink"
                  />
                ))}
              </div>
              <button
                onClick={handleLinkSubmit}
                disabled={!allLinksFilled}
                className={cn(
                  "w-full py-3 rounded-full font-semibold text-sm border font-rethink",
                  allLinksFilled
                    ? "bg-[#FEB604] text-stone-900 border-stone-100"
                    : "bg-stone-200 text-stone-400 border-stone-200 cursor-not-allowed"
                )}
              >
                Submit link
              </button>
            </div>
          )}

          {/* The brief */}
          {(displayCampaign.description || displayCampaign.contentBrief || displayCampaign.keyMessageCta || displayCampaign.whatToAvoid || displayCampaign.contentStyle || displayCampaign.goal || displayCampaign.competitors || displayCampaign.uniqueSellingPoint || displayCampaign.funFact || displayCampaign.scriptUrl) && (
            <div className="space-y-6">
              {(displayCampaign.description || displayCampaign.contentBrief) && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Campaign description</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.description || displayCampaign.contentBrief}
                  </p>
                </div>
              )}

              {displayCampaign.keyMessageCta && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Key message</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.keyMessageCta}
                  </p>
                </div>
              )}

              {displayCampaign.whatToAvoid && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">What to avoid</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.whatToAvoid}
                  </p>
                </div>
              )}

              {displayCampaign.contentStyle && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Content style</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {Array.isArray(displayCampaign.contentStyle) ? displayCampaign.contentStyle.join(", ") : displayCampaign.contentStyle}
                  </p>
                </div>
              )}

              {displayCampaign.goal && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Campaign goal</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.goal}
                  </p>
                </div>
              )}

              {displayCampaign.competitors && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Competitors</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.competitors}
                  </p>
                </div>
              )}

              {displayCampaign.uniqueSellingPoint && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Unique selling point</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.uniqueSellingPoint}
                  </p>
                </div>
              )}

              {displayCampaign.funFact && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Fun fact</h5>
                  <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">
                    {displayCampaign.funFact}
                  </p>
                </div>
              )}

              {(displayCampaign.scriptUrl || displayCampaign.scriptFileName) && (
                <div className="space-y-1.5">
                  <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Campaign script/brief</h5>
                  <a
                    href={displayCampaign.scriptUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-stone-200 rounded-full"
                  >
                    <HugeiconsIcon icon={File01Icon} size={14} className="text-stone-900 shrink-0" />
                    <span className="text-sm font-medium text-stone-900 font-rethink truncate max-w-[200px]">
                      {displayCampaign.scriptFileName || "Campaign brief"}
                    </span>
                    <HugeiconsIcon icon={Download01Icon} size={14} className="text-stone-900 shrink-0" />
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-stone-100" />

          {/* Campaign overview */}
          <div className="space-y-4">
            <h4 className="font-rethink font-semibold text-sm text-stone-900">Campaign overview</h4>
            <div className="space-y-4 pt-2">
              {displayCampaign.brandName && (
                <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500">Campaign by</span>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-[10px] font-medium text-stone-600 overflow-hidden shrink-0">
                      {displayCampaign.brandAvatar ? (
                        <Image src={displayCampaign.brandAvatar} alt="" width={28} height={28} className="object-cover" unoptimized />
                      ) : (
                        displayCampaign.brandName.charAt(0)
                      )}
                    </div>
                    <span className="text-stone-800 font-rethink">{displayCampaign.brandName}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                <span className="text-stone-500">Target</span>
                <span className="text-stone-800">
                  {(displayCampaign.viewTarget || displayCampaign.targetViews || 0).toLocaleString()} views
                </span>
              </div>
              <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                <span className="text-stone-500">Current views</span>
                <span className="text-stone-800">
                  {(displayCampaign.currentViews || 0).toLocaleString()} views
                </span>
              </div>
              <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                <span className="text-stone-500">Reward</span>
                <span className="text-stone-800">₦{displayCampaign.reward.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                <span className="text-stone-500">Platform</span>
                <span className="text-stone-800">{displayPlatforms.join(", ")}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-stone-100" />

          {/* Activity */}
          <div className="space-y-4">
            <h4 className="font-rethink font-semibold text-sm text-stone-900">Activity</h4>
            {renderActivity().length > 0 ? (
              <div className="space-y-5">
                {renderActivity()}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-10 px-6 space-y-3">
                <Image src={emptyActivityImg} alt="" unoptimized className="w-40 h-auto" />
                <h5 className="font-rethink font-medium text-sm text-stone-900 tracking-[-0.01em]">No activity yet</h5>
                <p className="font-rethink text-sm text-stone-500 font-medium max-w-[220px] leading-relaxed tracking-[-0.01em]">
                  Upload your content to kick off the review and tracking process.
                </p>
              </div>
            )}
          </div>
    </div>
  );

  const renderVideoPreview = () =>
    previewVideoUrl ? (
      <div className="fixed inset-0 z-[60] bg-stone-950/70 backdrop-blur-sm flex items-center justify-center p-6 font-rethink">
        <button
          onClick={() => setPreviewVideoUrl(null)}
          aria-label="Close preview"
          className="absolute top-5 right-5 flex items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <video
          src={previewVideoUrl}
          controls
          autoPlay
          className="max-w-full max-h-[80vh] rounded-2xl bg-black"
        />
      </div>
    ) : null;

  if (isMobile) {
    return (
      <div className="min-h-dvh bg-[#FAFAF9] flex flex-col">
        <header
          className="sticky top-0 z-10 flex items-center gap-3 px-4 h-14 border-b border-stone-200 bg-[#FAFAF9]"
          data-lenis-prevent
        >
          <button
            onClick={onClose}
            aria-label="Go back"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200 shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="font-rethink font-medium text-sm text-stone-900 truncate">{displayCampaign.title}</span>
        </header>

        <div className="w-full px-5 pt-6 pb-[env(safe-area-inset-bottom)]">
          {panelContent}
        </div>

        {renderMobileUploadSheet()}
        {renderVideoPreview()}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        onClick={onClose}
        className="w-1/5 bg-stone-900/10 backdrop-blur-md cursor-pointer"
      >
      </div>

      <div
        className="relative w-4/5 h-full bg-[#FAFAF9] rounded-l-[24px] border-l border-stone-200 overflow-y-auto pt-16 pb-12 px-10 animate-in slide-in-from-right duration-300"
        data-lenis-prevent
      >
        <button
          onClick={onClose}
          className="absolute top-6 right-6 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-stone-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {panelContent}
      </div>

        {renderMobileUploadSheet()}
        {renderVideoPreview()}
      </div>
    );
}

function StatusDetailsBadge({ status }: { status: CampaignItem["status"] }) {
  const badge = STATUS_BADGES[status];
  const dotClasses = `${badge.dot}${status === "live_tracking" ? " animate-pulse" : ""}`;

  return (
    <span
      className={`px-2 py-0.5 rounded-full font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1 ${badge.bg} ${badge.text}`}
    >
      <span className={`w-1 h-1 rounded-full ${dotClasses}`} /> {badge.label}
    </span>
  );
}
