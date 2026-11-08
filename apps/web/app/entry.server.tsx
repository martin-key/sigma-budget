// The document is sent whole, never streamed in parts: a screen is drawn in its loader, and crawlers and the browser part
// (apps/web/client/main.js) read the finished HTML.
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { renderToReadableStream } from 'react-dom/server';

export default async function handleRequest(request: Request, status: number, headers: Headers, routerContext: EntryContext) {
  let failed = false;
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    onError(e: unknown) { failed = true; console.error(e); },
  });
  await body.allReady;
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { status: failed ? 500 : status, headers });
}
