# Deploying

`npm run build` writes a static site to `dist/`. Serve it over HTTPS (the camera requires a secure
context) from the site root (`/`, the PWA scope).

## Content-Security-Policy

The CSP is defined once in `csp.ts`. The page also carries it as a `<meta http-equiv>` tag, but a
meta CSP only governs the page itself: dedicated workers (OpenCV, Tesseract) and the service worker
get their policy from the **response header** of their own script. Send the header on every path.

### Netlify / Cloudflare Pages

Nothing to do: the build emits `dist/_headers` (generated from `csp.ts` by `build/cspHeaders.ts`),
which both hosts read:

```
/*
  Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'
```

### nginx

```nginx
server {
    # ...
    root /path/to/dist;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" always;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`add_header` is not inherited by a `location` block that declares its own `add_header`; repeat it
there if you add one. Keep the value identical to `CSP` in `csp.ts`.

### Hosts without custom headers (e.g. GitHub Pages)

Only the page's meta CSP applies. The page is still protected, but the workers and the service
worker run without a CSP.
