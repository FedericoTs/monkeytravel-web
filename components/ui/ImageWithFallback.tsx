"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

/**
 * next/image that swaps to a branded gradient placeholder if the source errors
 * (404 / optimizer failure). Used for destination covers where some
 * /images/destinations/{slug}.jpg files don't exist yet — this avoids a broken
 * image icon and shows a clean gradient instead. Drop-in for `fill` covers.
 */
export default function ImageWithFallback({
  fallbackClassName,
  alt,
  onError,
  ...props
}: ImageProps & { fallbackClassName?: string }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        role="img"
        aria-label={typeof alt === "string" ? alt : undefined}
        className={
          fallbackClassName ??
          "absolute inset-0 bg-gradient-to-br from-[var(--primary)]/30 to-[var(--accent)]/30"
        }
      />
    );
  }

  return (
    <Image
      alt={alt}
      {...props}
      onError={(e) => {
        setErrored(true);
        onError?.(e);
      }}
    />
  );
}
