/**
 * Re-export Prisma's Decimal class safely.
 * Falls back to a no-op constructor during build time before `prisma generate` runs.
 */
let DecimalImpl: any;
try {
  // Available after `npx prisma generate`
  DecimalImpl = require("@prisma/client/runtime/library").Decimal;
} catch {
  // Build-time fallback — basic wrapper around number strings
  DecimalImpl = class FallbackDecimal {
    private val: number;
    constructor(v: string | number) {
      this.val = typeof v === "string" ? parseFloat(v) : v;
    }
    toString() { return this.val.toString(); }
    toNumber() { return this.val; }
    add(other: FallbackDecimal | number | string) {
      return new DecimalImpl(this.val + new DecimalImpl(other).val);
    }
    sub(other: FallbackDecimal | number | string) {
      return new DecimalImpl(this.val - new DecimalImpl(other).val);
    }
    mul(other: FallbackDecimal | number | string) {
      return new DecimalImpl(this.val * new DecimalImpl(other).val);
    }
    div(other: FallbackDecimal | number | string) {
      return new DecimalImpl(this.val / new DecimalImpl(other).val);
    }
    greaterThan(other: FallbackDecimal | number | string) {
      return this.val > new DecimalImpl(other).val;
    }
    lessThan(other: FallbackDecimal | number | string) {
      return this.val < new DecimalImpl(other).val;
    }
    equals(other: FallbackDecimal | number | string) {
      return this.val === new DecimalImpl(other).val;
    }
  };
}

export const Decimal = DecimalImpl as typeof import("@prisma/client/runtime/library").Decimal;
export type Decimal = import("@prisma/client/runtime/library").Decimal;
