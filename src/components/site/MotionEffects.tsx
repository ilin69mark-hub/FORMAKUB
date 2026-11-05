"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function MotionEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const revealNodes = Array.from(
      document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)"),
    );

    let observer: IntersectionObserver | null = null;
    if (reduceMotion) {
      revealNodes.forEach((node) => node.classList.add("is-visible"));
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer?.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
      );
      revealNodes.forEach((node) => observer?.observe(node));
    }

    const parallaxNodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-parallax]"),
    );
    let frame = 0;

    const updateParallax = () => {
      const viewport = window.innerHeight;
      for (const node of parallaxNodes) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > viewport + 200) continue;
        const center = rect.top + rect.height / 2;
        const progress = (center - viewport / 2) / viewport;
        const range = Number(node.dataset.range ?? "26");
        node.style.setProperty(
          "--parallax-y",
          `${(progress * range).toFixed(2)}px`,
        );
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateParallax();
      });
    };

    if (!reduceMotion) {
      updateParallax();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
    }

    return () => {
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  return null;
}
