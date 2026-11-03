#!/usr/bin/env bash
# Run BEFORE trusting the build. Checks the three things I could not test from my sandbox.
# usage: SUBSIDIUM=0x.. OWNER=0x.. POOL=0x.. ./probe.sh
set -e
RPC=${RPC:-https://api.hideki2.infra.testnet.somnia.network}
BANK=${MARGIN_BANK:-0x478769E1177C0773c43A593DCCc4Ad15F15F1394}
echo "1) Is the contract linked as an operator? (all three must be true)"
for SEL in 0x80054449 0xe37b444b 0x364c2587; do
  cast call "$POOL" "isOperatorAuthorized(address,address,bytes4)(bool)" "$OWNER" "$SUBSIDIUM" $SEL --rpc-url $RPC
done
echo "2) Does the contract read your margin health? (ok, bps; 10000 = liquidation line)"
cast call "$SUBSIDIUM" "healthBps()(bool,uint256)" --rpc-url $RPC
echo "   compare with the bank directly: equity, imReq, mmReq, cmReq"
cast call "$BANK" "getAccountHealth(address)(int256,uint256,uint256,uint256)" "$OWNER" --rpc-url $RPC
echo "3) Is the schedule chain alive? phase, deadline, pending subscription time"
cast call "$SUBSIDIUM" "phase()(uint8)" --rpc-url $RPC
cast call "$SUBSIDIUM" "deadline()(uint64)" --rpc-url $RPC
cast call "$SUBSIDIUM" "pending()(uint64)" --rpc-url $RPC
echo "After arm(), wait past the deadline and re-run: phase must move 1 -> 2 on its own."
