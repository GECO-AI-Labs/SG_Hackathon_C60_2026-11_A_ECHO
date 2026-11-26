/**
 * ECHO vocabulary in one file: objectives, metrics, gates, formats, and
 * the data rules from the brief. Screens and prompts both read from here,
 * so a definition shown in the UI is the same one the AI uses.
 */

export const OBJECTIVES = {
  awareness: {
    label: "Brand awareness",
    purpose: "Increase visibility and reach",
    primary: ["impressions"],
    supporting: ["unique_impressions", "new_followers"],
  },
  thought_leadership: {
    label: "Thought leadership",
    purpose: "Build expertise and credibility",
    primary: ["impressions"],
    supporting: ["unique_impressions", "shares"],
  },
  engagement: {
    label: "Engagement & community",
    purpose: "Encourage discussion and participation",
    primary: ["engagement_rate"],
    supporting: ["comments", "shares", "likes"],
  },
  lead_generation: {
    label: "Lead generation",
    purpose: "Generate enquiries and opportunities",
    primary: ["clicks"],
    supporting: ["ctr"],
  },
  campaign: {
    label: "Campaign / event",
    purpose: "Drive participation in a campaign or event",
    primary: ["clicks"],
    supporting: ["impressions", "ctr"],
  },
} as const;
export type Objective = keyof typeof OBJECTIVES;
export const OBJECTIVE_KEYS = Object.keys(OBJECTIVES) as Objective[];

/** Metric definitions shown in the UI next to every number. Same formulas LinkedIn uses. */
export const METRICS = {
  impressions: { label: "Impressions", def: "Times the post was shown." },
  unique_impressions: { label: "Unique impressions", def: "Distinct members who saw it. The closest thing to reach LinkedIn gives us." },
  clicks: { label: "Clicks", def: "Clicks on the post, its link, or the page name." },
  likes: { label: "Reactions", def: "All reaction types combined (LinkedIn does not split them for us)." },
  comments: { label: "Comments", def: "Comments on the post." },
  shares: { label: "Reposts", def: "Times the post was reshared." },
  ctr: { label: "CTR", def: "Clicks ÷ impressions." },
  engagement_rate: { label: "Engagement rate", def: "(Clicks + reactions + comments + reposts) ÷ impressions." },
  new_followers: { label: "New followers", def: "Page followers gained that day." },
} as const;
export type MetricKey = keyof typeof METRICS;

/** Data rules from the brief and the dataset README. Shown in the UI. */
export const DATA_RULES = {
  minImpressions: 30,
  minImpressionsWhy:
    "Posts with fewer than 30 impressions are left out of comparisons. On tiny bases one click swings the rate wildly (we saw 2,000%).",
  statsFrom: "2025-01-01",
  statsFromWhy: "LinkedIn returns stats only for recent posts. Older posts are still used as library and style material.",
  lowSampleFormats: ["article", "document", "poll"] as string[],
  lowSampleMin: 10,
  audienceCaveat:
    "LinkedIn gives no per-post audience data. Some engagement may come from GECO staff, so we do not treat it as external. Reach and impressions are the safer signal.",
};

/** Each gate's plain-language question and button labels, shown on the Desk. */
export const GATES = {
  1: {
    name: "Library", item: "classification", verb: "Approve classification",
    question: "Is this material filed correctly? Approving lets drafts cite it.",
    approve: "Approve", edit: "Reclassify",
  },
  2: {
    name: "Post", item: "post_draft", verb: "Approve post",
    question: "Is this post ready for you to publish? Approving does not post it.",
    approve: "Approve", edit: "Edit",
  },
  3: {
    name: "Objective", item: "objective_metrics", verb: "Confirm objective",
    question: "Once this post is live, which numbers should judge it?",
    approve: "Confirm", edit: "Change objective",
  },
  4: {
    name: "Insight", item: "insight", verb: "Approve insight",
    question: "Should this finding guide the next posts? Approved insights appear on the Write page.",
    approve: "Approve", edit: "Edit",
  },
} as const;
export type Gate = keyof typeof GATES;
export type ItemType = (typeof GATES)[Gate]["item"];

export const REJECT_REASONS = {
  off_brand_tone: "Off-brand tone",
  wrong_claim: "Wrong claim",
  wrong_angle: "Wrong angle",
  duplicate: "Duplicates existing content",
  already_known: "Already known", // Gate 4 only
  other: "Other",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;

export const FORMATS: Record<string, string> = {
  image: "Image",
  multiImage: "Carousel (images)",
  video: "Video",
  document: "Document",
  article: "Article",
  poll: "Poll",
  reference: "Event / link",
  text: "Text only",
};

/** Autonomy ladder (brief §7). Post drafts never above Level 1. */
export const AUTONOMY = {
  levels: ["Draft only", "Batch approval", "Auto-run with review"],
  level1MinItems: 20,
  level1MinUneditedRate: 0.9,
};
