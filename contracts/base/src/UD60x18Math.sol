// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library UD60x18Math {
    uint256 internal constant ONE = 1e18;
    uint256 internal constant LN2 = 693147180559945309;
    uint256 internal constant LOG2E = 1442695040888963407;

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        return a * b / ONE;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "div0");
        return a * ONE / b;
    }

    function exp(uint256 x) internal pure returns (uint256) {
        require(x < 133e15, "exp");
        uint256 y = mul(x, LOG2E);
        uint256 k = y / ONE;
        uint256 f = y - k * ONE;
        uint256 z = mul(f, LN2);
        uint256 z2 = mul(z, z);
        uint256 z3 = mul(z2, z);
        uint256 z4 = mul(z3, z);
        uint256 z5 = mul(z4, z);
        uint256 r = ONE + z + z2 / 2 + z3 / 6 + z4 / 24 + z5 / 120;
        if (k > 0) r <<= k;
        return r;
    }

    function ln(uint256 x) internal pure returns (uint256) {
        require(x > 0, "ln0");
        uint256 k;
        while (x >= 2 * ONE) {
            x /= 2;
            k++;
        }
        while (x < ONE) {
            x *= 2;
            k--;
        }
        uint256 u = div(x - ONE, x + ONE);
        uint256 u2 = mul(u, u);
        uint256 u3 = mul(u2, u);
        uint256 u5 = mul(mul(u3, u2), u2);
        uint256 u7 = mul(u5, u2);
        return k * LN2 + 2 * (u + u3 / 3 + u5 / 5 + u7 / 7);
    }
}
