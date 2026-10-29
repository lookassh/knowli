"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { createParentQueryClient } from "./query-client";
import { PARENT_COLOR_SCHEME_KEY, parentCssVariablesResolver, parentTheme } from "./theme";

const colorSchemeManager = localStorageColorSchemeManager({ key: PARENT_COLOR_SCHEME_KEY });

type AuthExpiredHandler = () => void;
const AuthExpiredContext = createContext<(handler: AuthExpiredHandler | null) => void>(() => {});

/**
 * Rejestruje reakcję ekranu na wygasłą sesję (401 z dowolnego zapytania
 * lub mutacji TanStack Query). Ostatnio zarejestrowany handler wygrywa.
 */
export function useAuthExpiredHandler(handler: AuthExpiredHandler): void {
  const register = useContext(AuthExpiredContext);
  useEffect(() => {
    register(handler);
    return () => register(null);
  }, [register, handler]);
}

/**
 * Providery wyłącznie drzewa `/parent`: Mantine (motyw, tryb jasny/ciemny,
 * modale, powiadomienia) i TanStack Query. Kid UI ich nie używa.
 */
export function ParentProviders({ children }: { children: ReactNode }) {
  const authExpired = useRef<AuthExpiredHandler | null>(null);
  const [queryClient] = useState(() => createParentQueryClient(() => authExpired.current?.()));
  const [register] = useState(() => (handler: AuthExpiredHandler | null) => {
    authExpired.current = handler;
  });

  return (
    <MantineProvider
      theme={parentTheme}
      cssVariablesResolver={parentCssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <QueryClientProvider client={queryClient}>
        <AuthExpiredContext.Provider value={register}>
          <ModalsProvider>
            <Notifications />
            {children}
          </ModalsProvider>
        </AuthExpiredContext.Provider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
