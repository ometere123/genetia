// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {LMSRMarketFactory} from "../src/lmsr/LMSRMarketFactory.sol";

/// @notice Deploy the LMSR stack on Arc testnet.
///
/// Required env:
///   PRIVATE_KEY           — admin deployer key
///   ARC_USDC_ADDRESS      — USDC ERC-20 address on Arc (default below for testnet)
///   RELAYER_ADDRESS       — GenLayer relayer wallet (calls proposeResolution)
///   TREASURY_ADDRESS      — Genetia treasury wallet (seeds market liquidity)
///
/// Run:
///   forge script script/DeployLMSR.s.sol \
///     --rpc-url arc_testnet \
///     --broadcast --verify
contract DeployLMSR is Script {
    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey   = vm.envUint("PRIVATE_KEY");
        address relayer       = vm.envAddress("RELAYER_ADDRESS");
        address treasury      = vm.envAddress("TREASURY_ADDRESS");
        address usdc          = vm.envOr("ARC_USDC_ADDRESS", ARC_TESTNET_USDC);

        vm.startBroadcast(deployerKey);

        LMSRMarketFactory factory = new LMSRMarketFactory(usdc, relayer, treasury);

        vm.stopBroadcast();

        console.log("=========================================================");
        console.log("LMSRMarketFactory deployed at:", address(factory));
        console.log("OutcomeTokens         at:    ", address(factory.tokens()));
        console.log("=========================================================");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Add to frontend/.env:");
        console.log("       NEXT_PUBLIC_LMSR_FACTORY_ADDRESS=", address(factory));
        console.log("       NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS=", address(factory.tokens()));
        console.log("  2. Have the treasury wallet approve the factory:");
        console.log("       USDC.approve(factory, uint256.max)");
        console.log("       (or do it inside the createMarket flow)");
        console.log("  3. Fund the treasury wallet via the Circle Faucet so it");
        console.log("     can seed new markets (each market needs `b` USDC).");
    }
}
