# Yopem Auth

A lightweight authentication api with Google OAuth integration using
[OpenAuth](https://openauth.js.org).

## Getting Started

### Prerequisites

- bun 1.2.18 or later
- Cloudflare Workers account
- Google Cloud Platform account

### Installation

1. Clone the repository

```bash
git clone https://github.com/yopem/auth.git
cd auth
```

2. Install dependencies

```bash
bun install
```

### Configuration

1. Google Auth Setup:
   - Create OAuth 2.0 credentials in Google Cloud Platform
   - Configure the authorized redirect URI:
     `https://your-domain/google/callback`
   - Fill the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your `.dev.vars`
     file

2. Cloudflare Workers Setup:
   - Create a KV database in Cloudflare Workers dashboard
   - Rename `wrangler.jsonc.example` to `wrangler.jsonc`
   - Fill in all required fields using the Wrangler CLI for managing secrets,
     refer to the
     [Cloudflare Workers Secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/#adding-secrets-to-your-project)
     for more details.

3. Environment Variables:
   - Add DATABASE_URL to your .env file because drizzle cannot read .dev.vars

### Run the Application

```bash
bun run dev
```

### Deploy

```bash
bun run deploy
```
