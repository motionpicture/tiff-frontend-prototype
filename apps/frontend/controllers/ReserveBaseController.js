"use strict";
const BaseController_1 = require('./BaseController');
const Util_1 = require('../../common/Util/Util');
const GMOUtil_1 = require('../../common/Util/GMO/GMOUtil');
const ReservationUtil_1 = require('../../common/models/Reservation/ReservationUtil');
const TicketTypeGroupUtil_1 = require('../../common/models/TicketTypeGroup/TicketTypeGroupUtil');
const Models_1 = require('../../common/models/Models');
const moment = require('moment');
const fs = require('fs-extra');
const reserveTicketForm_1 = require('../forms/Reserve/reserveTicketForm');
const reserveProfileForm_1 = require('../forms/Reserve/reserveProfileForm');
/**
 * 予約フローベースコントローラー
 */
class ReserveBaseController extends BaseController_1.default {
    constructor(req, res, next) {
        super(req, res, next);
        this.res.locals.GMOUtil = GMOUtil_1.default;
        this.res.locals.ReservationUtil = ReservationUtil_1.default;
    }
    /**
     * 予約フロー中の座席をキャンセルするプロセス
     *
     * @param {ReservationModel} reservationModel
     */
    processCancelSeats(reservationModel, cb) {
        let seatCodesInSession = (reservationModel.seatCodes) ? reservationModel.seatCodes : [];
        if (seatCodesInSession.length === 0) {
            return cb(null, reservationModel);
        }
        // セッション中の予約リストを初期化
        reservationModel.seatCodes = [];
        // 仮予約を空席ステータスに戻す
        this.logger.debug('removing reservations... seatCodes:', seatCodesInSession);
        Models_1.default.Reservation.remove({
            performance: reservationModel.performance._id,
            seat_code: { $in: seatCodesInSession },
            status: ReservationUtil_1.default.STATUS_TEMPORARY
        }, (err) => {
            // 失敗したとしても時間経過で消えるので放置
            if (err) {
                cb(err, reservationModel);
            }
            else {
                cb(null, reservationModel);
            }
        });
    }
    /**
     * パフォーマンスをFIXするプロセス
     * パフォーマンスIDから、パフォーマンスを検索し、その後プロセスに必要な情報をreservationModelに追加する
     */
    processFixPerformance(reservationModel, perfomanceId, cb) {
        // パフォーマンス取得
        this.logger.debug('searching performance... id:', perfomanceId);
        Models_1.default.Performance.findOne({
            _id: perfomanceId
        }, 'day start_time end_time is_mx4d film screen theater' // 必要な項目だけ指定すること
        )
            .populate('film', 'name name_en ticket_type_group image') // 必要な項目だけ指定すること
            .populate('screen', 'name name_en sections') // 必要な項目だけ指定すること
            .populate('theater', 'name name_en') // 必要な項目だけ指定すること
            .exec((err, performanceDocument) => {
            if (err) {
                cb(err, reservationModel);
            }
            else {
                // 内部以外は、上映開始20分過ぎていたらはじく
                if (reservationModel.purchaserGroup !== ReservationUtil_1.default.PURCHASER_GROUP_STAFF) {
                    let now = moment().add(-20, 'minutes');
                    if (performanceDocument.get('day') === now.format('YYYYMMDD')) {
                        if (performanceDocument.get('start') < now.format('HHmm')) {
                            return cb(new Error('You cannot reserve this performance.'), reservationModel);
                        }
                    }
                    else if (performanceDocument.get('day') < now.format('YYYYMMDD')) {
                        return cb(new Error('You cannot reserve this performance.'), reservationModel);
                    }
                }
                // 券種取得
                Models_1.default.TicketTypeGroup.findOne({
                    _id: performanceDocument.get('film').get('ticket_type_group')
                }, (err, ticketTypeGroupDocument) => {
                    reservationModel.seatCodes = [];
                    // 券種リストは、予約する主体によって異なる
                    // 内部関係者の場合
                    let group = reservationModel.purchaserGroup;
                    switch (group) {
                        case ReservationUtil_1.default.PURCHASER_GROUP_STAFF:
                            reservationModel.ticketTypes = TicketTypeGroupUtil_1.default.getOne4staff();
                            break;
                        case ReservationUtil_1.default.PURCHASER_GROUP_SPONSOR:
                            reservationModel.ticketTypes = TicketTypeGroupUtil_1.default.getOne4sponsor();
                            break;
                        case ReservationUtil_1.default.PURCHASER_GROUP_MEMBER:
                            // メルマガ当選者の場合、一般だけ
                            reservationModel.ticketTypes = [];
                            for (let ticketType of ticketTypeGroupDocument.get('types')) {
                                if (ticketType.get('code') === TicketTypeGroupUtil_1.default.TICKET_TYPE_CODE_ADULTS) {
                                    reservationModel.ticketTypes.push(ticketType);
                                }
                            }
                            break;
                        default:
                            // 一般、当日窓口、電話予約の場合
                            reservationModel.ticketTypes = [];
                            for (let ticketType of ticketTypeGroupDocument.get('types')) {
                                switch (ticketType.get('code')) {
                                    // 学生当日は、当日だけ
                                    case TicketTypeGroupUtil_1.default.TICKET_TYPE_CODE_STUDENTS_ON_THE_DAY:
                                        if (moment().format('YYYYMMDD') === performanceDocument.get('day')) {
                                            reservationModel.ticketTypes.push(ticketType);
                                        }
                                        break;
                                    case TicketTypeGroupUtil_1.default.TICKET_TYPE_CODE_STUDENTS:
                                        if (moment().format('YYYYMMDD') !== performanceDocument.get('day')) {
                                            reservationModel.ticketTypes.push(ticketType);
                                        }
                                        break;
                                    default:
                                        reservationModel.ticketTypes.push(ticketType);
                                        break;
                                }
                            }
                            break;
                    }
                    // パフォーマンス情報を保管
                    reservationModel.performance = {
                        _id: performanceDocument.get('_id'),
                        day: performanceDocument.get('day'),
                        start_time: performanceDocument.get('start_time'),
                        end_time: performanceDocument.get('end_time'),
                        is_mx4d: performanceDocument.get('is_mx4d'),
                        theater: {
                            _id: performanceDocument.get('theater').get('_id'),
                            name: performanceDocument.get('theater').get('name'),
                            name_en: performanceDocument.get('theater').get('name_en'),
                        },
                        screen: {
                            _id: performanceDocument.get('screen').get('_id'),
                            name: performanceDocument.get('screen').get('name'),
                            name_en: performanceDocument.get('screen').get('name_en'),
                            sections: performanceDocument.get('screen').get('sections'),
                        },
                        film: {
                            _id: performanceDocument.get('film').get('_id'),
                            name: performanceDocument.get('film').get('name'),
                            name_en: performanceDocument.get('film').get('name_en'),
                            image: performanceDocument.get('film').get('image')
                        }
                    };
                    // スクリーン座席表HTMLを保管(apiで取得)
                    // TODO ひとまず固定だが、最終的にはパフォーマンスに応じて適切なスクリーンを入れる
                    fs.readFile(`${__dirname}/../../common/views/screens/map.ejs`, 'utf8', (err, data) => {
                        if (err) {
                            cb(err, reservationModel);
                        }
                        else {
                            reservationModel.screenHtml = data;
                            cb(null, reservationModel);
                        }
                    });
                });
            }
        });
    }
    /**
     * 座席をFIXするプロセス
     * 新規仮予約 ここが今回の肝です！！！
     *
     * @param {ReservationModel} reservationModel
     * @param {Array<string>} seatCodes
     */
    processFixSeats(reservationModel, seatCodes, cb) {
        let promises = [];
        let purchaserGroup = reservationModel.purchaserGroup;
        // セッション中の予約リストを初期化
        reservationModel.seatCodes = [];
        // 新たな座席指定と、既に仮予約済みの座席コードについて
        seatCodes.forEach((seatCode) => {
            promises.push(new Promise((resolve, reject) => {
                let seatInfo = reservationModel.performance.screen.sections[0].seats.find((seat) => {
                    return (seat.code === seatCode);
                });
                // 万が一、座席が存在しなかったら
                if (!seatInfo) {
                    return reject(new Error(this.req.__('Message.InvalidSeatCode')));
                }
                else {
                    let newReservation = {
                        performance: reservationModel.performance._id,
                        seat_code: seatCode,
                        status: ReservationUtil_1.default.STATUS_TEMPORARY,
                        mvtk_kiin_cd: (purchaserGroup === ReservationUtil_1.default.PURCHASER_GROUP_CUSTOMER) ? this.req.mvtkUser.get('memberInfoResult').kiinCd : undefined,
                        staff: (purchaserGroup === ReservationUtil_1.default.PURCHASER_GROUP_STAFF) ? this.req.staffUser.get('_id') : undefined,
                        sponsor: (purchaserGroup === ReservationUtil_1.default.PURCHASER_GROUP_SPONSOR) ? this.req.sponsorUser.get('_id') : undefined,
                        member: (purchaserGroup === ReservationUtil_1.default.PURCHASER_GROUP_MEMBER) ? this.req.memberUser.get('_id') : undefined,
                    };
                    // 予約データを作成(同時作成しようとしたり、既に予約があったとしても、unique indexではじかれる)
                    this.logger.debug('creating reservation... seat_code:', seatCode);
                    Models_1.default.Reservation.create(newReservation, (err, reservationDocument) => {
                        this.logger.debug('reservation created.', err, reservationDocument);
                        if (err) {
                            reject(err);
                        }
                        else {
                            // ステータス更新に成功したらセッションに保管
                            reservationModel.seatCodes.push(seatCode);
                            reservationModel.setReservation(seatCode, {
                                _id: reservationDocument.get('_id'),
                                status: reservationDocument.get('status'),
                                seat_code: reservationDocument.get('seat_code'),
                                seat_grade_name: seatInfo.grade.name,
                                seat_grade_name_en: seatInfo.grade.name_en,
                                seat_grade_additional_charge: seatInfo.grade.additional_charge,
                            });
                            resolve();
                        }
                    });
                }
            }));
        });
        Promise.all(promises).then(() => {
            cb(null, reservationModel);
        }, (err) => {
            cb(err, reservationModel);
        });
    }
    /**
     * 券種FIXプロセス
     */
    processFixTickets(reservationModel, cb) {
        reserveTicketForm_1.default(this.req, this.res, (err) => {
            if (this.req.form.isValid) {
                // 座席選択情報を保存して座席選択へ
                let choices = JSON.parse(this.req.form['choices']);
                if (Array.isArray(choices)) {
                    choices.forEach((choice) => {
                        let ticketType = reservationModel.ticketTypes.find((ticketType) => {
                            return (ticketType.code === choice.ticket_type_code);
                        });
                        if (!ticketType) {
                            return cb(new Error(this.req.__('Message.UnexpectedError')), reservationModel);
                        }
                        let reservation = reservationModel.getReservation(choice.seat_code);
                        reservation.ticket_type_code = ticketType.code;
                        reservation.ticket_type_name = ticketType.name;
                        reservation.ticket_type_name_en = ticketType.name_en;
                        reservation.ticket_type_charge = ticketType.charge;
                        reservation.watcher_name = choice.watcher_name;
                        reservationModel.setReservation(reservation._id, reservation);
                    });
                    cb(null, reservationModel);
                }
                else {
                    cb(new Error(this.req.__('Message.UnexpectedError')), reservationModel);
                }
            }
            else {
                cb(new Error(this.req.__('Message.UnexpectedError')), reservationModel);
            }
        });
    }
    /**
     * 券種FIXプロセス
     */
    processFixProfile(reservationModel, cb) {
        let form = reserveProfileForm_1.default(this.req);
        form(this.req, this.res, (err) => {
            if (err)
                return cb(new Error('Message.UnexpectedError'), reservationModel);
            if (this.req.form.isValid) {
                // 購入者情報を保存して座席選択へ
                reservationModel.purchaserLastName = this.req.form['lastName'];
                reservationModel.purchaserFirstName = this.req.form['firstName'];
                reservationModel.purchaserEmail = this.req.form['email'];
                reservationModel.purchaserTel = this.req.form['tel'];
                reservationModel.paymentMethod = this.req.form['paymentMethod'];
                // TODO メルマガの場合強制的にクレジット
                // TODO 電話の場合強制的にコンビニ
                // TODO 内部と外部の場合、決済方法は空
                // TODO ユーザーセッションにプローフィール格納
                // this.req.sponsorUser.profile = {
                //     last_name: this.req.form['lastName'],
                //     first_name: this.req.form['firstName'],
                //     email: this.req.form['email'],
                //     tel: this.req.form['tel']
                // };
                // this.req.session[SponsorUser.AUTH_SESSION_NAME] = this.req.sponsorUser;
                cb(null, reservationModel);
            }
            else {
                cb(new Error('Message.Invalid'), reservationModel);
            }
        });
    }
    /**
     * 予約情報を確定してDBに保存するプロセス
     */
    processConfirm(reservationModel, cb) {
        // 購入番号発行
        let next = (reservationModel) => {
            // 予約プロセス固有のログファイルをセット
            this.setProcessLogger(reservationModel.paymentNo, () => {
                this.logger.info('paymentNo published. paymentNo:', reservationModel.paymentNo);
                let commonUpdate = {};
                switch (reservationModel.purchaserGroup) {
                    case ReservationUtil_1.default.PURCHASER_GROUP_CUSTOMER:
                        commonUpdate['mvtk_kiin_cd'] = this.req.mvtkUser.get('memberInfoResult').kiinCd;
                        break;
                    case ReservationUtil_1.default.PURCHASER_GROUP_MEMBER:
                        commonUpdate['member'] = this.req.memberUser.get('_id');
                        commonUpdate['member_user_id'] = this.req.memberUser.get('user_id');
                        break;
                    case ReservationUtil_1.default.PURCHASER_GROUP_SPONSOR:
                        commonUpdate['sponsor'] = this.req.sponsorUser.get('_id');
                        commonUpdate['sponsor_user_id'] = this.req.sponsorUser.get('user_id');
                        commonUpdate['sponsor_name'] = this.req.sponsorUser.get('name');
                        break;
                    case ReservationUtil_1.default.PURCHASER_GROUP_STAFF:
                        commonUpdate['staff'] = this.req.staffUser.get('_id');
                        commonUpdate['staff_user_id'] = this.req.staffUser.get('user_id');
                        commonUpdate['staff_name'] = this.req.staffUser.get('name');
                        commonUpdate['staff_email'] = this.req.staffUser.get('email');
                        commonUpdate['staff_tel'] = this.req.staffUser.get('tel');
                        commonUpdate['staff_signature'] = this.req.staffUser.get('signature');
                        break;
                    case ReservationUtil_1.default.PURCHASER_GROUP_TEL:
                        commonUpdate['status'] = ReservationUtil_1.default.STATUS_WAITING_SETTLEMENT_PAY_DESIGN;
                        commonUpdate['tel_staff'] = this.req.telStaffUser.get('_id');
                        commonUpdate['tel_staff_user_id'] = this.req.telStaffUser.get('user_id');
                        break;
                    case ReservationUtil_1.default.PURCHASER_GROUP_WINDOW:
                        commonUpdate['window'] = this.req.windowUser.get('_id');
                        commonUpdate['window_user_id'] = this.req.windowUser.get('user_id');
                        break;
                    default:
                        cb(new Error(this.req.__('Message.UnexpectedError')), reservationModel);
                        break;
                }
                // いったん全情報をDBに保存
                let promises = [];
                let reservationDocuments4update = reservationModel.toReservationDocuments();
                for (let reservationDocument4update of reservationDocuments4update) {
                    reservationDocument4update = Object.assign(reservationDocument4update, commonUpdate);
                    promises.push(new Promise((resolve, reject) => {
                        this.logger.info('updating reservation all infos..._id:', reservationDocument4update['_id']);
                        Models_1.default.Reservation.update({
                            _id: reservationDocument4update['_id']
                        }, reservationDocument4update, (err, raw) => {
                            this.logger.info('reservation updated.', err, raw);
                            if (err) {
                                reject(new Error(this.req.__('Message.UnexpectedError')));
                            }
                            else {
                                resolve();
                            }
                        });
                    }));
                }
                ;
                Promise.all(promises).then(() => {
                    cb(null, reservationModel);
                }, (err) => {
                    cb(err, reservationModel);
                });
            });
        };
        if (reservationModel.paymentNo) {
            next(reservationModel);
        }
        else {
            this.createPaymentNo((err, paymentNo) => {
                if (err) {
                    cb(new Error(this.req.__('Message.UnexpectedError')), reservationModel);
                }
                else {
                    reservationModel.paymentNo = paymentNo;
                    next(reservationModel);
                }
            });
        }
    }
    /**
     * 購入番号から全ての予約を完了にする
     *
     * @param {string} paymentNo 購入番号
     * @param {Object} update 追加更新パラメータ
     */
    processFixReservations(paymentNo, update, cb) {
        update['status'] = ReservationUtil_1.default.STATUS_RESERVED;
        update['purchased_at'] = Date.now();
        update['updated_user'] = 'ReserveBaseController';
        // 予約完了ステータスへ変更
        this.logger.info('updating reservations by paymentNo...', paymentNo, update);
        Models_1.default.Reservation.update({
            payment_no: paymentNo
        }, update, {
            multi: true
        }, (err, raw) => {
            this.logger.info('reservations updated.', err, raw);
            if (err) {
                cb(new Error('any reservations not updated.'));
            }
            else {
                // 完了メールキューがあれば何も更新しないし、なければ追加する
                this.logger.info('creating reservationEmailCue...');
                Models_1.default.ReservationEmailCue.create({
                    payment_no: paymentNo,
                    is_sent: false
                }, (err, cueDocument) => {
                    this.logger.info('reservationEmailCue created.', err, cueDocument);
                    if (err) {
                    }
                    cb(null);
                });
            }
        });
    }
    /**
     * 予約プロセス用のロガーを設定する
     * 1決済管理番号につき、1ログファイル
     *
     * @param {string} paymentNo 予約番号
     */
    setProcessLogger(paymentNo, cb) {
        Util_1.default.getReservationLogger(paymentNo, (err, logger) => {
            if (err) {
            }
            else {
                this.logger = logger;
            }
            cb();
        });
    }
    /**
     * 購入管理番号生成
     */
    createPaymentNo(cb) {
        Models_1.default.Sequence.findOneAndUpdate({
            target: 'payment_no'
        }, {
            $inc: {
                no: 1
            }
        }, {
            new: true
        }, (err, sequenceDocument) => {
            if (err) {
                cb(err, null);
            }
            else {
                let no = sequenceDocument.get('no');
                let paymentNo = `${no}${Util_1.default.getCheckDigit(no)}`;
                cb(err, paymentNo);
            }
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ReserveBaseController;
