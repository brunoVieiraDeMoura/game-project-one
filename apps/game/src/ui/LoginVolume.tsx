import { LOGIN_COLORS } from "./login";
import { CardFrame } from "./CardFrame";
import { setLoginVolume, toggleLoginMudo, useLoginVolume } from "./LoginMusic";

/**
 * Botão de volume da trilha — canto inferior-esquerdo de `/login` e
 * `/char-select` (os dois montam via `LoginBackdrop`). Mesma moldura de
 * madeira dos atalhos do rodapé (`CardFrame`, `bordas-botoes-cards`), pra não
 * destoar do resto da UI pintada.
 *
 * Clique no alto-falante alterna mudo; a barrinha ao lado arrasta o volume —
 * um `<input type="range">` de verdade (teclado/leitor de tela de graça),
 * invisível por cima de um trilho desenhado, o mesmo truque do checkbox de
 * "Lembrar de mim" (`ui/LoginChrome.tsx: LoginCheckbox`).
 *
 * Tamanho FIXO em vez de escalar com `u()`/palco: é um controle de canto,
 * não parte da composição central — e escalar exigiria `useLarguraDoPalco`
 * (definido em `ui/LoginChrome.tsx`, que já importa `LoginMusic`), o que
 * fecharia um import circular. `/login` e `/char-select` têm o mesmo DPI de
 * referência, então um tamanho fixo já lê bem nas duas.
 */
export function LoginVolumeButton() {
  const { volume, mudo } = useLoginVolume();
  const efetivo = mudo ? 0 : volume;

  return (
    <div style={{ position: "fixed", left: 18, bottom: 18, zIndex: 5 }}>
      <CardFrame
        border={9}
        background={LOGIN_COLORS.panel}
        inner={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}
      >
        <button
          type="button"
          onClick={toggleLoginMudo}
          title={mudo ? "Ativar som" : "Mudo"}
          style={{
            appearance: "none",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <IconeVolume efetivo={efetivo} />
        </button>
        <div style={{ position: "relative", width: 84, height: 8 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              background: "rgba(0,0,0,0.55)",
              border: `1px solid ${LOGIN_COLORS.goldFaint}`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 1,
              top: 1,
              bottom: 1,
              width: `calc(${efetivo * 100}% - 2px)`,
              borderRadius: 999,
              background: LOGIN_COLORS.gold,
              pointerEvents: "none",
            }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(efetivo * 100)}
            onChange={(e) => setLoginVolume(Number(e.target.value) / 100)}
            aria-label="Volume da música"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              margin: 0,
              opacity: 0,
              cursor: "pointer",
            }}
          />
        </div>
      </CardFrame>
    </div>
  );
}

function IconeVolume({ efetivo }: { efetivo: number }) {
  const cor = LOGIN_COLORS.gold;
  if (efetivo <= 0) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={18}
        height={18}
        aria-hidden
        fill="none"
        stroke={cor}
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M4 10v4h4l5 4V6l-5 4H4z" fill={cor} stroke="none" />
        <line x1="16" y1="9" x2="21" y2="15" />
        <line x1="21" y1="9" x2="16" y2="15" />
      </svg>
    );
  }
  const alto = efetivo > 0.5;
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden
      fill="none"
      stroke={cor}
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 10v4h4l5 4V6l-5 4H4z" fill={cor} stroke="none" />
      <path d="M16 9a4 4 0 010 6" />
      {alto && <path d="M18.5 6.5a8 8 0 010 11" />}
    </svg>
  );
}
