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
import {LMSRMarket} from "../src/LMSRMarket.sol";
import {LMSRLiquidityVault} from "../src/LMSRLiquidityVault.sol";

contract BaseLifecycleTest is Test {
    MockUSDC token;
    ProtocolRegistry registry;
    RiskManager risk;
    FeeRouter fees;
    OutcomeTokens outcomes;
    ResolutionGateway gateway;
    MarketFactory factory;
    address treasury = address(0x7000);
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256[5] watcherKeys = [uint256(11), 12, 13, 14, 15];
    bytes32 constant POOL_RELEASE = keccak256("pool-release-2026-09");
    bytes32 constant LMSR_RELEASE = keccak256("lmsr-release-2026-09");
    bytes32 constant RESOLVER_RELEASE = keccak256("resolver-release-2026-09");

    function setUp() public virtual {
        token = new MockUSDC();
        registry = new ProtocolRegistry(address(this));
        risk = new RiskManager(address(this), address(0));
        fees = new FeeRouter(address(token), treasury, address(this), address(0));
        outcomes = new OutcomeTokens(address(this), address(0));
        address[5] memory watcherSet;
        for (uint256 i; i < 5; ++i) watcherSet[i] = vm.addr(watcherKeys[i]);
        gateway = new ResolutionGateway(address(this), address(0), watcherSet);
        factory = new MarketFactory(
            address(this), address(token), address(registry), address(outcomes), address(fees), address(risk), address(gateway)
        );
        risk.setFactory(address(factory));
        fees.setFactory(address(factory));
        outcomes.setFactory(address(factory));
        gateway.setFactory(address(factory));
        registry.registerRelease(POOL_RELEASE, address(0x1001), keccak256("pool-code"), keccak256("commit"));
        registry.registerRelease(LMSR_RELEASE, address(0x1002), keccak256("lmsr-code"), keccak256("commit"));
        token.mint(alice, 100_000e6);
        token.mint(bob, 100_000e6);
        vm.prank(alice); token.approve(address(factory), type(uint256).max);
    }

    function terms(bytes32 id, bytes32 release) internal view returns (MarketFactory.MarketTerms memory t) {
        t = MarketFactory.MarketTerms({
            marketId: id,
            financialReleaseId: release,
            resolverReleaseId: RESOLVER_RELEASE,
            manifestHash: keccak256(abi.encode(id, "immutable-manifest")),
            resolver: address(uint160(uint256(keccak256(abi.encode(id, "resolver"))))),
            creator: creator,
            closeTime: block.timestamp + 1 days,
            resolutionAvailableTime: block.timestamp + 2 days,
            terminalDeadline: block.timestamp + 6 days
        });
    }

    function createPool(bytes32 id) internal returns (PoolMarket market, MarketFactory.MarketTerms memory t) {
        t = terms(id, POOL_RELEASE);
        market = PoolMarket(factory.createPool(t));
        vm.prank(alice); token.approve(address(market), type(uint256).max);
        vm.prank(bob); token.approve(address(market), type(uint256).max);
    }

    function createLMSR(bytes32 id, uint256 b)
        internal returns (LMSRMarket market, LMSRLiquidityVault vault, MarketFactory.MarketTerms memory t)
    {
        t = terms(id, LMSR_RELEASE);
        (address marketAddress, address vaultAddress) = factory.createLMSR(t, b, block.timestamp + 12 hours);
        market = LMSRMarket(marketAddress); vault = LMSRLiquidityVault(vaultAddress);
        vm.prank(alice); token.approve(vaultAddress, type(uint256).max);
        vm.prank(bob); token.approve(vaultAddress, type(uint256).max);
        vm.prank(alice); token.approve(marketAddress, type(uint256).max);
        vm.prank(bob); token.approve(marketAddress, type(uint256).max);
    }

    function settle(address market, MarketFactory.MarketTerms memory t, uint8 result, uint256 signatures) internal {
        ResolutionGateway.ResolutionEnvelope memory e = ResolutionGateway.ResolutionEnvelope({
            marketId: t.marketId,
            baseMarket: market,
            baseChainId: block.chainid,
            resolver: t.resolver,
            genlayerChainId: 61997,
            genlayerTxId: keccak256(abi.encode(t.marketId, result, "tx")),
            manifestHash: t.manifestHash,
            resolverReleaseId: t.resolverReleaseId,
            attempt: 0,
            outcome: result,
            resultCommitment: keccak256(abi.encode(t.marketId, result, "result"))
        });
        bytes32 d = gateway.digest(e);
        bytes[] memory sigs = new bytes[](signatures);
        for (uint256 i; i < signatures; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(watcherKeys[i], d);
            sigs[i] = abi.encodePacked(r, s, v);
        }
        gateway.submitResolution(e, sigs);
    }

    function settleExternal(address market, MarketFactory.MarketTerms memory t, uint8 result, uint256 signatures) external {
        require(msg.sender == address(this), "self");
        settle(market, t, result, signatures);
    }

    function testPoolAcceptsOneUnitAndOneSidedVoids() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("tiny"));
        vm.prank(alice); market.stake(true, 1);
        vm.warp(t.resolutionAvailableTime);
        settle(address(market), t, 0, 3);
        assertEq(uint8(market.outcome()), uint8(PoolMarket.Outcome.VOID));
        vm.prank(alice); assertEq(market.claim(), 1);
        assertEq(market.collectedFee(), 0);
    }

    function testPoolFeeSplitAndExactPayout() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("pool-fee"));
        vm.prank(alice); market.stake(true, 100e6);
        vm.prank(bob); market.stake(false, 100e6);
        vm.warp(t.resolutionAvailableTime); settle(address(market), t, 1, 3);
        assertEq(market.collectedFee(), 3e6);
        assertEq(token.balanceOf(creator), 300_000);
        assertEq(token.balanceOf(treasury), 2_700_000);
        vm.prank(bob); assertEq(market.claim(), 197e6);
    }

    function testPoolVoidHasNoFeeAndRefundsBothSides() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("pool-void"));
        vm.prank(alice); market.stake(true, 7);
        vm.prank(bob); market.stake(false, 11);
        vm.warp(t.resolutionAvailableTime); settle(address(market), t, 2, 3);
        vm.prank(alice); assertEq(market.claim(), 7);
        vm.prank(bob); assertEq(market.claim(), 11);
        assertEq(token.balanceOf(treasury), 0);
    }

    function testPoolCannotDoubleClaim() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("double"));
        vm.prank(alice); market.stake(true, 1e6);
        vm.warp(t.terminalDeadline); market.expireToVoid();
        vm.prank(alice); market.claim();
        vm.expectRevert(bytes("claimed")); vm.prank(alice); market.claim();
    }

    function testPoolExpireCannotRunEarlyAndIsPermissionless() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("expiry"));
        vm.expectRevert(bytes("not expired")); market.expireToVoid();
        vm.warp(t.terminalDeadline); vm.prank(address(0xDEAD)); market.expireToVoid();
        assertTrue(market.terminal());
    }

    function testPauseBlocksRiskButNotClaims() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("pause"));
        vm.prank(alice); market.stake(true, 5e6);
        risk.setPaused(true);
        vm.expectRevert(bytes("risk paused")); vm.prank(bob); market.stake(false, 1);
        vm.warp(t.terminalDeadline); market.expireToVoid();
        vm.prank(alice); assertEq(market.claim(), 5e6);
    }

    function testLMSRFundingTargetAndActivation() public {
        (LMSRMarket market, LMSRLiquidityVault vault,) = createLMSR(keccak256("fund"), 100e6);
        assertEq(market.fundingTarget(), 100e6);
        vm.prank(alice); vault.contribute(99_999_999);
        vm.expectRevert(bytes("target")); vault.activate();
        vm.prank(bob); vault.contribute(1);
        vault.activate();
        assertEq(uint8(market.status()), uint8(LMSRMarket.Status.ACTIVE));
    }

    function testLMSRFailedFundingReturnsEveryUnit() public {
        (, LMSRLiquidityVault vault,) = createLMSR(keccak256("failed"), 100e6);
        vm.prank(alice); vault.contribute(17);
        vm.warp(vault.fundingDeadline());
        uint256 before = token.balanceOf(alice);
        vm.prank(alice); assertEq(vault.withdrawFailedFunding(), 17);
        assertEq(token.balanceOf(alice), before + 17);
    }

    function testLMSRBuySellAndSolvency() public {
        (LMSRMarket market, LMSRLiquidityVault vault,) = createLMSR(keccak256("trade"), 100e6);
        vm.prank(alice); vault.contribute(100e6); vault.activate();
        vm.prank(bob); market.buy(1, 1e6, type(uint256).max);
        assertLe(market.maximumTerminalLiability(), market.protectedCollateral());
        vm.prank(bob); market.sell(1, 400_000, 0);
        assertLe(market.maximumTerminalLiability(), market.protectedCollateral());
    }

    function testLMSRVoidHalfShareRedemptionAndLPExit() public {
        (LMSRMarket market, LMSRLiquidityVault vault, MarketFactory.MarketTerms memory t) =
            createLMSR(keccak256("lmsr-void"), 100e6);
        vm.prank(alice); vault.contribute(100e6); vault.activate();
        vm.prank(bob); market.buy(1, 2e6, type(uint256).max);
        vm.warp(t.resolutionAvailableTime); settle(address(market), t, 2, 3);
        uint256 bobBefore = token.balanceOf(bob);
        vm.prank(bob); assertEq(market.redeem(2e6, 0), 1e6);
        assertEq(token.balanceOf(bob), bobBefore + 1e6);
        vm.prank(alice); assertGt(vault.withdrawTerminal(100e6), 0);
    }

    function testLMSRExpiryCannotBeReplaced() public {
        (LMSRMarket market, LMSRLiquidityVault vault, MarketFactory.MarketTerms memory t) =
            createLMSR(keccak256("lmsr-expire"), 100e6);
        vm.prank(alice); vault.contribute(100e6); vault.activate();
        vm.warp(t.terminalDeadline); market.expireToVoid();
        vm.expectRevert(); this.settleExternal(address(market), t, 0, 3);
    }

    function testRiskMarketCapAndSystemCapConstants() public view {
        assertEq(risk.MARKET_CAP(), 25_000e6);
        assertEq(risk.SYSTEM_CAP(), 250_000e6);
    }

    function testBRangeAndFundingFormula() public {
        vm.expectRevert(bytes("b")); factory.createLMSR(terms(keccak256("low"), LMSR_RELEASE), 99e6, block.timestamp + 1 hours);
        vm.expectRevert(bytes("b")); factory.createLMSR(terms(keccak256("high"), LMSR_RELEASE), 5_001e6, block.timestamp + 1 hours);
        (LMSRMarket market,,) = createLMSR(keccak256("max"), 5_000e6);
        assertEq(market.b(), 5_000e6);
        assertEq(market.fundingTarget(), 3_812_309_494);
    }

    function testReleaseAndBindingAreImmutable() public {
        MarketFactory.MarketTerms memory t = terms(keccak256("immutable"), POOL_RELEASE);
        address market = factory.createPool(t);
        vm.expectRevert(bytes("market exists")); factory.createPool(t);
        vm.expectRevert(bytes("release immutable"));
        registry.registerRelease(POOL_RELEASE, address(0x999), bytes32(0), bytes32(0));
        (bytes32 marketId, address resolver, bytes32 manifest,,) = gateway.bindings(market);
        assertEq(marketId, t.marketId); assertEq(resolver, t.resolver); assertEq(manifest, t.manifestHash);
    }

    function testTwoWatchersRejectedThreeAccepted() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("threshold"));
        vm.prank(alice); market.stake(true, 1);
        vm.warp(t.resolutionAvailableTime);
        vm.expectRevert(bytes("watcher quorum")); this.settleExternal(address(market), t, 2, 2);
        settle(address(market), t, 2, 3);
    }

    function testFuzzPoolAnyPositiveRepresentableStake(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 25_000e6);
        (PoolMarket market,) = createPool(keccak256(abi.encode("fuzz-stake", amount)));
        token.mint(alice, amount);
        vm.prank(alice); market.stake(true, amount);
        assertEq(market.yesReceipts(alice), amount);
    }

    function testMarketExposureCapRejectsOnlyNewRisk() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("cap"));
        vm.prank(alice); market.stake(true, 25_000e6);
        vm.expectRevert(bytes("market cap")); vm.prank(bob); market.stake(false, 1);
        vm.warp(t.terminalDeadline); market.expireToVoid();
        vm.prank(alice); assertEq(market.claim(), 25_000e6);
    }

    function testPoolClaimOrderDoesNotChangeEntitlement() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("order"));
        address carol = address(0xCA20);
        token.mint(carol, 100e6);
        vm.prank(carol); token.approve(address(market), type(uint256).max);
        vm.prank(alice); market.stake(true, 40e6);
        vm.prank(carol); market.stake(true, 60e6);
        vm.prank(bob); market.stake(false, 100e6);
        vm.warp(t.resolutionAvailableTime); settle(address(market), t, 0, 3);
        uint256 aliceExpected = market.claimable(alice);
        uint256 carolExpected = market.claimable(carol);
        vm.prank(carol); assertEq(market.claim(), carolExpected);
        vm.prank(alice); assertEq(market.claim(), aliceExpected);
        assertEq(aliceExpected, 78_800_000);
        assertEq(carolExpected, 118_200_000);
    }

    function testDuplicateWatcherDoesNotCount() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("duplicate-watcher"));
        vm.prank(alice); market.stake(true, 1);
        vm.warp(t.resolutionAvailableTime);
        ResolutionGateway.ResolutionEnvelope memory e = ResolutionGateway.ResolutionEnvelope({
            marketId: t.marketId, baseMarket: address(market), baseChainId: block.chainid, resolver: t.resolver,
            genlayerChainId: 61997, genlayerTxId: keccak256("dup-tx"), manifestHash: t.manifestHash,
            resolverReleaseId: t.resolverReleaseId, attempt: 0, outcome: 2,
            resultCommitment: keccak256("dup-result")
        });
        bytes32 d = gateway.digest(e);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(watcherKeys[0], d);
        bytes memory duplicate = abi.encodePacked(r, s, v);
        bytes[] memory sigs = new bytes[](3);
        sigs[0] = duplicate; sigs[1] = duplicate; sigs[2] = duplicate;
        vm.expectRevert(bytes("duplicate watcher")); gateway.submitResolution(e, sigs);
    }

    function testWrongManifestResolverChainAndMarketRejected() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("wrong-envelope"));
        vm.prank(alice); market.stake(true, 1);
        vm.warp(t.resolutionAvailableTime);
        MarketFactory.MarketTerms memory wrong = t;
        wrong.manifestHash = keccak256("wrong");
        vm.expectRevert(bytes("wrong manifest")); this.settleExternal(address(market), wrong, 2, 3);
        wrong = t; wrong.resolver = address(0xBAD);
        vm.expectRevert(bytes("wrong binding")); this.settleExternal(address(market), wrong, 2, 3);
    }

    function testResolutionTransactionReplayRejected() public {
        (PoolMarket market, MarketFactory.MarketTerms memory t) = createPool(keccak256("replay"));
        vm.prank(alice); market.stake(true, 1);
        vm.warp(t.resolutionAvailableTime); settle(address(market), t, 2, 3);
        vm.expectRevert(); this.settleExternal(address(market), t, 2, 3);
    }

    function testLMSRFeesNeverConsumeProtectedCollateral() public {
        (LMSRMarket market, LMSRLiquidityVault vault,) = createLMSR(keccak256("fees-safe"), 500e6);
        uint256 target = market.fundingTarget();
        vm.prank(alice); token.approve(address(vault), type(uint256).max);
        vm.prank(alice); vault.contribute(target); vault.activate();
        for (uint256 i; i < 12; ++i) {
            vm.prank(bob); market.buy(uint8(i % 2), 1e6, type(uint256).max);
            assertLe(market.maximumTerminalLiability(), market.protectedCollateral());
        }
    }
}

contract LMSRHandler is Test {
    MockUSDC immutable token;
    OutcomeTokens immutable outcomes;
    LMSRMarket immutable market;

    constructor(MockUSDC token_, OutcomeTokens outcomes_, LMSRMarket market_) {
        token = token_; outcomes = outcomes_; market = market_;
        token.approve(address(market), type(uint256).max);
    }

    function buy(uint8 sideSeed, uint96 sharesSeed) external {
        uint8 side = sideSeed % 2;
        uint256 shares = bound(uint256(sharesSeed), 1, 5e6);
        try market.quoteBuy(side, shares) returns (uint256 notional, uint256 fee) {
            if (notional + fee <= token.balanceOf(address(this))) {
                try market.buy(side, shares, notional + fee) {} catch {}
            }
        } catch {}
    }

    function sell(uint8 sideSeed, uint96 sharesSeed) external {
        uint8 side = sideSeed % 2;
        uint256 id = outcomes.tokenIdFor(market.marketId(), side);
        uint256 held = outcomes.balanceOf(address(this), id);
        if (held == 0) return;
        uint256 shares = bound(uint256(sharesSeed), 1, held);
        try market.sell(side, shares, 0) {} catch {}
    }
}

contract LMSRSolvencyInvariantTest is BaseLifecycleTest {
    LMSRMarket invariantMarket;
    LMSRLiquidityVault invariantVault;
    LMSRHandler handler;

    function setUp() public override {
        BaseLifecycleTest.setUp();
        (invariantMarket, invariantVault,) = createLMSR(keccak256("invariant"), 1_000e6);
        uint256 target = invariantMarket.fundingTarget();
        vm.prank(alice); token.approve(address(invariantVault), type(uint256).max);
        vm.prank(alice); invariantVault.contribute(target);
        invariantVault.activate();
        handler = new LMSRHandler(token, outcomes, invariantMarket);
        token.mint(address(handler), 24_000e6);
        targetContract(address(handler));
    }

    function invariantMaximumLiabilityIsAlwaysCollateralized() public view {
        assertLe(invariantMarket.maximumTerminalLiability(), invariantMarket.protectedCollateral());
    }

    function invariantFeesNeverConsumeProtectedCollateral() public view {
        assertGe(invariantMarket.protectedCollateral(), invariantMarket.terminalLiability(LMSRMarket.Outcome.YES));
        assertGe(invariantMarket.protectedCollateral(), invariantMarket.terminalLiability(LMSRMarket.Outcome.NO));
        assertGe(invariantMarket.protectedCollateral(), invariantMarket.terminalLiability(LMSRMarket.Outcome.VOID));
    }

    function invariantRiskCapsHold() public view {
        assertLe(risk.marketExposure(address(invariantMarket)), risk.MARKET_CAP());
        assertLe(risk.systemExposure(), risk.SYSTEM_CAP());
    }
}
