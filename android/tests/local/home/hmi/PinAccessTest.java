package local.home.hmi;

public final class PinAccessTest {
    private static int checks;
    private static void check(boolean result,String name){checks++;if(!result)throw new AssertionError(name);}
    public static void main(String[] args){
        check(PinAccess.validPin("1234"),"Four digits");check(PinAccess.validPin("0012"),"Four digits with leading zeros");
        for(String invalid:new String[]{"","123","12345","123456","1234567","12a4","12 4","１２３４","1234\n"})check(!PinAccess.validPin(invalid),"Reject non-PIN");
        PinAccess access=new PinAccess();check(!access.allows(1000,true,30),"No initial cache");access.verified(1000);
        check(!access.allows(1001,true,0),"Every time does not create a cache");
        for(int seconds:new int[]{30,60,300,600}){check(access.allows(1000+seconds*1000L-1,true,seconds),"Inside grace");check(!access.allows(1000+seconds*1000L,true,seconds),"Exact expiry");}
        check(!access.allows(999,true,600),"Clock cannot move backwards into a cache");check(!access.allows(1001,true,999),"Unsupported grace becomes every time");
        access.openSession();check(access.allows(999999,true,0),"Open service session stays usable");access.closeSession();check(!access.allows(999999,true,0),"Closing ends every-time session");
        access.verified(2000);access.openSession();access.closeSession();check(access.allows(3000,true,60),"Closing retains configured grace");
        access.invalidate();check(!access.allows(3000,true,600),"Changing PIN invalidates cache");check(access.allows(3000,false,0),"Disabled child lock remains accessible");
        System.out.println(checks+" PIN policy checks passed");
    }
}
