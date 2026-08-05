import { Profiler, useEffect, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { registrarEvento } from "./flightRecorder";
import { observarRenderer } from "./rendererProbe";
import {
  marcarDesmontagemDaCena,
  marcarDesmontagemDe,
  marcarMontagemDaCena,
  marcarMontagemDe,
  marcarRevelacao,
  marcarSuspensao,
} from "./cenaProbe";

/**
 * Sonda para os canvases SECUNDÁRIOS — hoje, os retratos do HUD.
 *
 * Cada `CharacterPortrait` é um `WebGLRenderingContext` inteiro (placa do
 * personagem, placa do alvo, janela de Status), e foi o vai-e-vem deles que
 * estourou o teto de ~16 contextos do Chrome e forçou a perda do contexto do
 * JOGO — os `Context Lost` × 19 do laudo. Eles emitem evento e contam em
 * `contextosVivos`, mas NÃO armam captura: abrir a janela de Status é ação do
 * jogador, não defeito, e capturar isso encheria os quatro slots de caso com
 * ruído de UI.
 *
 * Módulo à parte, e não um export do `scene/PerfHud`, para o HUD não passar a
 * depender do overlay do F9 — quem monta a sonda não tem nada com quem desenha
 * o medidor.
 */
export function SondaDeCanvas({ nome }: { nome: string }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => observarRenderer(gl, { nome }), [gl, nome]);
  return null;
}

/**
 * O FALLBACK de um `<Suspense>`, e é isso que a torna o sinal DIRETO.
 *
 * Ela não infere suspensão de efeito remontado nem de contador: o fallback só
 * existe enquanto o boundary está suspenso, então montar = suspendeu e
 * desmontar = revelou. Nada mais no React dá essa informação — a promessa é
 * lançada no render e o boundary a captura sem nome nem origem.
 *
 * O `nome` é o que responde "qual boundary caiu", e por isso todo `<Suspense>`
 * do jogo precisa passar um: com dois suspendendo ao mesmo tempo, um sinal
 * anônimo não distinguiria a cena do retrato do HUD.
 *
 * `useEffect`, e não `useLayoutEffect`: o carimbo tem de sair no mesmo commit
 * em que a cena é escondida, e um efeito de layout na montagem do fallback
 * ainda roda ANTES de o R3F aplicar o `hideInstance` nos irmãos.
 */
export function SondaDeSuspense({ nome }: { nome: string }) {
  useEffect(() => {
    marcarSuspensao(nome);
    return () => marcarRevelacao(nome);
  }, [nome]);
  return null;
}

/**
 * Montagem e desmontagem da CENA, para separar "escondida" de "desmontada".
 *
 * Vai DENTRO da `<Scene>`. Na re-suspensão o R3F esconde em vez de desmontar,
 * então esta sonda ficar calada enquanto a `SondaDeSuspense` monta é justamente
 * a prova de que não houve desmonte — e o contrário (esta disparando) derruba a
 * hipótese do Suspense.
 */
export function SondaDeCena() {
  useEffect(() => {
    marcarMontagemDaCena();
    return () => marcarDesmontagemDaCena();
  }, []);
  return null;
}

/**
 * Montagem/desmontagem de uma subárvore qualquer, por NOME — e ela é DOM, não
 * R3F.
 *
 * O suspeito da vez está fora do `<Canvas>`: o retrato do HUD recria um
 * contexto WebGL inteiro ao montar, e a pergunta é QUEM o montou. Marcando o
 * HUD, cada placa e a janela de Status com nomes distintos, a ordem dos eventos
 * responde sozinha — "o HUD desmontou e levou os três" tem uma assinatura
 * diferente de "só a placa do alvo remontou".
 *
 * Ela NÃO mede custo: quem mede é a coluna. Aqui só se registra quem e quando.
 */
export function SondaDeMontagem({ nome, dados }: { nome: string; dados?: Record<string, unknown> }) {
  useEffect(() => {
    marcarMontagemDe(nome, dados);
    return () => marcarDesmontagemDe(nome);
    // `dados` de propósito FORA das dependências: ele é rótulo, e um objeto
    // literal no chamador remontaria a sonda a cada render do pai
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome]);
  return null;
}

/** abaixo disto o render é normal e não vale evento */
const LIMIAR_RENDER_MS = 25;

const aoRenderizar: ProfilerOnRenderCallback = (id, fase, atual, base) => {
  if (atual < LIMIAR_RENDER_MS) return;
  registrarEvento("cena", "render-lento", {
    id,
    fase,
    ms: Math.round(atual),
    // `base` é quanto custaria SEM memoização nenhuma: perto do `atual`, o
    // trabalho é real; muito abaixo, alguém está re-renderizando à toa
    semMemo: Math.round(base),
  });
};

/**
 * Cronômetro do PRÓPRIO React, via `<Profiler>`.
 *
 * Ela existe porque cinco medições pontuais falharam em achar 650 ms: no
 * `voo-1785948017665.json` os quatro `frameLongo` (574–652 ms) somam
 * `trocaMs` = **28 ms no caso inteiro**, com `contextoMs`, `descarteMs`,
 * `modeloMs` e `renderMs` zerados e uma `longtask` de 650 ms marcada como UMA
 * tarefa síncrona. Ou seja: o custo não está em nenhuma função que dê para
 * embrulhar por fora — está no render e no commit de uma subárvore.
 *
 * Sondar mais chamadas uma a uma já se mostrou o caminho errado duas vezes
 * (o contexto WebGL de 8 ms, os cinco suspeitos de 28 ms). O `Profiler` mede a
 * subárvore INTEIRA de uma vez e diz qual delas, sem palpite sobre a função.
 *
 * Custo: só em DEV, e o React já paga o `Profiler` no build de
 * desenvolvimento. O callback sai cedo abaixo do limiar.
 */
export function SondaDeRender({ id, children }: { id: string; children: ReactNode }) {
  if (!import.meta.env.DEV) return <>{children}</>;
  return (
    <Profiler id={id} onRender={aoRenderizar}>
      {children}
    </Profiler>
  );
}
