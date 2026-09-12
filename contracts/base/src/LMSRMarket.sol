// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeRouter, IOutcomeTokens, IRiskManager} from "./interfaces/IGenetia.sol";
import {LMSRLiquidityVault} from "./LMSRLiquidityVault.sol";
import {UD60x18Math} from "./UD60x18Math.sol";

contract LMSRMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Status { FUNDING, ACTIVE, TERMINAL }
    enum Outcome { YES, NO, VOID }
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_B = 100e6;
    uint256 public constant MAX_B = 5_000e6;
    uint256 public constant LN2 = 693147180559945309;

    bytes32 public immutable marketId;
    bytes32 public immutable releaseId;
    IERC20 public immutable usdc;
    IOutcomeTokens public immutable tokens;
    IFeeRouter public immutable feeRouter;
    IRiskManager public immutable riskManager;
    address public immutable gateway;
    address public immutable creator;
    address public immutable factory;
    bytes32 public manifestHash;
    address public resolver;
    uint256 public immutable b;
    uint256 public immutable fundingTarget;
    uint256 public immutable closeTime;
    uint256 public immutable resolutionAvailableTime;
    uint256 public immutable terminalDeadline;

    LMSRLiquidityVault public vault;
    Status public status;
    Outcome public outcome;
    uint256 public qYes;
    uint256 public qNo;
    uint256 public totalFees;
    bool public voidDustReleased;

    event Activated(uint256 funding);
    event Bought(address indexed trader, uint8 indexed side, uint256 shares, uint256 notional, uint256 fee);
    event Sold(address indexed trader, uint8 indexed side, uint256 shares, uint256 notional, uint256 fee);
    event Settled(Outcome indexed outcome, uint256 liability, uint256 lpNav);
    event Redeemed(address indexed holder, uint256 yesBurned, uint256 noBurned, uint256 payout);
    event VoidDustReleased(uint256 amount);

    constructor(
        bytes32 marketId_, bytes32 releaseId_, address token, address outcomeTokens_, address feeRouter_,
        address riskManager_, address gateway_, address creator_,
        uint256 b_, uint256 closeTime_, uint256 resolutionAvailableTime_, uint256 terminalDeadline_
    ) {
        require(b_ >= MIN_B && b_ <= MAX_B, "b");
        require(closeTime_ > block.timestamp && resolutionAvailableTime_ >= closeTime_, "time");
        require(terminalDeadline_ == resolutionAvailableTime_ + 96 hours, "deadline");
        marketId = marketId_; releaseId = releaseId_; usdc = IERC20(token); tokens = IOutcomeTokens(outcomeTokens_);
        feeRouter = IFeeRouter(feeRouter_); riskManager = IRiskManager(riskManager_); gateway = gateway_;
        creator = creator_; factory = msg.sender; b = b_;
        fundingTarget = calculateFundingTarget(b_); closeTime = closeTime_; resolutionAvailableTime = resolutionAvailableTime_;
        terminalDeadline = terminalDeadline_; status = Status.FUNDING;
        usdc.forceApprove(feeRouter_, type(uint256).max);
    }

    function calculateFundingTarget(uint256 b_) public pure returns (uint256) {
        uint256 numerator = b_ * LN2 * 110;
        uint256 target = (numerator + (100 * 1e18 - 1)) / (100 * 1e18);
        return target < 100e6 ? 100e6 : target;
    }

    function bindVault(address vault_) external {
        require(msg.sender == factory && address(vault) == address(0) && vault_ != address(0), "vault");
        vault = LMSRLiquidityVault(vault_);
    }

    function bindResolution(address resolver_, bytes32 manifestHash_) external {
        require(msg.sender == factory && resolver == address(0) && manifestHash == bytes32(0), "binding");
        require(resolver_ != address(0) && manifestHash_ != bytes32(0), "binding values");
        resolver = resolver_;
        manifestHash = manifestHash_;
    }

    function activate(uint256 funding) external {
        require(msg.sender == address(vault) && status == Status.FUNDING, "vault");
        require(funding >= fundingTarget && usdc.balanceOf(address(this)) >= funding, "target");
        status = Status.ACTIVE;
        require(maximumTerminalLiability() <= protectedCollateral(), "solvency");
        emit Activated(funding);
    }

    function quoteBuy(uint8 side, uint256 shares) public view returns (uint256 notional, uint256 fee) {
        require(side < 2 && shares > 0, "trade");
        uint256 nextYes = qYes + (side == 1 ? shares : 0);
        uint256 nextNo = qNo + (side == 0 ? shares : 0);
        notional = _cost(nextYes, nextNo) - _cost(qYes, qNo);
        require(notional > 0, "zero quote");
        fee = notional * FEE_BPS / BPS;
    }

    function buy(uint8 side, uint256 shares, uint256 maxTotal) external nonReentrant returns (uint256 total) {
        require(status == Status.ACTIVE && block.timestamp < closeTime, "not trading");
        (uint256 notional, uint256 fee) = quoteBuy(side, shares); total = notional + fee;
        require(total <= maxTotal, "slippage");
        riskManager.reserveExposure(address(this), total);
        usdc.safeTransferFrom(msg.sender, address(this), total);
        if (side == 1) qYes += shares; else qNo += shares;
        if (fee > 0) { feeRouter.routeLMSR(creator, address(vault), fee); riskManager.releaseExposure(address(this), fee - fee / 2); totalFees += fee; }
        require(maximumTerminalLiability() <= protectedCollateral(), "solvency");
        tokens.mint(msg.sender, tokens.tokenIdFor(marketId, side), shares);
        emit Bought(msg.sender, side, shares, notional, fee);
    }

    function quoteSell(uint8 side, uint256 shares) public view returns (uint256 notional, uint256 fee) {
        require(side < 2 && shares > 0, "trade");
        require(shares <= (side == 1 ? qYes : qNo), "inventory");
        uint256 nextYes = side == 1 ? qYes - shares : qYes;
        uint256 nextNo = side == 0 ? qNo - shares : qNo;
        notional = _cost(qYes, qNo) - _cost(nextYes, nextNo);
        fee = notional * FEE_BPS / BPS;
    }

    function sell(uint8 side, uint256 shares, uint256 minNet) external nonReentrant returns (uint256 net) {
        require(status == Status.ACTIVE && block.timestamp < closeTime, "not trading");
        (uint256 notional, uint256 fee) = quoteSell(side, shares); net = notional - fee;
        require(net >= minNet, "slippage");
        tokens.burn(msg.sender, tokens.tokenIdFor(marketId, side), shares);
        if (side == 1) qYes -= shares; else qNo -= shares;
        if (fee > 0) { feeRouter.routeLMSR(creator, address(vault), fee); totalFees += fee; }
        riskManager.releaseExposure(address(this), notional - fee / 2);
        usdc.safeTransfer(msg.sender, net);
        require(maximumTerminalLiability() <= protectedCollateral(), "solvency");
        emit Sold(msg.sender, side, shares, notional, fee);
    }

    function settle(uint8 result) external {
        require(msg.sender == gateway && status == Status.ACTIVE && result <= uint8(Outcome.VOID), "settlement");
        require(block.timestamp >= resolutionAvailableTime, "too early");
        _settle(Outcome(result));
    }

    function expireToVoid() external {
        require(status == Status.ACTIVE && block.timestamp >= terminalDeadline, "not expired");
        _settle(Outcome.VOID);
    }

    function _settle(Outcome result) internal {
        outcome = result; status = Status.TERMINAL;
        uint256 liability = terminalLiability(result);
        uint256 balance = usdc.balanceOf(address(this));
        require(balance >= liability, "insolvent");
        uint256 lpNav = balance - liability;
        if (lpNav > 0) usdc.safeTransfer(address(vault), lpNav);
        vault.notifyTerminal();
        emit Settled(result, liability, lpNav);
    }

    function redeem(uint256 yesAmount, uint256 noAmount) external nonReentrant returns (uint256 payout) {
        require(status == Status.TERMINAL && (yesAmount > 0 || noAmount > 0), "redeem");
        if (yesAmount > 0) { tokens.burn(msg.sender, tokens.tokenIdFor(marketId, 1), yesAmount); qYes -= yesAmount; }
        if (noAmount > 0) { tokens.burn(msg.sender, tokens.tokenIdFor(marketId, 0), noAmount); qNo -= noAmount; }
        payout = outcome == Outcome.YES ? yesAmount : outcome == Outcome.NO ? noAmount : (yesAmount + noAmount) / 2;
        if (payout > 0) { riskManager.releaseExposure(address(this), payout); usdc.safeTransfer(msg.sender, payout); }
        require(terminalLiability(outcome) <= protectedCollateral(), "solvency");
        emit Redeemed(msg.sender, yesAmount, noAmount, payout);
    }

    /// @notice Sends the deterministic ceil/floor remainder to terminal LPs once no
    /// outcome tokens remain. This is the only permitted destination for VOID dust.
    function releaseVoidDust() external nonReentrant returns (uint256 dust) {
        require(status == Status.TERMINAL && outcome == Outcome.VOID && !voidDustReleased, "void dust");
        require(qYes == 0 && qNo == 0, "tokens remain");
        voidDustReleased = true;
        dust = usdc.balanceOf(address(this));
        if (dust > 0) {
            riskManager.releaseExposure(address(this), dust);
            usdc.safeTransfer(address(vault), dust);
        }
        emit VoidDustReleased(dust);
    }

    function protectedCollateral() public view returns (uint256) { return usdc.balanceOf(address(this)); }
    function maximumTerminalLiability() public view returns (uint256) { return qYes > qNo ? qYes : qNo; }
    function terminalLiability(Outcome result) public view returns (uint256) {
        if (result == Outcome.YES) return qYes;
        if (result == Outcome.NO) return qNo;
        return (qYes + qNo + 1) / 2;
    }

    function priceYes() external view returns (uint256) {
        uint256 yesExp = _normalizedExp(qYes, qNo); uint256 noExp = _normalizedExp(qNo, qYes);
        return yesExp * 1e18 / (yesExp + noExp);
    }

    function _cost(uint256 yesShares, uint256 noShares) internal view returns (uint256) {
        uint256 yesRatio = yesShares * 1e18 / b; uint256 noRatio = noShares * 1e18 / b;
        uint256 maxRatio = yesRatio > noRatio ? yesRatio : noRatio;
        uint256 sum = _expBelowMax(yesRatio, maxRatio) + _expBelowMax(noRatio, maxRatio);
        return b * (maxRatio + UD60x18Math.ln(sum)) / 1e18;
    }

    function _normalizedExp(uint256 own, uint256 other) internal view returns (uint256) {
        if (own >= other) return 1e18;
        uint256 difference = (other - own) * 1e18 / b;
        return difference >= 60e18 ? 0 : UD60x18Math.div(1e18, UD60x18Math.exp(difference));
    }

    function _expBelowMax(uint256 ratio, uint256 maxRatio) internal pure returns (uint256) {
        if (ratio == maxRatio) return 1e18;
        uint256 difference = maxRatio - ratio;
        return difference >= 60e18 ? 0 : UD60x18Math.div(1e18, UD60x18Math.exp(difference));
    }
}
