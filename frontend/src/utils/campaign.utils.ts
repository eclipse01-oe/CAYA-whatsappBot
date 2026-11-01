import type { Recipient } from './app.types';

export function cleanPhoneNumber(value: string): string {
    let phone = value.trim().replace(/\D/g, '');

    if (phone.startsWith('00')) {
        phone = phone.slice(2);
    } else if (/^0\d{10}$/.test(phone)) {
        phone = `234${phone.slice(1)}`;
    }

    return phone;
}

export function parseRecipients(data: string): Recipient[] {
    const lines = data
        .replace(/\r/g, '')
        .split('\n')
        .filter(line => line.trim());

    if (!lines.length) {
        throw new Error('Please provide recipient data.');
    }

    if (lines.length > 100) {
        throw new Error('Maximum of 100 recipients allowed.');
    }

    const recipients: Recipient[] = [];
    const seenPhones = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Remove numbering and bullet points.
        line = line.replace(
            /^(?:\d+\s*[.)\-:]\s*|[•●▪◦‣*-]\s*)+/u,
            ''
        ).trim();

        const match =
            line.match(/^(.+?)\s*(?:\||—|–|:)\s*(.+)$/) ??
            line.match(/^(.+?)\s+-\s+(.+)$/);

        if (!match) {
            throw new Error(
                `Invalid recipient on line ${i + 1}. Use Name | Phone.`
            );
        }

        const name = match[1].trim();
        const phone = cleanPhoneNumber(match[2]);

        if (!name) {
            throw new Error(`Missing name on line ${i + 1}.`);
        }

        if (!/^[1-9]\d{7,14}$/.test(phone)) {
            throw new Error(
                `Invalid phone number for ${name} on line ${i + 1}.`
            );
        }

        if (seenPhones.has(phone)) {
            throw new Error(
                `Duplicate phone number detected: ${phone}.`
            );
        }

        seenPhones.add(phone);

        recipients.push({
            name,
            phone,
        });
    }

    return recipients;
}