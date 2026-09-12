// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeRouter, IRiskManager} from "./interfaces/IGenetia.sol";

contract PoolMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Outcome { YES, NO, VOID }

    uint256 public constant FEE_BPS = 150;
    uint256 public constant BPS = 10_000;
    bytes32 public immutable marketId;
    bytes32 public immutable releaseId;
    IERC20 public immutable usdc;
    address public immutable creator;
    IFeeRouter public immutable feeRouter;
    IRiskManager public immutable riskManager;
    address public immutable gateway;
    address public immutable factory;
    bytes32 public manifestHash;
    address public resolver;
    uint256 public immutable closeTime;
    uint256 public immutable resolutionAvailableTime;
    uint256 public immutable terminalDeadline;

    uint256 public yesTotal;
    uint256 public noTotal;
    uint256 public totalPaid;
    uint256 public winningReceiptsClaimed;
    uint256 public collectedFee;
    bool public terminal;
    Outcome public outcome;
    mapping(address => uint256) public yesReceipts;
    mapping(address => uint256) public noReceipts;
    mapping(address => bool) public claimed;

    event Staked(address indexed account, bool indexed yes, uint256 amount);
    event Settled(Outcome indexed outcome, uint256 fee);
    event Claimed(address indexed account, uint256 amount);

    constructor(
        bytes32 marketId_, bytes32 releaseId_, address token, address creator_, address feeRouter_, address riskManager_,
        address gateway_, uint256 closeTime_, uint256 resolutionAvailableTime_,
        uint256 terminalDeadline_
    ) {
        require(token != address(0) && gateway_ != address(0), "address");
        require(closeTime_ > block.timestamp && resolutionAvailableTime_ >= closeTime_, "time");
        require(terminalDeadline_ == resolutionAvailableTime_ + 96 hours, "deadline");
        marketId = marketId_; releaseId = releaseId_; usdc = IERC20(token); creator = creator_; factory = msg.sender;
        feeRouter = IFeeRouter(feeRouter_); riskManager = IRiskManager(riskManager_); gateway = gateway_;
        closeTime = closeTime_;
        resolutionAvailableTime = resolutionAvailableTime_; terminalDeadline = terminalDeadline_;
        usdc.forceApprove(feeRouter_, type(uint256).max);
    }

    function bindResolution(address resolver_, bytes32 manifestHash_) external {
        require(msg.sender == factory && resolver == address(0) && manifestHash == bytes32(0), "binding");
        require(resolver_ != address(0) && manifestHash_ != bytes32(0), "binding values");
        resolver = resolver_;
        manifestHash = manifestHash_;
    }

    function stake(bool yes, uint256 amount) external nonReentrant {
        require(!terminal && block.timestamp < closeTime && amount > 0, "not trading");
        riskManager.reserveExposure(address(this), amount);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (yes) { yesReceipts[msg.sender] += amount; yesTotal += amount; }
        else { noReceipts[msg.sender] += amount; noTotal += amount; }
        emit Staked(msg.sender, yes, amount);
    }

    function settle(uint8 result) external {
        require(msg.sender == gateway && !terminal && result <= uint8(Outcome.VOID), "settlement");
        require(block.timestamp >= resolutionAvailableTime, "too early");
        Outcome finalOutcome = Outcome(result);
        if (yesTotal == 0 || noTotal == 0) finalOutcome = Outcome.VOID;
        terminal = true; outcome = finalOutcome;
        if (finalOutcome != Outcome.VOID) {
            collectedFee = (yesTotal + noTotal) * FEE_BPS / BPS;
            feeRouter.routePool(creator, collectedFee);
            riskManager.releaseExposure(address(this), collectedFee);
        }
        emit Settled(finalOutcome, collectedFee);
    }

    function expireToVoid() external {
        require(!terminal && block.timestamp >= terminalDeadline, "not expired");
        terminal = true; outcome = Outcome.VOID;
        emit Settled(Outcome.VOID, 0);
    }

    function claimable(address account) public view returns (uint256) {
        if (!terminal || claimed[account]) return 0;
        if (outcome == Outcome.VOID) return yesReceipts[account] + noReceipts[account];
        uint256 winnerReceipt = outcome == Outcome.YES ? yesReceipts[account] : noReceipts[account];
        uint256 winningTotal = outcome == Outcome.YES ? yesTotal : noTotal;
        return winnerReceipt * (yesTotal + noTotal - collectedFee) / winningTotal;
    }

    function claim() external nonReentrant returns (uint256 amount) {
        require(terminal && !claimed[msg.sender], "claimed");
        amount = claimable(msg.sender);
        claimed[msg.sender] = true; totalPaid += amount;
        if (outcome != Outcome.VOID) {
            winningReceiptsClaimed += outcome == Outcome.YES ? yesReceipts[msg.sender] : noReceipts[msg.sender];
        }
        if (amount > 0) { riskManager.releaseExposure(address(this), amount); usdc.safeTransfer(msg.sender, amount); }
        emit Claimed(msg.sender, amount);
    }

    /// @notice Sends only mathematically unallocatable rounding dust after every winning receipt has exited.
    function releaseDust() external nonReentrant returns (uint256 dust) {
        require(terminal && outcome != Outcome.VOID, "no dust");
        uint256 winningTotal = outcome == Outcome.YES ? yesTotal : noTotal;
        require(winningReceiptsClaimed == winningTotal, "claims remain");
        dust = usdc.balanceOf(address(this));
        if (dust > 0) {
            riskManager.releaseExposure(address(this), dust);
            feeRouter.routeDust(dust);
        }
    }
}
