/**
 * Renders the per-trip enrichment blocks under an email's main paragraph.
 *
 * Shared by TripReminder and TripFollowup so the two halves of the trip
 * lifecycle render identically — a "Day one" list in the pre-trip mail and
 * a "Your highlights" list in the post-trip one should be the same object
 * to the reader.
 *
 * Content comes from lib/email/trip-context.ts, which builds at most two
 * blocks from data the generator already wrote. Rendering nothing when
 * there is nothing is the normal case, not an edge case: a third of trips
 * have no highlights and a tenth have no weather note.
 *
 * MARKUP CHOICES
 * --------------
 * No <table>, no flexbox. Mail clients disagree about both, and the layout
 * here is one short line per item — a plain block with an inline muted
 * prefix survives Outlook, Gmail's clipper and Apple Mail dark mode
 * without a per-client workaround. Inline styles only, for the same
 * reason the sibling templates use them: <style> blocks get stripped.
 */

import { Section, Text } from "@react-email/components";
import type { ContextBlock } from "../trip-context";

export function ContextBlocks({ blocks }: { blocks?: ContextBlock[] }) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <Section style={wrap}>
      {blocks.map((block, i) => (
        <Section key={block.label} style={i === 0 ? firstBlock : laterBlock}>
          <Text style={labelStyle}>{block.label}</Text>

          {block.note ? <Text style={noteStyle}>{block.note}</Text> : null}

          {block.items?.map((item) => (
            <Text key={`${item.meta ?? ""}${item.text}`} style={itemStyle}>
              {item.meta ? <span style={metaStyle}>{item.meta}&nbsp;&nbsp;</span> : null}
              {item.text}
            </Text>
          ))}
        </Section>
      ))}
    </Section>
  );
}

/**
 * Plain-text rendering of the same blocks, for tripReminderEmailText /
 * tripFollowupEmailText. Returns [] so callers can spread it without
 * branching, and so an empty block set adds no stray blank lines.
 */
export function contextBlocksText(blocks?: ContextBlock[]): string[] {
  if (!blocks || blocks.length === 0) return [];
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push("", `${block.label}:`);
    if (block.note) lines.push(block.note);
    for (const item of block.items ?? []) {
      lines.push(`  - ${item.meta ? `${item.meta}  ` : ""}${item.text}`);
    }
  }
  return lines;
}

// A single tinted card holding every block, so the enrichment reads as
// supporting material rather than competing with the body copy.
const wrap: React.CSSProperties = {
  backgroundColor: "#FFF5EB",
  borderRadius: "12px",
  padding: "4px 20px 8px",
  margin: "24px 0 0",
};

const firstBlock: React.CSSProperties = { margin: "0" };

// Hairline between blocks rather than a gap: two blocks with only
// whitespace between them read as two unrelated fragments.
const laterBlock: React.CSSProperties = {
  margin: "0",
  borderTop: "1px solid #EADFD5",
  paddingTop: "4px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#8C959A",
  margin: "16px 0 8px",
};

const noteStyle: React.CSSProperties = {
  fontSize: "15px",
  color: "#333333",
  lineHeight: 1.55,
  margin: "0 0 14px",
};

const itemStyle: React.CSSProperties = {
  fontSize: "15px",
  color: "#333333",
  lineHeight: 1.5,
  margin: "0 0 8px",
};

// Times and slot names sit left of the item and must not compete with it.
const metaStyle: React.CSSProperties = {
  color: "#8C959A",
  fontWeight: 600,
};
