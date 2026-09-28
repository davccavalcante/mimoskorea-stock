import sanitizeHtml from "sanitize-html";
import { stripEmoji } from "./normalize";

// =============================================================================
// HTML helpers
// =============================================================================
// Product HTML is assembled by the system (see pipeline/compose.ts) from
// structured data, and every model-written string is escaped before it is
// inserted. sanitizeProductHtml() is the last line of defence before sync.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape model text and remove emoji in one step. */
export function safeText(text: string): string {
  return escapeHtml(stripEmoji(text));
}

const ALLOWED_TAGS = [
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "small",
];

export function sanitizeProductHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { th: ["scope"], td: ["colspan"] },
    allowedSchemes: [],
    disallowedTagsMode: "discard",
  }).trim();
}

/** Plain text from HTML (used for length checks and previews). */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
