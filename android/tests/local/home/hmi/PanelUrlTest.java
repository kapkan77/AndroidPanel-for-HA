package local.home.hmi;

public class PanelUrlTest {
    private static int checks;
    private static void check(boolean result, String message) {
        checks++;
        if (!result) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        for(String value:new String[]{"http://ha.local:8123/panel/room", "https://example.org/panels/one", "http://[::1]:8123/", " https://example.org/ "}) {
            check(PanelUrl.normalize(value)!=null,"Accept normal address");
        }
        for(String value:new String[]{"", "ha.local", "javascript:alert(1)", "file:///etc/passwd", "http://", "http://user:pass@example.org", "http://user@example.org", "http://example.org:65536", "http://example.org:0", "http://example.org:-2", "http://example.org/a b", "http://good.example\\@bad.example/"}) {
            check(PanelUrl.normalize(value)==null,"Reject unsafe or malformed address: "+value);
        }
        check(PanelUrl.normalize(null)==null,"Null is not configured");
        check("https://example.org/".equals(PanelUrl.normalize(" https://example.org/ ")),"Trim only outer whitespace");
        System.out.println(checks+" URL validation checks passed.");
    }
}
