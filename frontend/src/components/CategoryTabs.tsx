"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import { TrendingUp, Zap, Sparkles } from "lucide-react";
import { categoryMeta, type CategoryId } from "../lib/category-icons";

export type FilterStatus   = "all" | "open" | "resolved";
export type FilterCategory = CategoryId;

const CATEGORY_IDS = ["all", "crypto", "politics", "sports", "science", "entertainment"] as const;

interface CategoryTabsProps {
  activeCategory: FilterCategory;
  activeStatus:   FilterStatus;
  onCategoryChange: (c: FilterCategory) => void;
  onStatusChange:   (s: FilterStatus) => void;
}

export default function CategoryTabs({ activeCategory, activeStatus, onCategoryChange, onStatusChange }: CategoryTabsProps) {
  const t  = useTranslations("home");
  const tc = useTranslations("categories");

  return (
    <div className="border-b border-border bg-surface-0 sticky top-14 z-30">
      <div className="mx-auto max-w-[1400px] px-4">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          {/* Status */}
          <div className="flex items-center gap-0.5 mr-3 shrink-0">
            {([
              { id: "all",      label: t("filterAll"),      Icon: TrendingUp },
              { id: "open",     label: t("filterOpen"),     Icon: Zap        },
              { id: "resolved", label: t("filterResolved"), Icon: Sparkles   },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => onStatusChange(id)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap",
                  activeStatus === id
                    ? "bg-surface-3 text-white"
                    : "text-slate-500 hover:text-slate-300 hover:bg-surface-2"
                )}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border mx-1 shrink-0" />

          {/* Categories */}
          {CATEGORY_IDS.map((id) => {
            const { Icon } = categoryMeta(id);
            return (
              <button
                key={id}
                onClick={() => onCategoryChange(id as FilterCategory)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap",
                  activeCategory === id
                    ? "bg-surface-3 text-white"
                    : "text-slate-500 hover:text-slate-300 hover:bg-surface-2"
                )}
              >
                <Icon size={12} />
                {tc(id as any)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
