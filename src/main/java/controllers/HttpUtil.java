package controllers;

import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.UriInfo;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.Map;

public class HttpUtil {
    public static String absolutePath(UriInfo uriInfo,  HttpHeaders headers) {
        URI uri = uriInfo.getRequestUri();
        if (headers.getRequestHeader("X-Forwarded-Proto").contains("https")) { // TODO: This was needed with Play. Ist it still needed?
            try {
                uri = new URI("https", uri.getUserInfo(), uri.getHost(), uri.getPort(), uri.getPath(), uri.getQuery(), uri.getFragment());
            } catch (URISyntaxException e) {
                throw new RuntimeException(e);
            }
        }
        return uri.toString();
    }

    public static String prefix(UriInfo uriInfo,  HttpHeaders headers) {
        URI uri = uriInfo.getBaseUri();
        boolean secure = uri.getScheme().equals("https") ||
                headers.getRequestHeader("X-Forwarded-Proto").contains("https"); // TODO: This was needed with Play. Ist it still needed?
        String host = uri.getHost();
        String path = uriInfo.getPath();

        String prefix;
        if (host.equals("localhost")) {
            prefix = "../";
            long countSlash = path.chars().filter(ch -> ch == '/').count() - 1;
            for (long i = 0; i < countSlash; ++i) {
                prefix += "../";
            }
            prefix = prefix.substring(0, prefix.length() - 1);
        } else {
            // Only add an explicit port when connected to directly (no reverse proxy in
            // front): behind a proxy (Railway, etc.) the internal port isn't the public
            // one, and X-Forwarded-Proto being present is evidence of exactly that.
            boolean behindProxy = !headers.getRequestHeader("X-Forwarded-Proto").isEmpty();
            int port = uri.getPort();
            String portSuffix = "";
            if (!behindProxy && port != -1 && !((secure && port == 443) || (!secure && port == 80))) {
                portSuffix = ":" + port;
            }
            prefix = (secure ? "https://" : "http://") + host + portSuffix;
        }
        return prefix;
    }

    public static NewCookie buildCookie(String name, String value) {
        return new NewCookie.Builder(name)
                .value(value)
                .path("/")
                .maxAge(60 * 60 * 24 * 180) // 180 days TODO Even for jwt???
                .secure(true)
                .sameSite(NewCookie.SameSite.NONE)
                .httpOnly(true)
                .build();
    }

    public static NewCookie expireCookie(String name) {
        return new NewCookie.Builder(name)
                .value("")
                .path("/")
                .maxAge(0)
                .secure(true)
                .sameSite(NewCookie.SameSite.NONE)
                .httpOnly(true)
                .build();
    }

    // TODO: Fix so that it works for repeated keys
    static Map<String, String[]> paramsMap(MultivaluedMap<String, String> formParams) {
        Map<String, String[]> postParams = new HashMap<>();
        for (var entry : formParams.entrySet()) {
            postParams.put(entry.getKey(), entry.getValue().toArray(new String[0]));
        }
        return postParams;
    }
}
