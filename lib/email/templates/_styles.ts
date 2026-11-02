import type { CSSProperties } from "react";

/**
 * The inline styles the email templates share, so every email speaks the
 * same brand language. Email clients ignore stylesheets, hence objects.
 */

export const h1: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "0 0 16px",
  lineHeight: 1.3,
};

export const leadText: CSSProperties = {
  fontSize: "18px",
  color: "#555555",
  margin: "0 0 24px",
  fontWeight: 600,
};

export const bodyText: CSSProperties = {
  fontSize: "16px",
  color: "#333333",
  lineHeight: 1.6,
  margin: "16px 0",
};

export const linkText: CSSProperties = {
  color: "#FF6B6B",
};

export const signOff: CSSProperties = {
  fontSize: "15px",
  color: "#555555",
  fontWeight: 600,
  margin: "28px 0 0",
};

/** The call to action. */
export const button: CSSProperties = {
  backgroundColor: "#FF6B6B",
  color: "#FFFFFF",
  padding: "12px 32px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "16px",
  display: "inline-block",
};

/** The raised, larger call to action of the account and blog emails. */
export const largeButton: CSSProperties = {
  backgroundColor: "#FF6B6B",
  color: "#FFFFFF",
  padding: "14px 36px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: "16px",
  display: "inline-block",
  boxShadow: "0 4px 12px rgba(255,107,107,0.35)",
};

/** An outlined button under the call to action. */
export const secondaryButton: CSSProperties = {
  backgroundColor: "#FFFFFF",
  color: "#2D3436",
  border: "1px solid #D9CFC4",
  padding: "10px 24px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "15px",
  display: "inline-block",
};
