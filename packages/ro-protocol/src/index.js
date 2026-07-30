/**
 * @ragnarok/ro-protocol
 *
 * Codec do protocolo binario do rAthena para Node. `src/vendor/**` e o
 * roBrowserLegacy (GPL-3.0) quase intacto; o resto e a camada fina deste
 * projeto (registro sem singleton, enquadramento por conexao, socket TCP).
 */
export { initProtocol, getPacket, packetId, PACKET, PACKETVER, Configs } from "./registry.js";
export { PacketStream } from "./stream.js";
export { RoConnection, longToIP } from "./connection.js";
export { default as BinaryReader } from "./vendor/Utils/BinaryReader.js";
export { default as BinaryWriter } from "./vendor/Utils/BinaryWriter.js";
