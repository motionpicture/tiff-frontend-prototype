"use strict";
const redis = require('redis');
const conf = require('config');
const crypto = require('crypto');
const fs = require('fs-extra');
const log4js = require('log4js');
/**
 * 共通のユーティリティ
 */
class Util {
    /**
     * トークン生成
     *
     * @return {string}
     */
    static createToken() {
        let uniqid = require('uniqid'); // Generates unique id's on multiple processes and machines even if called at the same time.
        let md5hash = crypto.createHash('md5');
        // console.log(uniqid()); // Generate 18 byte unique id's based on the time, process id and mac address. Works on multiple processes and machines.
        // console.log(uniqid.process()); // Generate 12 byte unique id's based on the time and the process id. Works on multiple processes within a single machine but not on multiple machines.
        // console.log(uniqid.time()); // Generate 8 byte unique id's based on the current time only. Recommended only on a single process on a single machine.
        md5hash.update(Math.floor(Math.random() * 10000) + 1000 + uniqid.process(), 'binary');
        // md5hash.update(uniqid.process(), 'binary');
        let token = md5hash.digest('hex');
        return token;
    }
    /**
     * RedisCacheクライアントを取得する
     */
    static getRedisClient() {
        let client = redis.createClient(conf.get('redis_port'), conf.get('redis_host'), {
            password: conf.get('redis_key'),
            return_buffers: true
        });
        return client;
    }
    /**
     * 予約プロセス用のロガーを設定する
     * 1決済管理番号につき、1ログファイル
     *
     * @param {string} paymentNo 予約番号
     */
    static getReservationLogger(paymentNo, cb) {
        let env = process.env.NODE_ENV || 'dev';
        let moment = require('moment');
        // let logDir = `${__dirname}/../../../logs/${env}/reservations/${moment().format('YYYYMMDD')}`;
        let logDir = `${__dirname}/../../../logs/${env}/reservations/${paymentNo.slice(0, 1)}`;
        fs.mkdirs(logDir, (err) => {
            if (err) {
                cb(err, null);
            }
            else {
                log4js.configure({
                    appenders: [
                        {
                            category: 'reservation',
                            type: 'dateFile',
                            filename: `${logDir}/${paymentNo}.log`,
                            pattern: '-yyyy-MM-dd'
                        },
                        {
                            type: 'console'
                        }
                    ],
                    levels: {
                        reserve: 'ALL'
                    },
                    replaceConsole: true
                });
                cb(null, log4js.getLogger('reservation'));
            }
        });
    }
    static getCheckDigit(source) {
        let sourceString = source.toString();
        let weights = [2, 6, 3, 4, 3, 7, 5, 4, 2];
        let digits = sourceString.length;
        let sum = 0;
        for (let i = 0; i < digits; i++) {
            sum += parseInt(sourceString[i]) * weights[i];
        }
        let checkDigit = 11 - (sum % 11);
        return checkDigit;
    }
    static createHash(password, salt) {
        let sha512 = crypto.createHash('sha512');
        sha512.update(salt + password, 'utf8');
        let hash = sha512.digest('hex');
        return hash;
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Util;
