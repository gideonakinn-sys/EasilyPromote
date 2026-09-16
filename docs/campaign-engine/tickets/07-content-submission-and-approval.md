# 07: Content Approval and delivery

**What to build:** A creator in a campaign submits content. The brand reviews it against the brief and approves, requests changes or rejects. Approved content then goes where the campaign says: the creator posts it on their page, delivers it to the brand, or both.

**Blocked by:** 03, 05

**Milestone:** M5 · track B · 19 – 30 Oct

**Status:** ready-for-agent

## Corrections from the first draft

- **Extend the existing submission, don't replace it.** Submissions already go new → approved / rejected → awaiting post → posted → verifying, with appeals and an event log. Today's "new" is the first draft's "submitted". Add "changes requested" and the brand-page delivery path.
- Blocked by 03 and 05 (a content campaign must exist and a creator must be able to join). Application Required (06) is not needed to build this; it only adds another way in.
- **Brand-page delivery uses a download link at launch** (D12). Uploading the original file moves to ticket 11.
- Views campaigns keep their current submission path unchanged.

## Acceptance criteria

- [ ] Brand can request changes with notes; the creator resubmits; at most 2 rounds, then approve or reject (D11)
- [ ] Brand review shows the video, caption and the brief's requirements side by side
- [ ] After approval, **creator page**: awaiting post → creator submits the live post link (with required hashtags / code) → posted → verifying → completed
- [ ] After approval, **brand page**: creator shares a download link → brand confirms receipt → delivered → completed
- [ ] After approval, **both**: both paths, and the usage-rights acceptance is recorded
- [ ] Content with no brand response for 72 hours is approved automatically (D10)
- [ ] Every status change notifies the person who has to act next
- [ ] Submission status never changes an application, and application status never changes a submission
- [ ] End-to-end tests: each destination path; change request round trip; auto-approve; existing views submission unchanged
