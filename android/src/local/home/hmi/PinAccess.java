package local.home.hmi;

/** Local PIN policy; the grace window is measured from successful verification. */
final class PinAccess {
    static final int PIN_LENGTH=4;
    private long authenticatedAt = -1;
    private boolean sessionOpen;

    static boolean validPin(String value) {
        if(value==null || value.length()!=PIN_LENGTH)return false;
        for(int i=0;i<value.length();i++)if(value.charAt(i)<'0'||value.charAt(i)>'9')return false;
        return true;
    }
    static int graceSeconds(int value) {
        return value==30 || value==60 || value==300 || value==600 ? value : 0;
    }
    boolean allows(long now, boolean locked, int grace) {
        return !locked || sessionOpen || (authenticatedAt>=0 && graceSeconds(grace)>0 && now>=authenticatedAt && now-authenticatedAt<graceSeconds(grace)*1000L);
    }
    void verified(long now) {authenticatedAt=now;}
    void openSession() {sessionOpen=true;}
    void closeSession() {sessionOpen=false;}
    void invalidate() {authenticatedAt=-1;sessionOpen=false;}
}
