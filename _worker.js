export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "airgem.pages.dev") {
      url.hostname = "airgem.app";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
