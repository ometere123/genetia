// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LMSRMarketFactory} from "../../src/lmsr/LMSRMarketFactory.sol";
import {LMSRMarket} from "../../src/lmsr/LMSRMarket.sol";
import {OutcomeTokens} from "../../src/lmsr/OutcomeTokens.sol";
import {UD60x18Math} from "../../src/lmsr/UD60x18Math.sol";

/// Mintable USDC stand-in for tests.
contract MockUSDC is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract LMSRMarketTest is Test {
    MockUSDC usdc;
    LMSRMarketFactory factory;
    OutcomeTokens tokens;

    address admin    = address(0xA11CE);
    address relayer  = address(0xBEEF);
    address treasury = address(0xCAFE);

    address alice    = address(0xA1);
    address bob      = address(0xB0);

    uint256 constant B = 100 * 1e6;             // 100 USDC seed
    uint256 constant USDC_BASE = 10_000 * 1e6;  // 10k starting balance

    function setUp() public {
        usdc = new MockUSDC();
        usdc.mint(treasury, USDC_BASE);
        usdc.mint(alice,    USDC_BASE);
        usdc.mint(bob,      USDC_BASE);

        vm.prank(admin);
        factory = new LMSRMarketFactory(address(usdc), relayer, treasury);

        tokens = factory.tokens();

        // Treasury authorises factory to pull seed liquidity.
        vm.prank(treasury);
        usdc.approve(address(factory), type(uint256).max);
    }

    // ── Factory: creation ────────────────────────────────────────────────

    function _createMarket(uint256 expiryOffset) internal returns (uint256 marketId, LMSRMarket market) {
        vm.prank(admin);
        (marketId, ) = factory.createMarket(B, block.timestamp + expiryOffset);
        market = LMSRMarket(factory.marketById(marketId));
    }

    function test_createMarket_seedsLiquidity() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        (, LMSRMarket market) = _createMarket(7 days);

        assertEq(usdc.balanceOf(address(market)), B,            "market funded");
        assertEq(market.collateral(),             B,            "collateral set");
        assertEq(usdc.balanceOf(treasury),  treasuryBefore - B, "treasury debited");
        assertTrue(tokens.isMarket(address(market)),            "registered as market");
    }

    function test_createMarket_revertsExpiryInPast() public {
        vm.prank(admin);
        vm.expectRevert(LMSRMarketFactory.ExpiryInPast.selector);
        factory.createMarket(B, block.timestamp);
    }

    function test_createMarket_revertsNonAdmin() public {
        vm.prank(alice);
        vm.expectRevert(LMSRMarketFactory.NotAdmin.selector);
        factory.createMarket(B, block.timestamp + 1 days);
    }

    // ── Multi-currency: collateral allowlist ─────────────────────────────

    function test_multiCurrency_defaultUsdcIsAllowed() public {
        assertTrue(factory.allowedCollateral(address(usdc)), "default USDC allowed");
        address[] memory list = factory.getAllowedCollateralList();
        assertEq(list.length, 1, "1 allowed token at deploy");
        assertEq(list[0], address(usdc), "USDC is the entry");
    }

    function test_multiCurrency_explicitTokenOverloadWorks() public {
        // Use the explicit-token signature with the default USDC.
        vm.prank(admin);
        (uint256 marketId, address market) = factory.createMarket(address(usdc), B, block.timestamp + 1 days);
        assertEq(factory.marketCollateral(marketId), address(usdc), "collateral recorded");
        assertEq(usdc.balanceOf(market), B, "market seeded");
    }

    function test_multiCurrency_revertsOnDisallowedToken() public {
        MockUSDC eurc = new MockUSDC();
        eurc.mint(treasury, USDC_BASE);
        vm.prank(treasury);
        eurc.approve(address(factory), type(uint256).max);

        vm.prank(admin);
        vm.expectRevert(LMSRMarketFactory.CollateralNotAllowed.selector);
        factory.createMarket(address(eurc), B, block.timestamp + 1 days);
    }

    function test_multiCurrency_adminCanAllowlistNewToken() public {
        MockUSDC eurc = new MockUSDC();
        eurc.mint(treasury, USDC_BASE);
        vm.prank(treasury);
        eurc.approve(address(factory), type(uint256).max);

        // Admin allowlists the new token, then creates a market backed by it.
        vm.prank(admin);
        factory.setAllowedCollateral(address(eurc), true);
        assertTrue(factory.allowedCollateral(address(eurc)), "EURC allowlisted");

        vm.prank(admin);
        (uint256 marketId, address market) =
            factory.createMarket(address(eurc), B, block.timestamp + 1 days);

        assertEq(factory.marketCollateral(marketId), address(eurc), "market uses EURC");
        assertEq(eurc.balanceOf(market), B, "EURC seeded");
        assertEq(usdc.balanceOf(market), 0, "no USDC mixed in");
    }

    function test_multiCurrency_setAllowedCollateral_revertsForNonAdmin() public {
        MockUSDC eurc = new MockUSDC();
        vm.prank(alice);
        vm.expectRevert(LMSRMarketFactory.NotAdmin.selector);
        factory.setAllowedCollateral(address(eurc), true);
    }

    function test_multiCurrency_canRemoveTokenFromAllowlist() public {
        MockUSDC eurc = new MockUSDC();
        vm.prank(admin);
        factory.setAllowedCollateral(address(eurc), true);
        assertTrue(factory.allowedCollateral(address(eurc)), "added");

        vm.prank(admin);
        factory.setAllowedCollateral(address(eurc), false);
        assertFalse(factory.allowedCollateral(address(eurc)), "removed");

        // Subsequent createMarket with that token reverts.
        eurc.mint(treasury, USDC_BASE);
        vm.prank(treasury);
        eurc.approve(address(factory), type(uint256).max);
        vm.prank(admin);
        vm.expectRevert(LMSRMarketFactory.CollateralNotAllowed.selector);
        factory.createMarket(address(eurc), B, block.timestamp + 1 days);
    }

    // ── Trading: prices & symmetry ───────────────────────────────────────

    function test_startingPrice_is50_50() public {
        (, LMSRMarket market) = _createMarket(1 days);
        // p(Y) in UD60x18, should be 0.5e18 (within dust)
        uint256 p = market.priceYes();
        assertApproxEqAbs(p, 5e17, 1e10, "p(Y) ~= 0.5");
    }

    function test_buyYes_raisesYesPrice() public {
        (, LMSRMarket market) = _createMarket(1 days);
        uint256 priceBefore = market.priceYes();

        uint256 shares = 25 * 1e6; // 25 YES
        uint256 cost = market.costToBuy(1, shares);
        uint256 fee  = (cost * 200) / 10_000;
        uint256 max  = cost + fee + 1; // tiny pad for rounding

        vm.startPrank(alice);
        usdc.approve(address(market), max);
        market.buy(1, shares, max);
        vm.stopPrank();

        assertGt(market.priceYes(), priceBefore, "p(Y) up after YES buy");
        assertEq(market.qYes(), shares, "qYes increased");
        assertEq(tokens.balanceOf(alice, tokens.tokenIdFor(market.marketId(), 1)), shares, "alice got YES tokens");
    }

    function test_buy_revertsOnSlippage() public {
        (, LMSRMarket market) = _createMarket(1 days);
        uint256 shares = 25 * 1e6;
        uint256 cost = market.costToBuy(1, shares); // raw, no fee

        vm.startPrank(alice);
        usdc.approve(address(market), 1_000_000_000);
        vm.expectRevert(LMSRMarket.SlippageExceeded.selector);
        market.buy(1, shares, cost); // max < cost+fee
        vm.stopPrank();
    }

    function test_sellRoundTrip_recoversCost() public {
        (, LMSRMarket market) = _createMarket(1 days);
        uint256 shares = 10 * 1e6;

        uint256 cost = market.costToBuy(1, shares);
        uint256 fee  = (cost * 200) / 10_000;
        vm.startPrank(alice);
        usdc.approve(address(market), cost + fee + 10);
        market.buy(1, shares, cost + fee + 10);
        vm.stopPrank();

        // Sell same shares immediately — should recover ~cost (no fee on sell).
        uint256 ret = market.returnOnSell(1, shares);
        assertApproxEqAbs(ret, cost, 2, "sell return ~= original cost");

        vm.prank(alice);
        market.sell(1, shares, ret);
        assertEq(market.qYes(), 0, "qYes back to 0");
        assertEq(tokens.balanceOf(alice, tokens.tokenIdFor(market.marketId(), 1)), 0, "YES tokens burned");
    }

    function test_buy_revertsAfterExpiry() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);

        vm.startPrank(alice);
        usdc.approve(address(market), 1e9);
        vm.expectRevert(LMSRMarket.TradingClosed.selector);
        market.buy(1, 1e6, 1e9);
        vm.stopPrank();
    }

    // ── Resolution: happy path ───────────────────────────────────────────

    function test_proposeResolution_setsPending() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days); // past expiry

        vm.prank(relayer);
        market.proposeResolution(2); // YES

        assertEq(uint8(market.status()),         uint8(LMSRMarket.Status.Pending), "status pending");
        assertEq(uint8(market.proposedOutcome()), uint8(LMSRMarket.Outcome.YES),    "proposed YES");
        assertGt(market.challengeTimeLeft(), 0, "challenge window active");
    }

    function test_finalize_afterWindow() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(relayer);
        market.proposeResolution(2);

        vm.warp(block.timestamp + 25 hours);
        market.finalize();

        assertEq(uint8(market.status()),       uint8(LMSRMarket.Status.Finalized), "status finalized");
        assertEq(uint8(market.finalOutcome()), uint8(LMSRMarket.Outcome.YES),       "final YES");
    }

    function test_finalize_revertsBeforeWindow() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(relayer);
        market.proposeResolution(2);

        vm.expectRevert(LMSRMarket.WindowNotElapsed.selector);
        market.finalize();
    }

    // ── Resolution: dispute ──────────────────────────────────────────────

    function test_dispute_setsDisputed() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(relayer);
        market.proposeResolution(2);

        // Bond = 5% of collateral (100 USDC) = 5 USDC. Bob disputes.
        uint256 bond = (market.collateral() * 500) / 10_000;
        vm.startPrank(bob);
        usdc.approve(address(market), bond);
        market.dispute();
        vm.stopPrank();

        assertEq(uint8(market.status()),    uint8(LMSRMarket.Status.Disputed), "disputed");
        assertEq(market.disputeBondHolder(), bob, "bob holds bond");
        assertEq(market.disputeBondAmount(), bond, "bond amount");
    }

    function test_adminResolve_refundsBondIfDisputerWins() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(relayer);
        market.proposeResolution(2); // YES proposed

        uint256 bond = (market.collateral() * 500) / 10_000;
        vm.startPrank(bob);
        usdc.approve(address(market), bond);
        market.dispute();
        vm.stopPrank();

        uint256 bobBefore = usdc.balanceOf(bob);

        // Admin overrides to NO — bob was right, refund his bond.
        vm.prank(admin);
        market.adminResolve(1);

        assertEq(usdc.balanceOf(bob), bobBefore + bond, "bond refunded");
        assertEq(uint8(market.finalOutcome()), uint8(LMSRMarket.Outcome.NO), "final NO");
    }

    function test_adminResolve_slashesBondIfDisputerWrong() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(relayer);
        market.proposeResolution(2); // YES proposed

        uint256 bond = (market.collateral() * 500) / 10_000;
        vm.startPrank(bob);
        usdc.approve(address(market), bond);
        market.dispute();
        vm.stopPrank();

        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 feesBefore = market.feesAccrued();

        // Admin upholds YES — bob was wrong, slash bond.
        vm.prank(admin);
        market.adminResolve(2);

        assertEq(usdc.balanceOf(bob), bobBefore, "no refund");
        assertEq(market.feesAccrued(), feesBefore + bond, "bond slashed to fees");
    }

    // ── Redemption ────────────────────────────────────────────────────────

    function test_redeem_yesWin_paysOneToOne() public {
        (, LMSRMarket market) = _createMarket(1 days);

        // Alice buys 50 YES.
        uint256 shares = 50 * 1e6;
        uint256 cost = market.costToBuy(1, shares);
        uint256 fee  = (cost * 200) / 10_000;
        vm.startPrank(alice);
        usdc.approve(address(market), cost + fee + 10);
        market.buy(1, shares, cost + fee + 10);
        vm.stopPrank();

        // Resolve YES.
        vm.warp(block.timestamp + 2 days);
        vm.prank(relayer);
        market.proposeResolution(2);
        vm.warp(block.timestamp + 25 hours);
        market.finalize();

        // Alice redeems all 50 YES for 50 USDC.
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        market.redeem(shares, 0);
        assertEq(usdc.balanceOf(alice), aliceBefore + shares, "alice paid 1:1");
        assertEq(market.qYes(), 0, "qYes drained");
    }

    function test_redeem_invalidOutcome_paysProRata() public {
        (, LMSRMarket market) = _createMarket(1 days);

        // Alice buys 30 YES, Bob buys 20 NO.
        uint256 yesShares = 30 * 1e6;
        uint256 noShares  = 20 * 1e6;

        uint256 cy = market.costToBuy(1, yesShares); uint256 fy = (cy * 200) / 10_000;
        vm.startPrank(alice);
        usdc.approve(address(market), cy + fy + 10);
        market.buy(1, yesShares, cy + fy + 10);
        vm.stopPrank();

        uint256 cn = market.costToBuy(0, noShares); uint256 fn = (cn * 200) / 10_000;
        vm.startPrank(bob);
        usdc.approve(address(market), cn + fn + 10);
        market.buy(0, noShares, cn + fn + 10);
        vm.stopPrank();

        // Admin resolves as INVALID.
        vm.warp(block.timestamp + 2 days);
        vm.prank(admin);
        market.adminResolve(3); // INVALID

        // Both redeem; total payout shouldn't exceed collateral.
        uint256 totalShares = yesShares + noShares;
        uint256 collateral  = market.collateral();
        uint256 aPayout = (yesShares * collateral) / totalShares;
        uint256 bPayout = (noShares  * collateral) / totalShares;

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        vm.prank(alice); market.redeem(yesShares, 0);
        vm.prank(bob);   market.redeem(0, noShares);

        assertApproxEqAbs(usdc.balanceOf(alice), aliceBefore + aPayout, 2, "alice pro-rata");
        assertApproxEqAbs(usdc.balanceOf(bob),   bobBefore   + bPayout, 2, "bob pro-rata");
    }

    function test_redeem_revertsBeforeFinalize() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.expectRevert(LMSRMarket.WrongStatus.selector);
        vm.prank(alice);
        market.redeem(1, 0);
    }

    // ── Permissions ──────────────────────────────────────────────────────

    function test_proposeResolution_revertsForNonRelayer() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert(LMSRMarket.NotRelayer.selector);
        market.proposeResolution(2);
    }

    function test_adminResolve_revertsForNonAdmin() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert(LMSRMarket.NotAdmin.selector);
        market.adminResolve(2);
    }

    // ── sweepCollateral ───────────────────────────────────────────────────

    function test_sweepCollateral_emptyMarketReturnsAllSeed() public {
        // Market with 0 trades, finalized INVALID — treasury should be made whole.
        (, LMSRMarket market) = _createMarket(1 days);
        uint256 treasuryAfterSeed = usdc.balanceOf(treasury);

        vm.warp(block.timestamp + 2 days);
        vm.prank(admin);
        market.adminResolve(3); // INVALID

        // Grace period not elapsed yet → revert.
        vm.expectRevert(LMSRMarket.InGracePeriod.selector);
        vm.prank(admin);
        market.sweepCollateral(treasury);

        // After grace → sweepable.
        vm.warp(block.timestamp + market.SWEEP_GRACE_PERIOD() + 1);
        vm.prank(admin);
        market.sweepCollateral(treasury);

        assertEq(market.collateral(), 0, "collateral drained");
        assertEq(usdc.balanceOf(address(market)), 0, "market emptied");
        assertEq(usdc.balanceOf(treasury), treasuryAfterSeed + B, "treasury recovered seed");
    }

    function test_sweepCollateral_yesWin_keepsReserveForOutstandingYes() public {
        (uint256 marketId, LMSRMarket market) = _createMarket(1 days);

        // Alice buys 25 YES.
        uint256 shares = 25 * 1e6;
        uint256 cost = market.costToBuy(1, shares);
        uint256 max  = cost + (cost * 200) / 10_000 + 1;
        vm.startPrank(alice);
        usdc.approve(address(market), max);
        market.buy(1, shares, max);
        vm.stopPrank();

        // Resolve YES.
        vm.warp(block.timestamp + 2 days);
        vm.prank(admin);
        market.adminResolve(2); // YES

        // Wait through grace.
        vm.warp(block.timestamp + market.SWEEP_GRACE_PERIOD() + 1);

        // Sweep — must leave qYes USDC reserved (so Alice can still redeem).
        uint256 colBefore = market.collateral();
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(admin);
        market.sweepCollateral(treasury);

        assertEq(market.collateral(), shares, "reserve = qYes");
        assertEq(usdc.balanceOf(treasury), treasuryBefore + (colBefore - shares), "swept excess");

        // Alice can still fully redeem.
        vm.prank(alice);
        market.redeem(shares, 0);
        assertEq(usdc.balanceOf(alice), USDC_BASE - cost - (cost * 200) / 10_000 + shares, "alice paid 1:1");
    }

    function test_sweepCollateral_invalidWithTokensRevertsUntilRedeemed() public {
        // Two-sided market resolved INVALID — sweep must wait for redemptions.
        (uint256 marketId, LMSRMarket market) = _createMarket(1 days);

        // Alice buys 10 YES, Bob buys 5 NO.
        uint256 yesShares = 10 * 1e6;
        uint256 noShares  = 5 * 1e6;

        uint256 yesCost = market.costToBuy(1, yesShares);
        uint256 yesMax  = yesCost + (yesCost * 200) / 10_000 + 1;
        vm.startPrank(alice);
        usdc.approve(address(market), yesMax);
        market.buy(1, yesShares, yesMax);
        vm.stopPrank();

        uint256 noCost = market.costToBuy(0, noShares);
        uint256 noMax  = noCost + (noCost * 200) / 10_000 + 1;
        vm.startPrank(bob);
        usdc.approve(address(market), noMax);
        market.buy(0, noShares, noMax);
        vm.stopPrank();

        // Resolve INVALID after expiry.
        vm.warp(block.timestamp + 2 days);
        vm.prank(admin);
        market.adminResolve(3);

        // Past grace — sweep with tokens outstanding should revert.
        vm.warp(block.timestamp + market.SWEEP_GRACE_PERIOD() + 1);
        vm.expectRevert(LMSRMarket.NothingToSweep.selector);
        vm.prank(admin);
        market.sweepCollateral(treasury);

        // Both redeem (pro-rata invariant).
        vm.prank(alice);
        market.redeem(yesShares, 0);
        vm.prank(bob);
        market.redeem(0, noShares);

        // Now there might be rounding dust left. If so, sweepable; if not,
        // sweep still reverts cleanly with NothingToSweep.
        uint256 dust = market.collateral();
        if (dust > 0) {
            uint256 treasuryBefore = usdc.balanceOf(treasury);
            vm.prank(admin);
            market.sweepCollateral(treasury);
            assertEq(usdc.balanceOf(treasury), treasuryBefore + dust, "dust swept");
            assertEq(market.collateral(), 0, "collateral zero");
        }
    }

    function test_sweepCollateral_revertsForNonAdmin() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(admin);
        market.adminResolve(3);
        vm.warp(block.timestamp + market.SWEEP_GRACE_PERIOD() + 1);

        vm.prank(alice);
        vm.expectRevert(LMSRMarket.NotAdmin.selector);
        market.sweepCollateral(alice);
    }

    function test_sweepCollateral_revertsBeforeFinalized() public {
        (, LMSRMarket market) = _createMarket(1 days);
        vm.expectRevert(LMSRMarket.WrongStatus.selector);
        vm.prank(admin);
        market.sweepCollateral(treasury);
    }
}
