// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/RiskManager.sol";

contract RiskManagerTest is Test {
    RiskManager risk;
    address safe = address(0xA11CE);
    address component = address(0xB0B);

    function setUp() public {
        risk = new RiskManager(safe);
        vm.prank(safe);
        risk.registerComponent(component);
    }

    function test_marketCap() public {
        vm.prank(component);
        risk.reserveExposure(address(1), 25_000e6);
        assertEq(risk.marketExposure(address(1)), 25_000e6);
    }

    function test_systemCap() public {
        vm.prank(component);
        risk.reserveExposure(address(1), 25_000e6);
        vm.prank(component);
        risk.releaseExposure(address(1), 25_000e6);
        assertEq(risk.systemExposure(), 0);
    }

    function testFuzz_releaseCannotCreateExposure(uint256 amount) public {
        amount = bound(amount, 0, 25_000e6);
        vm.prank(component);
        risk.reserveExposure(address(1), amount);
        vm.prank(component);
        risk.releaseExposure(address(1), amount + 1);
        assertEq(risk.marketExposure(address(1)), 0);
    }
}
