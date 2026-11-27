# HerHaq-Website

Website for HerHaq Organization — [herhaq.com](https://herhaq.com)

Astro 5 site with the donation API in the same project, deployed to Netlify,
backed by Neon Postgres and the Paytm payment gateway.

## Quick start

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static pages to dist/, SSR function to .netlify/
npm run reconcile  # check Paytm for payments we may have missed (dry run)
```

Requires a `.env` with `DATABASE_URL`, the `PAYTM_*` credentials and
`PUBLIC_SITE_URL`. See the environment variables table in the architecture doc.

## Documentation

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the backend fits
together and why, the full environment variable reference, the donation flow
and its failure modes, a troubleshooting table, and what is deliberately not
built yet. Read this before changing anything under `src/pages/api/`.

Two things worth knowing before you touch the donation path:

- `.env` points at the **production** Paytm gateway. Calling
  `/api/paytm/initiate` creates a real order.
- The insert in `/api/paytm/initiate` must stay **before** the Paytm call. That
  ordering is what makes reconciliation complete.
