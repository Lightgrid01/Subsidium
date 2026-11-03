// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {ISomniaReactivityPrecompile} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";

interface IMarginBank {
    struct Position { int128 size; uint128 avgEntryPrice; int256 entryFundingIndex; uint64 lastUpdatedTimestampNs; }
    function getPosition(address account, address perpPool) external view returns (Position memory);
    function getActivePerpPools(address account) external view returns (address[] memory);
    function getAccountHealth(address account) external view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq);
}

interface IPerpPool {
    struct Health { uint256 oneBase; uint256 markPrice; int256 projectedCumulativeFunding; uint256 effectiveIMFBps; uint256 maintenanceMarginBps; uint256 closeOutMarginBps; }
    function getHealthSnapshot() external view returns (Health memory);
    function placeOrderFor(
        address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs,
        uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k
    ) external payable returns (bool success, uint128 orderId);
}

/// @title Subsidium
/// @notice A dead-man's switch for dreamDEX perp positions. The trader links this contract as a bot
///         (it can place/cancel/reduce for the account, never withdraw). If the trader stops checking in,
///         Somnia validators walk a ladder (warn -> cut 50% -> close all) through chained Schedule
///         subscriptions. No keeper, no server. An optional health guard cuts positions when margin thins.
contract Subsidium is SomniaEventHandler {
    enum Phase { Disarmed, Armed, Warned, Reduced, Closed }

    uint8 private constant MARKET = 2;

    address public immutable owner;      // the dreamDEX account this switch protects
    IMarginBank public immutable bank;
    address public guardian;             // may check in, pause or panic-close
    uint64 public interval;              // seconds of silence before the ladder starts
    uint64 public stepDelay;             // seconds between ladder rungs
    uint64 public pollInterval;          // health-guard cadence (seconds)
    uint256 public reduceBelowBps;       // health = equity/maintenance in bps; cut 50% below this (0 = guard off)
    uint256 public closeBelowBps;        // close everything below this
    Phase public phase;
    uint64 public deadline;              // time of the next escalation
    uint64 public pending;               // time of the one live schedule subscription (0 = none)
    uint64 public lastHealthCut;

    event Armed(uint64 deadline, uint64 interval);
    event CheckedIn(address indexed by, uint64 deadline);
    event Warned(uint64 at, uint64 nextStepAt);
    event PhaseChanged(Phase phase, uint64 at);
    event Cut(address indexed pool, bool isBid, uint256 quantity, uint256 pct, string reason);
    event CutFailed(address indexed pool, bytes reason);
    event HealthTrip(uint256 healthBps, uint256 pct);
    event Rescheduled(uint64 at);
    event Disarmed(address indexed by);

    error NotAllowed();
    error BadConfig();

    modifier onlyOwner() { if (msg.sender != owner) revert NotAllowed(); _; }
    modifier ownerOrGuardian() { if (msg.sender != owner && msg.sender != guardian) revert NotAllowed(); _; }

    constructor(address owner_, address bank_, address guardian_, uint64 interval_, uint64 stepDelay_) payable {
        if (owner_ == address(0) || bank_ == address(0) || interval_ < 5 || stepDelay_ < 5) revert BadConfig();
        owner = owner_; bank = IMarginBank(bank_); guardian = guardian_;
        interval = interval_; stepDelay = stepDelay_; pollInterval = 30;
    }

    receive() external payable {}

    // ---- owner controls ----
    function arm() external onlyOwner {
        phase = Phase.Armed;
        deadline = uint64(block.timestamp) + interval;
        emit Armed(deadline, interval);
        emit PhaseChanged(phase, uint64(block.timestamp));
        _ensureScheduled();
    }

    function checkIn() external ownerOrGuardian {
        if (phase == Phase.Disarmed || phase == Phase.Closed) revert NotAllowed();
        phase = Phase.Armed;
        deadline = uint64(block.timestamp) + interval;
        emit CheckedIn(msg.sender, deadline);
        emit PhaseChanged(phase, uint64(block.timestamp));
        _ensureScheduled();
    }

    function panic() external ownerOrGuardian {
        _cut(100, "panic");
        phase = Phase.Closed;
        emit PhaseChanged(phase, uint64(block.timestamp));
    }

    function disarm() external ownerOrGuardian {
        phase = Phase.Disarmed;
        emit Disarmed(msg.sender);
        emit PhaseChanged(phase, uint64(block.timestamp));
    }

    function configure(uint64 interval_, uint64 stepDelay_, uint64 pollInterval_, uint256 reduceBelowBps_, uint256 closeBelowBps_, address guardian_) external onlyOwner {
        if (interval_ < 5 || stepDelay_ < 5 || pollInterval_ < 5 || closeBelowBps_ > reduceBelowBps_) revert BadConfig();
        interval = interval_; stepDelay = stepDelay_; pollInterval = pollInterval_;
        reduceBelowBps = reduceBelowBps_; closeBelowBps = closeBelowBps_; guardian = guardian_;
        if (phase == Phase.Armed) { deadline = uint64(block.timestamp) + interval_; _ensureScheduled(); }
    }

    function rescue(address payable to, uint256 amount) external onlyOwner { to.transfer(amount); }

    // ---- reactive core ----
    function _onEvent(address, bytes32[] calldata topics, bytes calldata) internal override {
        if (topics.length == 0 || topics[0] != ISomniaReactivityPrecompile.Schedule.selector) return;
        pending = 0;
        if (phase == Phase.Disarmed || phase == Phase.Closed) return;
        uint64 t = uint64(block.timestamp);

        if (reduceBelowBps != 0 && t >= lastHealthCut + stepDelay) _guardHealth(t);

        if (t >= deadline) {
            if (phase == Phase.Armed) {
                phase = Phase.Warned; deadline = t + stepDelay;
                emit Warned(t, deadline);
                emit PhaseChanged(phase, t);
            } else if (phase == Phase.Warned) {
                _cut(50, "silence: reduce");
                phase = Phase.Reduced; deadline = t + stepDelay;
                emit PhaseChanged(phase, t);
            } else if (phase == Phase.Reduced) {
                _cut(100, "silence: close");
                phase = Phase.Closed;
                emit PhaseChanged(phase, t);
                return;
            }
        }
        _scheduleNext(t);
    }

    function _guardHealth(uint64 t) internal {
        (bool ok, uint256 h) = healthBps();
        if (!ok) return;
        if (h < closeBelowBps) { lastHealthCut = t; emit HealthTrip(h, 100); _cut(100, "health: close"); }
        else if (h < reduceBelowBps) { lastHealthCut = t; emit HealthTrip(h, 50); _cut(50, "health: reduce"); }
    }

    /// @notice equity / maintenance requirement in bps (10000 = on the liquidation line). ok=false when no position.
    function healthBps() public view returns (bool ok, uint256 bps) {
        try bank.getAccountHealth(owner) returns (int256 equity, uint256, uint256 mmReq, uint256) {
            if (mmReq == 0) return (false, 0);
            return (true, equity <= 0 ? 0 : uint256(equity) * 10_000 / mmReq);
        } catch { return (false, 0); }
    }

    function _cut(uint256 pct, string memory reason) internal {
        address[] memory pools = bank.getActivePerpPools(owner);
        for (uint256 i; i < pools.length; i++) {
            IMarginBank.Position memory p = bank.getPosition(owner, pools[i]);
            if (p.size == 0) continue;
            bool isBid = p.size < 0; // closing a short means buying
            uint256 abs_ = uint256(uint128(isBid ? -p.size : p.size));
            uint256 qty = abs_ * pct / 100;
            if (qty == 0) continue;
            uint256 mark = IPerpPool(pools[i]).getHealthSnapshot().markPrice;
            uint256 price = isBid ? mark * 110 / 100 : mark * 90 / 100; // 10% slippage bound
            try IPerpPool(pools[i]).placeOrderFor(owner, isBid, 0, price, qty, uint64((block.timestamp + 1 days) * 1e9), MARKET, 0, address(0), 0)
            returns (bool, uint128) { emit Cut(pools[i], isBid, qty, pct, reason); }
            catch (bytes memory why) { emit CutFailed(pools[i], why); }
        }
    }

    function _ensureScheduled() internal {
        if (pending == 0) _scheduleNext(uint64(block.timestamp));
    }

    function _scheduleNext(uint64 t) internal {
        uint64 at = deadline;
        if (reduceBelowBps != 0 && t + pollInterval < at) at = t + pollInterval;
        if (at < t + 2) at = t + 2;
        pending = at;
        SomniaExtensions.scheduleSubscriptionAtTimestamp(address(this), uint256(at) * 1000, SomniaExtensions.defaultSubscriptionOptions());
        emit Rescheduled(at);
    }
}
