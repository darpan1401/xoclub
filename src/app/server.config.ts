// Option 1: hard-code your tunnel URL here and rebuild Angular.
export const SOCKET_SERVER_URL = '';

// Option 2: open the Netlify site with ?server=https%3A%2F%2Fyour-tunnel.trycloudflare.com.
// This keeps quick-tunnel URL changes from requiring a new Netlify deployment.
export function getSocketServerUrl(): string {
  const queryUrl = new URLSearchParams(window.location.search).get('server');
  if (queryUrl) return queryUrl;
  return SOCKET_SERVER_URL || 'http://localhost:3000';
}
