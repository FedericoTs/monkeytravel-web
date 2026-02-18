"use client";

import { useRef, useEffect } from "react";

interface BlogContentProps {
  html: string;
}

export default function BlogContent({ html }: BlogContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    // Wrap each <table> in a styled container for rounded corners and scroll
    const tables = ref.current.querySelectorAll("table");
    tables.forEach((table) => {
      if (table.parentElement?.classList.contains("table-wrapper-scroll")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "table-wrapper";
      const scroll = document.createElement("div");
      scroll.className = "table-wrapper-scroll";
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(scroll);
      scroll.appendChild(table);
    });
  }, [html]);

  return (
    <div
      ref={ref}
      className="blog-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
