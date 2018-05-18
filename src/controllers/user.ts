/**
 * ユーザーコントローラー
 */

import * as  crypto from 'crypto';
import * as  createDebug from 'debug';
import * as express from 'express';
import * as libphonenumber from 'google-libphonenumber';
import * as querystring from 'querystring';
import { CognitoError } from '../models/CognitoError';

const debug = createDebug('sskts-account:controllers:user');

const COGNITO_AUTHORIZE_SERVER_ENDPOINT = process.env.COGNITO_AUTHORIZE_SERVER_ENDPOINT;
if (COGNITO_AUTHORIZE_SERVER_ENDPOINT === undefined) {
    throw new Error('Environment variable `COGNITO_AUTHORIZE_SERVER_ENDPOINT` required.');
}
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
if (COGNITO_USER_POOL_ID === undefined) {
    throw new Error('Environment variable `COGNITO_USER_POOL_ID` required.');
}
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
if (COGNITO_CLIENT_ID === undefined) {
    throw new Error('Environment variable `COGNITO_CLIENT_ID` required.');
}
const COGNITO_CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET;
if (COGNITO_CLIENT_SECRET === undefined) {
    throw new Error('Environment variable `COGNITO_CLIENT_SECRET` required.');
}

/**
 * メールアドレス確認に必要なパラメーターインターフェース
 */
interface IConfirmParams {
    username: string;
    sub: string;
    destination?: string;
    deliveryMedium?: string;
}

/**
 * 会員登録フォーム
 */
export async function signup(req: express.Request, res: express.Response) {
    if (req.method === 'POST') {
        signupValidation(req);
        const validationResult = await req.getValidationResult();
        debug(validationResult.array());
        if (!validationResult.isEmpty()) {
            const validationErrorMessage = validationResult
                .array()
                .map((error) => error.msg)
                .join('<br>');
            req.flash('validationErrorMessage', validationErrorMessage);
            res.redirect(`/signup?${querystring.stringify(req.query)}`);

            return;
        }
        try {
            const hash = crypto.createHmac('sha256', <string>COGNITO_CLIENT_SECRET)
                .update(`${req.body.username}${COGNITO_CLIENT_ID}`)
                .digest('base64');
            const params = {
                ClientId: <string>COGNITO_CLIENT_ID,
                SecretHash: hash,
                Password: req.body.password,
                Username: req.body.username,
                UserAttributes: [
                    {
                        Name: 'family_name',
                        Value: req.body.family_name
                    },
                    {
                        Name: 'given_name',
                        Value: req.body.given_name
                    },
                    {
                        Name: 'email',
                        Value: req.body.email
                    },
                    {
                        Name: 'phone_number',
                        Value: phoneNumberFormat(req.body.phone_number)
                    },
                    {
                        Name: 'custom:postalCode',
                        Value: req.body.postalCode
                    }
                ]
            };

            const confirmParams = await new Promise<IConfirmParams>((resolve, reject) => {
                req.cognitoidentityserviceprovider.signUp(params, (err, data) => {
                    debug('signUp response:', err, data);
                    if (err instanceof Error) {
                        reject(err);
                    } else {
                        resolve({
                            username: req.body.username,
                            sub: data.UserSub,
                            destination: (data.CodeDeliveryDetails !== undefined) ? data.CodeDeliveryDetails.Destination : undefined,
                            deliveryMedium: (data.CodeDeliveryDetails !== undefined) ? data.CodeDeliveryDetails.DeliveryMedium : undefined
                        });
                    }
                });
            });

            // 確認コード入力へ
            req.flash('confirmParams', <any>confirmParams);
            res.redirect(`/confirm?${querystring.stringify(req.query)}`);
        } catch (error) {
            req.flash('errorMessage', new CognitoError(error).message);
            res.redirect(`/signup?${querystring.stringify(req.query)}`);
        }
    } else {
        // 非ログイン中でなければログインページへ
        res.render('signup', {
            loginUrl: `/login?${querystring.stringify(req.query)}`
        });
    }
}

/**
 * 会員登録検証
 */
function signupValidation(req: express.Request) {
    // ログインID
    req.checkBody('username', 'ログインIDが未入力です').notEmpty();
    // セイ
    req.checkBody('family_name', 'セイが未入力です').notEmpty();
    req.checkBody('family_name', 'セイは全角カタカナで入力してください').matches(/^[ァ-ヶー]+$/);
    // メイ
    req.checkBody('given_name', 'メイが未入力です').notEmpty();
    req.checkBody('given_name', 'メイは全角カタカナで入力してください').matches(/^[ァ-ヶー]+$/);
    // メールアドレス
    req.checkBody('email', 'メールアドレスが未入力です').notEmpty();
    req.checkBody('email', 'メールアドレスの形式が正しくありません').isEmail();
    // 電話番号
    req.checkBody('phone_number', '電話番号が未入力です').notEmpty();
    (<any>req.checkBody('phone_number', '電話番号の形式が正しくありません')).custom((value: string) => {
        const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();
        const parsePhoneNumber = phoneUtil.parseAndKeepRawInput(value, 'JP');

        return phoneUtil.isValidNumber(parsePhoneNumber);
    });
}

/**
 * 電話番号フォーマット
 */
function phoneNumberFormat(phoneNumber: string) {
    const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();
    const parsePhoneNumber = phoneUtil.parseAndKeepRawInput(phoneNumber, 'JP');

    return phoneUtil.format(parsePhoneNumber, libphonenumber.PhoneNumberFormat.E164);
}

/**
 * 会員登録確認コード確認フロー
 */
export async function confirm(req: express.Request, res: express.Response) {
    if (req.method === 'POST') {
        try {
            await new Promise<void>((resolve, reject) => {
                const hash = crypto.createHmac('sha256', <string>COGNITO_CLIENT_SECRET)
                    .update(`${req.body.username}${COGNITO_CLIENT_ID}`)
                    .digest('base64');
                const params = {
                    ClientId: <string>COGNITO_CLIENT_ID,
                    SecretHash: hash,
                    ConfirmationCode: req.body.code,
                    Username: req.body.username,
                    ForceAliasCreation: false
                };
                req.cognitoidentityserviceprovider.confirmSignUp(params, (err, data) => {
                    if (err instanceof Error) {
                        reject(err);
                    } else {
                        debug(data);
                        resolve();
                    }
                });
            });

            // サインインして、認可フローへリダイレクト
            (<Express.Session>req.session).user = { username: req.body.username };
            res.redirect(`/authorize?${querystring.stringify(req.query)}`);
        } catch (error) {
            req.flash('errorMessage', new CognitoError(error).message);
            req.flash('confirmParams', <any>{
                username: req.body.username,
                sub: req.body.sub,
                destination: req.body.destination,
                deliveryMedium: req.body.deliveryMedium
            });
            res.redirect(`/confirm?${querystring.stringify(req.query)}`);
        }
    } else {
        try {
            const confirmParams = <IConfirmParams>req.flash('confirmParams')[0];
            res.render('confirm', {
                confirmParams: confirmParams,
                resendcodeUrl: `/resendcode?${querystring.stringify(req.query)}`
            });
        } catch (error) {
            res.redirect(`/error?error=${error.message}`);
        }
    }
}

/**
 * メールアドレス確認に必要なパラメーターインターフェース
 */
interface IConfirmForgotPasswordParams {
    username: string;
    destination?: string;
    deliveryMedium?: string;
}

/**
 * パスワード忘れフロー
 */
export async function forgotPassword(req: express.Request, res: express.Response) {
    if (req.method === 'POST') {
        try {
            const confirmForgotPasswordParams = await new Promise<IConfirmForgotPasswordParams>((resolve, reject) => {
                const hash = crypto.createHmac('sha256', <string>COGNITO_CLIENT_SECRET)
                    .update(`${req.body.username}${COGNITO_CLIENT_ID}`)
                    .digest('base64');
                const params = {
                    ClientId: <string>COGNITO_CLIENT_ID,
                    SecretHash: hash,
                    Username: req.body.username
                };
                req.cognitoidentityserviceprovider.forgotPassword(params, (err, data) => {
                    debug('forgotPassword response', err, data);
                    if (err instanceof Error) {
                        reject(err);
                    } else {
                        resolve({
                            username: req.body.username,
                            destination: (data.CodeDeliveryDetails !== undefined) ? data.CodeDeliveryDetails.Destination : undefined,
                            deliveryMedium: (data.CodeDeliveryDetails !== undefined) ? data.CodeDeliveryDetails.DeliveryMedium : undefined
                        });
                    }
                });
            });

            // 確認コード入力へ
            req.flash('confirmForgotPasswordParams', <any>confirmForgotPasswordParams);
            res.redirect(`/confirmForgotPassword?${querystring.stringify(req.query)}`);
        } catch (error) {
            req.flash('errorMessage', new CognitoError(error).message);
            res.redirect(`/forgotPassword?${querystring.stringify(req.query)}`);
        }
    } else {
        res.render('forgotPassword');
    }
}

/**
 * パスワード忘れ確認フロー
 */
export async function confirmForgotPassword(req: express.Request, res: express.Response) {
    if (req.method === 'POST') {
        try {
            // validation
            if (req.body.password !== req.body.confirmPassword) {
                throw { code: 'PasswordMismatchException' };
            }

            await new Promise<void>((resolve, reject) => {
                const hash = crypto.createHmac('sha256', <string>COGNITO_CLIENT_SECRET)
                    .update(`${req.body.username}${COGNITO_CLIENT_ID}`)
                    .digest('base64');
                const params = {
                    ClientId: <string>COGNITO_CLIENT_ID,
                    SecretHash: hash,
                    ConfirmationCode: req.body.code,
                    Username: req.body.username,
                    Password: req.body.password
                };
                req.cognitoidentityserviceprovider.confirmForgotPassword(params, (err, data) => {
                    debug('confirmForgotPassword response:', err, data);
                    if (err instanceof Error) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });

            // 認可フローへリダイレクト
            res.redirect(`/authorize?${querystring.stringify(req.query)}`);
        } catch (error) {
            req.flash('errorMessage', new CognitoError(error).message);
            req.flash('confirmForgotPasswordParams', <any>{
                username: req.body.username,
                destination: req.body.destination,
                deliveryMedium: req.body.deliveryMedium
            });
            res.redirect(`/confirmForgotPassword?${querystring.stringify(req.query)}`);
        }
    } else {
        try {
            const confirmForgotPasswordParams = <IConfirmParams>req.flash('confirmForgotPasswordParams')[0];
            res.render('confirmForgotPassword', {
                confirmForgotPasswordParams: confirmForgotPasswordParams,
                confirmUrl: `/confirm?${querystring.stringify(req.query)}`,
                resendcodeUrl: `/resendcode?${querystring.stringify(req.query)}`
            });
        } catch (error) {
            res.redirect(`/error?error=${error.message}`);
        }
    }
}
