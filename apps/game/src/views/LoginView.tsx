import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { gateway } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { FRAME_FONT } from "../ui/charFrame";
import { LOGIN_COLORS, LOGIN_FORM, LOGIN_TITLE_FONT, u } from "../ui/login";
import { LOGIN_FRAME_ART, LOGIN_FRAME_SIZE, RIBBON_BAND } from "../ui/loginFrameArt";
import { Ribbon } from "../ui/Ribbon";
import {
  LoginBackdrop,
  LoginBotaoLargo,
  LoginCampo,
  LoginCheckbox,
  LoginColuna,
  LoginError,
  LoginPainelOrnado,
  useLarguraDoPalco,
} from "../ui/LoginChrome";
import {
  LoginEpigrafe,
  LoginLinks,
  LoginRating,
  LoginRegioes,
  LoginTitulo,
} from "../ui/LoginDecor";

/**
 * Tela de login — "Império Antigo".
 *
 * A cena pintada é o `background.jpg` LIMPO; título, placas de região,
 * classificação indicativa, atalhos do rodapé e epígrafe são desenhados por
 * cima (`ui/LoginDecor`), em % do palco. O porquê do palco está em
 * `ui/LoginChrome.LoginBackdrop`.
 *
 * A conta é a tabela `login` do rAthena (nada de Supabase aqui). Conta nova sai
 * pelo próprio jogo, como no RO: usuário terminando em `_M`/`_F` que ainda não
 * existe é criado na hora (`new_account: yes` em `rathena-conf/login_conf.txt`)
 * e o sufixo some — `bruno_M` vira a conta `bruno`. Por isso o botão de criar
 * conta só monta o sufixo e manda o mesmo pacote de login.
 */

/** onde o nome do último acesso fica, para o "lembrar de mim" */
const LEMBRAR = "ragnarok:ultimo-usuario";

export function LoginView() {
  const navigate = useNavigate();
  const phase = useSessionStore((s) => s.phase);
  const error = useSessionStore((s) => s.error);
  /**
   * "Lembrar de mim" guarda só o USUÁRIO, nunca a senha.
   *
   * Senha em `localStorage` fica legível para qualquer script da página e
   * sobrevive à sessão — é o tipo de conveniência que não se paga. Poupar a
   * digitação do nome é o que a caixa realmente entrega, e é o que o cliente
   * oficial do RO faz.
   */
  const [username, setUsername] = useState(() => localStorage.getItem(LEMBRAR) ?? "");
  const [lembrar, setLembrar] = useState(() => localStorage.getItem(LEMBRAR) !== null);
  const [password, setPassword] = useState("");
  const [sex, setSex] = useState<"M" | "F">("M");
  const [creating, setCreating] = useState(false);
  const [sent, setSent] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (phase === "chars") navigate("/char-select");
  }, [phase, navigate]);

  useEffect(() => {
    if (error) setSent(false);
  }, [error]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    if (lembrar) localStorage.setItem(LEMBRAR, username);
    else localStorage.removeItem(LEMBRAR);

    useSessionStore.getState().setError(null);
    useSessionStore.getState().setPhase("connecting");
    setSent(true);

    gateway().emit("auth:login", {
      username: creating ? `${username}_${sex}` : username,
      password,
    });
  };

  return (
    <LoginBackdrop>
      <LoginRegioes />

      {/* título e painel em FLUXO, na mesma coluna: absolutos, eles se
          atropelavam em janela baixa — o painel subia por cima do nome */}
      <LoginColuna>
        <LoginTitulo />

      <LoginPainelOrnado largura={u(LOGIN_FORM.largura)} style={{ flex: "0 0 auto" }}>
        <HeaderRibbon>{creating ? "Funde sua linhagem" : "Entre em sua jornada"}</HeaderRibbon>

        <form onSubmit={submit} style={{ display: "grid", gap: u(0.7) }}>
          <LoginCampo
            icone="usuario"
            aria-label="Usuário"
            placeholder="Usuário"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <LoginCampo
            icone="senha"
            aria-label="Senha"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={creating ? "new-password" : "current-password"}
          />

          {creating ? (
            /**
             * O SEXO vira o sufixo `_M`/`_F` da conta, e o rAthena o grava na
             * criação — não há pacote para mudar depois. Daí o aviso embaixo: é
             * escolha definitiva, e o jogador tem de saber ANTES do botão.
             */
            <div style={{ display: "flex", alignItems: "center", gap: u(0.6), marginTop: u(0.2) }}>
              <span style={{ fontFamily: FRAME_FONT, fontSize: u(1.35), color: LOGIN_COLORS.inkDim }}>
                Sexo
              </span>
              {(["M", "F"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSex(s)}
                  style={{
                    appearance: "none",
                    flex: 1,
                    padding: `${u(0.45)} ${u(0.6)}`,
                    borderRadius: u(0.25),
                    border: `1px solid ${sex === s ? LOGIN_COLORS.gold : LOGIN_COLORS.goldFaint}`,
                    background: sex === s ? "rgba(150,112,38,0.42)" : "rgba(8,6,4,0.6)",
                    fontFamily: FRAME_FONT,
                    fontSize: u(1.35),
                    color: LOGIN_COLORS.ink,
                    cursor: "pointer",
                  }}
                >
                  {s === "M" ? "Masculino" : "Feminino"}
                </button>
              ))}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: u(0.6),
                marginTop: u(0.1),
              }}
            >
              <LoginCheckbox checked={lembrar} onChange={setLembrar}>
                Lembrar de mim
              </LoginCheckbox>
              {/**
               * O rAthena NÃO tem recuperação de senha pelo cliente — não há
               * pacote para isso, e a tabela `login` não tem fluxo de e-mail
               * associado. Em vez de um link para uma página que não existe, o
               * botão diz a verdade: quem repõe senha é quem administra.
               */}
              <button
                type="button"
                onClick={() =>
                  setAviso(
                    "A troca de senha é feita por quem administra o servidor — o rAthena não tem recuperação pelo cliente.",
                  )
                }
                style={{
                  appearance: "none",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  fontFamily: FRAME_FONT,
                  fontSize: u(1.35),
                  color: "#d8c48a",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Esqueceu sua senha?
              </button>
            </div>
          )}

          <div style={{ marginTop: u(0.6) }}>
            <LoginBotaoLargo type="submit" tom="entrar" disabled={sent}>
              {sent ? "conectando…" : creating ? "Criar e entrar" : "Entrar"}
            </LoginBotaoLargo>
          </div>
        </form>

        <Separador>ou</Separador>

        <LoginBotaoLargo
          tom="criar"
          onClick={() => {
            setCreating((v) => !v);
            setAviso(null);
          }}
        >
          {creating ? "Já tenho conta" : "Criar conta"}
        </LoginBotaoLargo>

        {creating && (
          <p
            style={{
              margin: `${u(0.9)} 0 0`,
              fontFamily: FRAME_FONT,
              fontSize: u(1.15),
              lineHeight: 1.5,
              color: LOGIN_COLORS.inkFaint,
              textAlign: "center",
            }}
          >
            A conta é criada no primeiro acesso. O sexo não muda depois.
          </p>
        )}

        {aviso && !error && (
          <p
            style={{
              margin: `${u(0.9)} 0 0`,
              fontFamily: FRAME_FONT,
              fontSize: u(1.2),
              lineHeight: 1.5,
              color: LOGIN_COLORS.inkDim,
              textAlign: "center",
            }}
          >
            {aviso}
          </p>
        )}
        {error && <LoginError>{error}</LoginError>}
      </LoginPainelOrnado>
      </LoginColuna>

      <LoginRating />
      <LoginLinks />
      <LoginEpigrafe />
    </LoginBackdrop>
  );
}

/**
 * A fita "Entre em sua jornada" — leia1.txt: "papel de cima centralizado no
 * login com texto dentro". Sobrepõe o trilho de cima do painel (`ChatFrame`
 * dentro de `LoginPainelOrnado`), por isso `position:absolute` com `top`
 * negativo em vez de nascer em fluxo: o `marginBottom` que havia antes só
 * empurrava o resto do formulário para baixo, nunca fazia a fita ENCOSTAR na
 * moldura como a referência mostra.
 *
 * `escala` remedida pela ALTURA renderizada (a conta só pela largura do bico
 * saía baixa demais, mesmo erro que a fita da era teve): na `referencia.png`
 * a fita mede ~55 px de alto num palco de 1402, contra 68 nativos do bico →
 * `escala(1402) ≈ 55/68 ≈ 0,81`.
 */
function HeaderRibbon({ children }: { children: React.ReactNode }) {
  const palco = useLarguraDoPalco();
  const escala = Math.max(0.45, Math.min(1.0, palco * 0.000578));
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: "50%",
        // -58% deixava a fita flutuando quase toda ACIMA do painel, sobre a
        // pintura crua — a moldura do painel (`ChatFrame`) tem uma margem
        // transparente no próprio topo da arte, então o pouco que sobrava
        // "dentro" (42%) ainda caía nessa margem e nenhuma vinha aparecia
        // por trás da fita (referencia2.png, marcação 2: "o papel é dentro
        // do canva de login"). Com -38% ela mergulha mais no painel, até
        // onde a folhagem de verdade começa.
        transform: "translate(-50%, -38%)",
        zIndex: 3,
        width: u(27),
      }}
    >
      <Ribbon
        cap={LOGIN_FRAME_ART.headerCap}
        ext={LOGIN_FRAME_ART.headerExt}
        tam={{ cap: LOGIN_FRAME_SIZE.headerCap, ext: LOGIN_FRAME_SIZE.headerExt }}
        banda={RIBBON_BAND.header}
        escala={escala}
        largura="100%"
      >
        <span
          style={{
            fontFamily: LOGIN_TITLE_FONT,
            fontSize: u(1.5),
            letterSpacing: u(0.06),
            // mesma correção da fita da era (`ui/LoginDecor.tsx: EraRibbon`):
            // `letter-spacing` só some depois de cada letra, e a folga do
            // último caractere puxava o texto pra esquerda dentro da caixa
            // centralizada por flex.
            marginLeft: u(0.06),
            textTransform: "uppercase",
            color: "#f0e2ae",
            textShadow: `0 ${u(0.06)} ${u(0.12)} rgba(0,0,0,0.9)`,
            whiteSpace: "nowrap",
          }}
        >
          {children}
        </span>
      </Ribbon>
    </div>
  );
}

/** "ou" entre dois filetes, separando entrar de criar conta */
function Separador({ children }: { children: React.ReactNode }) {
  const traco: React.CSSProperties = {
    flex: 1,
    height: 1,
    background: `linear-gradient(90deg, transparent, ${LOGIN_COLORS.goldSoft}, transparent)`,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: u(0.8), margin: `${u(0.9)} 0` }}>
      <div style={traco} />
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontSize: u(1.35),
          letterSpacing: u(0.1),
          textTransform: "uppercase",
          color: LOGIN_COLORS.inkFaint,
        }}
      >
        {children}
      </span>
      <div style={traco} />
    </div>
  );
}
