// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {ProtocolRegistry} from "../src/ProtocolRegistry.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {OutcomeTokens} from "../src/OutcomeTokens.sol";
import {ResolutionGateway} from "../src/ResolutionGateway.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {PoolMarket} from "../src/PoolMarket.sol";
import {PoolReleaseDeployer} from "../src/PoolReleaseDeployer.sol";

contract ReleaseDeactivationTest is Test {
    bytes32 constant A = keccak256("pool-release-a");
    bytes32 constant B = keccak256("pool-release-b");
    bytes32 constant RESOLVER = keccak256("resolver-release");
    MockUSDC token;
    ProtocolRegistry registry;
    MarketFactory factory;
    PoolMarket market;
    address alice = address(0xA11CE);
    address creator = address(0xC0FFEE);

    function setUp() public {
        token = new MockUSDC();
        registry = new ProtocolRegistry(address(this));
        RiskManager risk = new RiskManager(address(this), address(0));
        FeeRouter fees = new FeeRouter(address(token), address(0x7000), address(this), address(0));
        OutcomeTokens outcomes = new OutcomeTokens(address(this), address(0));
        address[5] memory watcherSet;
        for (uint256 i; i < 5; ++i) watcherSet[i] = vm.addr(i + 1);
        ResolutionGateway gateway = new ResolutionGateway(address(this), address(0), watcherSet);
        factory = new MarketFactory(address(this), address(token), address(registry), address(outcomes), address(fees), address(risk), address(gateway));
        risk.setFactory(address(factory)); fees.setFactory(address(factory)); outcomes.setFactory(address(factory)); gateway.setFactory(address(factory));
        registry.registerRelease(A, address(new PoolReleaseDeployer()), keccak256("a"), keccak256("commit-a"));
        registry.registerRelease(B, address(new PoolReleaseDeployer()), keccak256("b"), keccak256("commit-b"));
        token.mint(alice, 10e6);
    }

    function testDisablingReleaseBlocksCreationButExistingMarketExits() public {
        MarketFactory.MarketTerms memory t = _terms(keccak256("existing"));
        market = PoolMarket(factory.createPool(t));
        vm.prank(alice); token.approve(address(market), type(uint256).max);
        vm.prank(alice); market.stake(true, 1e6);
        registry.setReleaseActive(A, false);
        vm.expectRevert(bytes("release inactive")); factory.createPool(_terms(keccak256("new")));
        vm.warp(t.terminalDeadline); market.expireToVoid();
        vm.prank(alice); assertEq(market.claim(), 1e6);
    }

    function _terms(bytes32 id) internal view returns (MarketFactory.MarketTerms memory) {
        return MarketFactory.MarketTerms({marketId:id, financialReleaseId:A, resolverReleaseId:RESOLVER,
            manifestHash:keccak256(abi.encode(id, "manifest")), resolver:address(0x1234), creator:creator,
            closeTime:block.timestamp + 1 days, resolutionAvailableTime:block.timestamp + 2 days,
            terminalDeadline:block.timestamp + 6 days});
    }
}
