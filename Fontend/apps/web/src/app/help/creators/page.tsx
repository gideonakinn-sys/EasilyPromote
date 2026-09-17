import type { Metadata } from "next";
import { HelpArticle, HelpList, HelpText, type HelpSection } from "../../../components/help-article";

export const metadata: Metadata = {
  title: "Help for Creators · EasilyPromote",
  description: "How joining, applying, content review, delivery and getting paid work for creators on EasilyPromote.",
};

const SECTIONS: HelpSection[] = [
  {
    id: "profile",
    title: "Your profile and audience",
    questions: [
      {
        id: "audience-data",
        question: "Why should I add my audience?",
        answer: (
          <>
            <HelpText>
              Brands target where your followers are, not where you live. If you live in Abuja but 80% of your followers are in
              Lagos, you match a Lagos campaign. Without audience data, you can&apos;t join campaigns that need a share of their
              audience in a location.
            </HelpText>
            <HelpText>In your profile you can add:</HelpText>
            <HelpList
              items={[
                "Up to 5 audience locations, each with its share of your audience.",
                "Age groups and a gender split.",
                "A screenshot of your analytics as proof. It's required the first time.",
              ]}
            />
            <HelpText>Each breakdown can&apos;t add up to more than 100%. Your numbers show to brands as self-reported.</HelpText>
          </>
        ),
      },
      {
        id: "profile-other",
        question: "What else goes on my profile?",
        answer: (
          <HelpList
            items={[
              "Your social accounts and follower counts.",
              "Your categories, such as Fashion or Tech.",
              "Up to 12 portfolio items.",
              "Your legal name and phone number. Brands never see these.",
            ]}
          />
        ),
      },
      {
        id: "verification",
        question: "How do I become a Verified Creator?",
        answer: (
          <HelpText>
            Our team checks your identity and verifies you. You need at least one connected TikTok, Instagram or Facebook account
            first. If you disconnect all your accounts, the Verified Creator badge is removed. Some campaigns are open to verified
            creators only.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "marketplace",
    title: "Finding campaigns",
    questions: [
      {
        id: "recommended",
        question: "How are campaigns recommended to me?",
        answer: (
          <>
            <HelpText>A campaign shows under Recommended for You when you can join it and either:</HelpText>
            <HelpList
              items={[
                "it targets an audience and yours matches it well (a Match Score of 50 or more), or",
                "it doesn't target an audience and shares one of your categories or niches.",
              ]}
            />
            <HelpText>The best matches come first. Everything else is under New, newest first.</HelpText>
          </>
        ),
      },
      {
        id: "pay-on-cards",
        question: "What does the pay on a card mean?",
        answer: (
          <HelpList
            items={[
              "Per approved deliverable: a fixed amount for each piece of content the brand approves. The brand sets it.",
              "Per sign-up or download: a reward for each verified conversion through your code. Our team sets it.",
              "Per 1,000 views: what your place pays for views. It comes from our price table.",
            ]}
          />
        ),
      },
    ],
  },
  {
    id: "joining",
    title: "Joining and applying",
    questions: [
      {
        id: "join-vs-apply",
        question: "What's the difference between joining and applying?",
        answer: (
          <HelpList
            items={[
              "Open Call: if you meet the requirements, you join straight away and your place is reserved.",
              "Application Required: you apply, with a short pitch if you like. The brand picks who takes part. If you're selected, your place is reserved and we email you.",
            ]}
          />
        ),
      },
      {
        id: "why-cant-join",
        question: "Why can't I join or apply?",
        answer: (
          <>
            <HelpText>The campaign tells you exactly what&apos;s missing. Common reasons:</HelpText>
            <HelpList
              items={[
                "You haven't connected a social account.",
                "You haven't chosen your niches.",
                "You already have 3 active placements. A placement stops counting once its work is complete.",
                "Not enough of your audience is in the locations the brand targets.",
                "You don't have an account on the platforms the brand wants.",
                "The campaign needs more followers, a higher engagement rate, a category, verification, a rank or a badge you don't have yet.",
                "No places are left.",
              ]}
            />
          </>
        ),
      },
      {
        id: "application-status",
        question: "How long does an application take?",
        answer: (
          <HelpText>
            The brand has 7 days to review it. If they don&apos;t, it expires and we tell you. You can withdraw a pending application,
            and you can apply again after withdrawing or after it expires. Pending applications also close when the campaign ends.
          </HelpText>
        ),
      },
      {
        id: "brief",
        question: "When do I see the full brief?",
        answer: (
          <HelpText>
            Before you join you see a summary. Once you have a place, the full brief unlocks: do&apos;s and don&apos;ts, hashtags,
            sound, reference videos and your referral code if the campaign has one.
          </HelpText>
        ),
      },
    ],
  },
  {
    id: "submitting",
    title: "Submitting content",
    questions: [
      {
        id: "submit",
        question: "How do I submit content for a content campaign?",
        answer: (
          <HelpText>
            Share a link the brand can open to watch your video, with the caption you plan to post. You submit once per campaign.
            You can still edit your link and caption while the brand is reviewing.
          </HelpText>
        ),
      },
      {
        id: "no-response",
        question: "What if the brand doesn't review it?",
        answer: <HelpText>If the brand doesn&apos;t respond within 72 hours, your content is approved automatically.</HelpText>,
      },
    ],
  },
  {
    id: "changes",
    title: "Change requests and appeals",
    questions: [
      {
        id: "change-requests",
        question: "What happens when the brand asks for changes?",
        answer: (
          <HelpText>
            You get their notes. Update your content and resubmit. A brand can ask for changes at most 2 times. After that, they
            approve or reject it.
          </HelpText>
        ),
      },
      {
        id: "rejected",
        question: "My content was rejected. What now?",
        answer: (
          <>
            <HelpText>
              The brand has to give a reason. Your place goes back to the campaign, and you can&apos;t join the campaign again.
            </HelpText>
            <HelpText>
              If you think your content meets the brief, you have 7 days to appeal. Our team reviews it and decides, and that decision
              is final. If we uphold it while your place is still free, your content is approved and the place is yours again.
            </HelpText>
          </>
        ),
      },
    ],
  },
  {
    id: "delivering",
    title: "Delivering approved content",
    questions: [
      {
        id: "creator-page",
        question: "The content goes on my page. What do I do?",
        answer: (
          <>
            <HelpText>
              Post it, then share the live post link and the caption exactly as posted. Your caption must include every hashtag in
              the brief, and your referral code if the campaign gave you one. We check before accepting the link.
            </HelpText>
            <HelpText>
              The brand checks the post. If they don&apos;t respond within 72 hours, it&apos;s confirmed automatically. If they
              can&apos;t verify it, they tell you why and you can share the link again.
            </HelpText>
          </>
        ),
      },
      {
        id: "brand-page",
        question: "The content goes to the brand. What do I do?",
        answer: (
          <>
            <HelpText>
              Share a download link to the file that the brand can open, and accept the usage rights:
            </HelpText>
            <HelpText className="bg-stone-50 border border-stone-200 rounded-2xl p-4 text-stone-900">
              &ldquo;You grant the brand a perpetual, non-exclusive licence to use this content on its own organic and paid social
              channels.&rdquo;
            </HelpText>
            <HelpText>
              The brand confirms they received it. If they don&apos;t respond within 72 hours, it&apos;s confirmed automatically. If
              the campaign is for both pages, post it on your page after that.
            </HelpText>
            <HelpText>
              Deliver within 14 days of approval. If approved content is never delivered, our team can remove its pay after that.
            </HelpText>
          </>
        ),
      },
    ],
  },
  {
    id: "pay",
    title: "When you get paid",
    questions: [
      {
        id: "fixed-pay",
        question: "When is my fixed pay credited?",
        answer: (
          <>
            <HelpList
              items={[
                "Content for the brand's page only: when the brand approves it.",
                "Content for your page, or both: when your live post is confirmed.",
              ]}
            />
            <HelpText>
              You can withdraw it 7 days after delivery is confirmed. Until then your wallet shows it as waiting for delivery or on
              hold, with the date it unlocks.
            </HelpText>
          </>
        ),
      },
      {
        id: "views-referral-pay",
        question: "How do views and referral earnings work?",
        answer: (
          <HelpList
            items={[
              "Views: you earn as your live post gets views, up to what your place pays. You can withdraw views earnings while the campaign is live, paused or completed.",
              "Referrals: each verified sign-up or download through your code earns the reward our team set. Each reward is on hold for 7 days before you can withdraw it.",
              "Sign-ups recorded before a reward was set are paid once it's set, oldest first, while the brand's budget lasts. They start their 7-day hold then.",
            ]}
          />
        ),
      },
      {
        id: "withdrawals",
        question: "How do withdrawals work?",
        answer: (
          <>
            <HelpList
              items={[
                "Add your bank account in your wallet first.",
                "You withdraw per campaign, once a week. Everything you can withdraw from that campaign goes out together.",
                "A payout week runs from Friday to Thursday, Lagos time. Requests are paid on the Friday that ends the week, so a request on Thursday is paid the next day.",
                "The minimum is ₦2,000 per campaign. Less than that carries over until you reach it.",
              ]}
            />
            <HelpText>
              Fixed pay is checked again when it&apos;s paid. Only pay that&apos;s delivered and past its hold goes out.
            </HelpText>
          </>
        ),
      },
    ],
  },
];

export default function CreatorHelpPage() {
  return (
    <HelpArticle
      roleLabel="Creator"
      title="Help for Creators"
      intro="How campaigns work on EasilyPromote: finding and joining campaigns, getting your content approved, and getting paid."
      sections={SECTIONS}
      dashboardHref="/dashboard/creator"
      otherGuide={{ href: "/help/brands", label: "Help for Brands" }}
    />
  );
}
