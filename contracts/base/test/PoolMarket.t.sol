// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/PoolMarket.sol";

contract PoolMarketTest is Test {
    function test_noFixedMinimumInConstructor() public {
        PoolMarket market = new PoolMarket(
            bytes32(uint256(1)),
            address(1),
            address(2),
            address(3),
            address(4),
            address(5),
            block.timestamp + 1 hours,
            block.timestamp + 97 hours
        );
        assertEq(market.closeTime(), block.timestamp + 1 hours);
    }

    function test_terminalDeadline_isBounded() public {
        uint256 deadline = block.timestamp + 96 hours;
        PoolMarket market = new PoolMarket(
            bytes32(uint256(2)),
            address(1),
            address(2),
            address(3),
            address(4),
            address(5),
            block.timestamp + 1,
            deadline
        );
        assertEq(market.terminalDeadline(), deadline);
    }
}
