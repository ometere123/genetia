// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./interfaces/IUSDC.sol";
import "./OutcomeTokens.sol";
import "./UD60x18Math.sol";

contract LMSRMarket {
    using UD60x18Math for uint256;
    IUSDC public immutable usdc;
    OutcomeTokens public immutable tokens;
    address public immutable gateway;
    address public immutable creator;
    bytes32 public immutable marketId;
    uint256 public immutable b;
    uint256 public immutable closeTime;
    uint256 public immutable terminalDeadline;
    uint256 public qYes;
    uint256 public qNo;
    uint8 public outcome;
    bool public terminal;
    bool private entered;
    uint256 public constant FEE_BPS = 100;
    modifier lock() {
        require(!entered, "reentrant");
        entered = true;
        _;
        entered = false;
    }

    constructor(
        bytes32 id,
        address token,
        address tokenContract,
        address _gateway,
        address _creator,
        uint256 _b,
        uint256 close,
        uint256 deadline
    ) {
        require(_b >= 100e6 && _b <= 5000e6 && close > block.timestamp && deadline > close, "params");
        marketId = id;
        usdc = IUSDC(token);
        tokens = OutcomeTokens(tokenContract);
        gateway = _gateway;
        creator = _creator;
        b = _b;
        closeTime = close;
        terminalDeadline = deadline;
    }

    function cost(uint8 side, uint256 shares_) public view returns (uint256) {
        require(side < 2, "side");
        uint256 y = qYes + (side == 1 ? shares_ : 0);
        uint256 n = qNo + (side == 0 ? shares_ : 0);
        return _c(y, n) - _c(qYes, qNo);
    }

    function _c(uint256 y, uint256 n) internal view returns (uint256) {
        uint256 yy = y * 1e12 / b;
        uint256 nn = n * 1e12 / b;
        uint256 m = yy > nn ? yy : nn;
        return b * (_cExp(yy, m) + _cExp(nn, m)).ln() / 1e18 + b * m / 1e18;
    }

    function _cExp(uint256 x, uint256 m) internal pure returns (uint256) {
        return x >= m ? 1e18 : UD60x18Math.div(1e18, UD60x18Math.exp(m - x));
    }

    function buy(uint8 side, uint256 amount, uint256 maxCost) external lock {
        require(!terminal && block.timestamp < closeTime && amount > 0, "closed");
        uint256 raw = cost(side, amount);
        uint256 fee = raw * FEE_BPS / 10000;
        require(raw + fee <= maxCost && usdc.transferFrom(msg.sender, address(this), raw + fee), "quote");
        if (side == 1) qYes += amount;
        else qNo += amount;
        require(qYes + qNo <= usdcBalance(), "insolvent");
        tokens.mint(msg.sender, tokens.tokenIdFor(marketId, side), amount);
    }

    function usdcBalance() public view returns (uint256) {
        (bool ok, bytes memory data) =
            address(usdc).staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        return ok ? abi.decode(data, (uint256)) : 0;
    }

    function sell(uint8 side, uint256 amount, uint256 minReturn) external lock {
        require(!terminal && block.timestamp < closeTime && amount > 0, "closed");
        uint256 q = side == 1 ? qYes : qNo;
        require(amount <= q, "shares");
        uint256 beforeCost = _c(qYes, qNo);
        uint256 afterCost = _c(side == 1 ? qYes - amount : qYes, side == 0 ? qNo - amount : qNo);
        uint256 ret = beforeCost - afterCost;
        require(ret >= minReturn, "slippage");
        tokens.burn(msg.sender, tokens.tokenIdFor(marketId, side), amount);
        if (side == 1) qYes -= amount;
        else qNo -= amount;
        require(usdc.transfer(msg.sender, ret), "transfer");
    }

    function settle(uint8 result) external {
        require(msg.sender == gateway && result <= 2 && !terminal && block.timestamp >= closeTime, "settle");
        terminal = true;
        outcome = result;
    }

    function expireToVoid() external {
        require(!terminal && block.timestamp >= terminalDeadline, "early");
        terminal = true;
        outcome = 2;
    }

    function redeem(uint256 yes, uint256 no) external lock {
        require(terminal && (yes > 0 || no > 0), "redeem");
        uint256 payout = outcome == 0 ? yes : outcome == 1 ? no : (yes + no) / 2;
        if (yes > 0) tokens.burn(msg.sender, tokens.tokenIdFor(marketId, 1), yes);
        if (no > 0) tokens.burn(msg.sender, tokens.tokenIdFor(marketId, 0), no);
        require(usdc.transfer(msg.sender, payout), "transfer");
    }
}
