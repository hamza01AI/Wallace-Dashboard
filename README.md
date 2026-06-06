# Wallace Dashboard

Personal command-center dashboard for Tory with Airtable wired in as the CRM/data source.

## Local Services

- API: `npm run api` on `127.0.0.1:8787`
- Web app: `npm run dev` on port `5173`
- Airtable token: `~/.config/wallace/airtable.env`

The Airtable token is read only by the local API server. It is not bundled into the browser app.

## Current Airtable Sources

- Work CRM: `Proposal Submissions Master`
  - Table: `Proposals`
- Wallace base: `Wallace's Base`
  - Tables: `Acquisitions`, `Tenders`

## Commands

```bash
npm install
npm run api
npm run dev
npm run build
npm run lint
```

Open `http://localhost:5173/` on the Mac. For phone access, prefer Tailscale and run Vite bound to the Mac's Tailscale IP. The API remains local-only and is reached through Vite's `/api` proxy.

## Deploying On Vercel

This project is ready to deploy as a Vite app with a Vercel Function at `/api/dashboard`.

1. Push this repo to GitHub.
2. Import the Git repo into Vercel.
3. Set `AIRTABLE_TOKEN` in Vercel Project Settings for Production and Preview.
4. Deploy.

After that, any code changes pushed to the connected branch will trigger automatic preview and production deployments.

For local development against Vercel env vars, use:

```bash
vercel env pull
```
