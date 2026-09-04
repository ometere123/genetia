// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IUSDC {
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
