import BaseController from './BaseController';
import Util from '../../common/Util/Util';
import Models from '../../common/models/Models';
import ReservationUtil from '../../common/models/Reservation/ReservationUtil';
import TicketTypeGroupUtil from '../../common/models/TicketTypeGroup/TicketTypeGroupUtil';
import ReservationModel from '../models/Reserve/ReservationModel';
import moment = require('moment');
import fs = require('fs-extra');

/**
 * 予約フローベースコントローラー
 */
export default class ReserveBaseController extends BaseController {
    /**
     * 予約フロー中の座席をキャンセルするプロセス
     * 
     * @param {ReservationModel} reservationModel
     */
    protected processCancelSeats(reservationModel: ReservationModel, cb: (err: Error, reservationModel: ReservationModel) => void) {
        let seatCodesInSession = (reservationModel.seatCodes) ? reservationModel.seatCodes : [];
        let promises = [];

        // セッション中の予約リストを初期化
        reservationModel.seatCodes = [];

        // 仮予約を空席ステータスに戻す
        seatCodesInSession.forEach((seatCodeInSession) => {
            promises.push(new Promise((resolve, reject) => {
                this.logger.debug('removing reservation... seat_code:', seatCodeInSession);
                Models.Reservation.remove(
                    {
                        performance: reservationModel.performance._id,
                        seat_code: seatCodeInSession,
                        status: ReservationUtil.STATUS_TEMPORARY
                    },
                    (err) => {
                        // 失敗したとしても時間経過で消えるので放置
                        if (err) {
                        }

                        resolve();
                    }
                );

            }));
        });

        Promise.all(promises).then(() => {
            cb(null, reservationModel);

        }, (err) => {
            cb(err, reservationModel);

        });

    }

    /**
     * パフォーマンスをFIXするプロセス
     * パフォーマンスIDから、パフォーマンスを検索し、その後プロセスに必要な情報をreservationModelに追加する
     */
    protected processFixPerformance(reservationModel: ReservationModel, perfomanceId: string, cb: (err: Error, reservationModel: ReservationModel) => void) {

        // パフォーマンス取得
        this.logger.debug('searching performance... id:', perfomanceId);
        Models.Performance.findOne(
            {
                _id: perfomanceId
            },
            'day start_time end_time is_mx4d film screen theater' // 必要な項目だけ指定すること
        )
        .populate('film', 'name name_en ticket_type_group image') // 必要な項目だけ指定すること
        .populate('screen', 'name name_en sections') // 必要な項目だけ指定すること
        .populate('theater', 'name name_en') // 必要な項目だけ指定すること
        .exec((err, performanceDocument) => {

            if (err) {
                cb(err, reservationModel);
            } else {

                // 内部以外は、上映開始20分過ぎていたらはじく
                if (reservationModel.purchaserGroup !== ReservationUtil.PURCHASER_GROUP_STAFF) {
                    let now = moment().add(-20, 'minutes');
                    if (performanceDocument.get('day') === now.format('YYYYMMDD')) {
                        if (performanceDocument.get('start') < now.format('HHmm')) {
                            return cb(new Error('You cannot reserve this performance.'), reservationModel);

                        }

                    } else if (performanceDocument.get('day') < now.format('YYYYMMDD')) {
                        return cb(new Error('You cannot reserve this performance.'), reservationModel);

                    }

                }



                // 券種取得
                Models.TicketTypeGroup.findOne(
                    {
                        _id: performanceDocument.get('film').get('ticket_type_group')
                    },
                    (err, ticketTypeGroupDocument) => {
                        reservationModel.seatCodes = [];


                        // 券種リストは、予約する主体によって異なる
                        // 内部関係者の場合
                        let group = reservationModel.purchaserGroup;
                        switch (group) {
                            case ReservationUtil.PURCHASER_GROUP_STAFF:
                                reservationModel.ticketTypes = TicketTypeGroupUtil.getOne4staff();
                                break;

                            case ReservationUtil.PURCHASER_GROUP_SPONSOR:
                                reservationModel.ticketTypes = TicketTypeGroupUtil.getOne4sponsor();
                                break;

                            case ReservationUtil.PURCHASER_GROUP_MEMBER:
                                // メルマガ当選者の場合、一般だけ
                                reservationModel.ticketTypes = [];

                                for (let ticketType of ticketTypeGroupDocument.get('types')) {
                                    if (ticketType.get('code') === TicketTypeGroupUtil.TICKET_TYPE_CODE_ADULTS) {
                                        reservationModel.ticketTypes.push(ticketType);
                                    }
                                }

                                break;

                            default:
                                // 一般の場合
                                // 当日窓口、電話予約の場合は、一般と同様の券種
                                // TODO 電話予約の場合は、手数料が1席につき150円(コンビニ分)
                                reservationModel.ticketTypes = [];

                                for (let ticketType of ticketTypeGroupDocument.get('types')) {
                                    switch (ticketType.get('code')) {
                                        // 学生当日は、当日だけ
                                        case TicketTypeGroupUtil.TICKET_TYPE_CODE_STUDENTS_ON_THE_DAY:
                                            if (moment().format('YYYYMMDD') === performanceDocument.get('day')) {
                                                reservationModel.ticketTypes.push(ticketType);
                                            }

                                            break;

                                        case TicketTypeGroupUtil.TICKET_TYPE_CODE_STUDENTS:
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

                            } else {
                                reservationModel.screenHtml = data;

                                cb(null, reservationModel);

                            }

                        });
                    }
                );

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
    protected processFixSeats(reservationModel: ReservationModel, seatCodes: Array<string>, cb: (err: Error, reservationModel: ReservationModel) => void) {
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

                } else {
                    let newReservation = {
                        performance: reservationModel.performance._id,
                        seat_code: seatCode,
                        status: ReservationUtil.STATUS_TEMPORARY,
                        mvtk_kiin_cd: (purchaserGroup === ReservationUtil.PURCHASER_GROUP_CUSTOMER) ? this.mvtkUser.memberInfoResult.kiinCd : undefined,
                        staff: (purchaserGroup === ReservationUtil.PURCHASER_GROUP_STAFF) ? this.staffUser.get('_id') : undefined,
                        sponsor: (purchaserGroup === ReservationUtil.PURCHASER_GROUP_SPONSOR) ? this.sponsorUser.get('_id') : undefined,
                        member: (purchaserGroup === ReservationUtil.PURCHASER_GROUP_MEMBER) ? this.memberUser.get('_id') : undefined,
                    };

                    // 予約データを作成(同時作成しようとしたり、既に予約があったとしても、unique indexではじかれる)
                    this.logger.debug('creating reservation... seat_code:', seatCode);
                    Models.Reservation.create(
                        newReservation,
                        (err, reservationDocument) => {
                            this.logger.debug('reservation created.', err, reservationDocument);
                            if (err) {
                                reject(err);

                            } else {
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
                        }
                    );
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
     * 購入番号から全ての予約を完了にする
     * 
     * @param {string} paymentNo 購入番号
     * @param {Array<string>} reservationIds 予約IDリスト
     * @param {Object} update 追加更新パラメータ
     */
    protected processFixReservations(paymentNo: string, reservationIds: Array<string>, update: Object, cb: (err: Error) => void): void {
        let promises = [];

        update['status'] = ReservationUtil.STATUS_RESERVED;
        update['updated_user'] = 'ReserveBaseController';

        // 予約完了ステータスへ変更
        for (let reservationId of reservationIds) {
            promises.push(new Promise((resolve, reject) => {
                this.logger.info('updating reservation by id...', reservationId, update);
                Models.Reservation.update(
                    {
                        _id: reservationId
                    },
                    update,
                    (err, raw) => {
                        this.logger.info('reservation updated.', err, raw);
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    }
                );
            }));
        };

        Promise.all(promises).then(() => {
            // 完了メールキューがあれば何も更新しないし、なければ追加する
            this.logger.info('creating reservationEmailCue...');
            Models.ReservationEmailCue.create(
                {
                    payment_no: paymentNo,
                    is_sent: false
                },
                (err, cueDocument) => {
                    this.logger.info('reservationEmailCue created.', err, cueDocument);
                    if (err) {
                        // 失敗してもスルー(ログと運用でなんとかする)
                    }

                    cb(null);
                }
            );
        }, (err) => {
            cb(new Error('some reservations not updated.'));
        });
    }

    /**
     * 予約プロセス用のロガーを設定する
     * 1決済管理番号につき、1ログファイル
     * 
     * @param {string} paymentNo 予約番号
     */
    protected setProcessLogger(paymentNo: string, cb: () => void) {
        Util.getReservationLogger(paymentNo, (err, logger) => {
            if (err) {
                // 失敗したとしても処理は続行(ログファイルがデフォルトになってしまうが仕方ない)
            } else {
                this.logger = logger;
            }
    
            cb();
        });

    }

    /**
     * 購入管理番号生成
     */
    protected createPaymentNo(cb: (err: Error, no: string) => void): void {
        Models.Sequence.findOneAndUpdate(
            {
                target: 'payment_no'
            },
            {
                $inc: {
                    no: 1
                }
            },
            {
                new: true
            },
            (err, sequenceDocument) => {
                if (err) {
                    cb(err, null);

                } else {
                    let no: number = sequenceDocument.get('no');
                    let paymentNo = `${no}${Util.getCheckDigit(no)}`;
                    cb(err, paymentNo);

                }
            }
        );
    }
}
