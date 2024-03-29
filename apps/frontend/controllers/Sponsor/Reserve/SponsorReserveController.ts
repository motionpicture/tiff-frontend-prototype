import ReserveBaseController from '../../ReserveBaseController';
import SponsorUser from '../../../models/User/SponsorUser';
import Util from '../../../../common/Util/Util';
import reservePerformanceForm from '../../../forms/Reserve/reservePerformanceForm';
import reserveSeatForm from '../../../forms/Reserve/reserveSeatForm';
import Models from '../../../../common/models/Models';
import ReservationUtil from '../../../../common/models/Reservation/ReservationUtil';
import FilmUtil from '../../../../common/models/Film/FilmUtil';
import ReservationModel from '../../../models/Reserve/ReservationModel';
import lockFile = require('lockfile');

export default class SponsorReserveController extends ReserveBaseController {
    public layout = 'layouts/sponsor/layout';

    public start(): void {
        // 予約トークンを発行
        let token = Util.createToken();
        let reservationModel = new ReservationModel();
        reservationModel.token = token;
        reservationModel.purchaserGroup = ReservationUtil.PURCHASER_GROUP_SPONSOR;
        reservationModel.purchaserLastName = '';
        reservationModel.purchaserFirstName = '';
        reservationModel.purchaserTel = '';
        reservationModel.purchaserEmail = '';

        this.logger.debug('saving reservationModel... ', reservationModel);
        reservationModel.save((err) => {
            // パフォーマンス指定or無指定どちらか判断
            if (this.req.sponsorUser.get('performance')) {
                // パフォーマンスFIX
                this.processFixPerformance(reservationModel, this.req.sponsorUser.get('performance'), (err, reservationModel) => {
                    if (err) {
                        this.next(err);

                    } else {
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));
                        });

                    }
                });

            // 続けて予約の場合
            } else if (this.req.query.performance) {
                // パフォーマンスFIX
                this.processFixPerformance(reservationModel, this.req.query.performance, (err, reservationModel) => {
                    if (err) {
                        this.next(err);

                    } else {
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));
                        });

                    }
                });

            } else {
                // スケジュール選択へ
                reservationModel.save((err) => {
                    this.res.redirect(this.router.build('sponsor.reserve.performances', {token: token}));
                });

            }
        });

    }

    /**
     * スケジュール選択
     */
    public performances(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            // 仮予約あればキャンセルする
            this.processCancelSeats(reservationModel, (err, reservationModel) => {
                reservationModel.save((err) => {

                    // 外部関係者による予約数を取得
                    Models.Reservation.count(
                        {
                            sponsor: this.req.sponsorUser.get('_id'),
                            status: {$in: [ReservationUtil.STATUS_TEMPORARY, ReservationUtil.STATUS_RESERVED]}
                        },
                        (err, reservationsCount) => {
                            if (parseInt(this.req.sponsorUser.get('max_reservation_count')) <= reservationsCount) {
                                return this.next(new Error(this.req.__('Message.seatsLimit{{limit}}', {limit: this.req.sponsorUser.get('max_reservation_count')})));
                            }

                            if (this.req.method === 'POST') {
                                reservePerformanceForm(this.req, this.res, (err) => {
                                    if (this.req.form.isValid) {
                                        // パフォーマンスFIX
                                        this.processFixPerformance(reservationModel, this.req.form['performanceId'], (err, reservationModel) => {
                                            if (err) {
                                                this.next(new Error(this.req.__('Message.UnexpectedError')));
                                            } else {
                                                reservationModel.save((err) => {
                                                    this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));
                                                });
                                            }
                                        });
                                    } else {
                                        this.next(new Error(this.req.__('Message.UnexpectedError')));
                                    }
                                });
                            } else {
                                this.res.render('sponsor/reserve/performances', {
                                    FilmUtil: FilmUtil,
                                    reservationsCount: reservationsCount
                                });
                            }
                        }
                    );
                });
            });
        });
    }

    /**
     * 座席選択
     */
    public seats(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            // 外部関係者による予約数を取得
            let lockPath = `${__dirname}/../../../../../lock/SponsorFixSeats${this.req.sponsorUser.get('_id')}.lock`;
            lockFile.lock(lockPath, {wait: 5000}, (err) => {

                Models.Reservation.count(
                    {
                        sponsor: this.req.sponsorUser.get('_id'),
                        status: {$in: [ReservationUtil.STATUS_TEMPORARY, ReservationUtil.STATUS_RESERVED]},
                        seat_code: {
                            $nin: reservationModel.seatCodes // 現在のフロー中の予約は除く
                        }
                    },
                    (err, reservationsCount) => {
                        // 一度に確保できる座席数は、残り可能枚数と、10の小さい方
                        let reservableCount = parseInt(this.req.sponsorUser.get('max_reservation_count')) - reservationsCount;
                        let limit = Math.min(10, reservableCount);

                        // すでに枚数制限に達している場合
                        if (limit <= 0) {
                            lockFile.unlock(lockPath, (err) => {
                                this.next(new Error(this.req.__('Message.seatsLimit{{limit}}', {limit: limit.toString()})));
                            });

                        } else {

                            if (this.req.method === 'POST') {
                                reserveSeatForm(this.req, this.res, (err) => {
                                    if (this.req.form.isValid) {
                                        let seatCodes: Array<string> = JSON.parse(this.req.form['seatCodes']);

                                        // 追加指定席を合わせて制限枚数を超過した場合
                                        if (seatCodes.length > limit) {

                                            lockFile.unlock(lockPath, (err) => {
                                                let message = this.req.__('Message.seatsLimit{{limit}}', {limit: limit.toString()});
                                                this.res.redirect(`${this.router.build('sponsor.reserve.seats', {token: token})}?message=${encodeURIComponent(message)}`);

                                            });

                                        } else {
                                            // 仮予約あればキャンセルする
                                            this.logger.debug('processCancelSeats processing...');
                                            this.processCancelSeats(reservationModel, (err, reservationModel) => {
                                                this.logger.debug('processCancelSeats processed.', err);

                                                // 座席FIX
                                                this.processFixSeats(reservationModel, seatCodes, (err, reservationModel) => {
                                                    lockFile.unlock(lockPath, () => {

                                                        if (err) {
                                                            reservationModel.save((err) => {
                                                                let message = this.req.__('Mesasge.SelectedSeatsUnavailable');
                                                                this.res.redirect(`${this.router.build('sponsor.reserve.seats', {token: token})}?message=${encodeURIComponent(message)}`);
                                                            });
                                                        } else {
                                                            reservationModel.save((err) => {
                                                                // 券種選択へ
                                                                this.res.redirect(this.router.build('sponsor.reserve.tickets', {token: token}));
                                                            });
                                                        }

                                                    });

                                                });
                                            });

                                        }

                                    } else {
                                        lockFile.unlock(lockPath, (err) => {
                                            this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));

                                        });

                                    }

                                });
                            } else {

                                lockFile.unlock(lockPath, (err) => {
                                    this.res.render('sponsor/reserve/seats', {
                                        reservationModel: reservationModel,
                                        limit: limit,
                                        reservableCount: reservableCount
                                    });

                                });
                            }
                        }
                    }
                );
            });
        });
    }

    /**
     * 券種選択
     */
    public tickets(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            if (this.req.method === 'POST') {
                this.processFixTickets(reservationModel, (err, reservationModel) => {
                    if (err) {
                        this.res.redirect(this.router.build('sponsor.reserve.tickets', {token: token}));
                    } else {
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('sponsor.reserve.profile', {token: token}));
                        });
                    }
                });
            } else {
                this.res.render('sponsor/reserve/tickets', {
                    reservationModel: reservationModel,
                });
            }
        });
    }

    /**
     * 購入者情報
     */
    public profile(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            if (this.req.method === 'POST') {
                this.processFixProfile(reservationModel, (err, reservationModel) => {
                    if (err) {
                        this.res.render('sponsor/reserve/profile', {
                            reservationModel: reservationModel
                        });
                    } else {
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('sponsor.reserve.confirm', {token: token}));
                        });
                    }
                });
            } else {
                // セッションに情報があれば、フォーム初期値設定
                let email = reservationModel.purchaserEmail;
                this.res.locals.lastName = (reservationModel.purchaserLastName) ? reservationModel.purchaserLastName : '';
                this.res.locals.firstName = (reservationModel.purchaserFirstName) ? reservationModel.purchaserFirstName : '';
                this.res.locals.tel = (reservationModel.purchaserTel) ? reservationModel.purchaserTel : '';
                this.res.locals.email = (email) ? email : '';
                this.res.locals.emailConfirm = (email) ? email.substr(0, email.indexOf('@')) : '';
                this.res.locals.emailConfirmDomain = (email) ? email.substr(email.indexOf('@') + 1) : '';
                this.res.locals.paymentMethod = (reservationModel.paymentMethod) ? reservationModel.paymentMethod : '';

                this.res.render('sponsor/reserve/profile', {
                    reservationModel: reservationModel,
                });
            }
        });
    }

    /**
     * 予約内容確認
     */
    public confirm(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            if (this.req.method === 'POST') {
                this.processConfirm(reservationModel, (err, reservationModel) => {
                    if (err) {
                        let message = err.message;
                        this.res.redirect(`${this.router.build('sponsor.reserve.confirm', {token: token})}?message=${encodeURIComponent(message)}`);
                    } else {
                        // 予約確定
                        this.processFixReservations(reservationModel.paymentNo, {}, (err) => {
                            if (err) {
                                let message = err.message;
                                this.res.redirect(`${this.router.build('sponsor.reserve.confirm', {token: token})}?message=${encodeURIComponent(message)}`);
                            } else {
                                reservationModel.remove((err) => {
                                    this.logger.info('redirecting to complete...');
                                    this.res.redirect(this.router.build('sponsor.reserve.complete', {paymentNo: reservationModel.paymentNo}));
                                });
                            }
                        });
                    }
                });
            } else {
                this.res.render('sponsor/reserve/confirm', {
                    reservationModel: reservationModel
                });
            }
        });
    }

    public complete(): void {
        let paymentNo = this.req.params.paymentNo;
        Models.Reservation.find(
            {
                payment_no: paymentNo,
                status: ReservationUtil.STATUS_RESERVED,
                sponsor: this.req.sponsorUser.get('_id')
            },
            (err, reservationDocuments) => {
                if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));
                if (reservationDocuments.length === 0) return this.next(new Error(this.req.__('Message.NotFound')));

                this.res.render('sponsor/reserve/complete', {
                    reservationDocuments: reservationDocuments
                });
            }
        );

    }
}
