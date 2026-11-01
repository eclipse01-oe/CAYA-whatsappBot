import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { whatsappBot, isWhatsAppConnected } from '../config/whatsappBot.js';
import { emit, type SendMessagesJob } from '../config/eventEmitter.js';
import { MAX_RECIPIENTS_PER_BATCH, prepareCampaignData } from '../utils/selfChatUtils.js';


export const getPhone = async ( req: Request, res: Response ) => {

    const { phone } = req.body as {
        phone?: unknown;
    };

    if (typeof phone !== 'string' || !phone.trim()) {
        return res.status(400).json({
            message: 'Phone number is required.',
        });
    }

    const phoneNumber = phone.replace(/\D/g, '');

    if (!/^[1-9]\d{7,14}$/.test(phoneNumber)) {
        return res.status(400).json({
            message: 'Invalid international phone number.',
        });
    }

    try {

        const sock = await whatsappBot(phoneNumber);

        if (!sock) {
            return res.status(409).json({
                message: 'WhatsApp session cannot be initialized.',
            });
        }

        return res.status(202).json({
            message: 'WhatsApp initialization started.',
            phoneNumber,
            connected: isWhatsAppConnected(phoneNumber),
        });

    } catch (error) {

        console.error(
            'WhatsApp initialization failed:',
            error
        );

        return res.status(500).json({
            message: 'Failed to initialize WhatsApp.',
        });
    }
};


export const sendCampaign = async ( req: Request, res: Response ) => {

    const body = req.body as Record<string, unknown> | undefined;

    if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Invalid request body.',
        });
    }

    const accountInput = body.accountPhone;

    if (
        typeof accountInput !== 'string' ||
        !accountInput.trim()
    ) {
        return res.status(400).json({
            success: false,
            message: 'Sending account is required.',
        });
    }

    const accountPhone = accountInput.replace(/\D/g, '');

    if (!/^[1-9]\d{7,14}$/.test(accountPhone)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid international account number.',
        });
    }

    let campaignData: ReturnType<typeof prepareCampaignData>;

    try {

        campaignData = prepareCampaignData(body);

    } catch (error) {

        const message = error instanceof Error
            ? error.message
            : 'Invalid campaign data.';

        return res.status(400).json({
            success: false,
            message,
        });
    }

    if (!isWhatsAppConnected(accountPhone)) {
        return res.status(409).json({
            success: false,
            message: `WhatsApp account ${accountPhone} is not connected.`,
        });
    }

    const campaignId = randomUUID();

    const recipients = campaignData.recipients;

    const totalBatches = Math.ceil(
        recipients.length / MAX_RECIPIENTS_PER_BATCH
    );

    const jobs: SendMessagesJob[] = [];

    for ( let i = 0; i < totalBatches; i++ ) {

        const start = i * MAX_RECIPIENTS_PER_BATCH;

        const batchRecipients = recipients.slice(
            start, start + MAX_RECIPIENTS_PER_BATCH
        );

        jobs.push({
            jobId: randomUUID(),
            campaignId,
            batchNumber: i + 1,
            totalBatches,
            accountPhone,
            message: campaignData.message,
            recipients: batchRecipients,
            createdAt: new Date().toISOString(),
        });
    }

    const acceptedJobs: SendMessagesJob[] = [];

    let dispatchError: string | undefined;

    for (const job of jobs) {

        try {

            const accepted = emit('job:sendMessages', job);

            if (!accepted) {

                dispatchError = 'Message queue is unavailable.';

                break;
            }

            acceptedJobs.push(job);

        } catch (error) {

            dispatchError = error instanceof Error
                ? error.message
                : 'Failed to submit campaign batch.';

            console.error(
                `[${campaignId}] Batch submission failed:`,
                error
            );

            break;
        }
    }

    if (acceptedJobs.length === 0) {
        return res.status(503).json({
            success: false,
            campaignId,
            message: dispatchError ?? 'Campaign could not be submitted.',
        });
    }

    const queuedRecipients = acceptedJobs.reduce(
        (total, job) => total + job.recipients.length, 0
    );

    const fullyQueued = acceptedJobs.length === totalBatches;

    return res.status(202).json({
        success: fullyQueued,
        campaignId,
        status: fullyQueued ? 'queued' : 'partially_queued',
        message: fullyQueued
            ? 'Campaign accepted for processing.'
            : 'Some campaign batches were accepted, but submission was interrupted.',
        accountPhone,
        totalRecipients: recipients.length,
        queuedRecipients,
        totalBatches,
        acceptedBatches: acceptedJobs.length,
        batches: jobs.map(job => ({
            jobId: job.jobId,
            batchNumber: job.batchNumber,
            recipients: job.recipients.length,
            status: acceptedJobs.includes(job) ? 'queued' : 'not_queued',
        })),
        ...(dispatchError ? { warning: dispatchError } : {warning: null}),
    });
};