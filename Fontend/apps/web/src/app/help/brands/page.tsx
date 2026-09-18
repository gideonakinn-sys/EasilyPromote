import type { Metadata } from "next";
import { HelpArticle, HelpExample, HelpList, HelpText, type HelpSection } from "../../../components/help-article";

export const metadata: Metadata = {
  title: "Help for Brands · EasilyPromote",
  description: "How campaigns, rates, reviews, delivery and refunds work for brands on EasilyPromote.",
};

const SECTIONS: HelpSection[] = [
  {
    id: "create",
    title: "Creating a campaign",
    questions: [
      {
        id: "create-steps",
        question: "How do I create a campaign?",
        answer: (
          <>
            <HelpText>Open your dashboard and choose Create Campaign. The setup has six steps:</HelpText>
            <HelpList
              items={[
                "Campaign type: what you want from the campaign — visibility, sign-ups, content, or both.",
                "Audience: who you want to reach.",
                "Creators: how creators get in, and who can take part.",
                "Pay and budget: what creators earn and what you pay.",
                "Brief: everything creators need to make the content.",
                "Review and launch: check the summary and pay.",
              ]}
            />
            <HelpText>
              You can save a draft and come back to it. Your campaign goes live once your payment is confirmed.
            </HelpText>
          </>
        ),
      },
      {
        id: "objectives",
        question: "Which objectives can I choose?",
        answer: (
          <>
            <HelpText>Four objectives are open today:</HelpText>
            <HelpList
              items={[
                "Content: pay creators a set amount for each piece of content you approve.",
                "Views: creators post about you and you pay for the views they deliver.",
                "Downloads: pay for app installs, tracked with a code for each creator.",
                "Sign-ups: pay for people who sign up, tracked with a code for each creator.",
              ]}
            />
            <HelpText>Engagement, Leads, Sales and Other show as Coming soon. You can&apos;t create them yet.</HelpText>
          </>
        ),
      },
      {
        id: "what-each-pays-for",
        question: "What does each kind of campaign pay for?",
        answer: (
          <>
            <HelpList
              items={[
                "Content campaigns pay per deliverable. A deliverable is one piece of content, such as one video. You pay for up to 100 deliverables, and each one is a place one creator can take.",
                "Views campaigns pay for views on creators' live posts. You choose a target of at least 100,000 views.",
                "Sign-up and download campaigns pay creators for each verified sign-up or download that comes through their code. They also include a views target, paid in the same checkout.",
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: "rates",
    title: "Who sets the rate",
    questions: [
      {
        id: "rate-authority",
        question: "Do I decide what creators earn?",
        answer: (
          <>
            <HelpText>It depends on the objective:</HelpText>
            <HelpList
              items={[
                "Content: you set what creators earn for each approved deliverable, in whole naira.",
                "Sign-ups and downloads: you fund a referral budget. Our team sets the reward creators earn per sign-up or download. You can't set it.",
                "Views: you choose how many views you want and the cost is calculated automatically.",
              ]}
            />
          </>
        ),
      },
      {
        id: "reward-not-set",
        question: "What happens to sign-ups before the reward is set?",
        answer: (
          <HelpText>
            They&apos;re still recorded. When our team sets the reward, earlier sign-ups are paid from your referral budget, oldest
            first, while the budget lasts. If the reward changes later, the new amount applies to new sign-ups only.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "pricing",
    title: "What you pay",
    questions: [
      {
        id: "content-price",
        question: "How is a content campaign priced?",
        answer: (
          <>
            <HelpText>
              Your rate times the number of deliverables is the creator budget. Our 30% platform fee is added on top, so creators get
              exactly your rate. For example, ₦15,000 per video for 10 videos:
            </HelpText>
            <HelpExample
              rows={[
                { label: "Creator Budget (₦15,000 × 10)", value: "₦150,000" },
                { label: "Platform Fee (30%)", value: "₦45,000" },
              ]}
              total={{ label: "Total to Pay", value: "₦195,000" }}
            />
          </>
        ),
      },
      {
        id: "views-price",
        question: "How is a views campaign priced?",
        answer: (
          <>
            <HelpText>
              The price comes from our price table, with the 30% platform fee inside it. The more views you buy, the less each view
              costs. For example:
            </HelpText>
            <HelpList items={["100,000 views: ₦430,000", "1,000,000 views: ₦3,330,000"]} />
            <HelpText>The wizard shows the exact price for any number of views before you pay.</HelpText>
          </>
        ),
      },
      {
        id: "referral-price",
        question: "How is a sign-up or download campaign priced?",
        answer: (
          <>
            <HelpText>
              You pay the views price plus your referral budget, in one checkout. The referral budget is at least ₦1,000, and the 30%
              platform fee is inside it. For example, 100,000 views with a ₦100,000 referral budget:
            </HelpText>
            <HelpExample
              rows={[
                { label: "Views", value: "₦430,000" },
                { label: "Referral Budget", value: "₦100,000" },
              ]}
              total={{ label: "Total to Pay", value: "₦530,000" }}
            />
            <HelpText>
              ₦70,000 of that referral budget pays creator rewards. If the budget runs out, sign-ups are still recorded, but creators
              aren&apos;t paid for new ones until you add more budget.
            </HelpText>
          </>
        ),
      },
    ],
  },
  {
    id: "destination",
    title: "Where content goes and usage rights",
    questions: [
      {
        id: "destinations",
        question: "Where can the content end up?",
        answer: (
          <HelpList
            items={[
              "Creator's page: creators post the content on their own accounts.",
              "Your page: creators send you the content as a download link and you post it on your accounts.",
              "Both: creators send you the content first, then post it on their accounts too.",
            ]}
          />
        ),
      },
      {
        id: "usage-rights",
        question: "What usage rights do I get?",
        answer: (
          <>
            <HelpText>
              When content goes to your page (or both), the creator must accept one standard licence before they can deliver it:
            </HelpText>
            <HelpText className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-neutral-900">
              &ldquo;You grant the brand a perpetual, non-exclusive licence to use this content on its own organic and paid social
              channels.&rdquo;
            </HelpText>
            <HelpText>
              In short: you can use it in posts and paid ads for as long as you like. It isn&apos;t exclusive, so the creator can still
              show the work they made. Custom terms aren&apos;t available.
            </HelpText>
          </>
        ),
      },
    ],
  },
  {
    id: "access",
    title: "Open Call or Application Required",
    questions: [
      {
        id: "access-models",
        question: "What's the difference?",
        answer: (
          <HelpList
            items={[
              "Open Call: any creator who meets your requirements can join straight away and take a place. Good when you want to move fast.",
              "Application Required: creators apply and you choose who takes part. Good when you want to pick each creator yourself.",
            ]}
          />
        ),
      },
    ],
  },
  {
    id: "targeting",
    title: "Audience targeting",
    questions: [
      {
        id: "audience-location",
        question: "Does location mean where creators live?",
        answer: (
          <>
            <HelpText>
              No. Audience location is where a creator&apos;s followers are, as a share of their audience. A creator who lives in
              Abuja but has 80% of their followers in Lagos matches a Lagos campaign.
            </HelpText>
            <HelpText>
              Creators add these numbers themselves, with a screenshot of their analytics as proof. They show as self-reported.
            </HelpText>
          </>
        ),
      },
      {
        id: "hard-or-ranking",
        question: "Which settings stop a creator from joining?",
        answer: (
          <>
            <HelpText>These are requirements. A creator who misses one can&apos;t join or apply, and they see why:</HelpText>
            <HelpList
              items={[
                "Audience location, when you set a minimum share. Without a minimum share, your locations don't stop anyone. They decide which creators we recommend your campaign to and how applicants are ordered.",
                "Platforms: the creator needs an account on one of them.",
                "Minimum followers and content categories.",
              ]}
            />
            <HelpText>Age and gender never stop anyone. They only help order creators by how well their audience matches.</HelpText>
          </>
        ),
      },
    ],
  },
  {
    id: "applicants",
    title: "Reviewing applicants",
    questions: [
      {
        id: "applicant-list",
        question: "How do I review applicants?",
        answer: (
          <>
            <HelpText>
              Open your campaign and go to Applicants. By default the best audience match is first. Each applicant shows a snapshot
              of their profile from the moment they applied: audience, performance, portfolio and badges, with what matters most for
              your campaign at the top.
            </HelpText>
            <HelpList
              items={[
                "Approve: the creator gets a place straight away, the full brief unlocks for them, and they're told by email. If no places are left, approval is refused.",
                "Reject: add a reason if you like. The creator is told.",
              ]}
            />
          </>
        ),
      },
      {
        id: "applicant-expiry",
        question: "What if I don't review applications?",
        answer: (
          <HelpText>
            We remind you once an application has waited 3 days. An application you haven&apos;t reviewed after 7 days expires, and
            the creator is told. Pending applications also close when your campaign ends.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "content-review",
    title: "Reviewing content in content campaigns",
    questions: [
      {
        id: "review-options",
        question: "What can I do with submitted content?",
        answer: (
          <HelpList
            items={[
              "Approve it.",
              "Request changes, with notes. You can do this at most 2 times for each piece of content. After that, approve or reject.",
              "Reject it, with a reason. Rejecting frees the place, so another creator can take it.",
            ]}
          />
        ),
      },
      {
        id: "auto-approve",
        question: "What if I don't respond?",
        answer: (
          <HelpText>
            Content you haven&apos;t reviewed within 72 hours is approved automatically. The 72 hours start again each time the creator
            resubmits after a change request. We tell you when this happens.
          </HelpText>
        ),
      },
      {
        id: "appeals",
        question: "Can a creator challenge a rejection?",
        answer: (
          <HelpText>
            Yes. A creator has 7 days to appeal, and our team reviews the content against your brief. Our decision is final. If we
            uphold the appeal, the content counts as approved, as long as the creator&apos;s place is still free and your campaign has
            budget left for it.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "delivery",
    title: "Confirming delivery and posts in content campaigns",
    questions: [
      {
        id: "confirm-receipt",
        question: "Content is coming to my page. What do I do?",
        answer: (
          <HelpText>
            After you approve the content, the creator shares a download link and accepts the usage rights. Download the file and
            confirm you received it. If you don&apos;t confirm within 72 hours, it&apos;s confirmed automatically. A new link from the
            creator gives you a fresh 72 hours.
          </HelpText>
        ),
      },
      {
        id: "verify-post",
        question: "Content goes on the creator's page. What do I do?",
        answer: (
          <>
            <HelpText>
              After approval, the creator posts the content and shares the live link with the caption they used. The caption must
              include your brief&apos;s hashtags. We check this before we accept the link.
            </HelpText>
            <HelpText>
              Check the post and confirm it. If you can&apos;t find it or it doesn&apos;t match, choose Can&apos;t Verify The Post and
              tell the creator why. If you don&apos;t respond within 72 hours, the post is confirmed automatically.
            </HelpText>
          </>
        ),
      },
      {
        id: "both-order",
        question: "What happens when content goes to both pages?",
        answer: <HelpText>The creator sends you the file first. Once you confirm you received it, they post it on their page.</HelpText>,
      },
      {
        id: "when-creators-paid",
        question: "When are creators paid for content?",
        answer: (
          <HelpText>
            For content that goes only to your page, the creator&apos;s pay is set aside when you approve it. For the creator&apos;s
            page or both, it&apos;s set aside once the live post is confirmed. Either way, the creator can only withdraw it 7 days after
            delivery is confirmed. If approved content is never delivered to your page, our team can remove that pay 14 days after
            approval.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "refunds",
    title: "Refunds of unused budget",
    questions: [
      {
        id: "content-refunds",
        question: "Do I get unused content budget back?",
        answer: (
          <>
            <HelpText>
              Yes. Once a content campaign is completed or cancelled, our team issues the refund. It goes back to the payment you
              made through Paystack, and we tell you when it&apos;s on its way.
            </HelpText>
            <HelpText>The refund covers each unused deliverable at your rate, plus the platform fee you paid on it. It doesn&apos;t include:</HelpText>
            <HelpList
              items={[
                "Deliverables creators have been paid for or are owed.",
                "Content still in review, delivery or appeal.",
                "Rejected content while the creator can still appeal (7 days).",
              ]}
            />
            <HelpText>
              Paystack fees aren&apos;t deducted. If more becomes unused later, for example when an appeal window closes, our team can
              refund that too.
            </HelpText>
          </>
        ),
      },
      {
        id: "cancel-refunds",
        question: "What about views and sign-up campaigns?",
        answer: (
          <HelpText>
            When one of these campaigns is cancelled, the refund is sent automatically. For views, you get back the part of the
            creator budget that creators haven&apos;t been paid or asked to withdraw. For sign-ups and downloads, you get back the
            referral budget creators haven&apos;t earned, including the platform fee on it.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "connect-app",
    title: "Connecting your app",
    questions: [
      {
        id: "why-connect",
        question: "Why do I need to connect my app?",
        answer: (
          <HelpText>
            Sign-ups and downloads are reported by your own server, so we know each one is real. You can&apos;t pay for a sign-up or
            download campaign until your app is connected.
          </HelpText>
        ),
      },
      {
        id: "how-connect",
        question: "How do I connect it?",
        answer: (
          <>
            <HelpText>Go to Referral tracking from your dashboard, or follow the checklist in the campaign setup. Three steps:</HelpText>
            <HelpList
              items={[
                "Create a signing key.",
                "Your server checks a creator code with us.",
                "Your server sends a test conversion.",
              ]}
            />
            <HelpText>Each step ticks by itself once we receive it. Referral tracking has code examples for your developers.</HelpText>
          </>
        ),
      },
    ],
  },
];

export default function BrandHelpPage() {
  return (
    <HelpArticle
      roleLabel="Brand"
      title="Help for Brands"
      intro="How campaigns work on EasilyPromote: what you pay for, who sets the rate, and what happens from launch to refund."
      sections={SECTIONS}
      dashboardHref="/dashboard/brand"
      otherGuide={{ href: "/help/creators", label: "Help for Creators" }}
    />
  );
}
