"use strict";
const ReserveBaseController_1 = require('../../ReserveBaseController');
const Util_1 = require('../../../../common/Util/Util');
const GMOUtil_1 = require('../../../../common/Util/GMO/GMOUtil');
const reservePerformanceForm_1 = require('../../../forms/Reserve/reservePerformanceForm');
const reserveSeatForm_1 = require('../../../forms/Reserve/reserveSeatForm');
const Models_1 = require('../../../../common/models/Models');
const ReservationUtil_1 = require('../../../../common/models/Reservation/ReservationUtil');
const FilmUtil_1 = require('../../../../common/models/Film/FilmUtil');
const ReservationModel_1 = require('../../../models/Reserve/ReservationModel');
class TelReserveController extends ReserveBaseController_1.default {
    constructor(...args) {
        super(...args);
        this.layout = 'layouts/tel/layout';
    }
    start() {
        // 予約トークンを発行
        let token = Util_1.default.createToken();
        let reservationModel = new ReservationModel_1.default();
        reservationModel.token = token;
        reservationModel.purchaserGroup = ReservationUtil_1.default.PURCHASER_GROUP_TEL;
        reservationModel.purchaserLastName = '';
        reservationModel.purchaserFirstName = '';
        reservationModel.purchaserTel = '';
        reservationModel.purchaserEmail = '';
        // 購入番号発行(確認画面でペイデザイン川にコピーする際に必要になるので、事前に発行しておく)
        this.createPaymentNo((err, paymentNo) => {
            if (err)
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            reservationModel.paymentNo = paymentNo;
            // スケジュール選択へ
            reservationModel.save((err) => {
                this.res.redirect(this.router.build('tel.reserve.performances', { token: token }));
            });
        });
    }
    /**
     * スケジュール選択
     */
    performances() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            if (this.req.method === 'POST') {
                reservePerformanceForm_1.default(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // パフォーマンスFIX
                        this.processFixPerformance(reservationModel, this.req.form['performanceId'], (err, reservationModel) => {
                            if (err) {
                                this.next(err);
                            }
                            else {
                                this.logger.debug('saving reservationModel... ', reservationModel);
                                reservationModel.save((err) => {
                                    this.res.redirect(this.router.build('tel.reserve.seats', { token: token }));
                                });
                            }
                        });
                    }
                    else {
                        this.next(new Error(this.req.__('Message.UnexpectedError')));
                    }
                });
            }
            else {
                // 仮予約あればキャンセルする
                this.processCancelSeats(reservationModel, (err, reservationModel) => {
                    this.logger.debug('saving reservationModel... ', reservationModel);
                    reservationModel.save((err) => {
                        this.res.render('tel/reserve/performances', {
                            FilmUtil: FilmUtil_1.default
                        });
                    });
                });
            }
        });
    }
    /**
     * 座席選択
     */
    seats() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            let limit = 4;
            if (this.req.method === 'POST') {
                reserveSeatForm_1.default(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        let seatCodes = JSON.parse(this.req.form['seatCodes']);
                        // 追加指定席を合わせて制限枚数を超過した場合
                        if (seatCodes.length > limit) {
                            let message = this.req.__('Message.seatsLimit{{limit}}', { limit: limit.toString() });
                            this.res.redirect(`${this.router.build('tel.reserve.seats', { token: token })}?message=${encodeURIComponent(message)}`);
                        }
                        else {
                            // 仮予約あればキャンセルする
                            this.logger.debug('processCancelSeats processing...');
                            this.processCancelSeats(reservationModel, (err, reservationModel) => {
                                this.logger.debug('processCancelSeats processed.', err);
                                // 座席FIX
                                this.processFixSeats(reservationModel, seatCodes, (err, reservationModel) => {
                                    if (err) {
                                        reservationModel.save((err) => {
                                            let message = this.req.__('Mesasge.SelectedSeatsUnavailable');
                                            this.res.redirect(`${this.router.build('tel.reserve.seats', { token: token })}?message=${encodeURIComponent(message)}`);
                                        });
                                    }
                                    else {
                                        reservationModel.save((err) => {
                                            // 券種選択へ
                                            this.res.redirect(this.router.build('tel.reserve.tickets', { token: token }));
                                        });
                                    }
                                });
                            });
                        }
                    }
                    else {
                        this.res.redirect(this.router.build('tel.reserve.seats', { token: token }));
                    }
                });
            }
            else {
                this.res.render('tel/reserve/seats', {
                    reservationModel: reservationModel,
                    limit: limit
                });
            }
        });
    }
    /**
     * 券種選択
     */
    tickets() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            reservationModel.paymentMethod = null;
            if (this.req.method === 'POST') {
                this.processFixTickets(reservationModel, (err, reservationModel) => {
                    if (err) {
                        this.res.redirect(this.router.build('tel.reserve.tickets', { token: token }));
                    }
                    else {
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('tel.reserve.profile', { token: token }));
                        });
                    }
                });
            }
            else {
                this.res.render('tel/reserve/tickets', {
                    reservationModel: reservationModel,
                });
            }
        });
    }
    /**
     * 購入者情報
     */
    profile() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            if (this.req.method === 'POST') {
                this.processFixProfile(reservationModel, (err, reservationModel) => {
                    if (err) {
                        this.res.render('tel/reserve/profile', {
                            reservationModel: reservationModel
                        });
                    }
                    else {
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('tel.reserve.confirm', { token: token }));
                        });
                    }
                });
            }
            else {
                // セッションに情報があれば、フォーム初期値設定
                let email = reservationModel.purchaserEmail;
                this.res.locals.lastName = (reservationModel.purchaserLastName) ? reservationModel.purchaserLastName : '';
                this.res.locals.firstName = (reservationModel.purchaserFirstName) ? reservationModel.purchaserFirstName : '';
                this.res.locals.tel = (reservationModel.purchaserTel) ? reservationModel.purchaserTel : '';
                this.res.locals.email = (email) ? email : '';
                this.res.locals.emailConfirm = (email) ? email.substr(0, email.indexOf('@')) : '';
                this.res.locals.emailConfirmDomain = (email) ? email.substr(email.indexOf('@') + 1) : '';
                this.res.locals.paymentMethod = (reservationModel.paymentMethod) ? reservationModel.paymentMethod : GMOUtil_1.default.PAY_TYPE_CVS;
                this.res.render('tel/reserve/profile', {
                    reservationModel: reservationModel
                });
            }
        });
    }
    /**
     * 予約内容確認
     */
    confirm() {
        let token = this.req.params.token;
        ReservationModel_1.default.find(token, (err, reservationModel) => {
            if (err)
                return this.next(new Error(this.req.__('Message.Expired')));
            if (this.req.method === 'POST') {
                this.processConfirm(reservationModel, (err, reservationModel) => {
                    if (err) {
                        let message = err.message;
                        this.res.redirect(`${this.router.build('tel.reserve.confirm', { token: token })}?message=${encodeURIComponent(message)}`);
                    }
                    else {
                        // 予約確定
                        Models_1.default.Reservation.update({
                            payment_no: reservationModel.paymentNo
                        }, {
                            status: ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT_PAY_DESIGN
                        }, {
                            multi: true
                        }, (err, raw) => {
                            if (err) {
                                let message = err.message;
                                this.res.redirect(`${this.router.build('tel.reserve.confirm', { token: token })}?message=${encodeURIComponent(message)}`);
                            }
                            else {
                                reservationModel.remove((err) => {
                                    this.logger.info('redirecting to complete...');
                                    this.res.redirect(this.router.build('tel.reserve.complete', { paymentNo: reservationModel.paymentNo }));
                                });
                            }
                        });
                    }
                });
            }
            else {
                this.res.render('tel/reserve/confirm', {
                    reservationModel: reservationModel
                });
            }
        });
    }
    /**
     * 予約完了
     */
    complete() {
        let paymentNo = this.req.params.paymentNo;
        Models_1.default.Reservation.find({
            payment_no: paymentNo,
            status: ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT_PAY_DESIGN,
            tel_staff: this.req.telStaffUser.get('_id')
        }, (err, reservationDocuments) => {
            if (err)
                return this.next(new Error(this.req.__('Message.UnexpectedError')));
            if (reservationDocuments.length === 0)
                return this.next(new Error(this.req.__('Message.NotFound')));
            this.res.render('tel/reserve/complete', {
                reservationDocuments: reservationDocuments
            });
        });
    }
}
TelReserveController.RESERVATION_LIMIT_PER_PERFORMANCE = 4; // パフォーマンスあたりの最大座席確保枚数
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TelReserveController;
