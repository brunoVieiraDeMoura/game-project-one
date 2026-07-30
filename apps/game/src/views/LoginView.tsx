import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { gateway } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { Panel, RpgButton, ink } from "../ui/rpg";

/**
 * Tela de login. A conta é a tabela `login` do rAthena (nada de Supabase aqui).
 *
 * Conta nova sai pelo próprio jogo, como no RO: usuário terminando em `_M`/`_F`
 * que ainda não existe é criado na hora (`new_account: yes` em
 * rathena-conf/login_conf.txt) e o sufixo some — `bruno_M` vira a conta
 * `bruno`. Por isso o botão de criar conta só monta o sufixo e manda o mesmo
 * pacote de login.
 */
export function LoginView() {
  const navigate = useNavigate();
  const phase = useSessionStore((s) => s.phase);
  const error = useSessionStore((s) => s.error);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sex, setSex] = useState<"M" | "F">("M");
  const [creating, setCreating] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (phase === "chars") {
      navigate("/char-select");
    }
  }, [phase, navigate]);

  useEffect(() => {
    if (error) {
      setSent(false);
    }
  }, [error]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    useSessionStore.getState().setError(null);
    useSessionStore.getState().setPhase("connecting");
    setSent(true);

    gateway().emit("auth:login", {
      username: creating ? `${username}_${sex}` : username,
      password,
    });
  };

  return (
    <div style={backdrop}>
      <Panel style={{ width: 340, padding: 22 }}>
        <h1 style={title}>Ragnarok</h1>
        <p style={subtitle}>{creating ? "criar conta" : "entrar"}</p>

        <form onSubmit={submit} style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <label style={label}>
            Usuário
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={input}
              autoComplete="username"
            />
          </label>

          <label style={label}>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={input}
              autoComplete="current-password"
            />
          </label>

          {creating && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: ink.dim, font: "12px system-ui" }}>Sexo</span>
              <RpgButton color="blue" active={sex === "M"} onClick={() => setSex("M")}>
                Masculino
              </RpgButton>
              <RpgButton color="blue" active={sex === "F"} onClick={() => setSex("F")}>
                Feminino
              </RpgButton>
            </div>
          )}

          <button type="submit" disabled={sent} style={{ ...primary, opacity: sent ? 0.6 : 1 }}>
            {sent ? "conectando…" : creating ? "Criar e entrar" : "Entrar"}
          </button>
        </form>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
          <RpgButton onClick={() => setCreating((v) => !v)}>
            {creating ? "Já tenho conta" : "Criar conta"}
          </RpgButton>
          <span style={{ color: ink.faint, font: "11px system-ui", alignSelf: "center" }}>
            servidor local
          </span>
        </div>

        {error && <p style={errorStyle}>{error}</p>}
      </Panel>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle at 50% 30%, #1b2233 0%, #070910 70%)",
};

const title: React.CSSProperties = {
  margin: 0,
  font: "700 26px system-ui",
  color: ink.text,
  letterSpacing: 1,
  textAlign: "center",
};

const subtitle: React.CSSProperties = {
  margin: "4px 0 0",
  font: "12px system-ui",
  color: ink.faint,
  textAlign: "center",
  textTransform: "uppercase",
  letterSpacing: 2,
};

const label: React.CSSProperties = {
  display: "grid",
  gap: 4,
  font: "12px system-ui",
  color: ink.dim,
};

const input: React.CSSProperties = {
  background: "rgba(0,0,0,0.45)",
  border: `1px solid ${ink.border}`,
  borderRadius: 7,
  color: ink.text,
  font: "13px system-ui",
  padding: "8px 10px",
  outline: "none",
};

const primary: React.CSSProperties = {
  marginTop: 4,
  border: "1px solid #4f46e5",
  borderRadius: 7,
  background: "#4f46e5",
  color: "#fff",
  font: "600 13px system-ui",
  padding: "9px 12px",
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  margin: "12px 0 0",
  padding: "8px 10px",
  borderRadius: 7,
  background: "rgba(220,38,38,0.14)",
  border: "1px solid rgba(248,113,113,0.4)",
  color: "#fca5a5",
  font: "12px system-ui",
};
