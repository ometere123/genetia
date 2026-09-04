// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/ResolutionGateway.sol";

contract ResolutionGatewayTest is Test {
    function test_constants_are_locked() public {
        address[5] memory signers;
        ResolutionGateway gateway = new ResolutionGateway(address(this), signers);
        assertEq(gateway.GENLAYER_CHAIN_ID(), 61997);
        assertEq(gateway.THRESHOLD(), 3);
    }
}
