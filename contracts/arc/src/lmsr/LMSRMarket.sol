// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OutcomeTokens} from "./OutcomeTokens.sol";
import {UD60x18Math} from "./UD60x18Math.sol";

interface ILMSRMarketFactory {
    function relayer() external view returns (address);
    function admin() external view returns (address);
}

/// @title LMSRMarket
/// @notice Arc settlement and trading layer for one binary Genetia market.
///
/// GenLayer is the external intelligent resolver layer. In this MVP a trusted
/// relayer submits the GenLayer verdict by calling `proposeResolution`. The
/// market then enters a challenge window. If challenged, admin adjudication is
/// required. Multisig/governance dispute resolution is intentionally not
/// implemented in this version.
///
/// Admin functions are testnet safety escape hatches, not final decentralised
/// governance. They are kept visible through explicit events.
///
/// Mechanism: Hanson's Logarithmic Market Scoring Rule with liquidity
/// parameter `b`. The contract is the only counterparty; it mints/burns
/// outcome tokens against USDC according to the LMSR cost curve.
///
/// State machine:
/// Active -> Pending -> Finalized
/// Active -> Pending -> Disputed -> Finalized
/// Active/Pending/Disputed -> adminResolve -> Finalized
///
/// Resolution may also return Outcome.INVALID, in which case both YES and NO
/// holders redeem pro-rata against remaining collateral.
contract LMSRMarket is ReentrancyGuard {
    using UD60x18Math for uint256;

    enum Status {
        Active,
        Pending,
        Disputed,
        Finalized
    }

    enum Outcome {
        NONE,
        NO,
        YES,
        INVALID
    }

    uint256 public immutable marketId;
    address public immutable factory;
    OutcomeTokens public immutable tokens;
    IERC20 public immutable usdc;
    /// LMSR liquidity parameter, in 6-decimal USDC units.
    uint256 public immutable b;
    /// Unix timestamp after which trading closes and resolution may be proposed.
    uint256 public immutable expiry;

    /// 2% buy spread (basis points).
    uint256 public constant FEE_BPS = 200;
    uint256 public constant BPS = 10_000;
    /// MVP challenge window after `proposeResolution`.
    uint256 public constant CHALLENGE_WINDOW = 24 hours;
    /// Dispute bond: 5% of collateral, capped at 500 USDC (6-decimal).
    uint256 public constant DISPUTE_BOND_BPS = 500;
    uint256 public constant DISPUTE_BOND_CAP = 500 * 1e6;
    /// Testnet sweep grace period. Raise this for mainnet.
    uint256 public constant SWEEP_GRACE_PERIOD = 1 days;
    bytes32 private constant ACTION_BUY = keccak256("BUY");
    bytes32 private constant ACTION_SELL = keccak256("SELL");
    bytes32 private constant ACTION_REDEEM = keccak256("REDEEM");
    bytes32 private constant ACTION_ADMIN_RESOLVE = keccak256("ADMIN_RESOLVE");
    bytes32 private constant ACTION_SWEEP_FEES = keccak256("SWEEP_FEES");
    bytes32 private constant ACTION_SWEEP_COLLATERAL = keccak256("SWEEP_COLLATERAL");

    /// Outstanding YES shares (6-decimal).
    uint256 public qYes;
    /// Outstanding NO shares (6-decimal).
    uint256 public qNo;
    /// USDC backing redemptions and the LMSR inventory.
    uint256 public collateral;
    /// USDC fee bucket sweepable by treasury/admin.
    uint256 public feesAccrued;

    Status public status;
    Outcome public proposedOutcome;
    Outcome public finalOutcome;
    uint256 public pendingSince;
    address public disputeBondHolder;
    uint256 public disputeBondAmount;
    /// Timestamp at which the market reached Finalized.
    uint256 public finalizedAt;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed market,
        address indexed factory,
        address settlementAsset,
        uint256 b,
        uint256 expiry,
        uint256 timestamp
    );
    event Seeded(uint256 collateralAdded);
    event Bought(address indexed user, uint8 outcome, uint256 shares, uint256 cost, uint256 fee);
    event Sold(address indexed user, uint8 outcome, uint256 shares, uint256 ret);
    event ResolutionProposed(uint8 outcome, uint256 pendingUntil);
    event Disputed(address indexed challenger, uint256 bond);
    event Finalized(uint8 outcome);
    event AdminResolved(uint8 outcome);
    event Redeemed(address indexed user, uint256 yesBurned, uint256 noBurned, uint256 paid);
    event FeesSwept(address indexed to, uint256 amount);
    event CollateralSwept(address indexed to, uint256 amount);

    event TradeExecuted(
        uint256 indexed marketId,
        address indexed trader,
        uint8 indexed outcome,
        bytes32 action,
        uint256 shares,
        uint256 amount,
        uint256 fee,
        uint256 qYesAfter,
        uint256 qNoAfter,
        uint256 collateralAfter,
        uint256 timestamp
    );
    event ResolutionProposedDetailed(
        uint256 indexed marketId,
        address indexed resolver,
        uint8 indexed outcome,
        uint256 pendingSince,
        uint256 pendingUntil
    );
    event ResolutionChallenged(
        uint256 indexed marketId,
        address indexed challenger,
        uint256 bond,
        uint256 timestamp
    );
    event ResolutionFinalized(
        uint256 indexed marketId,
        uint8 indexed outcome,
        address indexed actor,
        bool adminAdjudicated,
        uint256 timestamp
    );
    event EmergencyActionUsed(
        uint256 indexed marketId,
        address indexed admin,
        bytes32 indexed action,
        uint8 outcome,
        uint256 amount,
        uint256 timestamp
    );

    error NotFactory();
    error NotRelayer();
    error NotAdmin();
    error WrongStatus();
    error TradingClosed();
    error ZeroShares();
    error SlippageExceeded();
    error InsufficientShares();
    error TransferFailed();
    error WindowNotElapsed();
    error WindowElapsed();
    error InvalidOutcome();
    error AlreadyDisputed();
    error InGracePeriod();
    error NothingToSweep();
    error ZeroAddress();
    error ZeroAmount();
    error MarketNotExpired();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != _factory().relayer()) revert NotRelayer();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != _factory().admin()) revert NotAdmin();
        _;
    }

    constructor(
        uint256 _marketId,
        address _tokens,
        address _usdc,
        uint256 _b,
        uint256 _expiry
    ) {
        if (_tokens == address(0) || _usdc == address(0)) revert ZeroAddress();
        require(_b > 0, "b must be > 0");
        require(_expiry > block.timestamp, "expiry in the past");

        marketId = _marketId;
        factory = msg.sender;
        tokens = OutcomeTokens(_tokens);
        usdc = IERC20(_usdc);
        b = _b;
        expiry = _expiry;
        status = Status.Active;

        emit MarketCreated(_marketId, address(this), msg.sender, _usdc, _b, _expiry, block.timestamp);
    }

    /// @notice Called by the factory immediately after deploy to pull seed
    /// liquidity into the market.
    function seed(address from, uint256 amount) external onlyFactory {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(from, address(this), amount)) revert TransferFailed();
        collateral += amount;
        emit Seeded(amount);
    }

    /// @notice Buy `shares` of `outcome` (0=NO, 1=YES). Reverts if total cost
    /// exceeds `maxCost`.
    function buy(uint8 outcome, uint256 shares, uint256 maxCost) external nonReentrant {
        if (status != Status.Active) revert WrongStatus();
        if (block.timestamp >= expiry) revert TradingClosed();
        if (outcome > 1) revert InvalidOutcome();
        if (shares == 0) revert ZeroShares();

        uint256 rawCost = _costToBuy(outcome, shares);
        uint256 fee = (rawCost * FEE_BPS) / BPS;
        uint256 total = rawCost + fee;
        if (total > maxCost) revert SlippageExceeded();

        if (!usdc.transferFrom(msg.sender, address(this), total)) revert TransferFailed();
        collateral += rawCost;
        feesAccrued += fee;

        if (outcome == 1) qYes += shares;
        else qNo += shares;

        tokens.mint(msg.sender, tokens.tokenIdFor(marketId, outcome), shares);
        emit Bought(msg.sender, outcome, shares, rawCost, fee);
        emit TradeExecuted(
            marketId,
            msg.sender,
            outcome,
            ACTION_BUY,
            shares,
            rawCost,
            fee,
            qYes,
            qNo,
            collateral,
            block.timestamp
        );
    }

    /// @notice Sell `shares` of `outcome` (0=NO, 1=YES). Reverts if return is
    /// below `minReturn`.
    function sell(uint8 outcome, uint256 shares, uint256 minReturn) external nonReentrant {
        if (status != Status.Active) revert WrongStatus();
        if (block.timestamp >= expiry) revert TradingClosed();
        if (outcome > 1) revert InvalidOutcome();
        if (shares == 0) revert ZeroShares();

        uint256 q = outcome == 1 ? qYes : qNo;
        if (shares > q) revert InsufficientShares();

        uint256 ret = _returnOnSell(outcome, shares);
        if (ret < minReturn) revert SlippageExceeded();

        tokens.burn(msg.sender, tokens.tokenIdFor(marketId, outcome), shares);

        if (outcome == 1) qYes -= shares;
        else qNo -= shares;
        collateral -= ret;

        if (!usdc.transfer(msg.sender, ret)) revert TransferFailed();
        emit Sold(msg.sender, outcome, shares, ret);
        emit TradeExecuted(
            marketId,
            msg.sender,
            outcome,
            ACTION_SELL,
            shares,
            ret,
            0,
            qYes,
            qNo,
            collateral,
            block.timestamp
        );
    }

    /// @notice Called by the trusted GenLayer relayer with the AI verdict.
    /// Starts the challenge window.
    function proposeResolution(uint8 outcome) external onlyRelayer {
        if (status != Status.Active) revert WrongStatus();
        if (block.timestamp < expiry) revert MarketNotExpired();
        if (outcome == 0 || outcome > 3) revert InvalidOutcome();

        proposedOutcome = Outcome(outcome);
        pendingSince = block.timestamp;
        status = Status.Pending;

        uint256 pendingUntil = block.timestamp + CHALLENGE_WINDOW;
        emit ResolutionProposed(outcome, pendingUntil);
        emit ResolutionProposedDetailed(marketId, msg.sender, outcome, block.timestamp, pendingUntil);
    }

    /// @notice Anyone can post a bond to halt finalization. This triggers MVP
    /// admin review. Future versions should replace admin adjudication with
    /// multisig/governance, independent resolver committees, stake/slashing for
    /// bad challenges, and/or a second GenLayer evaluation.
    function dispute() external nonReentrant {
        if (status != Status.Pending) revert WrongStatus();
        if (block.timestamp >= pendingSince + CHALLENGE_WINDOW) revert WindowElapsed();
        if (disputeBondHolder != address(0)) revert AlreadyDisputed();

        uint256 bond = (collateral * DISPUTE_BOND_BPS) / BPS;
        if (bond > DISPUTE_BOND_CAP) bond = DISPUTE_BOND_CAP;
        if (bond == 0) bond = 1e6;

        if (!usdc.transferFrom(msg.sender, address(this), bond)) revert TransferFailed();
        disputeBondHolder = msg.sender;
        disputeBondAmount = bond;
        status = Status.Disputed;

        emit Disputed(msg.sender, bond);
        emit ResolutionChallenged(marketId, msg.sender, bond, block.timestamp);
    }

    /// @notice Anyone can finalize once the challenge window passes undisputed.
    function finalize() external {
        if (status != Status.Pending) revert WrongStatus();
        if (block.timestamp < pendingSince + CHALLENGE_WINDOW) revert WindowNotElapsed();

        finalOutcome = proposedOutcome;
        status = Status.Finalized;
        finalizedAt = block.timestamp;

        emit Finalized(uint8(finalOutcome));
        emit ResolutionFinalized(marketId, uint8(finalOutcome), msg.sender, false, block.timestamp);
    }

    /// @notice Admin escape hatch for any non-finalized state. This is MVP
    /// admin adjudication, not final decentralised dispute governance.
    function adminResolve(uint8 outcome) external onlyAdmin {
        if (status == Status.Finalized) revert WrongStatus();
        if (outcome == 0 || outcome > 3) revert InvalidOutcome();

        uint256 bondBefore = disputeBondAmount;

        if (status == Status.Disputed) {
            if (Outcome(outcome) == proposedOutcome) {
                feesAccrued += disputeBondAmount;
            } else {
                if (!usdc.transfer(disputeBondHolder, disputeBondAmount)) revert TransferFailed();
            }
            disputeBondHolder = address(0);
            disputeBondAmount = 0;
        }

        finalOutcome = Outcome(outcome);
        status = Status.Finalized;
        finalizedAt = block.timestamp;

        emit AdminResolved(outcome);
        emit ResolutionFinalized(marketId, outcome, msg.sender, true, block.timestamp);
        emit EmergencyActionUsed(marketId, msg.sender, ACTION_ADMIN_RESOLVE, outcome, bondBefore, block.timestamp);
    }

    /// @notice Burns outcome tokens for the caller's pro-rata USDC payout.
    /// YES win: 1 YES = 1 USDC. NO win: 1 NO = 1 USDC. INVALID: both sides
    /// burn pro-rata against remaining collateral.
    function redeem(uint256 yesAmount, uint256 noAmount) external nonReentrant {
        if (status != Status.Finalized) revert WrongStatus();
        if (yesAmount == 0 && noAmount == 0) revert ZeroShares();

        uint256 payout;
        if (finalOutcome == Outcome.YES) {
            payout = yesAmount;
        } else if (finalOutcome == Outcome.NO) {
            payout = noAmount;
        } else if (finalOutcome == Outcome.INVALID) {
            uint256 totalShares = qYes + qNo;
            if (totalShares > 0) {
                payout = ((yesAmount + noAmount) * collateral) / totalShares;
            }
        } else {
            revert InvalidOutcome();
        }

        if (yesAmount > 0) {
            tokens.burn(msg.sender, tokens.tokenIdFor(marketId, 1), yesAmount);
            qYes -= yesAmount;
        }
        if (noAmount > 0) {
            tokens.burn(msg.sender, tokens.tokenIdFor(marketId, 0), noAmount);
            qNo -= noAmount;
        }

        if (payout > 0) {
            if (payout > collateral) payout = collateral;
            collateral -= payout;
            if (!usdc.transfer(msg.sender, payout)) revert TransferFailed();
        }

        emit Redeemed(msg.sender, yesAmount, noAmount, payout);
        emit TradeExecuted(
            marketId,
            msg.sender,
            uint8(finalOutcome),
            ACTION_REDEEM,
            yesAmount + noAmount,
            payout,
            0,
            qYes,
            qNo,
            collateral,
            block.timestamp
        );
    }

    /// @notice Sweep accumulated fees to treasury/admin. Testnet safety path.
    function sweepFees(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = feesAccrued;
        if (amount == 0) return;
        feesAccrued = 0;
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit FeesSwept(to, amount);
        emit EmergencyActionUsed(marketId, msg.sender, ACTION_SWEEP_FEES, 0, amount, block.timestamp);
    }

    /// @notice Sweep collateral above the redemption reserve to treasury/admin.
    /// Only callable after the grace period.
    function sweepCollateral(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        if (status != Status.Finalized) revert WrongStatus();
        if (block.timestamp < finalizedAt + SWEEP_GRACE_PERIOD) revert InGracePeriod();

        uint256 reserve = _redemptionReserve();
        if (collateral <= reserve) revert NothingToSweep();

        uint256 amount = collateral - reserve;
        collateral = reserve;
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit CollateralSwept(to, amount);
        emit EmergencyActionUsed(marketId, msg.sender, ACTION_SWEEP_COLLATERAL, uint8(finalOutcome), amount, block.timestamp);
    }

    /// @notice USDC reserved to honour remaining redemptions.
    function redemptionReserve() external view returns (uint256) {
        if (status != Status.Finalized) return collateral;
        return _redemptionReserve();
    }

    function _redemptionReserve() internal view returns (uint256) {
        if (finalOutcome == Outcome.YES) return qYes;
        if (finalOutcome == Outcome.NO) return qNo;
        if (finalOutcome == Outcome.INVALID) {
            if (qYes + qNo == 0) return 0;
            return collateral;
        }
        return collateral;
    }

    /// @notice Cost (raw, pre-fee) to buy `shares` of `outcome`.
    function costToBuy(uint8 outcome, uint256 shares) external view returns (uint256) {
        return _costToBuy(outcome, shares);
    }

    /// @notice Net USDC returned by selling `shares` of `outcome`.
    function returnOnSell(uint8 outcome, uint256 shares) external view returns (uint256) {
        return _returnOnSell(outcome, shares);
    }

    /// @notice Instantaneous YES price in UD60x18 (1e18 = 100%).
    function priceYes() external view returns (uint256) {
        return _priceYes();
    }

    /// @notice Instantaneous NO price in UD60x18 (1e18 = 100%).
    function priceNo() external view returns (uint256) {
        return UD60x18Math.ONE - _priceYes();
    }

    /// @notice Time remaining in the challenge window, in seconds.
    function challengeTimeLeft() external view returns (uint256) {
        if (status != Status.Pending) return 0;
        uint256 end = pendingSince + CHALLENGE_WINDOW;
        return block.timestamp >= end ? 0 : end - block.timestamp;
    }

    function _toUd(uint256 x) private pure returns (uint256) {
        return x * 1e12;
    }

    function _toUsdc(uint256 x) private pure returns (uint256) {
        return x / 1e12;
    }

    function _cost(uint256 _qYes, uint256 _qNo) private view returns (uint256) {
        uint256 bUd = _toUd(b);
        uint256 ratioY = UD60x18Math.udDiv(_toUd(_qYes), bUd);
        uint256 ratioN = UD60x18Math.udDiv(_toUd(_qNo), bUd);

        uint256 mx = ratioY > ratioN ? ratioY : ratioN;
        uint256 eY = ratioY >= mx
            ? UD60x18Math.ONE
            : UD60x18Math.udDiv(UD60x18Math.ONE, UD60x18Math.udExp(mx - ratioY));
        uint256 eN = ratioN >= mx
            ? UD60x18Math.ONE
            : UD60x18Math.udDiv(UD60x18Math.ONE, UD60x18Math.udExp(mx - ratioN));

        uint256 ln = UD60x18Math.udLn(eY + eN) + mx;
        return _toUsdc(UD60x18Math.udMul(bUd, ln));
    }

    function _costToBuy(uint8 outcome, uint256 shares) private view returns (uint256) {
        uint256 newY = outcome == 1 ? qYes + shares : qYes;
        uint256 newN = outcome == 0 ? qNo + shares : qNo;
        uint256 beforeCost = _cost(qYes, qNo);
        uint256 afterCost = _cost(newY, newN);
        return afterCost - beforeCost;
    }

    function _returnOnSell(uint8 outcome, uint256 shares) private view returns (uint256) {
        uint256 newY = outcome == 1 ? qYes - shares : qYes;
        uint256 newN = outcome == 0 ? qNo - shares : qNo;
        uint256 beforeCost = _cost(qYes, qNo);
        uint256 afterCost = _cost(newY, newN);
        return beforeCost - afterCost;
    }

    function _priceYes() private view returns (uint256) {
        uint256 bUd = _toUd(b);
        uint256 ratioY = UD60x18Math.udDiv(_toUd(qYes), bUd);
        uint256 ratioN = UD60x18Math.udDiv(_toUd(qNo), bUd);
        uint256 mx = ratioY > ratioN ? ratioY : ratioN;
        uint256 eY = ratioY >= mx
            ? UD60x18Math.ONE
            : UD60x18Math.udDiv(UD60x18Math.ONE, UD60x18Math.udExp(mx - ratioY));
        uint256 eN = ratioN >= mx
            ? UD60x18Math.ONE
            : UD60x18Math.udDiv(UD60x18Math.ONE, UD60x18Math.udExp(mx - ratioN));
        return UD60x18Math.udDiv(eY, eY + eN);
    }

    function _factory() private view returns (ILMSRMarketFactory) {
        return ILMSRMarketFactory(factory);
    }
}
