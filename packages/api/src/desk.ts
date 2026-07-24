import type { OpportunityFilter, Store } from "@flip-desk/store";
import {
  type AlertDTO,
  type HealthDTO,
  type InventoryDTO,
  type Money,
  money,
  type OpportunityDTO,
  type PnlDTO,
  toAlertDTO,
  toHealthDTO,
  toInventoryDTO,
  toOpportunityDTO,
  toPnlDTO,
} from "./dto.js";

/**
 * The Desk API (plan §14): the read/command surface the UI consumes. Queries project the store into
 * JSON-safe DTOs; commands (approve/reject) move an opportunity through its lifecycle. This is the ONLY
 * thing the web app imports — it never touches the domain packages or the store directly.
 */
export interface DeskSummary {
  readonly newCount: number;
  readonly approvedCount: number;
  readonly inventoryCount: number;
  readonly netProfit: Money;
  readonly llmMode?: string;
  readonly httpMode?: string;
}

export class Desk {
  constructor(private readonly store: Store) {}

  async feed(filter?: OpportunityFilter): Promise<OpportunityDTO[]> {
    return (await this.store.listOpportunities(filter)).map(toOpportunityDTO);
  }

  async opportunity(id: string): Promise<OpportunityDTO | undefined> {
    const r = await this.store.getOpportunity(id);
    return r ? toOpportunityDTO(r) : undefined;
  }

  async inventory(): Promise<InventoryDTO[]> {
    return (await this.store.listInventory()).map(toInventoryDTO);
  }

  async pnl(): Promise<PnlDTO> {
    return toPnlDTO(await this.store.getPnl());
  }

  async alerts(): Promise<AlertDTO[]> {
    return (await this.store.listAlerts()).map(toAlertDTO);
  }

  async health(): Promise<HealthDTO[]> {
    return (await this.store.listHealth()).map(toHealthDTO);
  }

  async approve(id: string): Promise<OpportunityDTO | undefined> {
    const r = await this.store.setOpportunityStatus(id, "approved");
    return r ? toOpportunityDTO(r) : undefined;
  }

  async reject(id: string): Promise<OpportunityDTO | undefined> {
    const r = await this.store.setOpportunityStatus(id, "rejected");
    return r ? toOpportunityDTO(r) : undefined;
  }

  async summary(mode?: { llm?: string; http?: string }): Promise<DeskSummary> {
    const [all, inv, pnl] = await Promise.all([
      this.store.listOpportunities(),
      this.store.listInventory(),
      this.store.getPnl(),
    ]);
    return {
      newCount: all.filter((o) => o.status === "new").length,
      approvedCount: all.filter((o) => o.status === "approved").length,
      inventoryCount: inv.length,
      netProfit: money(pnl.netProfitCents),
      ...(mode?.llm ? { llmMode: mode.llm } : {}),
      ...(mode?.http ? { httpMode: mode.http } : {}),
    };
  }
}
