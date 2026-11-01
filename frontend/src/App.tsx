import { useEffect, useState, type SubmitEvent } from 'react';

import { regStatus, submitCampaign } from './utils/api.utils';
import { parseRecipients } from './utils/campaign.utils';
import { useLocalStorage } from './utils/localStorage';

import type {
    ConnectionCode,
    ConnectionEvent,
    CampaignProgressEvent,
    CampaignCompletedEvent,
    CampaignResponse,
} from './utils/app.types';

import {
    Power,
    Code2,
    CheckCircle2,
    Activity,
    MessageSquareText,
    Users,
} from 'lucide-react';

import './App.css';


function App() {

    const [stored, setStored] = useLocalStorage('cayabot-data', {
        input: '',
        connectionStatus: [] as string[],
        message: '',
        recipientData: '',
        campaignStatus: [] as string[],
    });

    const {
        input,
        connectionStatus,
        message,
        recipientData,
        campaignStatus,
    } = stored;


    const [pairingCode, setPairingCode] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);

    const [streamReady, setStreamReady] = useState(false);

    const [isSending, setIsSending] = useState(false);


    const setInput = (value: string) => {
        setStored(prev => ({
            ...prev,
            input: value,
        }));
    };

    const setMessage = (value: string) => {
        setStored(prev => ({
            ...prev,
            message: value,
        }));
    };

    const setRecipientData = (value: string) => {
        setStored(prev => ({
            ...prev,
            recipientData: value,
        }));
    };

    const setConnectionStatus = (
        updater: string[] | ((previous: string[]) => string[])
    ) => {
        setStored(prev => ({
            ...prev,
            connectionStatus: typeof updater === 'function'
                ? updater(prev.connectionStatus)
                : updater,
        }));
    };

    const setCampaignStatus = (
        updater: string[] | ((previous: string[]) => string[])
    ) => {
        setStored(prev => ({
            ...prev,
            campaignStatus: typeof updater === 'function'
                ? updater(prev.campaignStatus)
                : updater,
        }));
    };

    useEffect(() => {

        const source = new EventSource(
            'http://localhost:3000/api/connection/stream'
        );

        source.onopen = () => {
            setStreamReady(true);
            console.log('SSE connected.');
        };

        source.onerror = () => {
            setStreamReady(false);
            console.log('SSE connection interrupted.');
        };

        source.addEventListener(
            'whatsapp:connection-code',
            event => {

                const data = JSON.parse(
                    (event as MessageEvent).data
                ) as ConnectionCode;

                setPairingCode(data.code);

                setConnectionStatus(v => [
                    ...v,
                    `Pairing code generated for ${data.phoneNumber}`,
                ]);
            }
        );

        source.addEventListener(
            'whatsApp:connection-status',
            event => {

                const data = JSON.parse(
                    (event as MessageEvent).data
                ) as ConnectionEvent;

                setConnectionStatus(v => [
                    ...v,
                    data.status,
                ]);
            }
        );


        source.addEventListener(
            'job:progress',
            event => {

                const data = JSON.parse(
                    (event as MessageEvent).data
                ) as CampaignProgressEvent;

                const recipient =
                    typeof data.recipient === 'string'
                        ? data.recipient
                        : data.recipient
                            ? `${data.recipient.name ?? ''}${data.recipient.phone
                                ? ` (${data.recipient.phone})`
                                : ''
                            }`
                            : '';

                setCampaignStatus(v => [
                    ...v,
                    `${data.status}: ${recipient}`,
                ]);
            }
        );

        source.addEventListener(
            'job:completed',
            event => {

                const data = JSON.parse(
                    (event as MessageEvent).data
                ) as CampaignCompletedEvent;

                setCampaignStatus(v => [
                    ...v,
                    `Campaign completed. Sent: ${data.summary.sent}, Failed: ${data.summary.failed}`,
                ]);
            }
        );


        return () => {
            source.close();
        };

    }, []);


    const onFormSubmit = async (
        event: SubmitEvent<HTMLFormElement>
    ) => {

        event.preventDefault();

        const number = input.replace(/\D/g, '');

        if (!/^[1-9]\d{7,14}$/.test(number)) {

            setConnectionStatus(v => [
                ...v,
                'Invalid international phone number.',
            ]);

            return;
        }

        if (!streamReady) {

            setConnectionStatus(v => [
                ...v,
                'Waiting for the event stream to connect.',
            ]);

            return;
        }

        setIsSubmitting(true);

        try {

            const result = await regStatus(number);

            setConnectionStatus(v => [
                ...v,
                result.message,
            ]);

        } catch (err) {

            const errorMessage = err instanceof Error
                ? err.message
                : 'Failed to initialize WhatsApp.';

            console.error('Error activating bot:', err);

            setConnectionStatus(v => [
                ...v,
                errorMessage,
            ]);

        } finally {

            setIsSubmitting(false);

        }
    };


    const sendCampaign = async (
        event: SubmitEvent<HTMLFormElement>
    ) => {

        event.preventDefault();

        if (!input.trim()) {

            setCampaignStatus(v => [
                ...v,
                'Enter the connected WhatsApp account number.',
            ]);

            return;
        }

        const accountPhone = input.replace(/\D/g, '');

        if (!/^[1-9]\d{7,14}$/.test(accountPhone)) {

            setCampaignStatus(v => [
                ...v,
                'Invalid sending account number.',
            ]);

            return;
        }

        if (!message.trim()) {

            setCampaignStatus(v => [
                ...v,
                'Message template cannot be empty.',
            ]);

            return;
        }

        let recipients;

        try {

            recipients = parseRecipients(recipientData);

        } catch (error) {

            setCampaignStatus(v => [
                ...v,
                error instanceof Error
                    ? error.message
                    : 'Invalid recipient data.',
            ]);

            return;
        }

        setIsSending(true);

        try {

            const result: CampaignResponse = await submitCampaign({
                accountPhone,
                message: message.trim(),
                recipients,
            });

            setCampaignStatus(v => [
                ...v,
                `Campaign ID: ${result.campaignId}`,
                result.message,
                `Recipients: ${result.queuedRecipients}/${result.totalRecipients}`,
                `Batches: ${result.acceptedBatches ?? result.totalBatches}`,
            ]);

            if (result.success) {
                setMessage('');
                setRecipientData('');
            }

        } catch (error) {

            const errorMessage = error instanceof Error
                ? error.message
                : 'Failed to submit campaign.';

            setCampaignStatus(v => [
                ...v,
                `❌ ${errorMessage}`,
            ]);

        } finally {

            setIsSending(false);

        }
    };


    return (
        <>
            {/* WhatsApp Connection */}
            <section id="center">

                <form onSubmit={onFormSubmit} id="phone-form">

                    <input
                        id="form-input"
                        type="text"
                        placeholder="Input number to connect"
                        onChange={e => setInput(e.target.value)}
                        value={input}
                    />

                    <button
                        type="submit"
                        disabled={isSubmitting || !streamReady}
                    >
                        <Power
                            className="icon"
                            size={100}
                            strokeWidth={1.8}
                        />

                        <span>
                            {isSubmitting || !streamReady
                                ? 'connecting...'
                                : 'connect'}
                        </span>
                    </button>

                </form>

                {!streamReady && (
                    <small>Establishing event stream...</small>
                )}

            </section>

            <div className="ticks"></div>


            {/* Connection Information */}
            <section id="next-steps">

                <div id="docs">

                    <div className="text-icon">
                        <p>Connection status</p>

                        <CheckCircle2
                            className="icon"
                            size={24}
                            strokeWidth={1.8}
                            color="green"
                        />
                    </div>

                    {connectionStatus.length > 0 ? (
                        <ul className="status-list">
                            {connectionStatus.map((v, i) => (
                                <li key={i}>{v}</li>
                            ))}
                        </ul>
                    ) : (
                        <p>No connection made yet.</p>
                    )}

                </div>


                <div id="social">

                    <div className="text-icon">
                        <p>Pairing code</p>

                        <Code2
                            className="icon"
                            size={24}
                            strokeWidth={1.8}
                            color="green"
                        />
                    </div>

                    {pairingCode ? (
                        <h2>{pairingCode}</h2>
                    ) : (
                        <p>Waiting for pairing code...</p>
                    )}

                </div>

            </section>

            <div className="ticks"></div>


            {/* Campaign Interface */}
            <section className="campaign-section">

                <header className="campaign-header">
                    <h2>WhatsApp Campaign</h2>

                    <p>
                        Create and distribute personalized messages
                        to multiple recipients.
                    </p>
                </header>


                <form
                    className="campaign-form"
                    onSubmit={sendCampaign}
                >

                    <div className="campaign-columns">

                        {/* Message Column */}
                        <div className="campaign-column">

                            <div className="text-icon">
                                <label htmlFor="campaign-message">
                                    Message template
                                </label>

                                <MessageSquareText
                                    className="icon"
                                    size={20}
                                    strokeWidth={1.8}
                                    color="green"
                                />
                            </div>

                            <textarea
                                className="glass"
                                id="campaign-message"
                                placeholder={`Hi \${name}, good morning!\nHow are you doing?\nWelcome to CAYA!`}
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                rows={16}
                            />

                            <small>
                                Use {'${name}'} to personalize each message.
                            </small>

                        </div>


                        {/* Recipient Data Column */}
                        <div className="campaign-column">

                            <div className="text-icon">
                                <label htmlFor="recipient-data">
                                    Recipient data
                                </label>

                                <Users
                                    className="icon"
                                    size={20}
                                    strokeWidth={1.8}
                                    color="green"
                                />
                            </div>

                            <textarea
                                className="glass"
                                id="recipient-data"
                                placeholder={
                                    `1. Emmanuel | 08012345678
2. David - 09012345678
3. Sarah: +254708920430
[- | : —] all work as separators`
                                }
                                value={recipientData}
                                onChange={e => setRecipientData(e.target.value)}
                                rows={16}
                            />

                            <small>
                                One recipient per line. Maximum 100 recipients.
                            </small>

                        </div>

                    </div>


                    <div className="campaign-actions">

                        <button
                            type="submit"
                            disabled={isSending}
                        >
                            {isSending
                                ? 'Submitting campaign...'
                                : 'Send campaign'}
                        </button>

                    </div>

                </form>


                {/* Campaign Activity */}
                <div className="campaign-activity">

                    <div className="text-icon">
                        <h3>Campaign activity</h3>

                        <Activity
                            className="icon"
                            size={22}
                            strokeWidth={1.8}
                            color="green"
                        />
                    </div>

                    {campaignStatus.length > 0 ? (
                        <ul className="status-list">
                            {campaignStatus.map((status, index) => (
                                <li key={index}>{status}</li>
                            ))}
                        </ul>
                    ) : (
                        <p>No campaign activity yet.</p>
                    )}

                </div>

            </section>

            <div className="ticks"></div>
        </>
    );
}

export default App;