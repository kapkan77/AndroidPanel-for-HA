package local.home.hmi;

import java.net.URI;
import java.net.URISyntaxException;

/** Validates setup input without accepting embedded login credentials. */
final class PanelUrl {
    static String normalize(String value) {
        if (value == null) return null;
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getPort() < -1 || uri.getPort() == 0 || uri.getPort() > 65535) return null;
            return uri.toASCIIString();
        } catch (URISyntaxException error) {
            return null;
        }
    }
}
