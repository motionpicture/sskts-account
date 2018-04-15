/**
 * Expressアプリケーション
 */

import * as  AWS from 'aws-sdk';
import * as cookieParser from 'cookie-parser';
import * as express from 'express';
import * as expressLayouts from 'express-ejs-layouts';
// tslint:disable-next-line:no-require-imports no-var-requires
const flash = require('express-flash');
// import * as flash from 'express-flash';
import * as createError from 'http-errors';
import { INTERNAL_SERVER_ERROR, NOT_FOUND } from 'http-status';
import * as logger from 'morgan';
import * as path from 'path';
import * as redis from 'redis';

import session from './middlewares/session';

import router from './routes/index';

const app = express();

const COGNITO_REGION = process.env.COGNITO_REGION;
if (COGNITO_REGION === undefined) {
    throw new Error('Environment variable `COGNITO_REGION` required.');
}
app.use((req, __, next) => {
    // Redis Cacheクライアント
    req.redisClient = redis.createClient({
        host: <string>process.env.REDIS_HOST,
        // tslint:disable-next-line:no-magic-numbers
        port: parseInt(<string>process.env.REDIS_PORT, 10),
        password: <string>process.env.REDIS_KEY,
        tls: { servername: <string>process.env.REDIS_HOST }
    });

    // Cognitoサービスプロバイダー
    req.cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider({
        apiVersion: 'latest',
        region: COGNITO_REGION
        // accessKeyId: accessKeyId,
        // secretAccessKey: secretAccessKey
    });

    next();
});

app.use(session);
app.use(flash());

// view engine setup
app.set('views', path.join(__dirname, '/../views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '/../public')));

app.use('/', router);

// catch 404 and forward to error handler
app.use((__1: express.Request, __2: express.Response, next: express.NextFunction) => {
    next(createError(NOT_FOUND));
});

// error handler
app.use((err: any, req: express.Request, res: express.Response, __: express.NextFunction) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    const status = (err.status !== undefined) ? err.status : INTERNAL_SERVER_ERROR;
    res.status(status);
    res.render('error');
});

export = app;
