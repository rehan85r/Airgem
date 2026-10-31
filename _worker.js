export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Keep the custom domain as the canonical host.
    if (url.hostname === "airgem.pages.dev") {
      url.hostname = "airgem.app";
      return Response.redirect(url.toString(), 301);
    }

    // Serve the admin page at /admin without changing the browser URL.
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      url.pathname = "/admin.html";
    }

    const response = await env.ASSETS.fetch(new Request(url, request));
    const secured = new Response(response.body, response);

    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("X-Frame-Options", "DENY");
    secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    secured.headers.set("Strict-Transport-Security", "max-age=31536000");
    secured.headers.set(
      "Content-Security-Policy",
      "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests"
    );

    if (url.pathname === "/admin.html") {
      secured.headers.set("Cache-Control", "no-store");
    }

    return secured;
  },
};
