// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRiskManager {
    function reserveExposure(address market, uint256 amount) external;
    function releaseExposure(address market, uint256 amount) external;
    function registerComponent(address component) external;
    function paused() external view returns (bool);
}

interface IFeeRouter {
    function registerMarket(address market) external;
    function routePool(address creator, uint256 fee) external;
    function routeLMSR(address creator, address vault, uint256 fee) external;
    function routeDust(uint256 amount) external;
}

interface IOutcomeTokens {
    function registerMarket(address market) external;
    function tokenIdFor(bytes32 marketId, uint8 outcome) external pure returns (uint256);
    function mint(address to, uint256 id, uint256 amount) external;
    function burn(address from, uint256 id, uint256 amount) external;
}

interface IResolutionGateway {
    function registerMarket(
        address market,
        bytes32 marketId,
        address resolver,
        bytes32 manifestHash,
        bytes32 resolverReleaseId,
        uint256 terminalDeadline
    ) external;
}

interface ITerminalMarket {
    function settle(uint8 outcome) external;
}

interface ILMSRMarket {
    function activate(uint256 funding) external;
    function settle(uint8 outcome) external;
}
