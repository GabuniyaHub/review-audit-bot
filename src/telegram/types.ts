export interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; text?: string;
    from?: {id: number; is_bot?: boolean}; chat: {id: number; type: string} };
}
export interface SourceCardDraft { source: '2gis'|'yandex'; externalId: string; url: string }
export interface OrganizationDraft {name: string; city: string; address: string; cards: SourceCardDraft[]}
export interface SetupDraft { organizations: OrganizationDraft[]; current?: Partial<OrganizationDraft> }
