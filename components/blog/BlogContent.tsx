"use client";

interface BlogContentProps {
  html: string;
}

export default function BlogContent({ html }: BlogContentProps) {
  return (
    <div
      className="blog-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
