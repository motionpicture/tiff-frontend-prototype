import BaseController from '../BaseController';
import Util from '../../../common/Util/Util';

import Models from '../../../common/models/Models';
import ReservationUtil from '../../../common/models/Reservation/ReservationUtil';
import FilmUtil from '../../../common/models/Film/FilmUtil';

import moment = require('moment');

export default class AdmissionController extends BaseController {
    public performances(): void {
        this.res.render('admission/performances', {
            layout: 'layouts/admission/layout',
            FilmUtil: FilmUtil
        });
    }

    public confirm(): void {
        let performanceId = this.req.params.id;

        Models.Reservation.find(
            {
                performance: performanceId,
                status: ReservationUtil.STATUS_RESERVED
            }
        ).exec((err, reservationDocuments) => {
            let reservationsById = {};
            for (let reservationDocument of reservationDocuments) {
                reservationsById[reservationDocument.get('_id')] = reservationDocument;
            }

            this.res.render('admission/confirm', {
                layout: 'layouts/admission/layout',
                reservationsById: reservationsById
            });

        });

    }
}
