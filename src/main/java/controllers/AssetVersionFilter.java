package controllers;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.ext.Provider;

import java.io.IOException;
import java.util.regex.Pattern;

// Static assets are served with Cache-Control: public, immutable, max-age=86400, so a CDN
// (Cloudflare) or browser keeps serving old scripts and stylesheets after a deployment,
// even though the pages that use them are new. Adding a version that changes with every
// start of the app to the asset URLs in generated pages makes each deployment fetch fresh copies.

@Provider
public class AssetVersionFilter implements ContainerResponseFilter {
    private static final String VERSION = Long.toString(System.currentTimeMillis(), 36);
    // src="/assets/x.js" or href='.../assets/x.css', without a query or fragment already
    private static final Pattern ASSET_URL = Pattern.compile("((?:src|href)=([\"'])[^\"'?#]*/assets/[^\"'?#]+)(\\2)");

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext) throws IOException {
        if (!(responseContext.getEntity() instanceof String html)) return;
        // The media type from @Produces may not be set yet when filters run
        MediaType mediaType = responseContext.getMediaType();
        boolean isHTML = mediaType != null ? mediaType.isCompatible(MediaType.TEXT_HTML_TYPE)
            : html.contains("<html");
        if (isHTML)
            responseContext.setEntity(ASSET_URL.matcher(html).replaceAll("$1?v=" + VERSION + "$3"));
    }
}
