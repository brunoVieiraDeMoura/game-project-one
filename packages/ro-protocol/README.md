# @ragnarok/ro-protocol

Codec do protocolo binário do rAthena para Node: definições de pacote, tabelas de
tamanho por packetver e enquadramento do stream TCP.

## Origem e licença

`src/vendor/**` é código do **roBrowserLegacy** (Vincent Thibault / MrAntares),
licenciado sob **GNU GPL v3**. Copiado e adaptado — não reescrito. As mudanças
feitas na cópia:

- imports por alias (`Utils/…`, `Core/…`) reescritos para caminhos relativos;
- `window`/`self` → `globalThis` (`Core/Configs.js`, `Utils/BinaryReader.js`,
  `Network/PacketVerManager.js`);
- `import('UI/UIManager.js')` removido do `PacketVerManager` (não há DOM aqui);
- nada mais: as structs e as tabelas de versão estão intactas de propósito, para
  poderem ser re-sincronizadas com o upstream.

Consequência: **este pacote e tudo que o linka são GPL-3.0**. O servidor rAthena
também é GPL-3.0.

## O que este pacote NÃO faz

Não há singleton de conexão como o `NetworkManager` do roBrowser (um socket por
processo). Aqui cada `RoConnection` é independente, porque o gateway atende várias
sessões ao mesmo tempo. O laço de enquadramento foi reescrito a partir do
`NetworkManager.receive()`, preservando os dois comportamentos que importam:
pacote partido entre dois `data` do TCP e pacote de tamanho variável (`len < 0`
na tabela → o tamanho real vem no `uint16` seguinte).

## Uso

```js
import { initProtocol, PACKET, RoConnection } from "@ragnarok/ro-protocol";

initProtocol(20130618);

const login = new RoConnection({ host: "127.0.0.1", port: 6900 });
login.on(PACKET.AC.ACCEPT_LOGIN, (pkt) => console.log(pkt.ServerList));
await login.connect();

const req = new PACKET.CA.LOGIN();
req.ID = "teste";
req.Passwd = "teste123";
req.Version = 25;
req.clienttype = 12;
login.send(req);
```

`readRaw(cb)` cobre os dois pontos do protocolo onde o servidor manda bytes soltos
sem cabeçalho de pacote (o account id logo após `CH.ENTER`, e o mesmo após
`CZ.ENTER` em packetver < 20070521). Sem consumir esses 4 bytes o parser lê o AID
como opcode e o stream inteiro desanda.
