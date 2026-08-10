import { z } from "zod";

/**
 * AST do corpo de script de um NPC do rAthena — a fonte de verdade pro
 * módulo NPCs (leia1.txt, aprovação da arquitetura, 2026-08-07). Sintaxe
 * (Lexer/Parser/AST, aqui) fica TOTALMENTE separada de semântica (Mapper,
 * fase seguinte): este arquivo não sabe o que `mes`/`cutin`/`switch(select(
 * ...))` SIGNIFICAM — só a FORMA gramatical deles. Ninguém além do Mapper
 * lê `callee`/`text` pra decidir comportamento.
 *
 * **Rótulos são pontos de entrada, não statements inline** (achado da
 * auditoria: ~30% do que o migrador antigo não conseguia ler eram só
 * `OnTouch:`/`OnInit:` etc., que não são parte do corpo linear — são outro
 * ponto de entrada do NPC, cada um com o próprio corpo). Por isso
 * `NpcScriptAst` é uma LISTA de `EntryPoint`, não um `Statement[]` só —
 * `label: null` é o corpo principal (clique no NPC), `label: "OnTouch"` é o
 * handler daquele evento.
 *
 * **Fallback é o MENOR nó sintático possível**: um statement não
 * reconhecido vira `RawStatement` (uma linha/trecho opaco), nunca o
 * restante do programa inteiro — a árvore ao redor (o `if`/`switch`/`while`
 * que contém aquele statement) continua válida. É o oposto do
 * `parse-npc-dialogue.ts` antigo, que perdia a estrutura inteira a partir
 * do primeiro statement não reconhecido.
 */

// ---------------------------------------------------------------------------
// Expressões — gramática C-like, Pratt parser (packages/.../parser.ts)
// ---------------------------------------------------------------------------

const IntLitSchema = z.object({ kind: z.literal("IntLit"), value: z.number().int() });
const StringLitSchema = z.object({ kind: z.literal("StringLit"), value: z.string() });
/** inclui o sigil de escopo como parte do nome (`.@input`, `$GLOBAL`, `hg_ma1`)
 * — são parte do LEXEMA no rAthena, não um operador de escopo separado. */
const IdentSchema = z.object({ kind: z.literal("Ident"), name: z.string() });

export type Expr =
  | z.infer<typeof IntLitSchema>
  | z.infer<typeof StringLitSchema>
  | z.infer<typeof IdentSchema>
  | { kind: "Call"; callee: string; args: Expr[] }
  | { kind: "Index"; target: Expr; index: Expr }
  | { kind: "Unary"; op: "-" | "!" | "~"; operand: Expr }
  | { kind: "Binary"; op: string; left: Expr; right: Expr }
  | { kind: "Assign"; op: "=" | "+=" | "-=" | "&=" | "|=" | "^="; target: Expr; value: Expr }
  | { kind: "Ternary"; test: Expr; consequent: Expr; alternate: Expr };

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    IntLitSchema,
    StringLitSchema,
    IdentSchema,
    z.object({ kind: z.literal("Call"), callee: z.string(), args: z.array(ExprSchema) }),
    z.object({ kind: z.literal("Index"), target: ExprSchema, index: ExprSchema }),
    z.object({ kind: z.literal("Unary"), op: z.enum(["-", "!", "~"]), operand: ExprSchema }),
    z.object({ kind: z.literal("Binary"), op: z.string(), left: ExprSchema, right: ExprSchema }),
    z.object({ kind: z.literal("Assign"), op: z.enum(["=", "+=", "-=", "&=", "|=", "^="]), target: ExprSchema, value: ExprSchema }),
    z.object({ kind: z.literal("Ternary"), test: ExprSchema, consequent: ExprSchema, alternate: ExprSchema }),
  ]),
);

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** offset de CARACTERE no texto-fonte deste statement (início inclusive,
 * fim exclusivo) — opcional pra não quebrar literais construídos à mão
 * (testes), mas SEMPRE populado pelo parser de verdade
 * (`tools/legacy-migration/src/npc-script/parser.ts`). Existe pro Writer
 * (leia1.txt, 2026-08-08): sem isso não tem como recortar um trecho
 * INTOCADO do arquivo original byte a byte — só reimprimir via Printer,
 * que já é sabidamente reformatado. */
export interface SourceSpan {
  start?: number;
  end?: number;
}

export type Statement =
  /** `identificador(args);` OU `identificador arg,arg;` — TODO comando do
   * rAthena (mes/next/close/cutin/warp/getitem/...) cai aqui; reconhecer o
   * que cada `callee` FAZ é trabalho do Mapper, não do Parser. */
  | ({ kind: "CallStatement"; callee: string; args: Expr[]; line: number } & SourceSpan)
  /** atribuição "bare" (`.@x = 1;`) ou qualquer expressão solta como statement. */
  | ({ kind: "ExprStatement"; expr: Expr; line: number } & SourceSpan)
  /** `set Var,Expr;` — sintaxe de vírgula, forma DIFERENTE de `Var = Expr;`
   * embora semanticamente equivalente; preservada distinta pro Writer
   * reemitir a MESMA sintaxe que o admin usou, nunca normalizar por conta
   * própria (achado: as duas formas coexistem no corpus real). */
  | ({ kind: "SetStatement"; target: Expr; value: Expr; line: number } & SourceSpan)
  | ({
      kind: "IfStatement";
      test: Expr;
      consequent: Statement[];
      alternate: Statement[] | null;
      line: number;
      /** span de CARACTERE só do `test` (entre os parênteses) — pro Writer
       * poder trocar SÓ a condição, sem tocar em `if (`/`)`/nos ramos
       * (leia1.txt, 2026-08-08 — "edição de texto dentro de conditional"). */
      testStart?: number;
      testEnd?: number;
      /** offset de CARACTERE logo depois do `{` do ramo (ou onde o
       * statement único começa, na forma sem chaves) — pro Writer não
       * perder um comentário entre `{`/`)`  e o primeiro statement do
       * ramo (leia1.txt, 2026-08-09). */
      consequentBodyStart?: number;
      alternateBodyStart?: number;
    } & SourceSpan)
  | ({
      kind: "SwitchStatement";
      discriminant: Expr;
      cases: SwitchCase[];
      line: number;
      /** span de CARACTERE só do `discriminant` (entre os parênteses) — pro
       * Writer poder trocar só o `select("A:B:C")`, sem tocar nos `case`s. */
      discriminantStart?: number;
      discriminantEnd?: number;
    } & SourceSpan)
  | ({ kind: "WhileStatement"; test: Expr; body: Statement[]; line: number } & SourceSpan)
  | ({ kind: "DoWhileStatement"; body: Statement[]; test: Expr; line: number } & SourceSpan)
  | ({ kind: "ForStatement"; init: Statement | null; test: Expr | null; update: Statement | null; body: Statement[]; line: number } & SourceSpan)
  | ({ kind: "BlockStatement"; body: Statement[]; line: number } & SourceSpan)
  | ({ kind: "BreakStatement"; line: number } & SourceSpan)
  /** menor fallback possível — UM statement opaco, não o script inteiro. */
  | ({ kind: "RawStatement"; text: string; line: number } & SourceSpan);

export interface SwitchCase {
  /** `null` = `default:` */
  test: Expr | null;
  body: Statement[];
  /** span de CARACTERE do CABEÇALHO (`case N:` ou `default:`, incluindo os
   * dois-pontos) — pro Writer reusar VERBATIM quando o corpo daquele case
   * não mudou, em vez de reimprimir `case ${printExpr(test)}:` (que pode
   * divergir da sintaxe original — leia1.txt: "não transforme sintaxe
   * antiga em sintaxe nova sem necessidade"). */
  headerStart?: number;
  headerEnd?: number;
}

const SPAN = { start: z.number().int().optional(), end: z.number().int().optional() };

const StatementSchema: z.ZodType<Statement> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("CallStatement"), callee: z.string(), args: z.array(ExprSchema), line: z.number().int(), ...SPAN }),
    z.object({ kind: z.literal("ExprStatement"), expr: ExprSchema, line: z.number().int(), ...SPAN }),
    z.object({ kind: z.literal("SetStatement"), target: ExprSchema, value: ExprSchema, line: z.number().int(), ...SPAN }),
    z.object({
      kind: z.literal("IfStatement"),
      test: ExprSchema,
      consequent: z.array(StatementSchema),
      alternate: z.array(StatementSchema).nullable(),
      line: z.number().int(),
      testStart: z.number().int().optional(),
      testEnd: z.number().int().optional(),
      consequentBodyStart: z.number().int().optional(),
      alternateBodyStart: z.number().int().optional(),
      ...SPAN,
    }),
    z.object({
      kind: z.literal("SwitchStatement"),
      discriminant: ExprSchema,
      cases: z.array(
        z.object({
          test: ExprSchema.nullable(),
          body: z.array(StatementSchema),
          headerStart: z.number().int().optional(),
          headerEnd: z.number().int().optional(),
        }),
      ),
      line: z.number().int(),
      discriminantStart: z.number().int().optional(),
      discriminantEnd: z.number().int().optional(),
      ...SPAN,
    }),
    z.object({ kind: z.literal("WhileStatement"), test: ExprSchema, body: z.array(StatementSchema), line: z.number().int(), ...SPAN }),
    z.object({ kind: z.literal("DoWhileStatement"), body: z.array(StatementSchema), test: ExprSchema, line: z.number().int(), ...SPAN }),
    z.object({
      kind: z.literal("ForStatement"),
      init: StatementSchema.nullable(),
      test: ExprSchema.nullable(),
      update: StatementSchema.nullable(),
      body: z.array(StatementSchema),
      line: z.number().int(),
      ...SPAN,
    }),
    z.object({ kind: z.literal("BlockStatement"), body: z.array(StatementSchema), line: z.number().int(), ...SPAN }),
    z.object({ kind: z.literal("BreakStatement"), line: z.number().int(), ...SPAN }),
    z.object({ kind: z.literal("RawStatement"), text: z.string(), line: z.number().int(), ...SPAN }),
  ]),
);

export const SwitchCaseSchema = z.object({
  test: ExprSchema.nullable(),
  body: z.array(StatementSchema),
  headerStart: z.number().int().optional(),
  headerEnd: z.number().int().optional(),
});

/** `label: null` = corpo principal (clique); qualquer outro valor = handler
 * daquele rótulo (`"OnTouch"`, `"OnInit"`, ...), sem o `:` final. `bodyStart`/
 * `bodyEnd` (opcionais) marcam o span de CARACTERE do CORPO deste entry
 * point no texto-fonte do NPC inteiro (não inclui o rótulo em si) — o
 * Writer usa isso pra saber onde termina "este handler" e começa o
 * próximo, sem tocar em nenhum dos outros. */
export const EntryPointSchema = z.object({
  label: z.string().nullable(),
  body: z.array(StatementSchema),
  line: z.number().int(),
  bodyStart: z.number().int().optional(),
  bodyEnd: z.number().int().optional(),
});
export type EntryPoint = z.infer<typeof EntryPointSchema>;

export const NpcScriptAstSchema = z.object({
  entryPoints: z.array(EntryPointSchema),
});
export type NpcScriptAst = z.infer<typeof NpcScriptAstSchema>;

export { StatementSchema };
