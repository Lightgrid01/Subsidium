# Link a bot rejects contract addresses, which blocks on chain automation

Severity: major
Area: app

## Steps to reproduce

1. Deploy any contract on Somnia Hideki testnet (chain ID 50383). Example: 0xC6d270a36f6DcC8cB3a38DBb91673af9CB9B1d33
2. Open app.testnet.dreamdex.io and connect the wallet that owns the perps account.
3. Open the wallet menu, choose Link a bot, and tick Perps.
4. Paste the contract address and click Add bot.

## Expected

Either the contract is accepted as a bot, or the Link a bot guide and the bounty brief say up front that only externally owned accounts can be linked, so builders know before they design a contract based strategy.

## Actual

The app shows this message and does not link the address:

"That address is a contract. Enter the address your bot trades from."

## Evidence

* Screenshot: feedback/images/link-a-bot-contract-error.png
* Contract: 0xC6d270a36f6DcC8cB3a38DBb91673af9CB9B1d33
* Deploy transaction: 0x1bad7db76197adff413f504ddb2fbdfd4875935fb5b9e32b078c76eb8cbbe39e

Why it matters: the bounty names Somnia Reactivity as a plus. A Reactivity handler is a contract. Because a contract cannot be linked as a bot, it cannot place orders through placeOrderFor, so any strategy driven by Reactivity cannot act on a perps account. Builders only find this out after deploying.

## Environment

* Network: Somnia Hideki testnet, chain ID 50383
* App: app.testnet.dreamdex.io
* SDK version: not applicable, this is an app flow
* Wallet address: 0x9fb6147e4d62d1fbb57e81b584387b169393c2f5
* Date: 2026-11-15
