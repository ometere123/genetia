// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./interfaces/IUSDC.sol";

contract PoolMarket {
    IUSDC public immutable usdc;
    address public immutable creator;
    address public immutable feeRouter;
    address public immutable riskManager;
    address public immutable gateway;
    bytes32 public immutable marketId;
    uint256 public immutable closeTime;
    uint256 public immutable terminalDeadline;
    uint256 public yesTotal;
    uint256 public noTotal;
    bool public settled;
    uint8 public outcome;
    bool public expired;
    uint256 public constant FEE_BPS = 150;
    uint256 public constant BPS = 10000;
    mapping(address => uint256) public yesReceipt;
    mapping(address => uint256) public noReceipt;
    mapping(address => bool) public claimed;
    bool private entered;
    modifier lock() {
        require(!entered, "reentrant");
        entered = true;
        _;
        entered = false;
    }

    constructor(
        bytes32 id,
        address token,
        address _creator,
        address _feeRouter,
        address _risk,
        address _gateway,
        uint256 close,
        uint256 deadline
    ) {
        require(token != address(0) && close > block.timestamp && deadline > close, "params");
        marketId = id;
        usdc = IUSDC(token);
        creator = _creator;
        feeRouter = _feeRouter;
        riskManager = _risk;
        gateway = _gateway;
        closeTime = close;
        terminalDeadline = deadline;
    }

    function stake(bool yes, uint256 amount) external lock {
        require(!settled && !expired && block.timestamp < closeTime && amount > 0, "not tradable");
        usdc.transferFrom(msg.sender, address(this), amount);
        (bool ok,) =
            riskManager.call(abi.encodeWithSignature("reserveExposure(address,uint256)", address(this), amount));
        require(ok, "risk");
        if (yes) {
            yesTotal += amount;
            yesReceipt[msg.sender] += amount;
        } else {
            noTotal += amount;
            noReceipt[msg.sender] += amount;
        }
    }

    function settle(uint8 result) external {
        require(msg.sender == gateway, "gateway");
        require(!settled && !expired && result <= 2, "settled");
        require(block.timestamp >= closeTime, "open");
        if (yesTotal == 0 || noTotal == 0) result = 2;
        settled = true;
        outcome = result;
        if (result < 2) {
            uint256 fee = (yesTotal + noTotal) * FEE_BPS / BPS;
            require(usdc.transfer(feeRouter, fee), "fee");
            (bool ok,) = feeRouter.call(abi.encodeWithSignature("routePool(address,uint256)", creator, fee));
            require(ok, "route");
        }
    }

    function expireToVoid() external {
        require(!settled && !expired && block.timestamp >= terminalDeadline, "early");
        expired = true;
        outcome = 2;
    }

    function claim() external lock {
        require((settled || expired) && !claimed[msg.sender], "claim");
        claimed[msg.sender] = true;
        uint256 receipt = outcome == 0
            ? yesReceipt[msg.sender]
            : outcome == 1 ? noReceipt[msg.sender] : yesReceipt[msg.sender] + noReceipt[msg.sender];
        uint256 winning = outcome == 0 ? yesTotal : outcome == 1 ? noTotal : yesTotal + noTotal;
        uint256 pool = yesTotal + noTotal;
        uint256 fee = (outcome < 2 && winning > 0) ? pool * FEE_BPS / BPS : 0;
        uint256 payout = outcome == 2 ? receipt : (winning == 0 ? 0 : receipt * (pool - fee) / winning);
        if (payout > 0) require(usdc.transfer(msg.sender, payout), "transfer");
    }
}
