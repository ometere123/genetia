// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {LMSRMarket} from "./LMSRMarket.sol";
import {LMSRLiquidityVault} from "./LMSRLiquidityVault.sol";
contract LMSRReleaseDeployer {
    function deployLMSR(bytes32 marketId, bytes32 releaseId, address token, address outcomeTokens, address feeRouter, address riskManager, address gateway, address creator, bytes32 manifestHash, address resolver, uint256 b, uint256 closeTime, uint256 resolutionAvailableTime, uint256 terminalDeadline, uint256 fundingDeadline, bytes32 marketSalt, bytes32 vaultSalt) external returns (address market, address vault) {
        LMSRMarket marketInstance = new LMSRMarket{salt: marketSalt}(marketId, releaseId, token, outcomeTokens, feeRouter, riskManager, gateway, creator, manifestHash, resolver, b, closeTime, resolutionAvailableTime, terminalDeadline);
        LMSRLiquidityVault vaultInstance = new LMSRLiquidityVault{salt: vaultSalt}(token, address(marketInstance), riskManager, marketInstance.fundingTarget(), fundingDeadline);
        marketInstance.bindVault(address(vaultInstance));
        return (address(marketInstance), address(vaultInstance));
    }
}
