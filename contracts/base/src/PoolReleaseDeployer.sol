// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {PoolMarket} from "./PoolMarket.sol";
contract PoolReleaseDeployer {
    function deployPool(bytes32 marketId, bytes32 releaseId, address token, address creator, address feeRouter, address riskManager, address gateway, bytes32 manifestHash, address resolver, uint256 closeTime, uint256 resolutionAvailableTime, uint256 terminalDeadline, bytes32 salt) external returns (address) {
        return address(new PoolMarket{salt: salt}(marketId, releaseId, token, creator, feeRouter, riskManager, gateway, manifestHash, resolver, closeTime, resolutionAvailableTime, terminalDeadline));
    }
}
