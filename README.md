# Coin Scanner (standalone)

Photos go from your phone to a small server function on Vercel, which adds your
Anthropic API key and asks Claude to identify the coin. The key never reaches the phone.

## Setup (about 15 minutes, on a computer)

### 1. Anthropic API key
1. Go to console.anthropic.com and sign up.
2. Billing: add a payment method and $20 of credit. Set a monthly spend limit.
3. API Keys: Create Key. Copy it somewhere private. Never paste it into a chat.

### 2. Put the code on GitHub
1. github.com: New repository, name it `coin-scanner`, choose Private, Create.
2. Click "uploading an existing file".
3. Drag in everything from this folder: `index.html`, `package.json`, `vercel.json`,
   `README.md`, and the `api` folder.
4. Click Commit changes.

### 3. Deploy on Vercel
1. vercel.com: sign in with GitHub.
2. Add New, then Project, then Import `coin-scanner`.
3. Framework Preset: Other. Leave build settings empty.
4. Open Environment Variables and add:
   - `ANTHROPIC_API_KEY` = your key from step 1
   - `APP_ACCESS_CODE` = any code you choose (testers type it once per phone)
5. Click Deploy. Vercel gives you a link like `coin-scanner-xxxx.vercel.app`.

### 4. Use it
Open the link on your phone in Safari, then Share, then Add to Home Screen.
The first scan asks for your access code.

## Changing things later
- New key or code: Vercel, Project, Settings, Environment Variables, then Redeploy.
- Optional `CLAUDE_MODEL` variable picks the model (default `claude-sonnet-5-5`).

## Cost
Roughly 1 to 2 cents per scan with the default model. Check usage in the Anthropic console.
