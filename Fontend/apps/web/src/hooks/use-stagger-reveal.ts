"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

// Scoped, reduced-motion-safe entrance stagger. Call it with a ref to the
// container and a "step" that changes whenever the content should re-animate
// (e.g. a selected month). Elements opt in via `data-reveal`.
export function useStaggerReveal<T extends HTMLElement>(step?: string | number) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (els.length === 0) return;

    els.forEach((el) => {
      gsap.set(el, { opacity: 0, y: 16 });
    });

    const tween = gsap.to(els, {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: "power3.out",
      stagger: 0.08,
      delay: 0.05,
      clearProps: "transform",
    });

    return () => {
      tween.kill();
    };
  }, [step]);

  return ref;
}