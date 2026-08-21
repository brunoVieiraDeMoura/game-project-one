import type { Item, ItemSubType, ItemType } from "@ragnarok/game-data";

export interface ItemListQuery {
  page: number;
  pageSize: number;
  /** name/aegisName substring filter */
  search?: string | undefined;
  type?: ItemType | undefined;
  subType?: ItemSubType | undefined;
}

export interface ItemListResult {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Storage abstraction for the Items module. Current implementation is a
 * JSON-file store seeded from the legacy migration output; the Supabase
 * implementation replaces it once the database schema (Bloco 3) is approved —
 * routes and admin UI don't change.
 */
export interface ItemRepository {
  list(query: ItemListQuery): Promise<ItemListResult>;
  get(id: number): Promise<Item | undefined>;
  create(item: Item): Promise<Item>;
  update(id: number, item: Item): Promise<Item | undefined>;
  remove(id: number): Promise<boolean>;
  /**
   * Ícone visual do item (`Item.icon`, um nome de arquivo em
   * `public/assets/items/`) — separado de `update()` de propósito: quem tem
   * esse campo em coluna própria acaba de ganhar upload de verdade
   * (`POST /items/:id/icon`), os outros backends (JSON, Supabase legado)
   * seguem sem ele. `undefined` = backend não suporta.
   */
  setIcon?(id: number, filename: string | null): Promise<Item | undefined>;
}
