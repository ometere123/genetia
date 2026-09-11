// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {PoolMarket} from "./PoolMarket.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
contract PoolReleaseDeployer {
    struct PoolArgs { bytes32 marketId; bytes32 releaseId; address token; address creator; address feeRouter; address riskManager; address gateway; bytes32 manifestHash; address resolver; uint256 closeTime; uint256 resolutionAvailableTime; uint256 terminalDeadline; bytes32 salt; }
    function predictPool(PoolArgs calldata a) external view returns (address) {
        bytes memory initCode = abi.encodePacked(
            type(PoolMarket).creationCode,
            abi.encode(a.marketId, a.releaseId, a.token, a.creator, a.feeRouter, a.riskManager, a.gateway, a.manifestHash, a.resolver, a.closeTime, a.resolutionAvailableTime, a.terminalDeadline)
        );
        return Create2.computeAddress(a.salt, keccak256(initCode), address(this));
    }

    function deployPool(bytes32 marketId, bytes32 releaseId, address token, address creator, address feeRouter, address riskManager, address gateway, bytes32 manifestHash, address resolver, uint256 closeTime, uint256 resolutionAvailableTime, uint256 terminalDeadline, bytes32 salt) external returns (address) {
        return address(new PoolMarket{salt: salt}(marketId, releaseId, token, creator, feeRouter, riskManager, gateway, manifestHash, resolver, closeTime, resolutionAvailableTime, terminalDeadline));
    }
}
