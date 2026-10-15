# XO Club

Angular 20 tic tac toe hosted on Netlify, with a small Node.js + Socket.IO game server running on your laptop. Rooms and moves are kept in server memory; there is no Firebase account or database.

## First-time setup

Install the project dependencies:

```bash
npm install
```

On your laptop, start the game server and leave that terminal open:

```bash
npm run server
```

The server listens on port `3000`. For a quick free public URL, install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run this in a second terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a temporary HTTPS URL ending in `.trycloudflare.com`. Open your Netlify site with that server URL as a query parameter (URL-encode it):

```text
https://YOUR-SITE.netlify.app/?server=https%3A%2F%2FYOUR-TUNNEL.trycloudflare.com
```

Use that same Netlify link on both devices. One player creates a room and shares its six-character room code; the other enters the code and joins. The frontend also accepts a fixed server URL in `src/app/server.config.ts`; after changing it, rebuild and redeploy Netlify.

## Build and deploy the frontend

```bash
npm run build
```

Netlify uses `npm run build` and publishes `dist/xo-room/browser` as configured in `netlify.toml`.

## Laptop server notes

- Keep both `npm run server` and the tunnel running while you play. If the laptop sleeps, disconnects, or the server stops, the game stops responding.
- Quick Tunnel URLs are temporary. If one changes, open the Netlify site with the new `?server=` URL. Rooms are lost when the server restarts.
- Quick Tunnels are meant for development/testing and have no uptime guarantee. For a stable URL, create a named Cloudflare Tunnel with a domain.
