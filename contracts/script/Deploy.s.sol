// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script, console} from "forge-std/Script.sol";
import {Subsidium} from "../src/Subsidium.sol";

/// forge script script/Deploy.s.sol --rpc-url hideki --broadcast --private-key $KEY  (deployer needs 33+ STT: the contract must hold 32 STT as subscription owner)
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");                       // your dreamDEX account
        address bank = vm.envOr("MARGIN_BANK", address(0x478769E1177C0773c43A593DCCc4Ad15F15F1394)); // verify on the explorer /system page
        address guardian = vm.envOr("GUARDIAN", address(0));
        uint64 interval = uint64(vm.envOr("INTERVAL", uint256(86400)));  // default: 24h of silence (use INTERVAL=60 for a quick demo)
        uint64 step = uint64(vm.envOr("STEP", uint256(3600)));
        vm.startBroadcast();
        Subsidium s = new Subsidium{value: 33 ether}(owner, bank, guardian, interval, step);
        vm.stopBroadcast();
        console.log("Subsidium:", address(s));
        console.log("Link this address as a bot (Perps) in the dreamDEX app, then call arm().");
    }
}
