import BaseController from '../../BaseController';
import Util from '../../../../common/Util/Util';
import SponsorReserveTermsForm from '../../../forms/Sponsor/Reserve/SponsorReserveTermsForm';
import SponsorReservePerformanceForm from '../../../forms/Sponsor/Reserve/SponsorReservePerformanceForm';
import SponsorReserveSeatForm from '../../../forms/Sponsor/Reserve/SponsorReserveSeatForm';
import SponsorReserveTicketForm from '../../../forms/Sponsor/Reserve/SponsorReserveTicketForm';
import SponsorReserveProfileForm from '../../../forms/Sponsor/Reserve/SponsorReserveProfileForm';

import Models from '../../../../common/models/Models';
import ReservationUtil from '../../../../common/models/Reservation/ReservationUtil';

import mongoose = require('mongoose');

import ReservationModel from '../../../models/Reserve/ReservationModel';
import ReservationResultModel from '../../../models/Reserve/ReservationResultModel';

export default class SponsorReserveController extends BaseController {
    /**
     * 規約
     */
    public terms(): void {
        let sponsorReserveTermsForm = new SponsorReserveTermsForm();
        if (this.req.method === 'POST') {

            sponsorReserveTermsForm.form.handle(this.req, {
                success: (form) => {
                    sponsorReserveTermsForm.form = form;

                    // 予約トークンを発行してスケジュール選択へ
                    let token = Util.createToken();
                    let reservationModel = new ReservationModel();
                    reservationModel.token = token;
                    reservationModel.paymentNo = Util.createPaymentNo();
                    reservationModel.save((err) => {
                        this.res.redirect(this.router.build('sponsor.reserve.performances', {token: token}));
                    });
                },
                error: (form) => {
                    return this.res.render('sponsor/reserve/terms', {
                        form: form,
                    });
                },
                empty: (form) => {
                    return this.res.render('sponsor/reserve/terms', {
                        form: form,
                    });
                }
            });
        } else {
            this.res.render('sponsor/reserve/terms', {
                form: sponsorReserveTermsForm.form
            });
        }
    }

    /**
     * スケジュール選択
     */
    public performances(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.logger.debug('reservationModel is ', reservationModel);

            let sponsorReservePerformanceForm = new SponsorReservePerformanceForm();
            if (this.req.method === 'POST') {

                sponsorReservePerformanceForm.form.handle(this.req, {
                    success: (form) => {
                        sponsorReservePerformanceForm.form = form;

                        // パフォーマンス取得
                        this.logger.debug('searching performance... id:', form.data.performance_id);
                        this.useMongoose(() => {
                            Models.Performance.findOne({_id: form.data.performance_id}, {})
                                .populate('film screen theater') // スペースつなぎで、複数populateできる
                                .exec((err, performance) => {

                                mongoose.disconnect(() => {

                                    if (err) {
                                        return this.next(err);
                                    }

                                    // パフォーマンス情報を保存して座席選択へ
                                    reservationModel.performance = {
                                        _id: performance._id,
                                        day: performance.get('day'),
                                        start_time: performance.get('start_time'),
                                        end_time: performance.get('end_time'),
                                        theater: {
                                            _id: performance.get('theater').get('_id'),
                                            name: performance.get('theater').get('name'),
                                            name_en: performance.get('theater').get('name_en'),
                                        },
                                        screen: {
                                            _id: performance.get('screen').get('_id'),
                                            name: performance.get('screen').get('name'),
                                            name_en: performance.get('screen').get('name_en'),
                                        },
                                        film: {
                                            _id: performance.get('film').get('_id'),
                                            name: performance.get('film').get('name'),
                                            name_en: performance.get('film').get('name_en'),
                                        }
                                    };

                                    // スクリーンの全座席コード
                                    reservationModel.screenSeatCodes = [];
                                    for (let seatDocument of performance.get('screen').get('sections')[0].get('seats')) {
                                        reservationModel.screenSeatCodes.push(seatDocument.get('code'));
                                    }

                                    reservationModel.seatCodes = [];
                                    reservationModel.ticketChoices = [];

                                    this.logger.debug('saving reservationModel... ', reservationModel);
                                    reservationModel.save((err) => {
                                        this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));
                                    });
                                });
                            });
                        });
                    },
                    error: (form) => {
                        this.next(new Error('不適切なアクセスです'));
                    },
                    empty: (form) => {
                        this.next(new Error('不適切なアクセスです'));
                    }
                });
            } else {
                // パフォーマンスを取得
                this.useMongoose(() => {
                    Models.Performance.find({}, null, {sort : {film: 1, day: 1, start_time: 1}, limit: 100})
                        .populate('film screen theater') // スペースつなぎで、複数populateできる
                        .exec((err, performanceDocuments) => {

                        mongoose.disconnect();

                        if (err) {
                            this.next(new Error('スケジュールを取得できませんでした'));
                        } else {
                            // TODO ここで画面表示に合わせて整形処理を入れる

                            // 作品ごとに
                            let performanceDocumentsByFilm = {};
                            for (let performanceDocument of performanceDocuments) {
                                let filmId = performanceDocument.get('film').get('id');
                                if (!performanceDocumentsByFilm.hasOwnProperty(filmId)) {
                                    performanceDocumentsByFilm[filmId] = [];
                                }

                                performanceDocumentsByFilm[filmId].push(performanceDocument);
                            }

                            this.res.render('sponsor/reserve/performances', {
                                form: sponsorReservePerformanceForm.form,
                                performances: performanceDocuments,
                                performanceDocumentsByFilm: performanceDocumentsByFilm,
                            });
                        }
                    });
                });
            }
        });
    }

    /**
     * 座席選択
     */
    public seats(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.logger.debug('reservationModel is ', reservationModel);

            let sponsorReserveSeatForm = new SponsorReserveSeatForm();
            if (this.req.method === 'POST') {

                sponsorReserveSeatForm.form.handle(this.req, {
                    success: (form) => {
                        sponsorReserveSeatForm.form = form;

                        let seatCodes: Array<string> = JSON.parse(form.data.codes);
                        let seatCodesInSession = (reservationModel.seatCodes) ? reservationModel.seatCodes : [];

                        if (seatCodes.length < 1) {
                            return this.next(new Error('不適切なアクセスです'));
                        }

                        // 仮押さえ
                        // まず仮押さえしてから、仮押さえキャンセル
                        this.useMongoose(() => {

                            let promises: Array<Promise<Function>> = [];

                            // セッション中の在庫リストを初期化
                            reservationModel.seatCodes = [];
                            reservationModel.ticketChoices = [];

                            for (let seatCodeInSession of seatCodesInSession) {
                                if (seatCodes.indexOf(seatCodeInSession) >= 0) {

                                // 座席選択肢になければ、空席ステータスに戻す(削除しちゃう)
                                } else {
                                    promises.push(new Promise((resolve, reject) => {

                                        this.logger.debug('STATUS_TEMPORARY to STATUS_AVAILABLE processing...seatCodeInSession:', seatCodeInSession);
                                        Models.Reservation.remove(
                                            {
                                                payment_no: reservationModel.paymentNo,
                                                seat_code: seatCodeInSession,
                                                status: ReservationUtil.STATUS_TEMPORARY,
                                            },
                                        (err) => {

                                            // 失敗したとしても時間経過で消えるので放置
                                            if (err) {
                                            } else {
                                            }

                                            resolve();
                                        });

                                    }));
                                }
                            }

                            for (let seatCode of seatCodes) {
                                // すでに仮押さえ済みであれば、セッションに加えるだけ
                                if (seatCodesInSession.indexOf(seatCode) >= 0) {
                                    promises.push(new Promise((resolve, reject) => {
                                        reservationModel.seatCodes.push(seatCode);

                                        resolve();
                                    }));
                                // 新規仮押さえであれば、検索して仮押さえトライ
                                } else {
                                    promises.push(new Promise((resolve, reject) => {

                                        this.logger.debug('findOneAndUpdate processing...');
                                        Models.Reservation.findOneAndUpdate(
                                            {
                                                payment_no: reservationModel.paymentNo,
                                                performance: reservationModel.performance._id,
                                                seat_code: seatCode,
                                                status: ReservationUtil.STATUS_AVAILABLE
                                            },
                                            {
                                                status: ReservationUtil.STATUS_TEMPORARY
                                            },
                                            {
                                                new: true,
                                                upsert: true,
                                            },
                                        (err, reservationDocument) => {

                                            if (err) {
                                            } else {
                                                if (reservationDocument) {
                                                    // ステータス更新に成功したらセッションに保管
                                                    reservationModel.seatCodes.push(reservationDocument.get('seat_code'));
                                                }
                                            }

                                            resolve();
                                        });

                                    }));
                                }
                            }


                            Promise.all(promises).then(() => {
                                mongoose.disconnect();

                                this.logger.debug('saving reservationModel... ', reservationModel);
                                reservationModel.save((err) => {
                                    // 仮押さえできていない在庫があった場合
                                    if (seatCodes.length > reservationModel.seatCodes.length) {
                                        // TODO メッセージ？
                                        let message = '座席を確保できませんでした。再度指定してください。';
                                        this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}) + `?message=${encodeURIComponent(message)}`);
                                    } else {
                                        this.res.redirect(this.router.build('sponsor.reserve.tickets', {token: token}));
                                    }
                                });

                            }, (err) => {
                                return this.next(err);
                            });

                        });
                    },
                    error: (form) => {
                        this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));
                    },
                    empty: (form) => {
                        this.res.redirect(this.router.build('sponsor.reserve.seats', {token: token}));
                    }
                });
            } else {
                // パフォーマンスを取得

                this.useMongoose(() => {

                    Models.Performance.findOne({_id: reservationModel.performance._id}, null)
                        .populate('film screen theater')
                        .exec((err, performance) => {

                        if (err) {
                            return this.next(new Error('スケジュールを取得できませんでした'));
                        }

                        // 予約リストを取得
                        Models.Reservation.find({performance: performance.get(('id'))}, null, null, (err, reservationDocuments) => {

                            mongoose.disconnect();

                            // 座席コードごとのオブジェクトに整形
                            let reservationDocumentsBySeatCode = {};
                            for (let reservationDocument of reservationDocuments) {
                                reservationDocumentsBySeatCode[reservationDocument.get('seat_code')] = reservationDocument;
                            }

                            // 販売座席リストを座席コードごとのオブジェクトに整形
                            let performanceSeatDocumentsBySeatCode = {};
                            for (let seatDocument of performance.get('seats')) {
                                performanceSeatDocumentsBySeatCode[seatDocument.get('code')] = seatDocument;
                            }

                            if (err) {
                                this.next(new Error('スケジュールを取得できませんでした'));
                            } else {
                                this.res.render('sponsor/reserve/seats', {
                                    form: sponsorReserveSeatForm.form,
                                    performance: performance,
                                    reservationDocumentsBySeatCode: reservationDocumentsBySeatCode,
                                    reservationModel: reservationModel,
                                    performanceSeatDocumentsBySeatCode: performanceSeatDocumentsBySeatCode,
                                });
                            }
                        })
                    });
                });
            }
        });
    }

    /**
     * 券種選択
     */
    public tickets(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.logger.debug('reservationModel is ', reservationModel);

            let sponsorReserveTicketForm = new SponsorReserveTicketForm();
            if (this.req.method === 'POST') {

                sponsorReserveTicketForm.form.handle(this.req, {
                    success: (form) => {
                        sponsorReserveTicketForm.form = form;

                        // 座席選択情報を保存して座席選択へ
                        reservationModel.ticketChoices = [];
                        let choices = JSON.parse(form.data.choices);

                        if (Array.isArray(choices)) {
                            choices.forEach((choice) => {
                                reservationModel.ticketChoices.push({
                                    seat_code: choice.seat_code,
                                    ticket: {
                                        type: choice.ticket.type,
                                        name: choice.ticket.name,
                                        name_en: choice.ticket.name_en,
                                        price: parseInt(choice.ticket.price),
                                    }
                                });
                            });
                        } else {
                            return this.next(new Error('不適切なアクセスです'));
                        }

                        this.logger.debug('saving reservationModel... ', reservationModel);
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('sponsor.reserve.profile', {token: token}));
                        });


                    },
                    error: (form) => {
                        this.res.redirect(this.router.build('sponsor.reserve.tickets', {token: token}));
                    },
                    empty: (form) => {
                        this.res.redirect(this.router.build('sponsor.reserve.tickets', {token: token}));
                    }
                });
            } else {
                // パフォーマンスを取得
                this.useMongoose(() => {

                    Models.Performance.findOne({_id: reservationModel.performance._id}, {})
                        .populate('film screen theater')
                        .exec((err, performanceDocument) => {

                        mongoose.disconnect();

                        if (err) {
                            return this.next(new Error('スケジュールを取得できませんでした'));
                        }

                        // 仮押さえ中の座席情報を取得
                        let seatDocuments = [];
                        for (let seatDocument of performanceDocument.get('seats')) {
                            if (reservationModel.seatCodes.indexOf(seatDocument.get('code')) >= 0) {
                                seatDocuments.push(seatDocument);
                            }

                            if (seatDocuments.length === reservationModel.seatCodes.length) {
                                break;
                            }
                        }

                        // 座席コードごとの券種選択リスト
                        let ticketChoices = (reservationModel.ticketChoices) ? reservationModel.ticketChoices : [];
                        let ticketChoicesBySeatCode = {};
                        for (let ticketChoice of ticketChoices) {
                            ticketChoicesBySeatCode[ticketChoice.seat_code] = ticketChoice;
                        }

                        this.res.render('sponsor/reserve/tickets', {
                            form: sponsorReserveTicketForm.form,
                            reservationModel: reservationModel,
                            seatDocuments: seatDocuments,
                            ticketChoicesBySeatCode: ticketChoicesBySeatCode,
                        });
                    });
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
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.logger.debug('reservationModel is ', reservationModel);

            let sponsorReserveProfileForm = new SponsorReserveProfileForm();
            if (this.req.method === 'POST') {

                sponsorReserveProfileForm.form.handle(this.req, {
                    success: (form) => {
                        sponsorReserveProfileForm.form = form;

                        // 購入者情報を保存して座席選択へ
                        reservationModel.profile = {
                            last_name: form.data.last_name,
                            first_name: form.data.first_name,
                            email: form.data.email,
                            tel: form.data.tel,
                        };

                        this.logger.debug('saving reservationModel... ', reservationModel);
                        reservationModel.save((err) => {
                            this.res.redirect(this.router.build('sponsor.reserve.confirm', {token: token}));
                        });
                    },
                    error: (form) => {
                        return this.res.render('sponsor/reserve/profile', {
                            form: form,
                            reservationModel: reservationModel,
                        });
                    },
                    empty: (form) => {
                        return this.res.render('sponsor/reserve/profile', {
                            form: form,
                            reservationModel: reservationModel,
                        });
                    }
                });
            } else {
                // セッションに情報があれば、フォーム初期値設定
                if (reservationModel.profile) {
                    let email = reservationModel.profile.email;
                    sponsorReserveProfileForm.form.fields.last_name.value = reservationModel.profile.last_name;
                    sponsorReserveProfileForm.form.fields.first_name.value = reservationModel.profile.first_name;
                    sponsorReserveProfileForm.form.fields.tel.value = reservationModel.profile.tel;
                    sponsorReserveProfileForm.form.fields.email.value = email;
                    sponsorReserveProfileForm.form.fields.emailConfirm.value = email.substr(0, email.indexOf('@'));
                    sponsorReserveProfileForm.form.fields.emailConfirmDomain.value = email.substr(email.indexOf('@') + 1);
                }

                this.res.render('sponsor/reserve/profile', {
                    form: sponsorReserveProfileForm.form,
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
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.logger.debug('reservationModel is ', reservationModel);

            if (this.req.method === 'POST') {
                this.res.redirect(this.router.build('sponsor.reserve.process', {token: token}));
            } else {
                this.res.render('sponsor/reserve/confirm', {
                    reservationModel: reservationModel
                });
            }
        });
    }

    public process(): void {
        let token = this.req.params.token;
        ReservationModel.find(token, (err, reservationModel) => {
            if (err || reservationModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.logger.debug('reservationModel is ', reservationModel);

            if (this.req.method === 'POST') {
            } else {
                // 予約情報セッション削除
                this.logger.debug('removing reservationModel... ', reservationModel);
                reservationModel.remove(() => {
                    if (err) {

                    } else {
                        // DB保存
                        this.useMongoose(() => {
                            // 予約ステータス更新
                            let reservedDocuments: Array<mongoose.Document> = [];

                            let promises = [];
                            for (let choice of reservationModel.ticketChoices) {
                                promises.push(new Promise((resolve, reject) => {

                                    this.logger.debug('STATUS_TEMPORARY to STATUS_RESERVED processing...seat_code:', choice.seat_code);
                                    Models.Reservation.findOneAndUpdate(
                                        {
                                            payment_no: reservationModel.paymentNo,
                                            seat_code: choice.seat_code,
                                            status: ReservationUtil.STATUS_TEMPORARY
                                        },
                                        {
                                            'status': ReservationUtil.STATUS_RESERVED,
                                            'performance': reservationModel.performance._id,
                                            'performance_day': reservationModel.performance.day,
                                            'performance_start_time': reservationModel.performance.start_time,
                                            'performance_end_time': reservationModel.performance.end_time,
                                            'theater': reservationModel.performance.theater._id,
                                            'theater_name': reservationModel.performance.theater.name,
                                            'screen': reservationModel.performance.screen._id,
                                            'screen_name': reservationModel.performance.screen.name,
                                            'film': reservationModel.performance.film._id,
                                            'film_name': reservationModel.performance.film.name,
                                            'purchaser_last_name': reservationModel.profile.last_name,
                                            'purchaser_first_name': reservationModel.profile.first_name,
                                            'purchaser_email': reservationModel.profile.email,
                                            'purchaser_tel': reservationModel.profile.tel,
                                            'ticket_type': choice.ticket.type,
                                            'ticket_name': choice.ticket.name,
                                            'created_user': this.constructor.toString(),
                                            'updated_user': this.constructor.toString(),
                                        },
                                        {
                                            new: true
                                        },
                                    (err, reservationDocument) => {

                                        this.logger.info('STATUS_TEMPORARY to STATUS_RESERVED processed.', err, reservationDocument, reservationModel);

                                        if (err) {
                                        } else {
                                            // ステータス更新に成功したらリストに追加
                                            reservedDocuments.push(reservationDocument);
                                        }

                                        resolve();
                                    });

                                }));
                            }

                            Promise.all(promises).then(() => {
                                mongoose.disconnect();

                                let reservationResultModel = reservationModel.toReservationResult();

                                // TODO 予約できていない在庫があった場合
                                if (reservationModel.seatCodes.length > reservedDocuments.length) {
                                    this.res.redirect(this.router.build('sponsor.reserve.confirm', {token: token}));
                                } else {
                                    // 予約結果セッションを保存して、完了画面へ
                                    this.logger.debug('saving reservationResult...', reservationResultModel);
                                    reservationResultModel.save((err) => {
                                        this.res.redirect(this.router.build('sponsor.reserve.complete', {token: token}));
                                    });
                                }

                            }, (err) => {
                                // TODO 万が一の対応どうするか
                                mongoose.disconnect();
                                return this.next(err);
                            });

                        });

                    }
                });
            }
        });
    }

    public complete(): void {
        let token = this.req.params.token;
        ReservationResultModel.find(token, (err, reservationResultModel) => {
            if (err || reservationResultModel === null) {
                return this.next(new Error('予約プロセスが中断されました'));
            }

            this.res.render('sponsor/reserve/complete', {
                reservationResultModel: reservationResultModel,
            });
        });
    }
}
