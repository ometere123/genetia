// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {PoolMarket} from "../src/PoolMarket.sol";

contract CreatePoolSepolia is Script {
    IERC20 constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    MarketFactory constant FACTORY = MarketFactory(0x370914519fa0Ad34A6138cb69f03A662137a4a9F);
    bytes32 constant RELEASE = keccak256("pool-release-20260912");
    address constant RESOLVER = 0x8c97eEC014E1756a1fA5DDD371e2Ed23d6702838;

    function run() external returns (address market) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address creator = vm.addr(pk);
        uint256 close = block.timestamp + 30 minutes;
        uint256 resolution = close + 1 hours;
        bytes32 marketId = keccak256(abi.encode("pool-connected-20260912", block.timestamp));
        bytes32 manifest = keccak256(abi.encode("pool-manifest-connected-20260912"));
        MarketFactory.MarketTerms memory terms = MarketFactory.MarketTerms({
            marketId: marketId,
            financialReleaseId: RELEASE,
            resolverReleaseId: keccak256("resolver-release-2026-09"),
            manifestHash: manifest,
            resolver: RESOLVER,
            creator: creator,
            closeTime: close,
            resolutionAvailableTime: resolution,
            terminalDeadline: resolution + 96 hours
        });
        vm.startBroadcast(pk);
        market = FACTORY.createPool(terms);
        USDC.approve(market, 10e6);
        PoolMarket(market).stake(true, 5e6);
        PoolMarket(market).stake(false, 5e6);
        vm.stopBroadcast();
        console2.log("PoolMarket", market);
        console2.logBytes32(marketId);
        return market;
    }
}
