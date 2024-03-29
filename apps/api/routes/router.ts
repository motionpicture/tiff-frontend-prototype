import NamedRoutes = require('named-routes');
import express = require('express');
import passport = require('passport');

import AuthController from '../controllers/Auth/AuthController';
import AdmissionController from '../controllers/Admission/AdmissionController';
import PerformanceController from '../controllers/Performance/PerformanceController';
import ReservationController from '../controllers/Reservation/ReservationController';
import ScreenController from '../controllers/Screen/ScreenController';


/**
 * URLルーティング
 * 
 * app.get(パス, ルーティング名称, メソッド);
 * といった形でルーティングを登録する
 * ルーティング名称は、ejs側やコントローラーでURLを生成する際に用いたりするので、意識的にページ一意な値を定めること
 * 
 * リクエスト毎に、req,res,nextでコントローラーインスタンスを生成して、URLに応じたメソッドを実行する、という考え方
 * 
 * メタタグ情報は./metas.jsonで管理しています
 */
export default (app: any) => {
    let router = new NamedRoutes();
    router.extendExpress(app);
    router.registerAppHelpers(app);




    app.post('/api/login', 'login', (req, res, next) => {(new AuthController(req, res, next)).login()});

    // 要認証サービス
    app.all('/api/reservations', 'reservations', passport.authenticate('bearer', {session: false}), (req, res, next) => {(new ReservationController(req, res, next)).findByMvtkUser()});
    app.all('/api/reservation/:id', 'reservation', passport.authenticate('bearer', {session: false}), (req, res, next) => {(new ReservationController(req, res, next)).findById()});



    // search performances
    app.get('/api/:locale/performance/search', 'performance.search', (req, res, next) => {(new PerformanceController(req, res, next)).search()});

    // reservation email
    app.post('/api/:locale/reservation/email', 'reservation.email', (req, res, next) => {(new ReservationController(req, res, next)).email()});

    // show screen html
    app.get('/api/screen/:id/show', 'screen.show', (req, res, next) => {(new ScreenController(req, res, next)).show()});

    // create new admission
    app.post('/api/admission/create', 'admission.add', (req, res, next) => {(new AdmissionController(req, res, next)).create()});


    // 404
    app.use((req, res, next) => {
        res.json({
            isSuccess: false,
            message: 'Not Found'
        });
    });

    // error handlers
    app.use((err: any, req, res, next) => {
        res.json({
            isSuccess: false,
            message: 'Internal Server Error'
        });
    });
}
