import { connect } from "node:net";

/**
 * Czy coś już nasłuchuje na porcie loopbacka. Równoległy przebieg E2E na tym
 * samym porcie nie kończy się błędem sam z siebie: `next start` drugiego
 * przebiegu pada na EADDRINUSE, a oczekiwanie na serwer dostaje odpowiedź
 * od serwera pierwszego — testy szłyby wtedy na cudzy świat i cudzą bazę.
 */
export function isPortInUse(port: number, host = "127.0.0.1", timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}
