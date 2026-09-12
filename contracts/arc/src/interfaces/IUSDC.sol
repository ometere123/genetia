// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Arc's USDC has a dual interface:
// - Native (18 decimals): msg.value, gas
// - ERC-20 (6 decimals): transfers, approvals, allowances
// Both share the same balance. We use the ERC-20 interface for market deposits.
interface IUSDC {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}
