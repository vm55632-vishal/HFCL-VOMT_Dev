'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export interface NavSection {
  id: string;
  label: string;
  icon: string;
}

/**
 * A sticky bar of section links for a long page. Click a chip to scroll to that section; the chip
 * for the section you're reading highlights as you scroll. Sections are located by element id
 * (`prefix` + section id). The bar sticks just below whatever fixed header the app shows (the top
 * header on desktop, the top bar on small screens) — it measures that rather than assuming a height.
 *
 * `sections` should be a stable (module-level) array.
 */
export default function SectionNav({
  sections,
  prefix = 'vd-',
}: {
  sections: readonly NavSection[];
  prefix?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const [top, setTop] = useState(60);

  // Where to stick: right under the app's own sticky header.
  useEffect(() => {
    const measure = () => {
      const narrow = window.matchMedia('(max-width: 860px)').matches;
      const header = document.querySelector<HTMLElement>(narrow ? '.sidebar' : '.appheader');
      setTop(Math.round(header?.getBoundingClientRect().height ?? 60));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Highlight the section being read.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const navBottom = navRef.current?.getBoundingClientRect().bottom ?? 0;
      const line = navBottom + 24; // a section "counts" once it passes just below the bar
      let current = sections[0]?.id ?? '';
      for (const s of sections) {
        const el = document.getElementById(prefix + s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      const atBottom =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = sections[sections.length - 1]!.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, prefix]);

  // On narrow screens the bar scrolls sideways: keep the active chip in view (horizontal only, so
  // the page itself never jumps).
  useEffect(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: btn.offsetLeft - (nav.clientWidth - btn.offsetWidth) / 2 });
  }, [active]);

  function jump(id: string) {
    const el = document.getElementById(prefix + id);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const navH = navRef.current?.offsetHeight ?? 0;
    const y = el.getBoundingClientRect().top + window.scrollY - top - navH - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: reduced ? 'auto' : 'smooth' });
    setActive(id);
  }

  return (
    <nav ref={navRef} className="rv-nav" style={{ top }} aria-label="Page sections">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`vdm__navbtn${active === s.id ? ' is-active' : ''}`}
          aria-current={active === s.id ? 'true' : undefined}
          onClick={() => jump(s.id)}
        >
          <Icon name={s.icon} size={15} />
          {s.label}
        </button>
      ))}
    </nav>
  );
}
