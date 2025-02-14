import axios from 'axios';
import { ZodString, z } from 'zod';
import { generateUuid } from '../../utils/generateUuid';
import { defineHandler } from '../../handler';
import * as API from './api';
import { hashSecretKey } from './hash';
import { PaymentCtx, PaymentOptions } from '../types';
import { prepareRequest } from './prepareRequest';
import { SO_ACCOUNT_NUMBER, soRequestNumber } from '../constants'
import { safeParse } from '../../utils/safeParser';

const edahabRequest = z.object({
    accountNumber: soRequestNumber,
});

export const createEdahabHandler = defineHandler({
    schema: {
        config: z.object({
            apiKey: z.string(),
            secretKey: z.string(),
            merchantId: z.string(),
            links: z.object({
                baseUrl: z.string(),
                requestUrl: z.string(),
                creditUrl: z.string(),
            }),
        }),
        request: edahabRequest,
        credit: edahabRequest,
    },
    defaultConfig: {
        links: {
            baseUrl: 'https://edahab.net/api',
            requestUrl: '/api/issueinvoice?hash=',
            creditUrl: '/api/agentPayment?hash=',
        },
    },
    request: async ({ ctx, options }: { ctx: PaymentCtx, options: PaymentOptions }) => {
        const parsedData = safeParse(edahabRequest.pick({ accountNumber: true }), { accountNumber: options.accountNumber });
        const accountNumber = parsedData.accountNumber.replace(SO_ACCOUNT_NUMBER, '');
        const requestFn = async (url: string, data: API.RequestPaymentData, referenceId: string) => {
            const response = await axios.post<API.RequestPaymentReq, { data: API.RequestPaymentRes }>(url, data);
            const { TransactionId, InvoiceStatus, StatusCode, StatusDescription } = response.data;
            const responseCode = `${StatusCode}`;
            if (responseCode !== '0') {
                console.log(`${StatusDescription}`);
                throw responseCode;
            }
            return {
                transactionId: TransactionId,
                paymentStatus: InvoiceStatus,
                referenceId,
            };
        };
        const { links } = ctx;
        const referenceId = generateUuid();

        const requestData = prepareRequest('request', { ...options, accountNumber }, ctx, referenceId) as API.RequestPaymentData;
        const hashCode = hashSecretKey(requestData, ctx.secretKey);

        const requestUrl = `${links.baseUrl + links.requestUrl + hashCode}`;

        return await requestFn(requestUrl, requestData, referenceId);
    },
    credit: async ({ ctx, options }: { ctx: PaymentCtx, options: PaymentOptions }) => {
        const parsedData = safeParse(edahabRequest.pick({ accountNumber: true }), { accountNumber: options.accountNumber });
        const accountNumber = parsedData.accountNumber.replace(SO_ACCOUNT_NUMBER, '');
        const requestFn = async (url: string, data: API.CreditPaymentData, referenceId: string) => {
            const response = await axios.post<API.CreditPaymentReq, { data: API.CreditPaymentRes }>(url, data).catch((e) => {
                return {
                    data: {
                        PhoneNumber: data.phoneNumber,
                        TransactionId: referenceId,
                        TransactionStatus: 'error',
                        TransactionMesage: e.message,
                    } as API.CreditPaymentRes,
                };
            });

            const { TransactionId, TransactionMesage, TransactionStatus } = response.data;
            const responseCode = `${TransactionStatus}`;

            if (responseCode === 'error') {
                console.log(`credit error: ${TransactionMesage}`);
                throw TransactionMesage;
            }

            return {
                transactionId: TransactionId,
                paymentStatus: TransactionStatus,
                referenceId: generateUuid(),
            };
        };
        const { links } = ctx;
        const referenceId = generateUuid();
        const requestData = prepareRequest('credit', { ...options, accountNumber, }, ctx, referenceId) as API.CreditPaymentData;

        const hashCode = hashSecretKey(requestData, ctx.secretKey);
        const creditUrl = `${links.baseUrl + links.creditUrl + hashCode}`;

        return await requestFn(creditUrl, requestData, referenceId);
    },
});

export type EdahabHandler = ReturnType<typeof createEdahabHandler>