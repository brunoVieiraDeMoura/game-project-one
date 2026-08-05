import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { gateway } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { FRAME_FONT } from "../ui/charFrame";
import { LOGIN_COLORS, LOGIN_FORM, u } from "../ui/login";
import {
  LoginBackdrop,
  LoginBotaoLargo,
  LoginCampo,
  LoginColuna,
  LoginError,
  LoginPainelOrnado,
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
        <div
          style={{
            textAlign: "center",
            fontFamily: FRAME_FONT,
            fontSize: u(1.05),
            letterSpacing: u(0.1),
            textTransform: "uppercase",
            color: "#e8d9ae",
            marginBottom: u(1.1),
          }}
        >
          {creating ? "Funde sua linhagem" : "Entre em sua jornada"}
        </div>

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
              <span style={{ fontFamily: FRAME_FONT, fontSize: u(0.8), color: LOGIN_COLORS.inkDim }}>
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
                    fontSize: u(0.8),
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
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: u(0.5),
                  fontFamily: FRAME_FONT,
                  fontSize: u(0.8),
                  color: LOGIN_COLORS.inkDim,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={lembrar}
                  onChange={(e) => setLembrar(e.target.checked)}
                  style={{ width: u(0.95), height: u(0.95), accentColor: LOGIN_COLORS.gold, cursor: "pointer" }}
                />
                Lembrar de mim
              </label>
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
                  fontSize: u(0.8),
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
              fontSize: u(0.72),
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
              fontSize: u(0.75),
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
          fontSize: u(0.8),
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
