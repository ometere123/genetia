// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UD60x18Math
/// @notice Minimal fixed-point exp / ln in 60.18 format. Self-contained
///         so we don't depend on PRB-Math. Mirrors the JS implementation
///         in frontend/src/lib/lmsr.ts so off-chain quotes match on-chain
///         settlement to within USDC dust.
///
/// All inputs and outputs are UD60x18: `1e18` represents `1.0`.
library UD60x18Math {
    /// 1e18 — the scale factor.
    uint256 internal constant ONE = 1e18;
    /// ln(2) in UD60x18 — 0.69314718055994530941723212...
    uint256 internal constant LN_2 = 693147180559945309;
    /// log2(e) in UD60x18 — 1.44269504088896340735992468...
    uint256 internal constant LOG2_E = 1442695040888963407;
    /// Upper bound on udExp input to keep result inside UD60x18.
    /// exp(133.084) ≈ 1.99e57, which fits a uint256 wrapped in UD60x18 (1e18 scale).
    uint256 internal constant MAX_EXP_INPUT = 133_084258667509499440;

    error ExpOverflow();
    error LnNonPositive();

    /// @notice Multiply two UD60x18 numbers.
    function udMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / ONE;
    }

    /// @notice Divide two UD60x18 numbers.
    function udDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "udDiv: zero divisor");
        return (a * ONE) / b;
    }

    /// @notice e^x for x in UD60x18. Domain: 0 ≤ x ≤ MAX_EXP_INPUT.
    function udExp(uint256 x) internal pure returns (uint256) {
        if (x == 0) return ONE;
        if (x > MAX_EXP_INPUT) revert ExpOverflow();

        // y = x · log2(e), result = 2^y. Split y into integer (k) and frac (f).
        uint256 y = udMul(x, LOG2_E);
        uint256 k = y / ONE;
        uint256 f = y - k * ONE;

        // 2^f = e^(f · ln 2) via 7-term Taylor around 0
        uint256 z = udMul(f, LN_2);
        uint256 z2 = udMul(z, z);
        uint256 z3 = udMul(z2, z);
        uint256 z4 = udMul(z3, z);
        uint256 z5 = udMul(z4, z);
        uint256 z6 = udMul(z5, z);
        uint256 z7 = udMul(z6, z);

        uint256 result = ONE + z + z2 / 2 + z3 / 6 + z4 / 24 + z5 / 120 + z6 / 720 + z7 / 5040;

        // 2^k by bit-shift (k ≤ ~191 since MAX_EXP_INPUT keeps us in range)
        if (k > 0) {
            require(k < 192, "udExp: shift overflow");
            result = result << k;
        }
        return result;
    }

    /// @notice ln(x) for x in UD60x18. Domain: x > 0.
    function udLn(uint256 x) internal pure returns (uint256) {
        if (x == 0) revert LnNonPositive();
        if (x == ONE) return 0;

        // Reduce to ln(m) where m ∈ [1, 2); accumulate ln(2) factor.
        // We track k as int256 because m can be < 1 (k negative).
        int256 k = 0;
        uint256 m = x;
        while (m >= 2 * ONE) {
            m /= 2;
            k += 1;
        }
        while (m < ONE) {
            m *= 2;
            k -= 1;
        }

        // u = (m − 1) / (m + 1); ln(m) = 2·(u + u³/3 + u⁵/5 + … + u¹³/13)
        uint256 u = udDiv(m - ONE, m + ONE);
        uint256 u2 = udMul(u, u);
        uint256 u3 = udMul(u2, u);
        uint256 u5 = udMul(u3, u2);
        uint256 u7 = udMul(u5, u2);
        uint256 u9 = udMul(u7, u2);
        uint256 u11 = udMul(u9, u2);
        uint256 u13 = udMul(u11, u2);

        uint256 series = u + u3 / 3 + u5 / 5 + u7 / 7 + u9 / 9 + u11 / 11 + u13 / 13;
        uint256 lnM = 2 * series;

        // Combine: result = k · ln(2) + lnM. Handle negative k via subtraction.
        if (k >= 0) {
            return uint256(k) * LN_2 + lnM;
        } else {
            uint256 sub = uint256(-k) * LN_2;
            // Guard: lnM is positive (m ∈ [1,2) ⇒ u ∈ [0, 1/3)), but with k<0
            // the true result could be negative — caller should ensure x ≥ 1.
            require(lnM >= sub, "udLn: negative result");
            return lnM - sub;
        }
    }
}
