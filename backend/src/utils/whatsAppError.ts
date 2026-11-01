import { DisconnectReason } from '@whiskeysockets/baileys';

export const getDisconnectStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const output = ( error as {
    output?: {
      statusCode?: unknown;
    };
  }).output;

  return typeof output?.statusCode === 'number'
    ? output.statusCode
    : undefined;
}


export const reportFatalSession = (statusCode: number): void => {
  console.error('\nAutomatic reconnection stopped.');

  switch (statusCode) {
    case DisconnectReason.connectionReplaced:
      console.error(
        'Another connection may be using this WhatsApp session.'
      );
      console.error(
        'Check for duplicate bot processes before restarting.'
      );
      break;

    case DisconnectReason.badSession:
      console.error('WhatsApp rejected the saved session.');
      console.error(
        'Inspect the authentication state before attempting a new pairing.'
      );
      break;

    case DisconnectReason.forbidden:
      console.error(
        'WhatsApp returned a forbidden response.'
      );
      console.error(
        'Check the account and any security notices in WhatsApp.'
      );
      break;

    case DisconnectReason.multideviceMismatch:
      console.error(
        'WhatsApp reported a multi-device compatibility problem.'
      );
      break;

    default:
      console.error(`Disconnect status: ${statusCode}`);
  }
}
