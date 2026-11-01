import type { Request, Response } from 'express';
import { whatsAppEmitter } from '../config/eventEmitter.js';

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

    const unsubscribe = [
        forward('whatsapp:connection-code'),
        forward('whatsApp:connection-status'),
    ];

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