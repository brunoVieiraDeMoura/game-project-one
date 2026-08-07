import { useEffect, useState } from "react";

/**
 * Valor estabilizado após `ms` sem mudar — extraído do
 * `useEffect`+`setTimeout(300)` que estava copiado nas 6 páginas de lista.
 * `onSettle` roda quando o valor debounced é atualizado (normalmente
 * `() => setPage(1)`, pra busca nova sempre voltar pra primeira página).
 */
export function useDebounced<T>(value: T, ms = 300, onSettle?: () => void): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(value);
      onSettle?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);

  return debounced;
}
