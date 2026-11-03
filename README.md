# Subsidium

A dead man's switch for your dreamDEX perps positions. Built on Somnia Reactivity.

If you stop checking in, Subsidium warns you, cuts your positions in half, then closes everything. An optional margin health guard steps in sooner when your account gets unsafe. Every action is recorded on chain and shown on a dashboard timeline called the black box.

Built for the dreamDEX Perps Builder Bounty, MVP track, bots and agents category.

## Why it exists

Perps positions do not sleep. Traders do. A phone dies, a flight takes off, a connection drops, and a leveraged position keeps moving. Subsidium lets a trader say "protect my positions if I go quiet" and have a contract enforce it. No bot has to stay online and no one has to trust a third party with a key.

## Who it is for

* Traders who hold leveraged positions and cannot always watch them
* Traders who want a predictable ladder instead of a surprise liquidation
* Builders who want a working example of Somnia Reactivity driving a real trading workflow

## How it works

You deploy Subsidium and link it as a bot on dreamDEX perps. You arm it and choose a quiet window of 1 hour, 6 hours, 24 hours or 3 days. While it is armed, you check in to reset the clock. If the clock runs out, the contract climbs a ladder one step at a time.

Phases:

1. Disarmed. Nothing happens.
2. Armed. The clock is running. A check in resets it.
3. Warned. The window ran out. A warning is recorded and a grace delay starts.
4. Reduced. Open positions are cut by half.
5. Closed. Every position is closed.

A check in during Warned or Reduced puts you back to Armed. Panic closes everything at once. Disarm stops the whole chain.

Each step is scheduled on chain with Somnia Reactivity. The contract is called back by the Reactivity precompile when a step is due, so no off chain keeper is involved.

### Margin health guard

While armed, the contract also checks your account health on a short poll interval. If health falls below the reduce threshold it cuts positions. If it falls below the close threshold it closes them. Accounts with no open positions are ignored.

### Cuts

For each active perp pool the contract reads your position and places an order through the dreamDEX margin bank. Long positions are sold down and short positions are bought back. If one pool fails, the failure is recorded and the other pools still run.

### Roles

* Owner. Can arm, configure, check in, panic, disarm and rescue funds.
* Guardian. An optional second address that can check in, panic and disarm. It cannot move funds.
* Everyone else. No control at all.

## Dashboard

A React dashboard shows the switch live.

* A segmented countdown and a heartbeat line
* The ladder with each step marked as waiting, done or tripped
* The black box, a timeline where every action lands with its transaction
* Check in windows of 1 hour, 6 hours, 24 hours, 3 days and a short Demo window
* Buttons to arm the switch and to close everything now

## Quick start

You need Node 20 or newer and Foundry.

### Contracts

```bash
cd contracts
npm install
forge install foundry-rs/forge-std --no-git
forge test -vv
```

All 13 tests should pass.

### Deploy

The deployer needs about 35 STT on Hideki testnet. The contract holds 32 STT as the Reactivity subscription owner balance and the rest pays gas. Contract creation on Somnia is gas heavy, so the gas limit is set high. Unused gas is refunded.

```bash
forge create src/Subsidium.sol:Subsidium \
  --rpc-url https://api.hideki2.infra.testnet.somnia.network \
  --account dev --legacy --gas-limit 60000000 --value 33ether --broadcast \
  --constructor-args <OWNER> 0x478769E1177C0773c43A593DCCc4Ad15F15F1394 <GUARDIAN_OR_ZERO_ADDRESS> 86400 3600
```

The constructor arguments are owner, margin bank, guardian, check in interval in seconds and step delay in seconds. The script in `contracts/script/Deploy.s.sol` does the same thing and reads OWNER, MARGIN_BANK, GUARDIAN, INTERVAL and STEP from the environment.

After deploying, link the contract address as a bot for Perps in the dreamDEX app, then call `arm()`.

### Dashboard

```bash
cd app
npm install
cp .env.example .env
```

Set `VITE_SUBSIDIUM` to your contract address and `VITE_FROM_BLOCK` to the block where it was deployed, then run:

```bash
npm run dev
```

Open http://localhost:5173. You can also paste the contract address into the Connect your switch box on first load.

## Network

* Network: Somnia Hideki testnet
* Chain ID: 50383
* RPC: https://api.hideki2.infra.testnet.somnia.network
* Explorer: https://explorer.testnet.somnia.network
* Gas coin: STT
* dreamDEX margin bank: 0x478769E1177C0773c43A593DCCc4Ad15F15F1394

## Deployments

Filled in after the Hideki deployment.

* Subsidium contract: PENDING
* Deploy transaction: PENDING
* Arm transaction: PENDING
* First scheduled step: PENDING
* First live order from a cut: PENDING

## Contract reference

Owner controls:

* `arm()` starts the clock and schedules the first step.
* `configure(interval, stepDelay, pollInterval, reduceBelowBps, closeBelowBps, guardian)` changes the settings. Changing them while armed rebases the clock.
* `rescue(to, amount)` sends funds out of the contract.

Owner or guardian:

* `checkIn()` resets the clock and returns the switch to Armed.
* `panic()` closes every position immediately.
* `disarm()` stops the chain of steps.

Views:

* `phase()`, `deadline()`, `interval()`, `stepDelay()`, `pollInterval()`
* `reduceBelowBps()`, `closeBelowBps()`, `guardian()`, `owner()`
* `healthBps()` returns whether the account is healthy and its health in basis points

Events:

* `Armed`, `CheckedIn`, `Warned`, `Cut`, `CutFailed`, `HealthTrip`, `Rescheduled`, `Disarmed`

## Tests

The Foundry suite covers 13 behaviours.

* Arming schedules a step and sets the deadline
* A check in resets the clock and a stale tick reschedules
* A check in after a warning rearms the switch
* Changing settings while armed rebases the clock
* Disarm stops the chain
* Guardian panic closes everything
* The health guard ignores a flat account
* The health guard reduces first and then closes
* The full ladder warns, reduces and closes
* Only the Reactivity precompile can fire a step
* A failing pool does not brick the ladder
* A short position is bought back
* Strangers cannot control the switch

## Security notes

This is testnet code and it has not been audited. Do not point it at real funds without a review.

* Only the Reactivity precompile can trigger scheduled steps.
* The contract holds 32 STT as the Reactivity subscription owner balance. The owner can pull funds with `rescue()`.
* The guardian can act on the switch but cannot move funds.
* The contract never holds your trading collateral. Orders go through the dreamDEX margin bank.

## Project structure

* `contracts/src/Subsidium.sol` the switch
* `contracts/test/Subsidium.t.sol` the test suite
* `contracts/script/Deploy.s.sol` the deploy script
* `app/` the React and Vite dashboard written in TypeScript with viem

## Ideas for later

* Treat any on chain action from the owner wallet as a check in
* More than one guardian
* Per pool rules, so some markets are cut before others

## X posts

Posts about this build, tagging @DreamDEXSomnia.

1. PENDING
2. PENDING
3. PENDING

## Author

Built by Lightgrid01, on X as @w3rgmi.

## License

MIT
