// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {LMSRMarket} from "./LMSRMarket.sol";
import {LMSRLiquidityVault} from "./LMSRLiquidityVault.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
contract LMSRReleaseDeployer {
    struct LMSRArgs { bytes32 marketId; bytes32 releaseId; address token; address outcomeTokens; address feeRouter; address riskManager; address gateway; address creator; bytes32 manifestHash; address resolver; uint256 b; uint256 closeTime; uint256 resolutionAvailableTime; uint256 terminalDeadline; uint256 fundingDeadline; bytes32 marketSalt; bytes32 vaultSalt; }
    function predictLMSR(LMSRArgs calldata a) external view returns (address market, address vault) {
        bytes memory marketCode = abi.encodePacked(
            type(LMSRMarket).creationCode,
            abi.encode(a.marketId, a.releaseId, a.token, a.outcomeTokens, a.feeRouter, a.riskManager, a.gateway, a.creator, a.b, a.closeTime, a.resolutionAvailableTime, a.terminalDeadline)
        );
        market = Create2.computeAddress(a.marketSalt, keccak256(marketCode), address(this));
        bytes memory vaultCode = abi.encodePacked(
            type(LMSRLiquidityVault).creationCode,
            abi.encode(a.token, market, a.riskManager, _fundingTarget(a.b), a.fundingDeadline)
        );
        vault = Create2.computeAddress(a.vaultSalt, keccak256(vaultCode), address(this));
    }

    function deployLMSR(bytes32 marketId, bytes32 releaseId, address token, address outcomeTokens, address feeRouter, address riskManager, address gateway, address creator, bytes32 manifestHash, address resolver, uint256 b, uint256 closeTime, uint256 resolutionAvailableTime, uint256 terminalDeadline, uint256 fundingDeadline, bytes32 marketSalt, bytes32 vaultSalt) external returns (address market, address vault) {
        LMSRMarket marketInstance = new LMSRMarket{salt: marketSalt}(marketId, releaseId, token, outcomeTokens, feeRouter, riskManager, gateway, creator, b, closeTime, resolutionAvailableTime, terminalDeadline);
        LMSRLiquidityVault vaultInstance = new LMSRLiquidityVault{salt: vaultSalt}(token, address(marketInstance), riskManager, marketInstance.fundingTarget(), fundingDeadline);
        marketInstance.bindVault(address(vaultInstance));
        marketInstance.bindResolution(resolver, manifestHash);
        return (address(marketInstance), address(vaultInstance));
    }

    function _fundingTarget(uint256 b) private pure returns (uint256) {
        uint256 target = (b * 693147180559945309 * 110 + (100 * 1e18 - 1)) / (100 * 1e18);
        return target < 100e6 ? 100e6 : target;
    }
}
