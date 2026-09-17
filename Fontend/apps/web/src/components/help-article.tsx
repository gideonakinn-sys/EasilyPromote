import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@ep/ui/lib/utils";
import logoPrimary from "@ep/ui/assets/logo-primary.svg";

// Public help pages (/help/brands, /help/creators): questions grouped into sections, each with
// its own anchor so a link can point straight at one answer.

export interface HelpQuestion {
  id: string;
  question: string;
  answer: React.ReactNode;
}

export interface HelpSection {
  id: string;
  title: string;
  questions: HelpQuestion[];
}

interface HelpArticleProps {
  roleLabel: string;
  title: string;
  intro: string;
  sections: HelpSection[];
  dashboardHref: string;
  otherGuide: { href: string; label: string };
}

interface HelpTextProps {
  children: React.ReactNode;
  className?: string;
}

export function HelpText({ children, className }: HelpTextProps) {
  return <p className={cn("text-[14px] font-medium text-stone-600 font-rethink leading-relaxed", className)}>{children}</p>;
}

interface HelpListProps {
  items: React.ReactNode[];
}

export function HelpList({ items }: HelpListProps) {
  return (
    <ul className="space-y-1.5 pl-4 list-disc marker:text-stone-300">
      {items.map((item, index) => (
        <li key={index} className="text-[14px] font-medium text-stone-600 font-rethink leading-relaxed">
          {item}
        </li>
      ))}
    </ul>
  );
}

interface HelpExampleProps {
  rows: { label: string; value: string }[];
  total: { label: string; value: string };
}

// A worked naira example, laid out like the checkout summary.
export function HelpExample({ rows, total }: HelpExampleProps) {
  return (
    <dl className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-2 text-[14px] font-rethink">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <dt className="font-medium text-stone-500">{row.label}</dt>
          <dd className="font-medium text-stone-900 tabular-nums">{row.value}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-stone-200 pt-2">
        <dt className="font-medium text-stone-900">{total.label}</dt>
        <dd className="font-medium text-stone-900 tabular-nums">{total.value}</dd>
      </div>
    </dl>
  );
}

export function HelpArticle({ roleLabel, title, intro, sections, dashboardHref, otherGuide }: HelpArticleProps) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-rethink">
      <header className="w-full bg-stone-50">
        <div className="max-w-3xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src={logoPrimary} alt="EasilyPromote" width={32} height={32} priority unoptimized />
            <span className="inline-flex items-center rounded-full bg-stone-200 px-2.5 py-1 text-[11px] font-medium leading-none text-stone-700">
              {roleLabel} Help
            </span>
          </div>
          <Link href={dashboardHref} className="bg-white rounded-full px-4 py-2 text-xs font-semibold text-stone-900">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 pt-6 pb-16 md:pt-10 space-y-8 md:space-y-10">
        <div className="space-y-3">
          <h1 className="text-[26px] md:text-[32px] leading-tight font-medium tracking-tight text-stone-900">{title}</h1>
          <HelpText>{intro}</HelpText>
        </div>

        <nav aria-label="On this page" className="bg-white border border-stone-200 rounded-2xl p-4 md:p-5">
          <p className="text-xs font-medium text-stone-500 mb-3">On This Page</p>
          <ol className="grid gap-2 md:grid-cols-2">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="flex gap-2 text-[14px] font-medium text-stone-900">
                  <span className="text-stone-400 tabular-nums w-5 shrink-0">{index + 1}.</span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-6 space-y-3">
            <h2 id={`${section.id}-heading`} className="text-[20px] font-medium tracking-tight text-stone-900">
              {section.title}
            </h2>
            <div className="space-y-3">
              {section.questions.map((item) => (
                <article key={item.id} id={item.id} className="scroll-mt-6 bg-white border border-stone-200 rounded-2xl p-4 md:p-5 space-y-3">
                  <h3 className="text-[16px] font-medium text-stone-900 leading-snug">
                    <a href={`#${item.id}`}>{item.question}</a>
                  </h3>
                  <div className="space-y-3">{item.answer}</div>
                </article>
              ))}
            </div>
          </section>
        ))}

        <div className="bg-white border border-stone-200 rounded-2xl p-4 md:p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <HelpText>Looking for the other side of the marketplace?</HelpText>
          <Link href={otherGuide.href} className="self-start md:self-auto bg-stone-900 text-white rounded-full px-4 py-2 text-xs font-semibold">
            {otherGuide.label}
          </Link>
        </div>
      </main>
    </div>
  );
}
