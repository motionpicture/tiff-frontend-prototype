/**
 * GMOペイメントユーティリティ
 */
export default class GMOUtil {
    public static PAY_TYPE_CREDIT = '0';
    public static PAY_TYPE_CVS   = '3';


    public static STATUS_CVS_UNPROCESSED = 'UNPROCESSED'; // 未決済
    public static STATUS_CVS_REQSUCCESS = 'REQSUCCESS'; // 要求成功
    public static STATUS_CVS_PAYSUCCESS = 'PAYSUCCESS'; // 決済完了
    public static STATUS_CVS_PAYFAIL = 'PAYFAIL'; // 決済失敗
    public static STATUS_CVS_EXPIRED = 'EXPIRED'; // 期限切れ
    public static STATUS_CVS_CANCEL = 'CANCEL'; // 支払い停止

    public static STATUS_CREDIT_UNPROCESSED = 'UNPROCESSED'; // 未決済
    public static STATUS_CREDIT_AUTHENTICATED = 'AUTHENTICATED'; // 未決済(3D 登録済)
    public static STATUS_CREDIT_CHECK = 'CHECK'; // 有効性チェック
    public static STATUS_CREDIT_CAPTURE = 'CAPTURE'; // 即時売上
    public static STATUS_CREDIT_AUTH = 'AUTH'; // 仮売上
    public static STATUS_CREDIT_SALES = 'SALES'; // 実売上
    public static STATUS_CREDIT_VOID = 'VOID'; // 取消
    public static STATUS_CREDIT_RETURN = 'RETURN'; // 返品
    public static STATUS_CREDIT_RETURNX = 'RETURNX'; // 月跨り返品
    public static STATUS_CREDIT_SAUTH = 'SAUTH'; // 簡易オーソリ

}
