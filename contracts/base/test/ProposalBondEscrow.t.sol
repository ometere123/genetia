// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {ProposalBondEscrow} from "../src/ProposalBondEscrow.sol";

contract ProposalBondEscrowTest is Test {
    MockUSDC token;
    ProposalBondEscrow escrow;
    address proposer = address(0xA11CE);
    address reserve = address(0xBEEF);

    function setUp() public {
        token = new MockUSDC();
        escrow = new ProposalBondEscrow(address(this), address(token), reserve);
        token.mint(proposer, 20e6);
        vm.prank(proposer);
        token.approve(address(escrow), type(uint256).max);
    }

    function testApprovedRefundsAfterWorkflowCompletes() public {
        bytes32 id = keccak256("approved");
        vm.prank(proposer); escrow.lock(id, proposer);
        escrow.bindMarket(id, address(0x1234));
        escrow.approve(id);
        assertEq(token.balanceOf(proposer), 20e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testRevisionThenOrdinaryRejectionSplitsBond() public {
        bytes32 id = keccak256("ordinary");
        vm.prank(proposer); escrow.lock(id, proposer);
        escrow.recordRevision(id); escrow.recordRevision(id);
        escrow.rejectOrdinary(id);
        assertEq(token.balanceOf(proposer), 19e6);
        assertEq(token.balanceOf(reserve), 1e6);
    }

    function testAbuseRetainsWholeBond() public {
        bytes32 id = keccak256("abuse");
        vm.prank(proposer); escrow.lock(id, proposer);
        escrow.retainForAbuse(id);
        assertEq(token.balanceOf(proposer), 18e6);
        assertEq(token.balanceOf(reserve), 2e6);
    }

    function testTimeoutRefundIsPermissionlessAndBounded() public {
        bytes32 id = keccak256("timeout");
        vm.prank(proposer); escrow.lock(id, proposer);
        vm.expectRevert(ProposalBondEscrow.TimeoutNotReached.selector);
        escrow.timeoutRefund(id);
        vm.warp(block.timestamp + escrow.INFRASTRUCTURE_TIMEOUT());
        address anyone = address(0xCAFE);
        vm.prank(anyone); escrow.timeoutRefund(id);
        assertEq(token.balanceOf(proposer), 20e6);
    }

    function testOrdinaryRejectionRequiresBothRevisions() public {
        bytes32 id = keccak256("revision-gate");
        vm.prank(proposer); escrow.lock(id, proposer);
        escrow.recordRevision(id);
        vm.expectRevert(ProposalBondEscrow.InvalidTransition.selector);
        escrow.rejectOrdinary(id);
    }

    function testApprovedRefundRequiresBaseMarketBinding() public {
        bytes32 id = keccak256("binding-gate");
        vm.prank(proposer); escrow.lock(id, proposer);
        vm.expectRevert(ProposalBondEscrow.MarketNotBound.selector);
        escrow.approve(id);
        escrow.bindMarket(id, address(0x1234));
        escrow.approve(id);
        assertEq(token.balanceOf(proposer), 20e6);
    }
}
