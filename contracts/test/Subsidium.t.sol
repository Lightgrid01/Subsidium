// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Subsidium, IMarginBank, IPerpPool} from "../src/Subsidium.sol";
import {ISomniaReactivityPrecompile} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";

contract MockPrecompile {
    uint64 public count;
    function subscribe(ISomniaReactivityPrecompile.SubscriptionData calldata) external returns (uint64) { return ++count; }
}

contract MockPool {
    int128 public size;
    bool public shouldRevert;
    uint256 public lastQty; bool public lastIsBid; uint8 public lastType; address public lastOwner; uint256 public lastPrice;
    function set(int128 s) external { size = s; }
    function setRevert(bool r) external { shouldRevert = r; }
    function getHealthSnapshot() external pure returns (IPerpPool.Health memory h) { h.oneBase = 1e18; h.markPrice = 2000e18; }
    function placeOrderFor(address o, bool isBid, uint64, uint256 price, uint256 q, uint64, uint8 t, uint8, address, uint96)
        external payable returns (bool, uint128)
    {
        require(!shouldRevert, "pool down");
        lastOwner = o; lastIsBid = isBid; lastQty = q; lastType = t; lastPrice = price;
        size = isBid ? size + int128(uint128(q)) : size - int128(uint128(q));
        return (true, 1);
    }
}

contract MockBank {
    MockPool public pool;
    int256 public equity; uint256 public mm;
    constructor(MockPool p) { pool = p; }
    function setHealth(int256 e, uint256 m) external { equity = e; mm = m; }
    function getPosition(address, address) external view returns (IMarginBank.Position memory p) { p.size = pool.size(); }
    function getActivePerpPools(address) external view returns (address[] memory a) { a = new address[](1); a[0] = address(pool); }
    function getAccountHealth(address) external view returns (int256, uint256, uint256, uint256) { return (equity, mm, mm, mm); }
}

contract SubsidiumTest is Test {
    address constant PRE = address(0x0100);
    address trader = address(0xA11CE);
    address guardian = address(0xB0B);
    MockPool pool; MockBank bank; Subsidium sw;

    function setUp() public {
        vm.etch(PRE, address(new MockPrecompile()).code);
        pool = new MockPool(); bank = new MockBank(pool);
        pool.set(int128(int256(10e18))); // long 10
        bank.setHealth(1000e18, 100e18);
        sw = new Subsidium{value: 40 ether}(trader, address(bank), guardian, 60, 20);
        vm.warp(1_000_000);
    }

    function _fire() internal {
        bytes32[] memory t = new bytes32[](2);
        t[0] = ISomniaReactivityPrecompile.Schedule.selector;
        vm.prank(PRE); sw.onEvent(PRE, t, "");
    }

    function test_armSchedulesAndSetsDeadline() public {
        vm.prank(trader); sw.arm();
        assertEq(uint8(sw.phase()), 1);
        assertEq(sw.deadline(), block.timestamp + 60);
        assertEq(sw.pending(), block.timestamp + 60);
    }

    function test_ladderWarnThenReduceThenClose() public {
        vm.prank(trader); sw.arm();
        vm.warp(block.timestamp + 60); _fire();
        assertEq(uint8(sw.phase()), 2);                       // warned
        assertEq(pool.size(), int128(int256(10e18)));         // untouched
        vm.warp(block.timestamp + 20); _fire();
        assertEq(uint8(sw.phase()), 3);                       // reduced
        assertEq(pool.lastQty(), 5e18);                       // 50%
        assertEq(pool.lastIsBid(), false);                    // selling a long
        assertEq(pool.lastType(), 2);                         // MARKET
        assertEq(pool.lastOwner(), trader);                   // acts for the account
        assertEq(pool.lastPrice(), 1800e18);                  // mark -10%
        vm.warp(block.timestamp + 20); _fire();
        assertEq(uint8(sw.phase()), 4);                       // closed
        assertEq(pool.size(), 0);
        assertEq(sw.pending(), 0);                            // chain ends
    }

    function test_checkInResetsAndStaleTickReschedules() public {
        vm.prank(trader); sw.arm();
        vm.warp(block.timestamp + 50);
        vm.prank(trader); sw.checkIn();
        uint64 newDeadline = sw.deadline();
        vm.warp(block.timestamp + 10); _fire();               // stale tick at the old deadline
        assertEq(uint8(sw.phase()), 1);                       // still armed
        assertEq(sw.pending(), newDeadline);                  // re-chained to new deadline
        assertEq(pool.size(), int128(int256(10e18)));
    }

    function test_checkInAfterWarnRearms() public {
        vm.prank(trader); sw.arm();
        vm.warp(block.timestamp + 60); _fire();
        assertEq(uint8(sw.phase()), 2);
        vm.prank(guardian); sw.checkIn();
        assertEq(uint8(sw.phase()), 1);
    }

    function test_onlyPrecompileCanFire() public {
        bytes32[] memory t = new bytes32[](1);
        vm.expectRevert();
        sw.onEvent(address(this), t, "");
    }

    function test_strangersCannotControl() public {
        vm.expectRevert(Subsidium.NotAllowed.selector); sw.arm();
        vm.expectRevert(Subsidium.NotAllowed.selector); sw.panic();
        vm.expectRevert(Subsidium.NotAllowed.selector); sw.checkIn();
    }

    function test_guardianPanicClosesAll() public {
        vm.prank(guardian); sw.panic();
        assertEq(pool.size(), 0);
        assertEq(uint8(sw.phase()), 4);
    }

    function test_shortPositionIsBought() public {
        pool.set(-int128(int256(8e18)));
        vm.prank(trader); sw.panic();
        assertEq(pool.lastIsBid(), true);
        assertEq(pool.lastPrice(), 2200e18);                  // mark +10%
        assertEq(pool.size(), 0);
    }

    function test_healthGuardReducesThenCloses() public {
        vm.startPrank(trader);
        sw.configure(600, 20, 10, 15_000, 11_000, guardian);  // reduce <1.5x, close <1.1x
        sw.arm();
        vm.stopPrank();
        bank.setHealth(130e18, 100e18);                       // 1.3x -> reduce
        vm.warp(block.timestamp + 10); _fire();
        assertEq(pool.lastQty(), 5e18);
        assertEq(uint8(sw.phase()), 1);                       // not a silence escalation
        bank.setHealth(105e18, 100e18);                       // 1.05x -> close
        vm.warp(block.timestamp + 20); _fire();
        assertEq(pool.size(), 0);
    }

    function test_healthGuardIgnoresFlatAccount() public {
        pool.set(0); bank.setHealth(100e18, 0);
        vm.startPrank(trader); sw.configure(600, 20, 10, 15_000, 11_000, guardian); sw.arm(); vm.stopPrank();
        vm.warp(block.timestamp + 10); _fire();
        assertEq(uint8(sw.phase()), 1);
    }

    function test_poolFailureDoesNotBrickLadder() public {
        pool.setRevert(true);
        vm.prank(trader); sw.arm();
        vm.warp(block.timestamp + 60); _fire();
        vm.warp(block.timestamp + 20); _fire();               // reduce attempt fails, ladder still advances
        assertEq(uint8(sw.phase()), 3);
        assertEq(pool.size(), int128(int256(10e18)));
    }

    function test_configureWhileArmedRebasesClock() public {
        vm.startPrank(trader); sw.arm(); sw.configure(86400, 3600, 30, 0, 0, guardian); vm.stopPrank();
        assertEq(sw.deadline(), block.timestamp + 86400);
        vm.warp(block.timestamp + 60); _fire();               // the old 60s tick finds the new deadline and re-chains
        assertEq(uint8(sw.phase()), 1);
        assertEq(sw.pending(), sw.deadline());
    }

    function test_disarmStopsChain() public {
        vm.prank(trader); sw.arm();
        vm.prank(trader); sw.disarm();
        vm.warp(block.timestamp + 60); _fire();
        assertEq(sw.pending(), 0);
        assertEq(pool.size(), int128(int256(10e18)));
    }
}
