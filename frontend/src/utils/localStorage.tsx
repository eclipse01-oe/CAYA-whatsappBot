import { useState, useEffect } from 'react';
import type { PersistedAppData } from './app.types';

export const useLocalStorage = (
    key: string,
    initialValue: PersistedAppData
) => {

    const [store, setStore] = useState<PersistedAppData>(() => {
        try {
            const saved = window.localStorage.getItem(key);

            return saved !== null
                ? JSON.parse(saved) as PersistedAppData
                : initialValue;

        } catch {
            return initialValue;
        }
    });

    useEffect(() => {
        window.localStorage.setItem(
            key,
            JSON.stringify(store)
        );
    }, [key, store]);

    return [store, setStore] as const;
};