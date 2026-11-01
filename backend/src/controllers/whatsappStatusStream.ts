import type { Request, Response } from 'express';
import { whatsAppEmitter } from '../config/eventEmitter.js';

const STREAM_EVENTS = [
    'whatsapp:connection-code',
    'whatsApp:connection-status',
    'job:progress',
    'job:completed',
    'message:sent',
    'message:failed',
] as const;

export const whatsappStream = (_req: Request, res: Response) => {

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.flushHeaders();

    console.log('SSE client connected.');

    res.write(
        `event: connected\n` +
        `data: ${JSON.stringify({ connected: true })}\n\n`
    );

    const forward = (eventName: string) => {

        const listener = (data: unknown) => {

            if (res.destroyed || res.writableEnded) return;

            res.write(
                `event: ${eventName}\n` +
                `data: ${JSON.stringify(data)}\n\n`
            );
        };

        whatsAppEmitter.on(eventName, listener);

        return () => {
            whatsAppEmitter.off(eventName, listener);
        };
    };

    const unsubscribe = STREAM_EVENTS.map(forward);

    const heartbeat = setInterval(() => {

        if (!res.destroyed && !res.writableEnded) {
            res.write(': heartbeat\n\n');
        }

    }, 25000);

    res.on('close', () => {

        clearInterval(heartbeat);

        unsubscribe.forEach(remove => remove());

        console.log('SSE connection closed.');
    });
};