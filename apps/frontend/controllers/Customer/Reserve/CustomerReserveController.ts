import ReserveBaseController from '../../ReserveBaseController';
import MvtkUser from '../../../models/User/MvtkUser';
import Util from '../../../../common/Util/Util';
import GMOUtil from '../../../../common/Util/GMO/GMOUtil';
import reservePerformanceForm from '../../../forms/Reserve/reservePerformanceForm';
import reserveSeatForm from '../../../forms/Reserve/reserveSeatForm';
import reserveTicketForm from '../../../forms/Reserve/reserveTicketForm';
import reserveProfileForm from '../../../forms/Reserve/reserveProfileForm';
import Models from '../../../../common/models/Models';
import ReservationUtil from '../../../../common/models/Reservation/ReservationUtil';
import FilmUtil from '../../../../common/models/Film/FilmUtil';
import ReservationModel from '../../../models/Reserve/ReservationModel';
import lockFile = require('lockfile');

export default class CustomerReserveController extends ReserveBaseController {
    public static RESERVATION_LIMIT_PER_PERFORMANCE = 4; // パフォーマンスあたりの最大座席確保枚数

    /**
     * スケジュール選択
     */
    public performances(): void {
        if (this.req.method === 'POST') {
            reservePerformanceForm(this.req, this.res, (err) => {
                if (this.req.form.isValid) {
                    this.res.redirect(307, this.router.build('customer.reserve.start'));

                } else {
                    this.res.render('customer/reserve/performances', {
                    });

                }

            });
        } else {
            this.res.render('customer/reserve/performances', {
                FilmUtil: FilmUtil
            });

        }
    }

    /**
     * ポータルからパフォーマンス指定でPOSTされてくる
     */
    public start(): void {

        reservePerformanceForm(this.req, this.res, (err) => {
            if (this.req.form.isValid) {
                // 言語も指定
                if (this.req.form['locale']) {
                   this.req.session['locale'] = this.req.form['locale'];
                } else {
                   this.req.session['locale'] = 'ja';
                }

                // 予約トークンを発行
                let token = Util.createToken();
                let reservationModel = new ReservationModel();
                reservationModel.token = token;

                // パフォーマンスFIX
                this.processFixPerformance(reservationModel, this.req.form['performanceId'], (err, reservationModel) => {
                    if (err) {
                        this.next(err);
                    } else {
                        reservationModel.save((err) => {
                            this.res.redirect(`${this.router.build('customer.reserve.terms')}?cb=${encodeURIComponent(this.router.build('customer.reserve.login', {token: token}))}`);

                        });
                    }
                });

            } else {
                this.next(new Error(this.req.__('Message.UnexpectedError')));

            }

        });

    }

    public login(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err) return this.next(new Error(this.req.__('Message.Expired')));

            reservationModel.purchaserGroup = ReservationUtil.PURCHASER_GROUP_CUSTOMER;

            reservationModel.save((err) => {
                this.res.redirect(this.router.build('customer.reserve.seats', {token: token}));

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

            // 1アカウント1パフォーマンスごとに枚数制限
            let lockPath = `${__dirname}/../../../../../lock/CustomerFixSeats${this.mvtkUser.memberInfoResult.kiinCd}${reservationModel.performance._id}.lock`;
            lockFile.lock(lockPath, {wait: 5000}, (err) => {

                Models.Reservation.count(
                    {
                        mvtk_kiin_cd: this.mvtkUser.memberInfoResult.kiinCd,
                        performance: reservationModel.performance._id,
                        seat_code: {
                            $nin: reservationModel.seatCodes // 現在のフロー中の予約は除く
                        }
                    },
                    (err, reservationsCount) => {
                        let limit = CustomerReserveController.RESERVATION_LIMIT_PER_PERFORMANCE - reservationsCount;

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

                                            lockFile.unlock(lockPath, () => {
                                                let message = this.req.__('Message.seatsLimit{{limit}}', {limit: limit.toString()});
                                                this.res.redirect(`${this.router.build('customer.reserve.seats', {token: token})}?message=${encodeURIComponent(message)}`);

                                            });

                                        } else {
                                            // 仮予約あればキャンセルする
                                            this.logger.debug('processCancelSeats processing...');
                                            this.processCancelSeats(reservationModel, (err, reservationModel) => {
                                                this.logger.debug('processCancelSeats processed.', err);

                                                // 座席FIX
                                                this.logger.debug('processFixSeats processing...', reservationModel.token, seatCodes);
                                                this.processFixSeats(reservationModel, seatCodes, (err, reservationModel) => {
                                                    this.logger.debug('processFixSeats processed.', reservationModel.token, err);
                                                    lockFile.unlock(lockPath, () => {

                                                        // 仮予約に失敗した座席コードがあった場合
                                                        if (err) {
                                                            reservationModel.save((err) => {
                                                                let message = this.req.__('Mesasge.SelectedSeatsUnavailable');
                                                                this.res.redirect(`${this.router.build('customer.reserve.seats', {token: token})}?message=${encodeURIComponent(message)}`);
                                                            });
                                                        } else {
                                                            reservationModel.save((err) => {
                                                                // 券種選択へ
                                                                this.res.redirect(this.router.build('customer.reserve.tickets', {token: token}));
                                                            });
                                                        }

                                                    });

                                                });

                                            });

                                        }

                                    } else {
                                        lockFile.unlock(lockPath, () => {
                                            this.res.redirect(this.router.build('customer.reserve.seats', {token: token}));

                                        });

                                    }

                                });
                            } else {

                                lockFile.unlock(lockPath, (err) => {
                                    this.res.render('customer/reserve/seats', {
                                        reservationModel: reservationModel,
                                        limit: limit
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

            reservationModel.paymentMethod = null;

            if (this.req.method === 'POST') {
                reserveTicketForm(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 座席選択情報を保存して座席選択へ
                        let choices = JSON.parse(this.req.form['choices']);

                        if (Array.isArray(choices)) {
                            choices.forEach((choice) => {
                                let reservation = reservationModel.getReservation(choice.seat_code);

                                let ticketType = reservationModel.ticketTypes.find((ticketType) => {
                                    return (ticketType.code === choice.ticket_type_code);
                                });
                                if (!ticketType) {
                                    return this.next(new Error(this.req.__('Message.UnexpectedError')));
                                }

                                reservation.ticket_type_code = ticketType.code;
                                reservation.ticket_type_name = ticketType.name;
                                reservation.ticket_type_name_en = ticketType.name_en;
                                reservation.ticket_type_charge = ticketType.charge;;

                                reservationModel.setReservation(reservation._id, reservation);
                            });

                            this.logger.debug('saving reservationModel... ');
                            reservationModel.save((err) => {
                                this.res.redirect(this.router.build('customer.reserve.profile', {token: token}));
                            });

                        } else {
                            this.next(new Error(this.req.__('Message.UnexpectedError')));
                        }

                    } else {
                        this.res.redirect(this.router.build('customer.reserve.tickets', {token: token}));

                    }
                });
            } else {
                this.res.render('customer/reserve/tickets', {
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
                let form = reserveProfileForm(this.req);
                form(this.req, this.res, (err) => {
                    if (this.req.form.isValid) {
                        // 購入者情報を保存して座席選択へ
                        reservationModel.profile = {
                            last_name: this.req.form['lastName'],
                            first_name: this.req.form['firstName'],
                            email: this.req.form['email'],
                            tel: this.req.form['tel']
                        };

                        reservationModel.paymentMethod = this.req.form['paymentMethod'];

                        this.logger.debug('saving reservationModel... ');
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('customer.reserve.confirm', {token: token}));
                        });

                    } else {
                        this.res.render('customer/reserve/profile', {
                            reservationModel: reservationModel
                        });

                    }

                });

            } else {
                let email = this.mvtkUser.memberInfoResult.kiinMladdr;
                this.res.locals.lastName = this.mvtkUser.memberInfoResult.kiinsiKnnm;
                this.res.locals.firstName = this.mvtkUser.memberInfoResult.kiimmiKnnm;
                this.res.locals.tel = `${this.mvtkUser.memberInfoResult.kiinshgikykNo}${this.mvtkUser.memberInfoResult.kiinshnikykNo}${this.mvtkUser.memberInfoResult.kiinknyshNo}`;
                this.res.locals.email = email;
                this.res.locals.emailConfirm = email.substr(0, email.indexOf('@'));
                this.res.locals.emailConfirmDomain = email.substr(email.indexOf('@') + 1);
                this.res.locals.paymentMethod = GMOUtil.PAY_TYPE_CREDIT;

                // セッションに情報があれば、フォーム初期値設定
                if (reservationModel.profile) {
                    let email = reservationModel.profile.email;
                    this.res.locals.lastName = reservationModel.profile.last_name;
                    this.res.locals.firstName = reservationModel.profile.first_name;
                    this.res.locals.tel = reservationModel.profile.tel;
                    this.res.locals.email = email;
                    this.res.locals.emailConfirm = email.substr(0, email.indexOf('@'));
                    this.res.locals.emailConfirmDomain = email.substr(email.indexOf('@') + 1);
                }

                if (reservationModel.paymentMethod) {
                    this.res.locals.paymentMethod = reservationModel.paymentMethod;
                }

                this.res.render('customer/reserve/profile', {
                    reservationModel: reservationModel
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
                        this.res.redirect(`${this.router.build('customer.reserve.confirm', {token: token})}?message=${encodeURIComponent(message)}`);
                    } else {
                        reservationModel.save((err) => {
                            this.logger.info('starting GMO payment...');
                            this.res.redirect(307, this.router.build('gmo.reserve.start', {token: token}));
                        });
                    }
                });
            } else {
                this.res.render('customer/reserve/confirm', {
                    reservationModel: reservationModel
                });

            }
        });
    }

    /**
     * 仮予約完了
     */
    public waitingSettlement(): void {
        let paymentNo = this.req.params.paymentNo;
        Models.Reservation.find(
            {
                payment_no: paymentNo,
                status: ReservationUtil.STATUS_WAITING_SETTLEMENT,
                mvtk_kiin_cd: this.mvtkUser.memberInfoResult.kiinCd
            },
            (err, reservationDocuments) => {
                if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));
                if (reservationDocuments.length === 0) return this.next(new Error(this.req.__('Message.NotFound')));

                this.res.render('customer/reserve/waitingSettlement', {
                    reservationDocuments: reservationDocuments
                });

            }
        );
    }

    /**
     * 予約完了
     */
    public complete(): void {
        let paymentNo = this.req.params.paymentNo;
        Models.Reservation.find(
            {
                payment_no: paymentNo,
                status: ReservationUtil.STATUS_RESERVED,
                mvtk_kiin_cd: this.mvtkUser.memberInfoResult.kiinCd
            },
            (err, reservationDocuments) => {
                if (err) return this.next(new Error(this.req.__('Message.UnexpectedError')));
                if (reservationDocuments.length === 0) return this.next(new Error(this.req.__('Message.NotFound')));

                this.res.render('customer/reserve/complete', {
                    reservationDocuments: reservationDocuments
                });

            }
        );
    }
}
