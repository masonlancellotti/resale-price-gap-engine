/**
 * Mail-provider seam (plan §4.2, §4.4). Production reads the operator's own inbox via the Gmail API
 * (a dedicated address that saved-search alert emails route to); tests use {@link FakeMailProvider}.
 * This is a T2 channel: parsing emails the platforms themselves send us — zero collection risk.
 */
export interface EmailMessage {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly html?: string;
  readonly text?: string;
}

export interface MailQuery {
  readonly label?: string;
  readonly from?: string;
  readonly unreadOnly?: boolean;
}

export interface MailProvider {
  fetch(query: MailQuery): Promise<EmailMessage[]>;
}

export class FakeMailProvider implements MailProvider {
  constructor(private readonly messages: readonly EmailMessage[]) {}
  async fetch(query: MailQuery): Promise<EmailMessage[]> {
    return this.messages.filter((m) => (query.from ? m.from.includes(query.from) : true));
  }
}
