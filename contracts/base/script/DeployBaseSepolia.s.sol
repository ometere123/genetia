// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProtocolRegistry} from "../src/ProtocolRegistry.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {OutcomeTokens} from "../src/OutcomeTokens.sol";
import {ResolutionGateway} from "../src/ResolutionGateway.sol";
import {ProposalBondEscrow} from "../src/ProposalBondEscrow.sol";
import {PoolReleaseDeployer} from "../src/PoolReleaseDeployer.sol";
import {LMSRReleaseDeployer} from "../src/LMSRReleaseDeployer.sol";
import {MarketFactory} from "../src/MarketFactory.sol";

contract DeployBaseSepolia is Script {
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    bytes32 constant POOL_RELEASE = keccak256("pool-release-20260912");
    bytes32 constant LMSR_RELEASE = keccak256("lmsr-release-20260912");

    function run() external returns (address factory) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address safe = vm.addr(pk);
        address[5] memory watchers = [
            vm.addr(vm.envUint("TEST_WATCHER_1_PRIVATE_KEY")),
            vm.addr(vm.envUint("TEST_WATCHER_2_PRIVATE_KEY")),
            vm.addr(vm.envUint("TEST_WATCHER_3_PRIVATE_KEY")),
            vm.addr(vm.envUint("TEST_WATCHER_4_PRIVATE_KEY")),
            vm.addr(vm.envUint("TEST_WATCHER_5_PRIVATE_KEY"))
        ];
        vm.startBroadcast(pk);
        ProtocolRegistry registry = new ProtocolRegistry(safe);
        OutcomeTokens outcomes = new OutcomeTokens(safe, address(0));
        RiskManager risk = new RiskManager(safe, address(0));
        FeeRouter fees = new FeeRouter(USDC, safe, safe, address(0));
        PoolReleaseDeployer poolRelease = new PoolReleaseDeployer();
        LMSRReleaseDeployer lmsrRelease = new LMSRReleaseDeployer();
        ProposalBondEscrow escrow = new ProposalBondEscrow(safe, USDC, safe);
        ResolutionGateway gateway = new ResolutionGateway(safe, address(0), watchers);
        MarketFactory marketFactory = new MarketFactory(safe, USDC, address(registry), address(outcomes), address(fees), address(risk), address(gateway));
        outcomes.setFactory(address(marketFactory));
        risk.setFactory(address(marketFactory));
        fees.setFactory(address(marketFactory));
        gateway.setFactory(address(marketFactory));
        bytes32 sourceCommit = vm.envBytes32("SOURCE_COMMIT");
        registry.registerRelease(POOL_RELEASE, address(poolRelease), address(poolRelease).codehash, sourceCommit);
        registry.registerRelease(LMSR_RELEASE, address(lmsrRelease), address(lmsrRelease).codehash, sourceCommit);
        registry.setDefaults(POOL_RELEASE, LMSR_RELEASE);
        vm.stopBroadcast();
        console2.log("ProtocolRegistry", address(registry));
        console2.log("RiskManager", address(risk));
        console2.log("FeeRouter", address(fees));
        console2.log("OutcomeTokens", address(outcomes));
        console2.log("ResolutionGateway", address(gateway));
        console2.log("ProposalBondEscrow", address(escrow));
        console2.log("PoolReleaseDeployer", address(poolRelease));
        console2.log("LMSRReleaseDeployer", address(lmsrRelease));
        console2.log("MarketFactory", address(marketFactory));
        return address(marketFactory);
    }
}
