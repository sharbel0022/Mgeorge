import documents from '@/lib/legal-documents.json';

// Public information page: no workspace lookup or user identity is required.
export function GET() {
  return new Response(documents['anvandarvillkor'], {headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }});
}
