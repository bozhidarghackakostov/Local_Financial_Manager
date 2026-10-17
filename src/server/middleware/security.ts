import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/index.ts';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function securityMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Verify Host header to prevent DNS rebinding attacks
  const rawHost = req.headers.host;
  if (rawHost) {
    const hostname = rawHost.split(':')[0].toLowerCase();
    if (!ALLOWED_HOSTS.has(hostname)) {
      next(new ForbiddenError('Request rejected: untrusted Host header'));
      return;
    }
  }

  // Verify Origin header on state-changing requests to block Cross-Site Request Forgery from external sites
  const mutatingMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
  if (mutatingMethods.has(req.method.toUpperCase())) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        if (!ALLOWED_HOSTS.has(parsedOrigin.hostname.toLowerCase())) {
          next(new ForbiddenError('Request rejected: cross-origin requests are not permitted'));
          return;
        }
      } catch {
        next(new ForbiddenError('Request rejected: malformed Origin header'));
        return;
      }
    }
  }

  next();
}
