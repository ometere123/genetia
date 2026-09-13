/**
 * Shared category styling — lucide icons + Tailwind colour tokens.
 * Replaces ad-hoc emoji glyphs across MarketCard, CategoryTabs,
 * CreateMarketModal, and home / about pages.
 */

import {
  type LucideIcon,
  Bitcoin,
  Landmark,
  Trophy,
  Atom,
  Clapperboard,
  Shapes,
  LayoutGrid,
} from "lucide-react";

export type CategoryId =
  | "all"
  | "crypto"
  | "politics"
  | "sports"
  | "science"
  | "entertainment"
  | "other";

export interface CategoryMeta {
  Icon: LucideIcon;
  /** Tailwind text + 10%-bg tokens used by category chips. */
  color: string;
}

export const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  all:           { Icon: LayoutGrid,    color: "text-slate-400 bg-slate-400/10"  },
  crypto:        { Icon: Bitcoin,       color: "text-yellow-400 bg-yellow-400/10"},
  politics:      { Icon: Landmark,      color: "text-blue-400 bg-blue-400/10"    },
  sports:        { Icon: Trophy,        color: "text-red-400 bg-red-400/10"      },
  science:       { Icon: Atom,          color: "text-purple-400 bg-purple-400/10"},
  entertainment: { Icon: Clapperboard,  color: "text-pink-400 bg-pink-400/10"    },
  other:         { Icon: Shapes,        color: "text-slate-400 bg-slate-400/10"  },
};

export function categoryMeta(id: string): CategoryMeta {
  return CATEGORY_META[(id as CategoryId)] ?? CATEGORY_META.other;
}
