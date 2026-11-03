# Subsidium
Dead-man's switch for dreamDEX perps on Somnia Reactivity. Miss your check-in and validators warn, cut 50%, then close, with no keeper.

## 1. Contracts (tested: 12/12 with mocks)
    cd contracts && npm i && forge install foundry-rs/forge-std && forge test

## 2. Deploy to Hideki testnet (deployer needs 33+ STT)
    OWNER=<your dreamDEX account> INTERVAL=86400 STEP=3600 forge  # use INTERVAL=60 STEP=20 for a quick demo; the dashboard can change it later
    script script/Deploy.s.sol \
      --rpc-url https://api.hideki2.infra.testnet.somnia.network --broadcast --private-key $KEY

## 3. Link it as a bot
dreamDEX app > wallet > Link a bot > paste the Subsidium address > keep Perps ticked. Move margin to the Perps account and open a small position.

## 4. Probe (run before trusting anything)
    SUBSIDIUM=0x.. OWNER=0x.. POOL=<a perp pool> ./probe.sh
Then call `arm()` (the UI does it), wait past the deadline, and confirm `phase` moves 1 -> 2 -> 3 on its own.

## 5. Dashboard
    cd app && cp .env.example .env   # set VITE_SUBSIDIUM and VITE_FROM_BLOCK
    npm i && npm run dev             # deploy the dist folder to Vercel when happy

Optional: drop your own background clip at `app/public/background.mp4`; it plays over the built-in animated scene.
